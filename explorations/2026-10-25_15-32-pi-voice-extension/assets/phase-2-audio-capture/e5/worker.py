#!/usr/bin/env python3
"""E5 exploration worker: explicit hold/release capture, then one batch ASR.

Never records on import, --check, or until --worker receives {"action":"start"}.
No duration cap, VAD, automatic speech end, output-text file or prompt insertion.
Private test roles use only synthetic children; no audio/service/inference access.
"""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import signal
import stat
import struct
import subprocess
import sys
import tempfile
import time
import wave

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
SELF = Path(__file__).resolve()
TARGET = 'alsa_input.pci-0000_00_1f.3-platform-sof_sdw.HiFi__Mic__source'
BINARY = Path.home() / '.local/bin/whisper-cli'
MODEL = Path.home() / '.local/share/whisper.cpp/models/ggml-large-v3.bin'
EXPECTED = {
    'binary': (BINARY, '6c2d7b6529155d77338719cdbd66ab287945716a3921a41fdf736af2e34a25c2'),
    'model': (MODEL, '64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2'),
}


def write_json(p, value):
    fd = os.open(p, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as f:
        json.dump(value, f, indent=2)
        f.write('\n')


def artifact_check(full=False):
    """Metadata fast path after preparation; --check rehashes both artifacts."""
    manifest = json.loads((HERE / 'artifact-provenance.json').read_text())
    observed = {}
    for name, (p, digest) in EXPECTED.items():
        meta = p.stat()
        old = manifest[name]
        if not stat.S_ISREG(meta.st_mode) or not os.access(p, os.R_OK):
            raise RuntimeError(f'Selected {name} is not a readable regular file')
        if (old['path'] != str(p) or old['sha256'] != digest
                or old['size'] != meta.st_size or old['mtime_ns'] != meta.st_mtime_ns):
            raise RuntimeError(f'Selected {name} changed since provenance verification; no fallback')
        if full:
            h = hashlib.sha256()
            with p.open('rb') as f:
                for block in iter(lambda: f.read(1024 * 1024), b''):
                    h.update(block)
            if h.hexdigest() != digest:
                raise RuntimeError(f'Selected {name} hash mismatch; no fallback')
        observed[name] = old
    if not os.access(BINARY, os.X_OK) or observed['model']['size'] != 3095033483:
        raise RuntimeError('Selected full large-v3/Vulkan artifacts are unavailable')
    return observed


def wav_info(p):
    """Seek-based strict RIFF/PCM subset, no fixture/file-duration ceiling.

    Inspect headers/chunks only; PCM payload is skipped, not loaded into memory.
    RIFF's intrinsic 32-bit size/resource limits still apply.
    """
    with p.open('rb') as f:
        total = os.fstat(f.fileno()).st_size
        h = f.read(12)
        if len(h) != 12 or h[:4] != b'RIFF' or h[8:] != b'WAVE':
            raise RuntimeError('Invalid/incomplete RIFF/WAVE header')
        if struct.unpack_from('<I', h, 4)[0] != total - 8:
            raise RuntimeError('WAV RIFF length does not match finalized file size')
        pos, formats, data = 12, [], []
        while pos < total:
            f.seek(pos)
            h = f.read(8)
            if len(h) != 8:
                raise RuntimeError('WAV chunk header is truncated')
            size = struct.unpack_from('<I', h, 4)[0]
            end = pos + 8 + size
            if end + size % 2 > total:
                raise RuntimeError('WAV chunk payload/padding extends beyond EOF')
            if h[:4] == b'fmt ':
                if size not in (16, 18):
                    raise RuntimeError('Unsupported PCM fmt layout')
                formats.append(f.read(size))
            elif h[:4] == b'data':
                data.append((pos + 8, size))
            pos = end + size % 2
        if len(formats) != 1 or len(data) != 1:
            raise RuntimeError('WAV requires exactly one fmt and data chunk')
        fmt = formats[0]
        if len(fmt) == 18 and fmt[16:] != b'\0\0':
            raise RuntimeError('Unsupported PCM extension')
        if struct.unpack_from('<HHIIHH', fmt) != (1, 1, 16000, 32000, 2, 16):
            raise RuntimeError('WAV is not mono 16-kHz PCM-s16le with consistent alignment')
        offset, size = data[0]
        if not size or size % 2:
            raise RuntimeError('WAV has no audio or an incomplete PCM frame')
        return {'codec': 'pcm_s16le', 'sample_rate': 16000, 'channels': 1,
                'frames': size // 2, 'duration_s': size / 32000,
                'bytes': total, 'data_offset': offset,
                'mode': oct(p.stat().st_mode & 0o777)}


class Control:
    def __init__(self):
        self.fd = sys.stdin.fileno()
        mode = os.fstat(self.fd).st_mode
        # Node/libuv stdio='pipe' is usually a Unix socketpair on Linux;
        # Python Popen uses a FIFO. Both are intended private owner streams.
        if not (stat.S_ISFIFO(mode) or stat.S_ISSOCK(mode)):
            raise RuntimeError('Worker requires its diagnostic owner control stream')
        self.selector = selectors.DefaultSelector()
        self.selector.register(self.fd, selectors.EVENT_READ, 'control')
        self.pending = b''
        self.started = self.stopped = self.cancelled = self.eof = False
        self.interrupted = False

    def pump(self, wait=0):
        for key, _mask in self.selector.select(wait):
            if key.data != 'control':
                yield key
                continue
            raw = os.read(self.fd, 65536)
            if not raw:
                self.selector.unregister(self.fd)
                self.eof = self.cancelled = True
                continue
            self.pending += raw
            if len(self.pending) > 4096:
                self.cancelled = True
                raise RuntimeError('Unexpected oversized control command')
            while b'\n' in self.pending:
                line, self.pending = self.pending.split(b'\n', 1)
                try:
                    obj = json.loads(line)
                    action = obj['action']
                except (ValueError, KeyError, TypeError):
                    self.cancelled = True
                    raise RuntimeError('Invalid diagnostic control protocol') from None
                if action == 'start':
                    self.started = True  # Repeats never create another operation.
                elif action == 'stop':
                    self.stopped = True
                elif action == 'cancel':
                    self.cancelled = True
                else:
                    self.cancelled = True
                    raise RuntimeError('Unknown diagnostic action')
        if self.interrupted:
            self.cancelled = True

    def drain(self, wait=0):
        for _key in self.pump(wait):
            raise RuntimeError('Unconsumed child data during control-only phase')


class Services:
    simulation = False

    def preflight(self, trial):
        expected_runtime = f'/run/user/{os.getuid()}'
        if not os.environ.get('HERDR_PANE_ID') or not os.environ.get('PI_CODING_AGENT'):
            raise RuntimeError('Required isolated Pi inside Herdr context is absent')
        if (os.environ.get('PIPEWIRE_REMOTE') not in (None, '', 'pipewire-0')
                or os.environ.get('PIPEWIRE_RUNTIME_DIR') not in (None, '', expected_runtime)
                or os.environ.get('XDG_RUNTIME_DIR') != expected_runtime):
            raise RuntimeError('Unexpected audio runtime/target override; refusing capture')
        trial.report['artifacts'] = artifact_check()
        for tool in ('/usr/bin/stdbuf', '/usr/bin/pw-record'):
            if not os.access(tool, os.X_OK):
                raise RuntimeError('Required existing capture executable is absent')
        out, _err, code = trial.process(['wpctl', 'inspect', '@DEFAULT_AUDIO_SOURCE@'], 'preflight', deadline=3)
        if trial.control.cancelled or trial.control.stopped:
            return
        if (code or f'node.name = "{TARGET}"' not in out
                or 'media.class = "Audio/Source"' not in out):
            raise RuntimeError('Confirmed microphone is unavailable or the default changed')
        out, _err, code = trial.process(['wpctl', 'get-volume', '@DEFAULT_AUDIO_SOURCE@'], 'preflight', deadline=3)
        if trial.control.cancelled or trial.control.stopped:
            return
        if code or '[MUTED]' in out:
            raise RuntimeError('Microphone is muted/unavailable; no setting was changed')
        trial.report['input'] = {'node_name': TARGET, 'volume': out.strip(), 'herdr_context_present': True}

    def recorder(self, audio):
        return ['/usr/bin/stdbuf', '-oL', '/usr/bin/pw-record', '--verbose',
                '--rate', '16000', '--channels', '1', '--format', 's16', '--target', TARGET, str(audio)]

    def transcriber(self, audio):
        return [str(BINARY), '--model', str(MODEL), '--file', str(audio),
                '--language', 'auto', '--threads', '8', '--device', '0', '--no-timestamps']


class Trial:
    def __init__(self, control, services, root=HERE):
        self.control, self.services, self.root = control, services, root
        self.run = self.audio = None
        self.children = []
        self.t0 = time.monotonic()
        self.backend = {'vulkan0': False, 'encoder_layers': None, 'decoder_layers': None}
        self.report = {'simulation': services.simulation, 'target': TARGET, 'events': [],
                       'children': [], 'recording_duration_cap': None, 'vad': False,
                       'transcript_persisted': False, 'outcome': 'error', 'audio_deleted': False}

    def emit(self, event, **fields):
        try:
            print(json.dumps({'event': event, **fields}, ensure_ascii=False), flush=True)
        except (BrokenPipeError, OSError):
            self.control.cancelled = self.control.eof = True
            raise RuntimeError('Diagnostic owner output closed') from None

    def log(self, event, **fields):
        self.report['events'].append({'event': event, 'elapsed_s': round(time.monotonic() - self.t0, 6), **fields})

    def state(self, state):
        self.log('state', state=state)
        self.emit('state', state=state)

    def reserve(self):
        run = Path(tempfile.mkdtemp(prefix='run-', dir=self.root))
        try:
            write_json(self.root / 'authorization-used.json', {
                'run': str(run), 'max_attempts': 1, 'duration_cap': None,
                'scope': 'Ctrl+Q E5; one capture then one full-large-v3/Vulkan batch ASR; delete WAV; no retry'})
        except BaseException:
            run.rmdir()  # This newly created empty directory only.
            raise RuntimeError('E5 attempt already reserved or unavailable; no retry') from None
        self.run = run
        self.audio = run / 'capture.wav'
        self.emit('run', run=str(run))

    def interrupted(self, _sig, _frame):
        self.control.interrupted = True

    def process(self, argv, phase, deadline=None):
        """Consume both pipes and control; no active capture/inference time limit.

        Only explicit stop/cancel/EOF, failed startup or observed fatal error can
        terminate capture. Stop finalizes capture, but never stops batch ASR.
        """
        self.control.drain()
        if self.control.cancelled or (phase != 'inference' and self.control.stopped):
            return '', '', None
        env = dict(os.environ)
        if phase == 'inference':
            env['GGML_VK_VISIBLE_DEVICES'] = '0'
            cache = self.run / 'cache'
            cache.mkdir(mode=0o700)
            tmp = self.run / 'tmp'
            tmp.mkdir(mode=0o700)
            env['XDG_CACHE_HOME'], env['TMPDIR'] = str(cache), str(tmp)
            env['MESA_SHADER_CACHE_DIR'] = str(cache / 'mesa')
        p = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, env=env)
        item = {'phase': phase, 'pid': p.pid, 'argv': argv, 'signals': [], 'reaped': False}
        self.report['children'].append(item)
        self.children.append(p)
        sel = self.control.selector
        sel.register(p.stdout, selectors.EVENT_READ, 'stdout')
        sel.register(p.stderr, selectors.EVENT_READ, 'stderr')
        start = time.monotonic()
        tails = {'stdout': b'', 'stderr': b''}
        output = []
        pending_out = pending_err = ''
        live_pipes = 2
        stop_at, last_signal = None, 0
        active = False
        failure = None
        try:
            while p.poll() is None or live_pipes:
                keys = list(self.control.pump(0.02))
                for key in keys:
                    raw = os.read(key.fileobj.fileno(), 65536)
                    if not raw:
                        sel.unregister(key.fileobj)
                        live_pipes -= 1
                        continue
                    kind = key.data
                    tails[kind] = (tails[kind] + raw)[-65536:]
                    if phase == 'preflight' or (phase == 'inference' and kind == 'stdout'):
                        if kind == 'stdout':
                            output.append(raw)
                    if phase == 'capture' and kind == 'stdout':
                        pending_out += raw.decode('utf-8', 'replace')
                        lines = pending_out.split('\n'); pending_out = lines.pop()[-4096:]
                        for line in lines:
                            if re.search(r'stream state changed .* -> streaming$', line):
                                if not active:
                                    active = True
                                    item['stream_active_s'] = round(time.monotonic() - start, 6)
                                    try:
                                        item['owned_executable'] = os.readlink(f'/proc/{p.pid}/exe')
                                    except OSError:
                                        item['owned_executable'] = None
                                    if not self.control.stopped and not self.control.cancelled:
                                        self.state('recording'); self.emit('stream-active')
                            if re.search(r'\b(error|failed)\b|stream node \d+ unconnected', line.lower()):
                                failure = 'Recorder diagnostic reported an error'
                    if phase == 'capture' and kind == 'stderr':
                        failure = 'Recorder wrote unexpected stderr; inspect metadata before any retry'
                    if phase == 'inference' and kind == 'stderr':
                        pending_err += raw.decode('utf-8', 'replace')
                        lines = pending_err.split('\n'); pending_err = lines.pop()[-4096:]
                        for line in lines:
                            # Retain facts only, never raw ASR logs or dictated text.
                            if 'whisper_backend_init_gpu:' in line and 'using Vulkan0 backend' in line:
                                self.backend['vulkan0'] = True
                            for label, name in (('n_audio_layer', 'encoder_layers'), ('n_text_layer', 'decoder_layers')):
                                m = re.search(rf'{label}\s*=\s*(\d+)', line)
                                if m:
                                    self.backend[name] = int(m.group(1))
                            if ('whisper_backend_init_gpu:' in line and ('no GPU found' in line or 'failed to initialize' in line)
                                    or 'main: processing' in line and not self.backend['vulkan0']):
                                failure = 'Selected Vulkan backend unavailable; no CPU/model retry'
                now = time.monotonic()
                if deadline is not None and now - start > deadline:
                    failure = 'Local metadata command timed out'
                if phase == 'capture' and not active and now - start > 3:
                    failure = 'Recorder did not become stream-active during startup'
                wants_stop = self.control.cancelled or failure is not None or (phase == 'capture' and self.control.stopped)
                if wants_stop and stop_at is None and p.poll() is None:
                    stop_at = now
                    if phase == 'capture':
                        self.state('stopping')
                    self.log('termination-request', phase=phase, cancel=self.control.cancelled,
                             stop=self.control.stopped, failed=failure is not None)
                if stop_at is not None and p.poll() is None:
                    delay = now - stop_at
                    level = 3 if delay >= 3 else 2 if delay >= 2 else 1
                    if level > last_signal:
                        sig = signal.SIGKILL if level == 3 else signal.SIGTERM if level == 2 or phase != 'capture' else signal.SIGINT
                        try:
                            p.send_signal(sig)
                        except ProcessLookupError:
                            pass
                        last_signal = level
                        item['signals'].append(signal.Signals(sig).name)
                        if level > 1:
                            item['escalated'] = True
            code = p.wait()
            item.update(returncode=code, reaped=True, lifetime_s=round(time.monotonic() - start, 6))
            if phase == 'capture':
                # Capture diagnostics contain metadata only with a named WAV path.
                item['diagnostics'] = {k: v.decode('utf-8', 'replace') for k, v in tails.items()}
                item['stream_active'] = active
            if failure:
                raise RuntimeError(failure)
            if self.control.cancelled:
                return '', '', code
            out = b''.join(output).decode('utf-8', 'replace')
            return out, tails['stderr'].decode('utf-8', 'replace') if phase == 'preflight' else '', code
        finally:
            # Never abandon a possibly active owned process. No broad PID/group kill.
            if p.poll() is None:
                p.kill()
                while p.poll() is None:
                    time.sleep(0.02)
                p.wait()
                item.update(reaped=True, returncode=p.returncode, forced_cleanup=True)
            for pipe in (p.stdout, p.stderr):
                try:
                    sel.unregister(pipe)
                except KeyError:
                    pass
                pipe.close()

    def execute(self):
        text = None
        error = None
        try:
            while not self.control.started and not self.control.cancelled:
                self.control.drain(0.1)
            if not self.control.started:
                self.report['outcome'] = 'cancelled'
            else:
                self.reserve()
                if self.control.cancelled or self.control.stopped:
                    self.report['outcome'] = 'cancelled'
                else:
                    self.state('preflight')
                    self.services.preflight(self)
                    self.control.drain()
                    if self.control.cancelled or self.control.stopped:
                        self.report['outcome'] = 'cancelled'
                    else:
                        self.state('starting')
                        _out, _err, code = self.process(self.services.recorder(self.audio), 'capture')
                        if self.control.cancelled:
                            self.report['outcome'] = 'cancelled'
                        elif not self.control.stopped or code not in (0, 1):
                            raise RuntimeError('Recorder did not complete an explicit normal stop')
                        elif self.report['children'][-1].get('escalated'):
                            raise RuntimeError('Recorder needed escalation; partial audio discarded')
                        elif not self.report['children'][-1].get('stream_active'):
                            raise RuntimeError('Recording stopped before stream readiness')
                        else:
                            self.report['wav'] = wav_info(self.audio)
                            self.control.drain()
                            if self.control.cancelled:
                                self.report['outcome'] = 'cancelled'
                            else:
                                self.state('transcribing')
                                text, _err, code = self.process(self.services.transcriber(self.audio), 'inference')
                                self.report['backend'] = self.backend
                                if self.control.cancelled:
                                    self.report['outcome'] = 'cancelled'
                                elif code != 0:
                                    raise RuntimeError('Batch transcription process failed; no retry/fallback')
                                elif self.backend != {'vulkan0': True, 'encoder_layers': 32, 'decoder_layers': 32}:
                                    raise RuntimeError('Full large-v3/Vulkan runtime confirmation missing')
                                elif not text.strip():
                                    raise RuntimeError('Batch transcription was empty')
                                else:
                                    text = text.strip()
                                    self.report['transcript_characters'] = len(text)
                                    self.report['outcome'] = 'transcribed'
        except Exception as exc:
            self.report['outcome'] = 'cancelled' if self.control.cancelled else 'error'
            # Messages are curated by this worker; never save raw stderr/ASR text.
            error = str(exc) if isinstance(exc, RuntimeError) else f'Harness {type(exc).__name__}; inspect metadata'
            self.report['error'] = error
        finally:
            for p in self.children:
                if p.poll() is None:
                    p.kill()
                    while p.poll() is None:
                        time.sleep(0.02)
                p.wait()
            if self.run is not None:
                try:
                    self.state('cleaning')
                except RuntimeError:
                    self.control.cancelled = True
                try:
                    self.audio.unlink(missing_ok=True)
                    self.report['audio_deleted'] = not self.audio.exists()
                except OSError:
                    error = 'Temporary audio deletion failed; do not start another recording'
                    self.report.update(error=error, outcome='error', cleanup_error=True)
                try:
                    self.control.drain()
                except RuntimeError:
                    self.control.cancelled = True
                if self.control.cancelled and not self.report.get('cleanup_error'):
                    self.report['outcome'] = 'cancelled'
                if self.report['outcome'] == 'transcribed' and self.report['audio_deleted']:
                    try:
                        self.emit('transcript', text=text)
                    except RuntimeError:
                        self.report['outcome'] = 'cancelled'
                write_json(self.run / 'result.json', self.report)
            outcome = self.report['outcome']
            try:
                self.emit('finished', ok=outcome == 'transcribed', outcome=outcome,
                          run=str(self.run) if self.run else None, **({'error': error} if error else {}))
            except RuntimeError:
                pass
            self.control.selector.close()
        return 0 if self.report['outcome'] in ('transcribed', 'cancelled') else 1


