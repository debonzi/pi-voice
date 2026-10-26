#!/usr/bin/env python3
"""One supervised, explicit Pi Voice operation; Python standard library only.

stdin is a private FIFO/socket carrying newline-delimited JSON. Nothing opens an
input until start. EOF is cancellation, including during metadata preflight.
stdout is protocol only; no audio, transcript, or raw diagnostic is persisted.
The CLI has no simulation mode. Tests inject Services through the Python API.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import selectors
import shutil
import signal
import stat
import struct
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass

DEFAULT_TRANSCRIPT_BYTES = 8 * 1024 * 1024
MAX_CONTROL_BYTES = 16384
MAX_LINE_BYTES = 16384


class Failure(Exception):
    """Only curated, nonsensitive messages may cross the protocol boundary."""


@dataclass(frozen=True)
class Timings:
    startup: float = 3.0
    metadata: float = 3.0
    terminate: float = 2.0
    kill: float = 3.0
    pipe_close: float = 1.0
    poll: float = 0.02


class Control:
    def __init__(self, fd):
        mode = os.fstat(fd).st_mode
        # Node/libuv's stdio='pipe' is generally a Unix socketpair, not a FIFO.
        if not (stat.S_ISFIFO(mode) or stat.S_ISSOCK(mode)):
            raise Failure('A private owner control pipe is required.')
        self.fd = fd
        self.selector = selectors.DefaultSelector()
        self.selector.register(fd, selectors.EVENT_READ, 'control')
        self.pending = b''
        self.config = None
        self.started = self.stopped = self.canceled = self.eof = False
        self.protocol_error = False

    def _line(self, line):
        try:
            obj = json.loads(line)
            if not isinstance(obj, dict):
                raise ValueError
            action = obj['type']
            if action == 'start':
                if not self.started:
                    if not isinstance(obj.get('config'), dict):
                        raise ValueError
                    self.config = obj['config']
                    self.started = True
            elif action == 'stop':
                self.stopped = True
            elif action == 'cancel':
                self.canceled = True
            else:
                raise ValueError
        except (ValueError, KeyError, TypeError, UnicodeError):
            self.protocol_error = True
            raise Failure('Invalid worker control protocol.') from None

    def pump(self, wait=0):
        events = self.selector.select(wait)
        # Control wins over readiness/results arriving in the same select batch.
        children = []
        for key, _mask in events:
            if key.data != 'control':
                children.append(key)
                continue
            raw = os.read(self.fd, 65536)
            if not raw:
                self.selector.unregister(self.fd)
                self.eof = self.canceled = True
                self.pending = b''
                continue
            self.pending += raw
            while b'\n' in self.pending:
                line, self.pending = self.pending.split(b'\n', 1)
                if len(line) > MAX_CONTROL_BYTES:
                    self.protocol_error = True
                    raise Failure('Worker control resource limit exceeded.')
                self._line(line)
            if len(self.pending) > MAX_CONTROL_BYTES:
                self.protocol_error = True
                raise Failure('Worker control resource limit exceeded.')
        return children

    def drain(self, wait=0):
        if self.pump(wait):
            raise Failure('Internal worker supervision error.')

    def close(self):
        self.selector.close()


def validate_config(config):
    if config.get('threads') != 8 or config.get('language') != 'auto':
        raise Failure('Full large-v3 requires eight threads and automatic language.')
    for key, executable in (('whisperCli', True), ('model', False)):
        value = config.get(key)
        if not isinstance(value, str) or not os.path.isabs(value):
            raise Failure('Absolute executable and model paths are required.')
        path = Path(value)
        if not path.is_file() or not os.access(path, os.R_OK):
            raise Failure('A required local artifact is unavailable.')
        if executable and not os.access(path, os.X_OK):
            raise Failure('The transcription executable is unavailable.')
    maximum = config.get('maxTranscriptBytes', DEFAULT_TRANSCRIPT_BYTES)
    if type(maximum) is not int or not 1 <= maximum <= 64 * 1024 * 1024:
        raise Failure('Invalid transcript resource limit.')
    # Read only the ggml model header, not a multi-gigabyte hash on every start.
    # This checks full multilingual large-v3 architecture, NOT weight provenance.
    with open(config['model'], 'rb') as handle:
        header = handle.read(48)
    if len(header) != 48:
        raise Failure('The full multilingual large-v3 model is required.')
    values = struct.unpack('<12I', header)
    if (values[0] != 0x67676D6C or
            values[1:11] != (51866, 1500, 1280, 20, 32, 448, 1280, 20, 32, 128)):
        raise Failure('The full multilingual large-v3 model is required.')
    return dict(config, maxTranscriptBytes=maximum)


def wav_info(path):
    """Strict seek/chunk-aware finalized RIFF PCM validation; never read PCM.

    No duration/file-size cutoff beyond RIFF's intrinsic 32-bit representation.
    Zero frames are valid structure but are handled as an empty operation.
    """
    with open(path, 'rb') as handle:
        total = os.fstat(handle.fileno()).st_size
        header = handle.read(12)
        if (len(header) != 12 or header[:4] != b'RIFF' or header[8:] != b'WAVE'
                or struct.unpack_from('<I', header, 4)[0] != total - 8):
            raise Failure('The recording was not a finalized WAV file.')
        position, formats, data = 12, [], []
        while position < total:
            handle.seek(position)
            header = handle.read(8)
            if len(header) != 8:
                raise Failure('The recording contains an incomplete WAV chunk.')
            size = struct.unpack_from('<I', header, 4)[0]
            end = position + 8 + size
            if end + size % 2 > total:
                raise Failure('The recording contains an incomplete WAV chunk.')
            if header[:4] == b'fmt ':
                if size not in (16, 18) or formats:
                    raise Failure('The recording has an unsupported WAV format.')
                formats.append(handle.read(size))
            elif header[:4] == b'data':
                if data:
                    raise Failure('The recording has duplicate audio chunks.')
                data.append((position + 8, size))
            position = end + size % 2
        if len(formats) != 1 or len(data) != 1:
            raise Failure('The recording is missing required WAV chunks.')
        fmt = formats[0]
        if ((len(fmt) == 18 and fmt[16:] != b'\0\0') or
                struct.unpack_from('<HHIIHH', fmt) != (1, 1, 16000, 32000, 2, 16)):
            raise Failure('The recording is not mono 16-kHz PCM-s16le.')
        offset, size = data[0]
        if size % 2:
            raise Failure('The recording contains an incomplete audio frame.')
        return {'frames': size // 2, 'dataOffset': offset, 'bytes': total}


class Services:
    """Production commands. Overridable Python seam, never a wire-level fake mode."""
    def tool(self, name):
        path = shutil.which(name)
        if not path or not os.path.isfile(path) or not os.access(path, os.X_OK):
            raise Failure('A required local capture tool is unavailable.')
        return [path]

    def preflight(self, worker):
        worker.config = validate_config(worker.control.config)
        # Resolve executables before any service connection/capture.
        self.stdbuf = self.tool('stdbuf')
        self.pw_record = self.tool('pw-record')
        self.wpctl = self.tool('wpctl')
        worker.control.drain()
        if worker.aborted_before_capture():
            return
        result = worker.process(self.wpctl + ['inspect', '@DEFAULT_AUDIO_SOURCE@'], 'metadata')
        if worker.aborted_before_capture():
            return
        if result.code != 0:
            raise Failure('The current default microphone is unavailable.')
        properties = {}
        for line in result.output.decode('utf-8', 'replace').splitlines():
            match = re.match(r'\s*\*?\s*([\w.]+)\s*=\s*"([^"\r\n]*)"\s*$', line)
            if match:
                properties[match[1]] = match[2]
        name = properties.get('node.name', '')
        if (properties.get('media.class') != 'Audio/Source' or not name
                or len(name) > 1024 or name.startswith('-')
                or any(ord(c) < 32 or 127 <= ord(c) <= 159 for c in name)
                or 'monitor' in name.lower()
                or properties.get('device.class', '').lower() == 'monitor'
                or properties.get('media.role', '').lower() == 'monitor'
                or properties.get('stream.monitor', '').lower() == 'true'
                or properties.get('stream.capture.sink', '').lower() == 'true'
                or properties.get('api.alsa.pcm.stream', '').lower() == 'playback'):
            raise Failure('No eligible current default microphone was found.')
        worker.target = name
        description = properties.get('node.description', name)
        worker.input_description = ''.join(c for c in description
                                          if ord(c) >= 32 and not 127 <= ord(c) <= 159)[:256]
        # Do not enumerate or silently select another source. No setter is used.
        # A default/device change after this snapshot has no pinning guarantee.

    def recorder(self, worker):
        return self.stdbuf + ['-oL'] + self.pw_record + [
            '--verbose', '--rate', '16000', '--channels', '1', '--format', 's16',
            '--target', worker.target, str(worker.audio)]

    def transcriber(self, worker):
        config = worker.config
        return [config['whisperCli'], '--model', config['model'], '--file', str(worker.audio),
                '--language', 'auto', '--threads', '8', '--device', '0', '--no-timestamps']

    def cleanup(self, directory):
        # Only the fresh private operation directory, never a shared cache/path.
        shutil.rmtree(directory)


@dataclass
class Result:
    code: int | None = None
    output: bytes = b''
    active: bool = False
    stop_sent: bool = False
    escalated: bool = False
    spawned: bool = False


class Worker:
    def __init__(self, control, services=None, output=None, runtime_root=None, timings=None):
        self.control = control
        self.services = services or Services()
        self.output = output or sys.stdout
        self.runtime_root = runtime_root
        self.timings = timings or Timings()
        self.directory = self.audio = None
        self.directory_identity = None
        self.children = []
        self.config = None
        self.target = self.input_description = None
        self.backend = {'vulkan0': False, 'encoder': None, 'decoder': None}
        self.output_closed = False

    def emit(self, kind, **fields):
        try:
            self.output.write(json.dumps({'type': kind, **fields}, ensure_ascii=False) + '\n')
            self.output.flush()
        except (BrokenPipeError, OSError):
            self.output_closed = True
            self.control.canceled = True
            raise Failure('The operation owner disconnected.') from None

    def state(self, value, **fields):
        self.emit('state', state=value, **fields)

    def aborted_before_capture(self):
        return self.control.canceled or self.control.stopped

    def allocate(self):
        root = self.runtime_root
        if root is None:
            candidate = os.environ.get('XDG_RUNTIME_DIR')
            if candidate:
                metadata = os.stat(candidate)
                if (stat.S_ISDIR(metadata.st_mode) and metadata.st_uid == os.getuid()
                        and metadata.st_mode & 0o077 == 0):
                    root = candidate
        self.directory = Path(tempfile.mkdtemp(prefix='pi-voice-', dir=root))
        metadata = self.directory.stat()
        self.directory_identity = (metadata.st_dev, metadata.st_ino)
        self.audio = self.directory / 'capture.wav'
        fd = os.open(self.audio, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        os.close(fd)

    def _line(self, phase, kind, line, result):
        text = line.decode('utf-8', 'replace')
        if phase == 'capture':
            # Match diagnostic structures, not words inside paths/property values.
            # A perfectly valid runtime directory may contain "error" or "failed".
            metadata = (text.startswith('sndfile: opened file ') or
                        re.match(r'^\s*[\w.]+\s*=', text))
            fatal = not metadata and re.search(
                r'^(?:error\b|failed\b|(?:core|remote|stream|sndfile)(?:\s+\d+)?[ :].*\b(?:error|failed)\b|'
                r'stream node \d+ unconnected)', text.lower())
            disconnected = (re.search(r'^stream state changed .* -> unconnected\s*$', text) and
                            result.active and not self.control.stopped and not self.control.canceled)
            if kind == 'stderr' or fatal or disconnected:
                raise Failure('The recorder reported an input error.')
            if re.search(r'stream state changed .* -> streaming\s*$', text):
                if not result.active:
                    result.active = True
                    if not self.aborted_before_capture():
                        self.state('recording', input=self.input_description)
        elif phase == 'inference' and kind == 'stderr':
            if 'whisper_backend_init_gpu:' in text:
                if 'using Vulkan0 backend' in text:
                    self.backend['vulkan0'] = True
                elif ('no GPU found' in text or 'failed' in text or
                      re.search(r'using \S+ backend', text)):
                    raise Failure('The required Vulkan device is unavailable; transcription was rejected.')
            for label, key in (('n_audio_layer', 'encoder'), ('n_text_layer', 'decoder')):
                match = re.search(rf'{label}\s*=\s*(\d+)', text)
                if match:
                    self.backend[key] = int(match[1])
                    if self.backend[key] != 32:
                        raise Failure('The full large-v3 runtime was not confirmed.')
            if 'main: processing' in text and not self.backend['vulkan0']:
                raise Failure('The required Vulkan device is unavailable; transcription was rejected.')

    def process(self, argv, phase):
        """Supervise a direct child, draining both pipes with bounded memory.

        Only metadata and recorder startup have deadlines. Active capture and
        inference have none. Stop/cancel termination is INT, TERM at 2s, KILL at
        3s; escalation can never produce an admitted recording.
        """
        self.control.drain()
        result = Result()
        if self.control.canceled or (phase != 'inference' and self.control.stopped):
            return result
        env = dict(os.environ)
        if phase == 'inference':
            cache, temporary = self.directory / 'cache', self.directory / 'tmp'
            cache.mkdir(mode=0o700)
            temporary.mkdir(mode=0o700)
            env.update(GGML_VK_VISIBLE_DEVICES='0', XDG_CACHE_HOME=str(cache),
                       MESA_SHADER_CACHE_DIR=str(cache / 'mesa'), TMPDIR=str(temporary))
        child = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, env=env, umask=0o077)
        self.children.append(child)
        result.spawned = True
        selector = self.control.selector
        pipes = (child.stdout, child.stderr)
        for pipe, kind in zip(pipes, ('stdout', 'stderr')):
            selector.register(pipe, selectors.EVENT_READ, kind)
        live = set(pipes)
        pending = {'stdout': b'', 'stderr': b''}
        output = bytearray()
        started = time.monotonic()
        stop_at = exit_at = None
        last_signal = 0
        failure = None
        try:
            while child.poll() is None or live:
                try:
                    keys = self.control.pump(self.timings.poll)
                except Failure as exc:
                    failure = exc
                    keys = []
                for key in keys:
                    raw = os.read(key.fileobj.fileno(), 65536)
                    kind = key.data
                    if not raw:
                        selector.unregister(key.fileobj)
                        live.discard(key.fileobj)
                        if pending[kind]:
                            try:
                                self._line(phase, kind, pending[kind], result)
                            except Failure as exc:
                                failure = failure or exc
                            pending[kind] = b''
                        continue
                    if phase == 'metadata' or (phase == 'inference' and kind == 'stdout'):
                        maximum = self.config['maxTranscriptBytes'] if phase == 'inference' else 65536
                        if len(output) + len(raw) > maximum:
                            failure = failure or Failure('Local process output resource limit exceeded.')
                        elif failure is None and kind == 'stdout':
                            output.extend(raw)
                    # Transcripts are arbitrary length within their separate bound;
                    # only diagnostic/readiness lines go through the line parser.
                    if phase == 'capture' or (phase == 'inference' and kind == 'stderr'):
                        pending[kind] += raw
                        lines = pending[kind].split(b'\n')
                        pending[kind] = lines.pop()
                        for line in lines:
                            if len(line) > MAX_LINE_BYTES:
                                failure = failure or Failure('Local diagnostic resource limit exceeded.')
                                continue
                            try:
                                self._line(phase, kind, line, result)
                            except Failure as exc:
                                failure = failure or exc
                        if len(pending[kind]) > MAX_LINE_BYTES:
                            pending[kind] = b''
                            failure = failure or Failure('Local diagnostic resource limit exceeded.')
                now = time.monotonic()
                if phase == 'metadata' and now - started > self.timings.metadata:
                    failure = failure or Failure('Default microphone lookup timed out.')
                if phase == 'capture' and not result.active and now - started > self.timings.startup:
                    failure = failure or Failure('The microphone did not become stream-active.')
                stop = self.control.canceled or failure or (phase != 'inference' and self.control.stopped)
                if stop and stop_at is None and child.poll() is None:
                    stop_at = now
                    if phase == 'capture':
                        try:
                            self.state('stopping')
                        except Failure as exc:
                            failure = failure or exc
                if stop_at is not None and child.poll() is None:
                    elapsed = now - stop_at
                    level = 3 if elapsed >= self.timings.kill else 2 if elapsed >= self.timings.terminate else 1
                    if level > last_signal:
                        sig = (signal.SIGKILL if level == 3 else signal.SIGTERM if level == 2
                               else signal.SIGINT)
                        try:
                            child.send_signal(sig)
                            if phase == 'capture' and level == 1 and self.control.stopped:
                                result.stop_sent = True
                        except ProcessLookupError:
                            pass
                        last_signal = level
                        result.escalated = level > 1
                if child.poll() is not None and live:
                    if exit_at is None:
                        exit_at = now
                    elif now - exit_at > self.timings.pipe_close:
                        raise Failure('A local process did not close its diagnostic pipes.')
            result.code = child.wait()
            result.output = bytes(output)
            if failure and (not self.control.canceled or self.control.protocol_error):
                raise failure
            return result
        finally:
            # Exceptions cannot leak a writer/reader. All direct children are
            # reaped before the operation directory is eligible for deletion.
            if child.poll() is None:
                child.kill()
            child.wait()
            for pipe in pipes:
                try:
                    selector.unregister(pipe)
                except KeyError:
                    pass
                pipe.close()

    def execute(self):
        text = None
        outcome, message = 'canceled', None
        cleanup_ok = True
        try:
            while not self.control.started and not self.control.canceled and not self.control.stopped:
                self.control.drain(0.1)
            self.control.drain()
            if not self.aborted_before_capture() and self.control.started:
                self.state('starting')
                self.services.preflight(self)
                self.control.drain()
                if not self.aborted_before_capture():
                    self.allocate()
                    capture = self.process(self.services.recorder(self), 'capture')
                    self.control.drain()
                    if not capture.spawned and self.control.stopped:
                        # A release in the final pre-spawn drain must never reopen
                        # the microphone or turn a harmless quick gesture into error.
                        self.control.canceled = True
                    if not self.control.canceled:
                        if (not capture.stop_sent or capture.code not in (0, 1)
                                or capture.escalated):
                            raise Failure('The recorder did not finish an intentional normal stop.')
                        info = wav_info(self.audio)
                        self.control.drain()
                        if not self.control.canceled:
                            if not info['frames'] or not capture.active:
                                outcome = 'empty'
                            else:
                                self.state('transcribing')
                                inference = self.process(self.services.transcriber(self), 'inference')
                                self.control.drain()
                                if not self.control.canceled:
                                    if inference.code != 0 or inference.escalated:
                                        raise Failure('Local batch transcription failed; no retry was made.')
                                    if self.backend != {'vulkan0': True, 'encoder': 32, 'decoder': 32}:
                                        raise Failure('The full large-v3 Vulkan runtime was not confirmed.')
                                    try:
                                        text = inference.output.decode('utf-8').strip()
                                    except UnicodeError:
                                        raise Failure('The transcription contained invalid text.') from None
                                    if any((ord(c) < 32 and c not in '\n\r\t') or
                                           127 <= ord(c) <= 159 for c in text):
                                        raise Failure('The transcription contained invalid text.')
                                    outcome = 'completed' if text else 'empty'
        except Failure as exc:
            outcome, message = 'error', str(exc)
        except Exception:
            outcome, message = 'error', 'The local voice operation failed.'
        finally:
            # Reap even if preflight or an injected service raised unexpectedly.
            for child in self.children:
                try:
                    if child.poll() is None:
                        child.kill()
                    child.wait()
                except OSError:
                    cleanup_ok = False
            try:
                self.state('cleaning')
            except Failure:
                pass
            if self.directory is not None and cleanup_ok:
                try:
                    metadata = self.directory.lstat()
                    if (not stat.S_ISDIR(metadata.st_mode) or
                            (metadata.st_dev, metadata.st_ino) != self.directory_identity):
                        raise OSError('Owned directory identity changed')
                    self.services.cleanup(self.directory)
                    if self.directory.exists():
                        raise OSError('Owned directory still exists')
                except Exception:
                    cleanup_ok = False
            try:
                self.control.drain()
            except Failure as exc:
                outcome, message = 'error', str(exc)
            if not cleanup_ok:
                outcome, message = 'error', 'Temporary audio cleanup failed; do not start another recording.'
            elif self.control.canceled and not self.control.protocol_error:
                outcome, message = 'canceled', None
            try:
                if outcome == 'completed' and cleanup_ok:
                    self.emit('transcript', text=text)
                self.emit('finished', outcome=outcome, cleanupOk=cleanup_ok,
                          **({'message': message} if message else {}))
            except Failure:
                outcome = 'canceled' if cleanup_ok else 'error'
            self.control.close()
        return 1 if outcome == 'error' else 0


def main(services=None, runtime_root=None, timings=None):
    # This process is a private helper, never Pi's process. Popen also explicitly
    # restricts child creation permissions when Worker is imported by a host.
    os.umask(0o077)
    control = None
    try:
        control = Control(sys.stdin.fileno())
        worker = Worker(control, services, runtime_root=runtime_root, timings=timings)
        def interrupted(_signum, _frame):
            control.canceled = True
        for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
            signal.signal(signum, interrupted)
        return worker.execute()
    except Exception:
        # No raw exception/paths/diagnostics on either stream.
        if control is not None:
            control.close()
        print(json.dumps({'type': 'finished', 'outcome': 'error', 'cleanupOk': True,
                          'message': 'The voice worker could not initialize.'}), flush=True)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
