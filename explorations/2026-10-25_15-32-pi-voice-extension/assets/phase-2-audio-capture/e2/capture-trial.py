#!/usr/bin/env python3
"""E2 exploration only. No Pi extension. No playback/transcription or settings changes.

Run interactively inside Herdr with no arguments. --self-test uses fake children
and synthetic PCM only; it NEVER calls pw-record, wpctl or an audio API.
Private worker/fixture roles are not standalone user commands.
"""
from __future__ import annotations
import importlib.util
import json
import os
from pathlib import Path
import re
import selectors
import signal
import stat
import subprocess
import sys
import tempfile
import time
import wave

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
SELF = Path(__file__).resolve()
TARGET = 'alsa_input.pci-0000_00_1f.3-platform-sof_sdw.HiFi__Mic__source'
NORMAL_STARTUP = 3.0
SAFETY_STOP = 4.0  # Experiment abort, NOT successful normal completion.
SAFETY_TERM = 4.25
SAFETY_KILL = 4.5  # Reserve margin before the five-second process lifetime budget.
TAIL_LIMIT = 65536


def save_json(p, value):
    fd = os.open(p, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, 'w') as f:
        json.dump(value, f, indent=2)
        f.write('\n')


def emit(event, **fields):
    print(json.dumps({'event': event, **fields}), flush=True)


def validator():
    p = HERE.parent / 'e1/formats/format-checks.py'
    spec = importlib.util.spec_from_file_location('e1_format_validator', p)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.validate


