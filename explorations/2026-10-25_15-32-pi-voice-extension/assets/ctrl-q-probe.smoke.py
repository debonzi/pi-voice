"""Synthetic local PTY startup check; not a physical terminal/keyboard test."""
import errno
import os
from pathlib import Path
import pty
import select
import subprocess
import time

assets = Path(__file__).resolve().parent
master, slave = pty.openpty()
# Give the child enough terminal space to display its diagnostic widget.
import fcntl
import struct
import termios
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 36, 160, 0, 0))
env = dict(os.environ, TERM="xterm-256color", PI_PROGRAM_STATUS="0")
child = subprocess.Popen(["bash", str(assets / "run-ctrl-q-probe.sh")],
                         stdin=slave, stdout=slave, stderr=slave, env=env)
os.close(slave)
output = bytearray()

def wait_for(needle, timeout=15):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if needle in output:
            return
        ready, _, _ = select.select([master], [], [], 0.1)
        if ready:
            try:
                data = os.read(master, 65536)
            except OSError as error:
                if error.errno == errno.EIO:
                    break
                raise
            if not data:
                break
            output.extend(data)
        if child.poll() is not None:
            break
    raise AssertionError(f"PTY did not display {needle!r}; child status={child.poll()}")

try:
    # Reply to Pi's DA sentinel without claiming Kitty support.
    wait_for(b"\x1b[c")
    os.write(master, b"\x1b[?1;2c")
    wait_for(b"Ctrl+Q probe:")
    print("PASS: isolated Pi startup loaded the real diagnostic and displayed its widget")
    os.write(master, b"\x11")
    wait_for(b"PRESS Ctrl+Q")
    print("PASS: synthetic legacy Ctrl+Q reached the real raw-input listener")
    os.write(master, b"\x1b[113;5:3u")
    wait_for(b"RELEASE Ctrl+Q")
    print("PASS: synthetic Kitty Q release reached the real raw-input listener")
    os.write(master, b"/quit\r")
    deadline = time.monotonic() + 8
    while child.poll() is None and time.monotonic() < deadline:
        ready, _, _ = select.select([master], [], [], 0.1)
        if ready:
            try:
                output.extend(os.read(master, 65536))
            except OSError as error:
                if error.errno != errno.EIO:
                    raise
    assert child.poll() == 0, f"Pi did not exit cleanly: {child.poll()}"
    print("PASS: /quit exited the isolated Pi process cleanly")
    print("Limit: synthetic PTY injection; actual WezTerm event delivery remains untested.")
finally:
    if child.poll() is None:
        child.terminate()
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait(timeout=5)
    os.close(master)
    runtime = assets / "ctrl-q-runtime"
    runtime.mkdir(exist_ok=True)
    (runtime / "synthetic-startup.ansi.log").write_bytes(output)
