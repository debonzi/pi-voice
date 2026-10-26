#!/usr/bin/env python3
"""Synthetic subprocess fixtures, never imported by the production worker.

All roles are selected by the test harness; there is no audio/service access.
Every fake has an independent watchdog. Its ledger stores metadata only.
"""
import json
import os
from pathlib import Path
import signal
import struct
import sys
import time
import wave

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT))


def settings():
    return json.loads(Path(os.environ['PI_VOICE_TEST_SPEC']).read_text())


def record(role, **data):
    spec = settings()
    path = Path(spec['ledger'])
    fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
    with os.fdopen(fd, 'w') as handle:
        handle.write(json.dumps({'role': role, 'pid': os.getpid(), **data}) + '\n')


def wav(path, mode='normal'):
    if mode == 'invalid':
        path.write_bytes(b'not a finalized WAV')
        return
    with wave.open(str(path), 'wb') as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(16000)
        # One frame intentionally proves there is no 200-ms admission threshold.
        handle.writeframes(b'' if mode == 'empty' else b'\0\0')


def metadata(argv):
    spec = settings()
    record('metadata', argv=argv)
    if spec.get('slow_metadata'):
        time.sleep(5)
    if spec.get('metadata_flood'):
        print('x' * 100000, flush=True)
        return 0
    source = json.loads(Path(spec['source']).read_text())
    if source.get('missing'):
        return 1
    print('id 55, type PipeWire:Interface:Node')
    for key, value in source.items():
        print(f'  * {key} = "{value}"')
    return 0


def recorder(argv):
    spec = settings()
    mode = spec.get('capture', 'normal')
    path = Path(argv[-1])
    def finish(signum, _frame):
        record('signal', signal=signum)
        if mode == 'ignore' or (mode == 'term' and signum == signal.SIGINT):
            return
        wav(path, mode)
        raise SystemExit(1)

    signal.signal(signal.SIGINT, finish)
    signal.signal(signal.SIGTERM, finish)
    record('recorder', argv=argv, audio=str(path),
           file_mode=path.stat().st_mode & 0o777,
           directory_mode=path.parent.stat().st_mode & 0o777)
    if mode == 'no-ready':
        time.sleep(10)
        return 97
    print('stream state changed unconnected -> connecting', flush=True)
    print('stream state changed paused -> streaming', flush=True)
    if mode == 'fatal-tail':
        print('stream input failed', end='', flush=True)
        wav(path)
        return 1
    if mode == 'unexpected':
        wav(path)
        return 1
    if mode == 'stderr':
        print('SYNTHETIC PRIVATE recorder failure', file=sys.stderr, flush=True)
    if mode == 'flood':
        for _ in range(4000):
            print('ordinary bounded metadata line', flush=True)
    until = time.monotonic() + 12
    while time.monotonic() < until:
        time.sleep(0.02)
    return 97


def inference(argv):
    spec = settings()
    mode = spec.get('inference', 'normal')
    record('inference', argv=argv, gpu=os.environ.get('GGML_VK_VISIBLE_DEVICES'),
           cache=os.environ.get('XDG_CACHE_HOME'), temporary=os.environ.get('TMPDIR'))
    print('whisper_model_load: n_audio_layer = 32', file=sys.stderr, flush=True)
    print('whisper_model_load: n_text_layer = ' + ('4' if mode == 'turbo' else '32'),
          file=sys.stderr, flush=True)
    if mode == 'no-gpu':
        print('whisper_backend_init_gpu: no GPU found', file=sys.stderr, flush=True)
        time.sleep(5)
        return 97
    if mode != 'missing-gpu':
        print('whisper_backend_init_gpu: using Vulkan0 backend', file=sys.stderr, flush=True)
    print('SYNTHETIC PRIVATE diagnostics, never persist this.', file=sys.stderr, flush=True)
    if mode == 'slow':
        time.sleep(8)
    if mode == 'fail':
        return 2
    if mode == 'oversized':
        print('x' * 100000, flush=True)
    elif mode == 'control':
        print('bad\x1b[201~text', flush=True)
    elif mode == 'invalid-utf8':
        os.write(1, b'\xff\xfe')
    elif mode == 'empty':
        print('  \n', flush=True)
    else:
        print('SYNTHETIC TRANSCRIPT: começo e fim.', flush=True)
    return 0


def worker():
    from worker.voice_worker import Services, Timings, main
    spec = settings()

    class SyntheticServices(Services):
        def tool(self, name):
            return [sys.executable, '-B', str(Path(__file__).resolve()), name]

        def cleanup(self, directory):
            if spec.get('cleanup_failure'):
                raise PermissionError('synthetic deletion failure')
            return super().cleanup(directory)

    timings = Timings(startup=0.6, metadata=1.0, terminate=0.15, kill=0.3,
                      pipe_close=0.3, poll=0.005)
    return main(SyntheticServices(), runtime_root=spec['runtime'], timings=timings)


def main(role=None, argv=None):
    if role is None:
        role, argv = sys.argv[1], sys.argv[2:]
    if role == 'worker':
        return worker()
    if role == 'stdbuf':
        assert argv[0] == '-oL'
        os.execv(argv[1], argv[1:])
    if role == 'wpctl':
        return metadata(argv)
    if role == 'pw-record':
        return recorder(argv)
    if role == 'inference':
        return inference(argv)
    raise AssertionError('Unknown synthetic role')


if __name__ == '__main__':
    raise SystemExit(main())