def worker(run: Path, simulation=False, fake_mode='normal'):
    """Own exactly one recorder, independent of interactive parent's event loop.

    EOF on control pipe = discard. Timer stops/terminates/kills before five
    seconds under ordinary scheduler operation; this is not a real-time guarantee.
    The worker itself being SIGKILLed is outside this helper's guarantee.
    """
    os.umask(0o077)  # This disposable worker only; never the main Pi process.
    audio = run / 'capture.wav'
    report = {'simulation': simulation, 'target': None if simulation else TARGET,
              'pid': None, 'events': [], 'diagnostics': {'stdout': '', 'stderr': ''},
              'intent': None, 'fatal': False, 'escalated': False, 'stream_active': False,
              'audio_deleted': False, 'child_reaped': False}
    child, selector = None, selectors.DefaultSelector()
    start = time.monotonic()
    stop_at, sent_term, sent_kill = None, False, False
    interrupted = False

    def log(event, **data):
        item = {'event': event, 'elapsed_s': round(time.monotonic() - start, 6), **data}
        report['events'].append(item)
        emit(**item)

    def interrupted_handler(_signum, _frame):
        nonlocal interrupted
        interrupted = True

    signal.signal(signal.SIGINT, interrupted_handler)
    signal.signal(signal.SIGTERM, interrupted_handler)
    signal.signal(signal.SIGHUP, interrupted_handler)

    def send(sig):
        if child is not None and child.poll() is None:
            child.send_signal(sig)
            log('signal', signal=signal.Signals(sig).name)

    def request(intent):
        nonlocal stop_at
        # Discard cannot be reversed by a later stop; repeat requests are idempotent.
        if intent != 'stop':
            report['intent'] = intent
        elif report['intent'] is None:
            report['intent'] = intent
        if stop_at is None:
            stop_at = time.monotonic()
            log('stop-requested', intent=report['intent'])
            send(signal.SIGINT)

    try:
        argv = ([sys.executable, str(SELF), '--fixture', str(audio), fake_mode]
                if simulation else ['/usr/bin/stdbuf', '-oL', '/usr/bin/pw-record',
                    '--verbose', '--rate', '16000', '--channels', '1', '--format', 's16',
                    '--target', TARGET, str(audio)])
        report['argv'] = argv
        start = time.monotonic()
        child = subprocess.Popen(argv, stdin=subprocess.DEVNULL,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        report['pid'] = child.pid
        log('spawned', pid=child.pid)
        selector.register(sys.stdin.buffer, selectors.EVENT_READ, 'control')
        selector.register(child.stdout, selectors.EVENT_READ, 'stdout')
        selector.register(child.stderr, selectors.EVENT_READ, 'stderr')
        pending, control = '', ''
        while child.poll() is None or any(k.data != 'control' for k in selector.get_map().values()):
            now = time.monotonic()
            elapsed = now - start
            if interrupted:
                request('interrupted-discard')
            if child.poll() is None:
                if elapsed >= (0.6 if simulation and fake_mode == 'safety' else SAFETY_STOP):
                    if report['intent'] is None:
                        request('safety-limit-discard')
                if not report['stream_active'] and elapsed >= NORMAL_STARTUP and report['intent'] is None:
                    request('startup-timeout-discard')
                if stop_at is not None and not sent_term and (now - stop_at >= 0.25 or elapsed >= SAFETY_TERM):
                    sent_term = True
                    report['escalated'] = True
                    send(signal.SIGTERM)
                if stop_at is not None and not sent_kill and (now - stop_at >= 0.5 or elapsed >= SAFETY_KILL):
                    sent_kill = True
                    report['escalated'] = True
                    send(signal.SIGKILL)
            for key, _mask in selector.select(0.02):
                raw = os.read(key.fileobj.fileno(), 65536)
                kind = key.data
                if not raw:
                    selector.unregister(key.fileobj)
                    if kind == 'control' and child.poll() is None:
                        request('owner-eof-discard')
                    continue
                text = raw.decode('utf-8', 'replace')
                if kind == 'control':
                    control += text
                    lines = control.split('\n')
                    control = lines.pop()[-128:]
                    for line in lines:
                        if line in ('stop', 'cancel'):
                            request('stop' if line == 'stop' else 'cancel-discard')
                    continue
                old = report['diagnostics'][kind]
                report['diagnostics'][kind] = (old + text)[-TAIL_LIMIT:]
                diagnostic_text = (old[-128:] + text).lower()
                # Initial "unconnected -> connecting" is normal startup, not loss.
                if re.search(r'\b(error|failed)\b|stream node \d+ unconnected', diagnostic_text):
                    report['fatal'] = True
                    request('diagnostic-error-discard')
                if kind == 'stdout':
                    pending += text
                    lines = pending.split('\n')
                    pending = lines.pop()[-4096:]
                    for line in lines:
                        if re.search(r'stream state changed .* -> streaming$', line):
                            if not report['stream_active']:
                                report['stream_active'] = True
                                log('stream-active' if report['intent'] is None else 'stream-active-during-stop')
                                try:
                                    report['owned_executable'] = os.readlink(f'/proc/{child.pid}/exe')
                                except OSError:
                                    report['owned_executable'] = None
        report['returncode'] = child.wait(timeout=1)
        report['child_reaped'] = True
        report['child_lifetime_s'] = round(time.monotonic() - start, 6)
        log('closed', returncode=report['returncode'])
        if report['child_lifetime_s'] > 5:
            report['intent'] = 'over-five-seconds-discard'
        valid = validator()
        if audio.exists():
            size = audio.stat().st_size
            report['wav_mode'] = oct(audio.stat().st_mode & 0o777)
            report['wav_size'] = size
            report['wav'] = valid(audio.read_bytes()) if size <= 1000000 else {'verdict': 'invalid', 'reason': 'size-limit'}
        else:
            report['wav'] = {'verdict': 'invalid', 'reason': 'missing-file'}
        normal = (report['intent'] == 'stop' and not report['fatal']
                  and not report['escalated'] and report['stream_active']
                  and report['returncode'] in (0, 1) and report['wav']['verdict'] == 'accepted')
        # Exit 0/1 is an experimental candidate, never a universal success rule.
        if normal:
            p = subprocess.run(['/usr/bin/ffprobe', '-v', 'error', '-protocol_whitelist', 'file',
                                '-show_entries', 'stream=codec_name,sample_rate,channels,bits_per_sample:format=duration',
                                '-of', 'json', '-i', str(audio)], stdin=subprocess.DEVNULL,
                               capture_output=True, text=True, timeout=3)
            report['ffprobe'] = {'returncode': p.returncode, 'stderr': p.stderr[-4096:],
                                 'metadata': json.loads(p.stdout) if p.returncode == 0 else None}
            normal = p.returncode == 0
        report['outcome'] = 'completed-then-deleted' if normal else 'discarded'
    except BaseException as exc:
        report['outcome'] = 'harness-error'
        report['exception'] = f'{type(exc).__name__}: {exc}'
    finally:
        selector.close()
        if child is not None and child.poll() is None:
            report['escalated'] = True
            child.kill()
            try:
                child.wait(timeout=1)
                report['child_reaped'] = True
            except subprocess.TimeoutExpired:
                report['cleanup_error'] = 'owned child termination not confirmed; WAV not unlinked'
        if child is not None and child.poll() is not None:
            for pipe in (child.stdout, child.stderr):
                pipe.close()
        if child is None or child.poll() is not None:
            try:
                audio.unlink(missing_ok=True)
                report['audio_deleted'] = not audio.exists()
            except OSError as exc:
                report['cleanup_error'] = str(exc)
        save_json(run / 'result.json', report)
        emit('finished', outcome=report.get('outcome'), intent=report['intent'],
             deleted=report['audio_deleted'], reaped=report['child_reaped'])
    return 0 if report.get('outcome') in ('completed-then-deleted', 'discarded') and not report.get('cleanup_error') else 1


def fixture(p: Path, mode):
    """Synthetic child for --self-test only; never opens an audio API."""
    os.umask(0o077)
    def finish(_sig, _frame):
        with wave.open(str(p), 'wb') as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
            w.writeframes(b'\0' * 16000)  # Half-second digital silence.
        raise SystemExit(1)
    signal.signal(signal.SIGINT, finish)
    signal.signal(signal.SIGTERM, finish)
    # Create a deliberately unfinished placeholder, never an old input.
    with p.open('xb') as f:
        f.write(b'RIFF0000WAVE')
    print('stream state changed unconnected -> connecting', flush=True)
    print('stream state changed paused -> streaming', flush=True)
    until = time.monotonic() + 6
    while time.monotonic() < until:
        time.sleep(0.02)
    return 97


def local_environment():
    expected = f'/run/user/{os.getuid()}'
    if os.environ.get('PIPEWIRE_REMOTE') not in (None, '', 'pipewire-0'):
        raise RuntimeError('Unexpected PipeWire target override; stopping without recording.')
    if os.environ.get('XDG_RUNTIME_DIR') != expected:
        raise RuntimeError('Unexpected local runtime directory; stopping without recording.')
    if os.environ.get('PIPEWIRE_RUNTIME_DIR') not in (None, '', expected):
        raise RuntimeError('Unexpected PipeWire runtime override; stopping without recording.')


def authorize_real_worker(run, fd):
    # Prevent accidental standalone real-worker execution or duplicate launches.
    # This is a local harness guard, not a security boundary against its own user.
    local_environment()
    if fd < 3 or not stat.S_ISFIFO(os.fstat(fd).st_mode):
        raise RuntimeError('Real worker requires a private parent grant pipe.')
    try:
        grant = json.loads(os.read(fd, 4096))
    finally:
        os.close(fd)
    ledger = json.loads((HERE / 'authorization-used.json').read_text())
    number = grant['attempt']
    if (grant['parent_pid'] != os.getppid() or number not in (1, 2, 3)
            or ledger.get('max_attempts') != 3
            or run.parent.resolve() != Path(ledger['run']).resolve()
            or run.name != f'trial-{number}'):
        raise RuntimeError('Worker grant does not match this authorized E2 attempt.')
    save_json(run / 'recorder-launch-reserved.json', {'attempt': number, 'target': TARGET})


def spawn_worker(run, simulation=False, mode='normal'):
    args = [sys.executable, '-B', str(SELF), '--worker', str(run)]
    if simulation:
        args += ['--simulation', mode]
        return subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, text=True, bufsize=1)
    readfd, writefd = os.pipe()
    try:
        grant = {'parent_pid': os.getpid(), 'attempt': int(run.name.split('-')[-1])}
        os.write(writefd, json.dumps(grant).encode())
        os.close(writefd); writefd = None
        return subprocess.Popen(args + ['--grant-fd', str(readfd)], pass_fds=(readfd,),
                                stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, text=True, bufsize=1)
    finally:
        os.close(readfd)
        if writefd is not None:
            os.close(writefd)