class FakeServices(Services):
    simulation = True

    def __init__(self, scenario):
        self.scenario = scenario

    def preflight(self, trial):
        trial.report['input'] = {'simulation': True}

    def recorder(self, audio):
        mode = 'ignore' if self.scenario == 'capture-ignore' else 'normal'
        return [sys.executable, '-B', str(SELF), '--fake-capture', str(audio), mode]

    def transcriber(self, audio):
        return [sys.executable, '-B', str(SELF), '--fake-asr', self.scenario]


def fake_capture(audio, mode):
    def finish(_sig, _frame):
        with wave.open(str(audio), 'wb') as f:
            f.setnchannels(1); f.setsampwidth(2); f.setframerate(16000)
            f.writeframes(b'\0' * 16000)  # Fixed half-second synthetic silence.
        raise SystemExit(1)
    if mode == 'ignore':
        signal.signal(signal.SIGINT, signal.SIG_IGN)
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
    else:
        signal.signal(signal.SIGINT, finish)
        signal.signal(signal.SIGTERM, finish)
    with audio.open('xb') as f:
        f.write(b'RIFF0000WAVE')
    print('stream state changed unconnected -> connecting', flush=True)
    print('stream state changed paused -> streaming', flush=True)
    # Synthetic-only independent watchdog protects against a broken test harness.
    until = time.monotonic() + 15
    while time.monotonic() < until:
        time.sleep(0.02)
    return 97


