#!/usr/bin/env python3
"""Real Pi startup/shutdown in synthetic PTY; NEVER sends Ctrl+Q.
No microphone, service query, model inference, or physical-terminal claim.
"""
import errno
import fcntl
import os
from pathlib import Path
import pty
import select
import struct
import subprocess
import termios
import time

os.umask(0o077)
here = Path(__file__).resolve().parent
assert not (here/'authorization-used.json').exists(), 'Do not run after the real trial'
assert not [p for p in here.glob('run-*') if p.is_dir()], 'Real capture must not exist for preparation smoke'
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 42, 180, 0, 0))
env = dict(os.environ, TERM='xterm-256color', PI_PROGRAM_STATUS='0')
child = subprocess.Popen(['bash', str(here/'run-voice-trial.sh')], stdin=slave, stdout=slave, stderr=slave, env=env)
os.close(slave)
output = bytearray()

def read_some(wait=0.05):
    if select.select([master], [], [], wait)[0]:
        try:
            b = os.read(master, 65536)
        except OSError as exc:
            if exc.errno == errno.EIO:
                return False
            raise
        output.extend(b)
        return bool(b)
    return True


def wait_for(needle, timeout=25):
    until = time.monotonic() + timeout
    while time.monotonic() < until:
        if needle in output:
            return
        if not read_some() or child.poll() is not None:
            break
    raise AssertionError(f'Missing PTY marker {needle!r}; child={child.poll()}')


try:
    wait_for(b'\x1b[c')
    os.write(master, b'\x1b[?1;2c')  # No claim of physical Kitty release support.
    wait_for(b'E5 ONE-SHOT LOCAL VOICE')
    wait_for(b'microphone is NOT open')
    print('PASS: real isolated offline Pi loaded the explicit E5 diagnostic and idle widget')
    os.write(master, b'keyboard-only smoke text\r')
    wait_for(b'E5 diagnostic blocks prompts')
    print('PASS: ordinary input was handled without cloud prompt submission')
    os.write(master, b'/voice-test view\r')
    wait_for(b'No successfully completed transcript')
    print('PASS: actual Pi command handler refuses viewing before any capture')
    assert not (here/'authorization-used.json').exists()
    assert not [p for p in here.glob('run-*') if p.is_dir()]
    print('PASS: no real worker run or microphone-budget reservation created')
    os.write(master, b'/quit\r')
    until = time.monotonic() + 8
    while child.poll() is None and time.monotonic() < until:
        read_some()
    assert child.poll() == 0, f'Disposable Pi did not exit cleanly: {child.poll()}'
    print('PASS: /quit exited the owned diagnostic Pi cleanly')
    print('Limit: no Ctrl+Q, microphone, live source query, inference or physical Herdr input test')
finally:
    if child.poll() is None:
        child.terminate()
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            child.kill(); child.wait(timeout=5)
    os.close(master)
    log = here/'startup-smoke.ansi.log'
    fd = os.open(log, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, 'wb') as f:
        f.write(output)