def self_test():
    root = Path(tempfile.mkdtemp(prefix='selftest-', dir=HERE))
    checks = []
    for case in ('stop', 'cancel', 'eof', 'safety'):
        run = root / case
        run.mkdir(mode=0o700)
        proc = spawn_worker(run, True, 'safety' if case == 'safety' else 'normal')
        events = []
        try:
            # Nonblocking bounded readiness wait: no real recorder is involved.
            sel = selectors.DefaultSelector()
            sel.register(proc.stdout, selectors.EVENT_READ)
            limit = time.monotonic() + 4
            pending, active = '', False
            while time.monotonic() < limit and not active:
                if not sel.select(0.1):
                    continue
                raw = os.read(proc.stdout.fileno(), 65536)
                if not raw:
                    raise AssertionError('fake worker closed before readiness')
                pending += raw.decode('utf-8', 'replace')
                lines = pending.split('\n'); pending = lines.pop()
                for line in lines:
                    item = json.loads(line)
                    events.append(item)
                    active |= item['event'] == 'stream-active'
            if not active:
                raise AssertionError('fake stream-active timeout')
            sel.close()
            if case == 'eof':
                proc.stdin.close()
                proc.stdin = None
            elif case in ('stop', 'cancel'):
                proc.stdin.write(case + '\n'); proc.stdin.flush()
            # communicate() would close stdin and turn every case into owner EOF.
            # Keep the owner's control writer open until the worker finishes.
            proc.wait(timeout=5)
            output, errors = proc.stdout.read(), proc.stderr.read()
            assert proc.returncode == 0, (case, errors)
            result = json.loads((run / 'result.json').read_text())
            assert result['child_reaped'] and result['audio_deleted'], case
            assert result['stream_active'] and result['returncode'] == 1, case
            assert result['wav']['verdict'] == 'accepted', case
            assert result['intent'] == {'stop': 'stop', 'cancel': 'cancel-discard', 'eof': 'owner-eof-discard', 'safety': 'safety-limit-discard'}[case], result
            assert result['outcome'] == ('completed-then-deleted' if case == 'stop' else 'discarded'), result
            assert not list(run.glob('*.wav')), case
            checks.append({'case': case, 'passed': True})
        finally:
            if proc.poll() is None:
                if proc.stdin and not proc.stdin.closed:
                    proc.stdin.close(); proc.stdin = None
                try:
                    proc.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    proc.kill(); proc.wait()
            for pipe in (proc.stdin, proc.stdout, proc.stderr):
                if pipe and not pipe.closed:
                    pipe.close()
    save_json(root / 'summary.json', {'scope': 'fake children and synthetic WAV only', 'cases': checks})
    print(f'SELF-TEST PASS: {len(checks)}/4 cases; {root}')
    return 0


