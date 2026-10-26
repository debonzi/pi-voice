#!/usr/bin/env python3
"""E5 synthetic-only validation. No wpctl, pw-record, GPU or real ASR execution.
Run: /usr/bin/python3 -B worker.test.py
"""
import collections
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import selectors
import signal
import stat
import struct
import subprocess
import sys
import tempfile
import time
import unittest
import wave
from unittest.mock import patch

sys.dont_write_bytecode = True
os.umask(0o077)
HERE = Path(__file__).resolve().parent
WORKER = HERE / 'worker.py'
ROOT = Path(tempfile.mkdtemp(prefix='selftest-suite-', dir=HERE))
spec = importlib.util.spec_from_file_location('e5worker', WORKER)
w = importlib.util.module_from_spec(spec)
spec.loader.exec_module(w)


class Harness:
    def __init__(self, case, root=None):
        self.root = root or Path(tempfile.mkdtemp(prefix='selftest-' + case + '-', dir=ROOT))
        self.p = subprocess.Popen([sys.executable, '-B', str(WORKER), '--test-worker', str(self.root), case],
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.sel = selectors.DefaultSelector()
        self.sel.register(self.p.stdout, selectors.EVENT_READ)
        self.pending = b''
        self.queue = collections.deque()
        self.events = []

    def send(self, *actions):
        self.p.stdin.write(b''.join(json.dumps({'action': a}).encode() + b'\n' for a in actions))
        self.p.stdin.flush()

    def wait(self, event, state=None, timeout=6):
        until = time.monotonic() + timeout
        while time.monotonic() < until:
            if not self.queue:
                if not self.sel.select(0.05):
                    continue
                raw = os.read(self.p.stdout.fileno(), 65536)
                if not raw:
                    raise AssertionError(f'worker closed waiting for {event}: {self.p.stderr.read()}')
                self.pending += raw
                lines = self.pending.split(b'\n'); self.pending = lines.pop()
                self.queue.extend(json.loads(line) for line in lines if line)
            while self.queue:
                item = self.queue.popleft(); self.events.append(item)
                if item['event'] == event and (state is None or item.get('state') == state):
                    return item
        raise AssertionError(f'timeout waiting for {event}/{state}')

    def finish(self):
        item = self.wait('finished')
        self.p.wait(timeout=3)  # Keep control open; closing it would be cancellation.
        result = json.loads((Path(item['run']) / 'result.json').read_text()) if item['run'] else None
        return item, result

    def close(self):
        if self.p.stdin and not self.p.stdin.closed:
            self.p.stdin.close()
        if self.p.poll() is None:
            try:
                self.p.wait(timeout=5)
            except subprocess.TimeoutExpired:
                # Fake-only independent child watchdog caps a broken test.
                self.p.kill(); self.p.wait()
        for pipe in (self.p.stdout, self.p.stderr):
            pipe.close()
        self.sel.close()


class WorkerChecks(unittest.TestCase):
    def harness(self, case='normal', root=None):
        h = Harness(case, root)
        self.addCleanup(h.close)
        return h

    def start(self, case='normal'):
        h = self.harness(case)
        h.send('start')
        h.wait('stream-active')
        return h

    def check_cleanup(self, h, result):
        self.assertTrue(result['audio_deleted'])
        self.assertFalse(list(h.root.rglob('*.wav')))
        for child in result['children']:
            self.assertTrue(child['reaped'])
            self.assertFalse(Path(f'/proc/{child["pid"]}').exists())
            self.assertNotIn('/usr/bin/pw-record', child['argv'])
            self.assertNotIn(str(w.BINARY), child['argv'])
        for p in h.root.rglob('*'):
            self.assertEqual(stat.S_IMODE(p.stat().st_mode), 0o700 if p.is_dir() else 0o600)

    def test_normal_integrated_fake_capture_validation_asr_and_no_text_persistence(self):
        h = self.start()
        h.send('stop', 'stop')
        item, result = h.finish()
        self.assertEqual(item['outcome'], 'transcribed')
        self.assertTrue(item['ok'])
        self.assertEqual(h.p.returncode, 0)
        self.assertEqual(result['recording_duration_cap'], None)
        self.assertEqual(result['backend'], {'vulkan0': True, 'encoder_layers': 32, 'decoder_layers': 32})
        self.assertEqual([c['phase'] for c in result['children']], ['capture', 'inference'])
        self.assertEqual(result['children'][0]['signals'], ['SIGINT'])
        self.assertEqual(len([e for e in h.events if e['event'] == 'transcript']), 1)
        self.assertIn('SYNTHETIC-ONLY-TRANSCRIPT', next(e['text'] for e in h.events if e['event'] == 'transcript'))
        raw = (Path(item['run'])/'result.json').read_text()
        self.assertNotIn('SYNTHETIC-ONLY-TRANSCRIPT', raw)
        self.assertNotIn('secret simulated stderr', raw)
        self.check_cleanup(h, result)

    def test_active_recording_survives_prior_five_second_cap(self):
        h = self.start()
        time.sleep(5.3)
        self.assertIsNone(h.p.poll())
        h.send('stop')
        item, result = h.finish()
        self.assertTrue(item['ok'])
        self.assertGreater(result['children'][0]['lifetime_s'], 5)
        self.check_cleanup(h, result)

    def test_cancel_while_recording_does_not_start_asr(self):
        h = self.start(); h.send('cancel')
        item, result = h.finish()
        self.assertEqual(item['outcome'], 'cancelled')
        self.assertFalse(item['ok'])
        self.assertEqual([c['phase'] for c in result['children']], ['capture'])
        self.assertFalse(any(e['event'] == 'transcript' for e in h.events))
        self.check_cleanup(h, result)

    def test_owner_eof_discards_recording(self):
        h = self.start(); h.p.stdin.close()
        item, result = h.finish()
        self.assertEqual(item['outcome'], 'cancelled')
        self.assertEqual([c['phase'] for c in result['children']], ['capture'])
        self.check_cleanup(h, result)

    def test_cancel_during_batch_asr_reaps_both_and_suppresses_text(self):
        h = self.start('asr-cancel'); h.send('stop')
        h.wait('state', 'transcribing'); time.sleep(0.2); h.send('cancel')
        item, result = h.finish()
        self.assertEqual(item['outcome'], 'cancelled')
        self.assertEqual([c['phase'] for c in result['children']], ['capture', 'inference'])
        self.assertFalse(any(e['event'] == 'transcript' for e in h.events))
        self.check_cleanup(h, result)

    def test_owner_eof_during_asr_discards(self):
        h = self.start('asr-eof'); h.send('stop')
        h.wait('state', 'transcribing'); time.sleep(0.2); h.p.stdin.close()
        item, result = h.finish()
        self.assertEqual(item['outcome'], 'cancelled')
        self.check_cleanup(h, result)

    def test_no_gpu_is_error_without_cpu_or_model_retry(self):
        h = self.start('no-gpu'); h.send('stop')
        item, result = h.finish()
        self.assertEqual(item['outcome'], 'error')
        self.assertIn('Vulkan', item['error'])
        self.assertEqual(len(result['children']), 2)
        self.assertFalse(any(e['event'] == 'transcript' for e in h.events))
        self.check_cleanup(h, result)

    def test_unresponsive_fake_escalates_and_deletes_partial_file(self):
        h = self.start('capture-ignore'); h.send('cancel')
        item, result = h.finish()
        self.assertEqual(item['outcome'], 'cancelled')
        self.assertEqual(result['children'][0]['signals'], ['SIGINT', 'SIGTERM', 'SIGKILL'])
        self.assertEqual(result['children'][0]['returncode'], -signal.SIGKILL)
        self.check_cleanup(h, result)

    def test_release_queued_before_worker_start_opens_no_recorder(self):
        h = self.harness(); h.send('start', 'stop')
        item, result = h.finish()
        self.assertEqual(item['outcome'], 'cancelled')
        self.assertEqual(result['children'], [])
        self.check_cleanup(h, result)

    def test_one_shot_ledger_refuses_another_attempt(self):
        h = self.start(); h.send('cancel'); item, result = h.finish()
        original = (h.root/'authorization-used.json').read_bytes()
        h2 = self.harness(root=h.root); h2.send('start')
        item2, result2 = h2.finish()
        self.assertEqual(item2['outcome'], 'error')
        self.assertIsNone(result2)
        self.assertEqual(original, (h.root/'authorization-used.json').read_bytes())
        self.assertEqual(len(list(h.root.glob('run-*'))), 1)
        self.check_cleanup(h, result)

    def test_worker_sigterm_cancels_and_waits_for_owned_recorder(self):
        h = self.start(); h.p.send_signal(signal.SIGTERM)
        item, result = h.finish()
        self.assertEqual(item['outcome'], 'cancelled')
        self.check_cleanup(h, result)

    def test_unlink_error_stays_error_even_when_cancelled(self):
        root = Path(tempfile.mkdtemp(prefix='selftest-unlink-', dir=ROOT))
        class Control:
            started = cancelled = True
            stopped = eof = False
            selector = selectors.DefaultSelector()
            def drain(self):
                pass
        trial = w.Trial(Control(), w.FakeServices('normal'), root)
        original_reserve = trial.reserve
        def reserve():
            original_reserve()
            trial.audio.write_bytes(b'synthetic-error-injection-only')
        trial.reserve = reserve
        original_unlink = Path.unlink
        def unlink(p, *args, **kwargs):
            if p == trial.audio:
                raise PermissionError('synthetic unlink failure')
            return original_unlink(p, *args, **kwargs)
        with contextlib.redirect_stdout(io.StringIO()) as output, patch.object(Path, 'unlink', unlink):
            code = trial.execute()
        events = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual(code, 1)
        self.assertEqual(events[-1]['outcome'], 'error')
        self.assertIn('deletion failed', events[-1]['error'])
        self.assertFalse(trial.report['audio_deleted'])
        self.assertTrue(trial.report['cleanup_error'])
        # The injected failure is restored; remove only this synthetic fixture.
        trial.audio.unlink()

    def test_seek_validator_supports_long_sparse_wav_without_reading_pcm(self):
        p = ROOT/'long-synthetic.wav'
        data_size = 16000 * 2 * 3600
        fmt = struct.pack('<HHIIHH', 1, 1, 16000, 32000, 2, 16)
        before = b'JUNK\3\0\0\0abc\0'
        body_header = b'WAVE' + before + b'fmt ' + struct.pack('<I', 16) + fmt + b'data' + struct.pack('<I', data_size)
        with p.open('xb') as f:
            f.write(b'RIFF' + struct.pack('<I', len(body_header) + data_size) + body_header)
            f.truncate(8 + len(body_header) + data_size)
        try:
            info = w.wav_info(p)
            self.assertEqual(info['duration_s'], 3600)
            self.assertEqual(info['data_offset'], 56)
            self.assertGreater(info['bytes'], 1000000)
        finally:
            p.unlink()

    def test_seek_validator_rejects_truncated_file(self):
        p = ROOT/'truncated.wav'
        with wave.open(str(p), 'wb') as f:
            f.setnchannels(1); f.setsampwidth(2); f.setframerate(16000); f.writeframes(b'\0'*320)
        with p.open('r+b') as f:
            f.truncate(p.stat().st_size-2)
        try:
            with self.assertRaisesRegex(RuntimeError, 'length'):
                w.wav_info(p)
        finally:
            p.unlink()

    def test_regular_file_stdin_cannot_start_real_worker(self):
        p = ROOT/'not-a-control-stream.txt'; p.write_text('{"action":"start"}\n')
        with p.open('rb') as f:
            done = subprocess.run([sys.executable, '-B', str(WORKER), '--worker'], stdin=f, capture_output=True, timeout=3)
        self.assertEqual(done.returncode, 1)
        self.assertFalse((HERE/'authorization-used.json').exists())


if __name__ == '__main__':
    print(f'Synthetic worker evidence: {ROOT}', flush=True)
    unittest.main(verbosity=2)
