"""Fake-only worker integration and format tests. No real tools/services run.

Run: python3 -B -m unittest discover -s tests -p 'test_voice_worker.py' -v
"""
import io
import json
import os
from pathlib import Path
import selectors
import signal
import socket
import struct
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from worker.voice_worker import Control, Failure, Result, Services, Timings, Worker, wav_info

FAKE = Path(__file__).with_name('fake_audio.py')
SOURCE = {'node.name': 'alsa_input.builtin', 'media.class': 'Audio/Source',
          'node.description': 'Synthetic built-in microphone'}
MODEL_HEADER = struct.pack('<12I', 0x67676D6C, 51866, 1500, 1280, 20, 32,
                           448, 1280, 20, 32, 128, 1)


class Harness:
    def __init__(self, test, directory, options=None, use_socket=False):
        self.test = test
        self.directory = directory
        self.runtime = directory / 'runtime'
        self.runtime.mkdir(mode=0o700, exist_ok=True)
        self.source = directory / 'source.json'
        if not self.source.exists():
            self.source.write_text(json.dumps(SOURCE))
        self.ledger = directory / ('ledger-' + str(time.monotonic_ns()))
        self.spec = directory / ('spec-' + str(time.monotonic_ns()))
        data = {'ledger': str(self.ledger), 'source': str(self.source),
                'runtime': str(self.runtime), **(options or {})}
        self.spec.write_text(json.dumps(data))
        self.model = directory / 'model.bin'
        if not self.model.exists():
            self.model.write_bytes(MODEL_HEADER)
        self.cli = directory / 'whisper-cli'
        if not self.cli.exists():
            self.cli.write_text(f'#!{sys.executable}\nimport sys\nsys.path.insert(0, {str(FAKE.parent)!r})\n'
                                'from fake_audio import main\nraise SystemExit(main("inference", sys.argv[1:]))\n')
            self.cli.chmod(0o700)
        self.config = {'whisperCli': str(self.cli), 'model': str(self.model),
                       'language': 'auto', 'threads': 8}
        env = dict(os.environ, PI_VOICE_TEST_SPEC=str(self.spec), PYTHONDONTWRITEBYTECODE='1')
        self.socket = None
        if use_socket:
            self.socket, child_socket = socket.socketpair()
            stdin = child_socket
        else:
            child_socket = None
            stdin = subprocess.PIPE
        self.process = subprocess.Popen([sys.executable, '-B', str(FAKE), 'worker'],
                                        stdin=stdin, stdout=subprocess.PIPE,
                                        stderr=subprocess.PIPE, env=env)
        if child_socket:
            child_socket.close()
        self.events = []
        self.pending = b''
        self.selector = selectors.DefaultSelector()
        self.selector.register(self.process.stdout, selectors.EVENT_READ)
        test.addCleanup(self.close)

    def close(self):
        self.owner_eof()
        if self.process.poll() is None:
            try:
                self.process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait()
        self.process.stdout.close()
        self.process.stderr.close()
        self.selector.close()

    def owner_eof(self):
        if self.socket is not None:
            self.socket.close()
            self.socket = None
        if self.process.stdin is not None and not self.process.stdin.closed:
            self.process.stdin.close()

    def send(self, *commands):
        data = ''.join(json.dumps(command) + '\n' for command in commands).encode()
        if self.socket:
            self.socket.sendall(data)
        else:
            self.process.stdin.write(data)
            self.process.stdin.flush()

    def start(self, **overrides):
        self.send({'type': 'start', 'config': {**self.config, **overrides}})

    def read(self, timeout=0.1):
        if not self.selector.select(timeout):
            return
        raw = os.read(self.process.stdout.fileno(), 65536)
        if not raw:
            return
        self.pending += raw
        while b'\n' in self.pending:
            line, self.pending = self.pending.split(b'\n', 1)
            self.events.append(json.loads(line))

    def until(self, predicate, timeout=5):
        until = time.monotonic() + timeout
        while time.monotonic() < until:
            self.read(0.02)
            for event in self.events:
                if predicate(event):
                    return event
            if self.process.poll() is not None:
                self.read(0)
                for event in self.events:
                    if predicate(event):
                        return event
                break
        raise AssertionError(f'Missing event; events={self.events}; returncode={self.process.poll()}')

    def state(self, state):
        return self.until(lambda event: event.get('state') == state)

    def records(self, role=None):
        records = []
        if self.ledger.exists():
            records = [json.loads(line) for line in self.ledger.read_text().splitlines()]
        return [record for record in records if role is None or record['role'] == role]

    def wait_record(self, role):
        until = time.monotonic() + 3
        while time.monotonic() < until:
            records = self.records(role)
            if records:
                return records[-1]
            time.sleep(0.005)
        raise AssertionError('Missing fake subprocess: ' + role)

    def finish(self, outcome, cleanup=True):
        event = self.until(lambda item: item['type'] == 'finished')
        self.process.wait(timeout=3)
        while self.selector.select(0):
            raw = os.read(self.process.stdout.fileno(), 65536)
            if not raw:
                break
            self.pending += raw
        self.test.assertEqual(self.pending, b'')
        self.test.assertEqual(self.events[-1], event)
        self.test.assertEqual(event['outcome'], outcome, self.events)
        self.test.assertEqual(event['cleanupOk'], cleanup)
        self.test.assertEqual(self.process.returncode, 1 if outcome == 'error' else 0)
        self.test.assertEqual(self.process.stderr.read(), b'')
        texts = [item for item in self.events if item['type'] == 'transcript']
        self.test.assertEqual(len(texts), 1 if outcome == 'completed' else 0)
        if cleanup:
            self.test.assertEqual(list(self.runtime.iterdir()), [])
        for item in self.records():
            if item['role'] in ('recorder', 'inference', 'metadata'):
                with self.test.assertRaises(ProcessLookupError):
                    os.kill(item['pid'], 0)
        return event


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='pi-voice-unit-')
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)

    def harness(self, options=None, use_socket=False):
        return Harness(self, self.directory, options, use_socket)

    def completed(self, harness):
        harness.start()
        harness.state('recording')
        harness.send({'type': 'stop'})
        harness.finish('completed')

    def test_no_start_has_no_preflight_or_children(self):
        harness = self.harness()
        time.sleep(0.1)
        self.assertEqual(harness.records(), [])
        self.assertEqual(harness.events, [])
        harness.owner_eof()
        harness.finish('canceled')

    def test_normal_exit_one_and_private_cleanup_before_transcript(self):
        harness = self.harness()
        harness.start()
        active = harness.state('recording')
        self.assertEqual(active['input'], SOURCE['node.description'])
        harness.send({'type': 'stop'})
        harness.until(lambda item: item['type'] == 'transcript')
        self.assertEqual(list(harness.runtime.iterdir()), [])
        harness.finish('completed')
        recorder = harness.records('recorder')[0]
        self.assertEqual(recorder['file_mode'], 0o600)
        self.assertEqual(recorder['directory_mode'], 0o700)
        self.assertEqual([x['signal'] for x in harness.records('signal')], [signal.SIGINT])
        inference = harness.records('inference')[0]
        self.assertEqual(inference['gpu'], '0')
        argv = inference['argv']
        for flag, value in (('--language', 'auto'), ('--threads', '8'), ('--device', '0'),
                            ('--model', str(harness.model))):
            self.assertEqual(argv[argv.index(flag) + 1], value)
        self.assertIn('--no-timestamps', argv)
        serialized = json.dumps(harness.events)
        self.assertNotIn('PRIVATE diagnostics', serialized)
        self.assertNotIn('capture.wav', serialized)

    def test_stop_in_final_pre_spawn_drain_is_harmless(self):
        class NoCapture(Services):
            def preflight(self, worker):
                worker.config = {'maxTranscriptBytes': 1024}

            def recorder(self, worker):
                return ['must-not-run-a-recorder']

        class StopBeforeSpawn(Worker):
            def process(self, argv, phase):
                self.control.stopped = True
                return super().process(argv, phase)

        read_fd, write_fd = os.pipe()
        try:
            control = Control(read_fd)
            control.started = True
            control.config = {}
            output = io.StringIO()
            worker = StopBeforeSpawn(control, NoCapture(), output, runtime_root=self.directory)
            self.assertEqual(worker.execute(), 0)
            self.assertEqual(worker.children, [])
            self.assertEqual(json.loads(output.getvalue().splitlines()[-1])['outcome'], 'canceled')
            self.assertEqual(list(self.directory.iterdir()), [])
        finally:
            os.close(read_fd)
            os.close(write_fd)

    def test_recorder_metadata_paths_are_not_fatal_diagnostics(self):
        read_fd, write_fd = os.pipe()
        try:
            control = Control(read_fd)
            worker = Worker(control, output=io.StringIO())
            result = Result()
            for line in (b'sndfile: opened file "/tmp/error/failed/capture.wav" format 10010002 channels:1 rate:16000',
                         b'  media.filename = "/tmp/error/capture.wav"',
                         b'connecting record stream; target=alsa_input.error.usb'):
                worker._line('capture', 'stdout', line, result)
            with self.assertRaises(Failure):
                worker._line('capture', 'stdout', b'stream input failed', result)
            control.close()
        finally:
            os.close(read_fd)
            os.close(write_fd)

    def test_current_default_is_fresh_for_successive_workers_including_usb(self):
        for name, description in [('alsa_input.builtin', 'Built-in'), ('alsa_input.usb-device', 'USB mic')]:
            with self.subTest(source=name):
                harness = self.harness()
                harness.source.write_text(json.dumps({'node.name': name, 'media.class': 'Audio/Source',
                                                      'node.description': description}))
                self.completed(harness)
                recorder = harness.records('recorder')[0]
                argv = recorder['argv']
                self.assertEqual(argv[argv.index('--target') + 1], name)
                self.assertEqual(harness.records('metadata')[0]['argv'],
                                 ['inspect', '@DEFAULT_AUDIO_SOURCE@'])

    def test_no_default_wrong_class_and_monitor_refused(self):
        for source in ({'missing': True}, {'media.class': 'Audio/Source'},
                       {'node.name': 'speaker', 'media.class': 'Audio/Sink'},
                       {'node.name': 'speaker.monitor', 'media.class': 'Audio/Source'}):
            with self.subTest(source=source):
                harness = self.harness()
                harness.source.write_text(json.dumps(source))
                harness.start()
                harness.finish('error')
                self.assertEqual(harness.records('recorder'), [])

    def test_stop_cancel_batched_with_start_never_preflights(self):
        for command in ('stop', 'cancel'):
            with self.subTest(command=command):
                harness = self.harness()
                harness.send({'type': 'start', 'config': harness.config}, {'type': command})
                harness.finish('canceled')
                self.assertEqual(harness.records(), [])

    def test_stop_cancel_eof_during_slow_preflight_never_opens_input(self):
        for action in ('stop', 'cancel', 'eof'):
            with self.subTest(action=action):
                harness = self.harness({'slow_metadata': True})
                harness.start()
                harness.wait_record('metadata')
                if action == 'eof':
                    harness.owner_eof()
                else:
                    harness.send({'type': action})
                harness.finish('canceled')
                self.assertEqual(harness.records('recorder'), [])

    def test_cancel_and_owner_eof_during_capture_fifo_and_socket(self):
        for use_socket, action in ((False, 'cancel'), (False, 'eof'), (True, 'eof')):
            with self.subTest(socket=use_socket, action=action):
                harness = self.harness(use_socket=use_socket)
                harness.start()
                harness.state('recording')
                if action == 'eof':
                    harness.owner_eof()
                else:
                    harness.send({'type': action})
                harness.finish('canceled')
                self.assertEqual(harness.records('inference'), [])

    def test_cancel_and_eof_during_inference(self):
        for action in ('cancel', 'eof'):
            with self.subTest(action=action):
                harness = self.harness({'inference': 'slow'})
                harness.start()
                harness.state('recording')
                harness.send({'type': 'stop'})
                harness.wait_record('inference')
                if action == 'eof':
                    harness.owner_eof()
                else:
                    harness.send({'type': action})
                harness.finish('canceled')

    def test_quick_stop_and_cancel_after_spawn_never_report_recording(self):
        for action, outcome in (('stop', 'empty'), ('cancel', 'canceled')):
            with self.subTest(action=action):
                harness = self.harness({'capture': 'no-ready'})
                harness.start()
                harness.wait_record('recorder')
                # The fake records this metadata only after installing handlers;
                # no sleep or late-readiness synchronization is required.
                harness.send({'type': action})
                harness.finish(outcome)
                self.assertNotIn('recording', [item.get('state') for item in harness.events])
                self.assertEqual(harness.records('inference'), [])

    def test_repeated_start_stop_and_cancel_win(self):
        harness = self.harness({'inference': 'slow'})
        harness.start()
        harness.send({'type': 'start', 'config': {'invalid': True}})
        harness.state('recording')
        harness.send({'type': 'stop'}, {'type': 'stop'})
        harness.wait_record('inference')
        harness.send({'type': 'cancel'}, {'type': 'cancel'})
        harness.finish('canceled')
        self.assertEqual(len(harness.records('recorder')), 1)
        self.assertEqual(len(harness.records('inference')), 1)

    def test_termination_escalation_discards(self):
        for mode in ('term', 'ignore'):
            with self.subTest(mode=mode):
                harness = self.harness({'capture': mode})
                harness.start()
                harness.state('recording')
                harness.send({'type': 'stop'})
                harness.finish('error')
                self.assertIn(signal.SIGTERM, [item['signal'] for item in harness.records('signal')])
                self.assertEqual(harness.records('inference'), [])

    def test_unexpected_exit_fatal_fragment_and_stderr_are_errors(self):
        for mode in ('unexpected', 'fatal-tail', 'stderr'):
            with self.subTest(mode=mode):
                harness = self.harness({'capture': mode})
                harness.start()
                harness.finish('error')
                self.assertEqual(harness.records('inference'), [])

    def test_invalid_and_empty_wav(self):
        for mode, outcome in (('invalid', 'error'), ('empty', 'empty')):
            with self.subTest(mode=mode):
                harness = self.harness({'capture': mode})
                harness.start()
                harness.state('recording')
                harness.send({'type': 'stop'})
                harness.finish(outcome)
                self.assertEqual(harness.records('inference'), [])

    def test_startup_deadline(self):
        harness = self.harness({'capture': 'no-ready'})
        harness.start()
        harness.finish('error')
        self.assertEqual(harness.records('inference'), [])

    def test_gpu_full_model_and_text_admission_fail_closed(self):
        for mode in ('no-gpu', 'missing-gpu', 'turbo', 'fail', 'control', 'invalid-utf8'):
            with self.subTest(mode=mode):
                harness = self.harness({'inference': mode})
                harness.start()
                harness.state('recording')
                harness.send({'type': 'stop'})
                harness.finish('error')
                self.assertEqual(len(harness.records('inference')), 1)

    def test_empty_transcript(self):
        harness = self.harness({'inference': 'empty'})
        harness.start()
        harness.state('recording')
        harness.send({'type': 'stop'})
        harness.finish('empty')

    def test_bounded_output_and_metadata_limits(self):
        harness = self.harness({'inference': 'oversized'})
        harness.start(maxTranscriptBytes=1024)
        harness.state('recording')
        harness.send({'type': 'stop'})
        harness.finish('error')
        harness = self.harness({'metadata_flood': True})
        harness.start()
        harness.finish('error')
        self.assertEqual(harness.records('recorder'), [])

    def test_both_pipes_are_drained_without_persisting_diagnostics(self):
        harness = self.harness({'capture': 'flood'})
        self.completed(harness)
        self.assertLess(len(json.dumps(harness.events)), 3000)

    def test_cleanup_failure_overrides_completed_and_cancel(self):
        for cancel in (False, True):
            with self.subTest(cancel=cancel):
                harness = self.harness({'cleanup_failure': True})
                harness.start()
                harness.state('recording')
                harness.send({'type': 'cancel' if cancel else 'stop'})
                event = harness.finish('error', cleanup=False)
                self.assertIn('cleanup failed', event['message'])
                for directory in harness.runtime.iterdir():
                    self.assertTrue((directory / 'capture.wav').exists())
                    import shutil
                    shutil.rmtree(directory)  # Only the test's own synthetic fixtures.

    def test_invalid_protocol_cancels_children_but_reports_error(self):
        harness = self.harness()
        harness.start()
        harness.state('recording')
        harness.send({'type': 'unknown-private-payload'})
        event = harness.finish('error')
        self.assertNotIn('unknown-private-payload', event['message'])

    def test_signal_to_helper_is_cancellation(self):
        harness = self.harness()
        harness.start()
        harness.state('recording')
        harness.process.send_signal(signal.SIGTERM)
        harness.finish('canceled')

    def test_preflight_artifact_validation_without_services(self):
        for change in ({'whisperCli': 'relative'}, {'model': '/no/such/local/model'},
                       {'threads': 4}, {'language': 'en'}, {'maxTranscriptBytes': 0}):
            with self.subTest(change=change):
                harness = self.harness()
                harness.start(**change)
                harness.finish('error')
                self.assertEqual(harness.records(), [])
        harness = self.harness()
        header = list(struct.unpack('<12I', MODEL_HEADER))
        header[9] = 4
        harness.model.write_bytes(struct.pack('<12I', *header))
        harness.start()
        harness.finish('error')
        self.assertEqual(harness.records(), [])

    def test_default_deadlines_are_not_recording_or_inference_caps(self):
        defaults = Timings()
        self.assertEqual((defaults.terminate, defaults.kill), (2.0, 3.0))
        harness = self.harness()
        harness.start()
        harness.state('recording')
        # Longer than the injected 0.6-second recorder STARTUP deadline.
        time.sleep(0.8)
        self.assertIsNone(harness.process.poll())
        harness.send({'type': 'stop'})
        harness.finish('completed')


class WavTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='pi-voice-wav-')
        self.addCleanup(self.temporary.cleanup)
        self.path = Path(self.temporary.name) / 'synthetic.wav'
        self.fmt = struct.pack('<HHIIHH', 1, 1, 16000, 32000, 2, 16)

    def chunk(self, kind, payload):
        return kind + struct.pack('<I', len(payload)) + payload + b'\0' * (len(payload) % 2)

    def fixture(self, chunks):
        payload = b'WAVE' + b''.join(chunks)
        self.path.write_bytes(b'RIFF' + struct.pack('<I', len(payload)) + payload)
        return self.path

    def test_padded_unknown_chunks_and_one_positive_frame(self):
        path = self.fixture([self.chunk(b'JUNK', b'abc'), self.chunk(b'fmt ', self.fmt),
                             self.chunk(b'data', b'\0\0'), self.chunk(b'LIST', b'x')])
        info = wav_info(path)
        self.assertEqual(info['frames'], 1)
        self.assertGreater(info['dataOffset'], 44)

    def test_empty_structurally_valid(self):
        self.fixture([self.chunk(b'fmt ', self.fmt), self.chunk(b'data', b'')])
        self.assertEqual(wav_info(self.path)['frames'], 0)

    def test_sparse_one_hour_wav_no_size_or_duration_limit(self):
        size = 3600 * 32000
        with self.path.open('wb') as handle:
            handle.write(b'RIFF' + struct.pack('<I', size + 36) + b'WAVE')
            handle.write(self.chunk(b'fmt ', self.fmt))
            handle.write(b'data' + struct.pack('<I', size))
            handle.seek(size - 1, 1)
            handle.write(b'\0')
        self.assertEqual(wav_info(self.path)['frames'], 3600 * 16000)

    def test_strict_rejections(self):
        normal = [self.chunk(b'fmt ', self.fmt), self.chunk(b'data', b'\0\0')]
        cases = [normal + [self.chunk(b'data', b'\0\0')],
                 [self.chunk(b'data', b'\0\0')],
                 [self.chunk(b'fmt ', self.fmt), self.chunk(b'data', b'x')],
                 [self.chunk(b'fmt ', struct.pack('<HHIIHH', 1, 2, 16000, 64000, 4, 16)), normal[1]],
                 [self.chunk(b'fmt ', self.fmt), self.chunk(b'JUNK', b'x')[:-1]]]
        for chunks in cases:
            with self.subTest(chunks=chunks):
                self.fixture(chunks)
                with self.assertRaises(Failure):
                    wav_info(self.path)
        self.fixture(normal)
        with self.path.open('ab') as handle:
            handle.write(b'extra')
        with self.assertRaises(Failure):
            wav_info(self.path)


if __name__ == '__main__':
    unittest.main()