def preflight():
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        raise RuntimeError('Run interactively in a separate Herdr terminal pane; no recording started.')
    if not os.environ.get('HERDR_PANE_ID'):
        raise RuntimeError('HERDR_PANE_ID absent; required Herdr context not confirmed.')
    local_environment()
    for tool in ('/usr/bin/stdbuf', '/usr/bin/pw-record', '/usr/bin/ffprobe'):
        if not os.access(tool, os.X_OK):
            raise RuntimeError(f'Missing existing tool: {tool}; no installation attempted.')
    p = subprocess.run(['wpctl', 'inspect', '@DEFAULT_AUDIO_SOURCE@'], capture_output=True, text=True, timeout=3)
    if p.returncode or f'node.name = "{TARGET}"' not in p.stdout or 'media.class = "Audio/Source"' not in p.stdout:
        raise RuntimeError('Confirmed default input changed/unavailable; stopping without recording.')
    v = subprocess.run(['wpctl', 'get-volume', '@DEFAULT_AUDIO_SOURCE@'], capture_output=True, text=True, timeout=3)
    if v.returncode or '[MUTED]' in v.stdout:
        raise RuntimeError('Input mute/availability changed; no settings changed and no recording started.')
    return {'target': TARGET, 'volume': v.stdout.strip(), 'herdr_context_present': True}