def fake_asr(scenario):
    print('whisper_model_load: n_audio_layer = 32', file=sys.stderr, flush=True)
    print('whisper_model_load: n_text_layer = 32', file=sys.stderr, flush=True)
    if scenario == 'no-gpu':
        print('whisper_backend_init_gpu: no GPU found', file=sys.stderr, flush=True)
        time.sleep(2)
        return 97
    print('whisper_backend_init_gpu: using Vulkan0 backend', file=sys.stderr, flush=True)
    if scenario in ('asr-cancel', 'asr-eof'):
        time.sleep(8)
    print('SYNTHETIC-ONLY-TRANSCRIPT: começo, meio e fim.', flush=True)
    print('secret simulated stderr content must not be persisted', file=sys.stderr, flush=True)
    return 0


def main():
    os.umask(0o077)  # Only this disposable diagnostic worker/children.
    if sys.argv[1:] == ['--check']:
        print(json.dumps(artifact_check(full=True), indent=2))
        return 0
    if len(sys.argv) == 4 and sys.argv[1] == '--fake-capture':
        return fake_capture(Path(sys.argv[2]), sys.argv[3])
    if len(sys.argv) == 3 and sys.argv[1] == '--fake-asr':
        return fake_asr(sys.argv[2])
    if sys.argv[1:] == ['--worker']:
        services, root = Services(), HERE
    elif len(sys.argv) == 4 and sys.argv[1] == '--test-worker':
        services, root = FakeServices(sys.argv[3]), Path(sys.argv[2]).resolve()
        if not root.is_relative_to(HERE) or not root.name.startswith('selftest-'):
            raise RuntimeError('Synthetic worker root must be a private E5 selftest directory')
    else:
        raise RuntimeError('Use the isolated Pi launcher; --check is read-only')
    control = Control()
    trial = Trial(control, services, root)
    for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(sig, trial.interrupted)
    return trial.execute()


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (RuntimeError, OSError, ValueError) as exc:
        print(f'E5 worker stopped: {type(exc).__name__}', file=sys.stderr)
        raise SystemExit(1)