def interactive():
    meta = preflight()
    lock = HERE / 'authorization-used.json'
    if lock.exists():
        raise RuntimeError('E2 one-run authorization already reserved; do not rerun without renewed approval.')
    print('E2: SoundWire microphones; no playback/transcription; all WAVs deleted.')
    print('Three attempts maximum: finish / cancel / finish. Short phrase or silence is fine.')
    print('Press ENTER to START each attempt, then ENTER again to STOP (trial 2: CANCEL).')
    print('Aim to stop after 1–2 seconds. At 4 seconds the safety limit ABORTS/DISCARDS;')
    print('it is not automatic successful completion. Type q + ENTER to quit before starting.')
    answer = input('Reserve this single three-attempt run? ENTER confirms; q quits: ')
    if answer.strip().lower() != '':
        return 0
    root = Path(tempfile.mkdtemp(prefix='run-', dir=HERE))
    save_json(lock, {'run': str(root), 'max_attempts': 3, 'policy': 'delete all WAVs; no playback or inference'})
    save_json(root / 'context.json', meta)
    print(f'Results: {root}', flush=True)
    summaries = []
    for number, action in ((1, 'stop'), (2, 'cancel'), (3, 'stop')):
        answer = input(f'[{number}/3] ENTER to START, q to quit: ')
        if answer.strip().lower() != '':
            break
        preflight()  # Refuse a changed route before each microphone open.
        run = root / f'trial-{number}'
        run.mkdir(mode=0o700)
        proc = spawn_worker(run)
        sel = selectors.DefaultSelector()
        sel.register(proc.stdout, selectors.EVENT_READ, 'worker')
        sel.register(sys.stdin, selectors.EVENT_READ, 'user')
        pending, requested, user_pending = '', False, b''
        print(f'[{number}/3] STARTING — ENTER to {action.upper()} now; do not wait past 4 seconds.', flush=True)
        try:
            while sel.get_map():
                for key, _mask in sel.select(0.05):
                    raw = os.read(key.fileobj.fileno(), 65536)
                    if key.data == 'user':
                        if not raw:
                            proc.stdin.close(); requested = True
                            sel.unregister(sys.stdin)
                        elif not requested:
                            user_pending += raw
                            if b'\n' in user_pending:
                                proc.stdin.write(action + '\n'); proc.stdin.flush(); requested = True
                                print('STOPPING / FINALIZING; audio will be deleted.', flush=True)
                        continue
                    if not raw:
                        sel.unregister(proc.stdout)
                        if sys.stdin in sel.get_map():
                            sel.unregister(sys.stdin)
                        break
                    pending += raw.decode('utf-8', 'replace')
                    lines = pending.split('\n'); pending = lines.pop()
                    for line in lines:
                        event = json.loads(line)
                        if event['event'] == 'stream-active':
                            print('RECORDING (stream active; not proof of audible speech). ENTER now to stop/cancel.', flush=True)
                        elif event['event'] == 'stop-requested':
                            print(f"Stop intent: {event['intent']}", flush=True)
            proc.wait(timeout=2)
        finally:
            sel.close()
            if proc.stdin and not proc.stdin.closed:
                proc.stdin.close()
            try:
                proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                # Do NOT kill the supervisor and abandon its recorder. It has its
                # independent deadline; wait longer, report, and never start another.
                proc.wait(timeout=6)
            errors = proc.stderr.read()[-4096:]
            proc.stdout.close(); proc.stderr.close()
        if not (run / 'result.json').exists():
            raise RuntimeError(f'Worker ended without report; stop here and report path {run}; stderr={errors}')
        result = json.loads((run / 'result.json').read_text())
        summaries.append({'trial': number, 'action': action, 'outcome': result.get('outcome'),
                          'intent': result.get('intent'), 'returncode': result.get('returncode'),
                          'deleted': result.get('audio_deleted'), 'reaped': result.get('child_reaped')})
        print(json.dumps(summaries[-1]), flush=True)
        expected = 'completed-then-deleted' if action == 'stop' else 'discarded'
        if (proc.returncode or result.get('outcome') != expected
                or result.get('intent') != ('stop' if action == 'stop' else 'cancel-discard')
                or not result.get('audio_deleted') or not result.get('child_reaped')):
            print('Unexpected result: stopping this E2 run; do not retry without review.', flush=True)
            break
    save_json(root / 'summary.json', {'trials': summaries, 'authorization': 'E2 only, maximum three attempts'})
    print(f'Finished. Send this result path to the assistant: {root}', flush=True)
    return 0


def main():
    # Applies only to this disposable harness process and its descendants.
    os.umask(0o077)
    if len(sys.argv) == 2 and sys.argv[1] == '--self-test':
        return self_test()
    if len(sys.argv) == 5 and sys.argv[1] == '--worker' and sys.argv[3] == '--simulation':
        return worker(Path(sys.argv[2]), True, sys.argv[4])
    if len(sys.argv) == 5 and sys.argv[1] == '--worker' and sys.argv[3] == '--grant-fd':
        run = Path(sys.argv[2]).resolve()
        authorize_real_worker(run, int(sys.argv[4]))
        return worker(run)
    if len(sys.argv) == 4 and sys.argv[1] == '--fixture':
        return fixture(Path(sys.argv[2]), sys.argv[3])
    if len(sys.argv) != 1:
        raise RuntimeError('Only no-argument interactive run or --self-test is a public command.')
    return interactive()


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (KeyboardInterrupt, EOFError):
        print('\nCanceled. No automatic restart. Send any printed result path for review.', file=sys.stderr)
        raise SystemExit(130)
    except Exception as exc:
        print(f'STOP: {exc}', file=sys.stderr)
        raise SystemExit(1)
