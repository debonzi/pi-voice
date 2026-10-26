"""Bounded keyboard/protocol experiment; no microphone, network, or model access.

Temporarily requests the same Kitty flags (7) as Pi, then restores the stack
and local terminal mode. Records only protocol replies and Q-related events.
"""
import datetime
import json
import os
from pathlib import Path
import re
import select
import signal
import sys
import termios
import time
import tty


class Observation:
    def __init__(self):
        self.buffer = b""
        self.paste = False
        self.flags = []
        self.da_replies = 0
        self.events = {}
        self.interrupted = False

    def feed(self, data):
        self.buffer += data
        while self.buffer:
            if self.buffer.startswith(b"\x1b["):
                match = re.match(rb"\x1b\[[0-?]*[ -/]*[@-~]", self.buffer)
                if not match:
                    if len(self.buffer) > 4096:
                        self.buffer = b""
                    return
                token = match[0]
            elif self.buffer == b"\x1b":
                return
            else:
                token = self.buffer[:1]
            self.buffer = self.buffer[len(token):]
            self.accept(token)

    def accept(self, token):
        if token == b"\x1b[200~":
            self.paste = True
            return
        if token == b"\x1b[201~":
            self.paste = False
            return
        if self.paste:
            return
        if token == b"\x03":
            self.interrupted = True
            return
        reply = re.fullmatch(rb"\x1b\[\?(\d+)u", token)
        if reply:
            self.flags.append(int(reply[1]))
            return
        if re.fullmatch(rb"\x1b\[\?[\d;]*c", token):
            self.da_replies += 1
            return
        kitty = re.fullmatch(rb"\x1b\[(?:113|81)(?::\d*){0,2}(?:;(\d+))?(?::([123]))?u", token)
        other = re.fullmatch(rb"\x1b\[27;(\d+);(?:113|81)~", token)
        if kitty:
            encoding = "kitty"
            kind = {b"1": "press", b"2": "repeat", b"3": "release"}.get(kitty[2], "press")
            modifiers = int(kitty[1] or b"1") - 1
        elif other:
            encoding, kind, modifiers = "modifyOtherKeys", "press", int(other[1]) - 1
        elif token == b"\x11":
            encoding, kind, modifiers = "legacy-control-byte", "press", 4
        elif token in (b"q", b"Q"):
            encoding, kind, modifiers = "plain-text-q", "press", int(token == b"Q")
        else:
            return  # Never persist arbitrary keys, pasted text, or unknown responses.
        key = token.hex()
        if key not in self.events:
            self.events[key] = {"hex": key, "encoding": encoding, "event": kind,
                                "modifiers": modifiers, "count": 0}
        self.events[key]["count"] += 1

    def result(self):
        return {"reported_flags": self.flags, "device_attributes_replies": self.da_replies,
                "event_type_bit_acknowledged": any(flags & 2 for flags in self.flags),
                "q_events": list(self.events.values()),
                "interrupted": self.interrupted}


def self_test():
    obs = Observation()
    obs.feed(b"\x1b[?7u\x1b[?1;2c")
    assert obs.flags == [7] and obs.da_replies == 1
    obs.feed(b"\x11" * 59)
    assert obs.events["11"]["count"] == 59
    obs.feed(b"\x1b[113;5:")
    obs.feed(b"3u\x1b[113;5:2u")
    assert obs.events[b"\x1b[113;5:3u".hex()]["event"] == "release"
    assert obs.events[b"\x1b[113;5:2u".hex()]["event"] == "repeat"
    obs.feed(b"\x1b[113;1:3u\x1b[27;5;113~")
    assert obs.events[b"\x1b[113;1:3u".hex()]["modifiers"] == 0
    assert obs.events[b"\x1b[27;5;113~".hex()]["encoding"] == "modifyOtherKeys"
    before = json.dumps(obs.result(), sort_keys=True)
    obs.feed(b"private text\x1b[200~private text\x11\x1b[113;5:3u\x1b[201~")
    assert json.dumps(obs.result(), sort_keys=True) == before
    obs.feed(b"\x03")
    assert obs.interrupted
    partial = Observation()
    partial.feed(b"\x1b[?1u")
    assert not partial.result()["event_type_bit_acknowledged"]
    print("PASS: flags/DA, legacy counts, split Kitty events, changed modifiers, modifyOtherKeys, privacy/paste, abort, partial flags")


def main():
    if sys.argv[1:] == ["--self-test"]:
        self_test()
        return
    if sys.argv[1:]:
        raise SystemExit("Usage: python3 ctrl-q-protocol.py [--self-test]")
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        raise SystemExit("Run in a normal terminal, not Pi !/!! or redirected stdin/stdout.")
    print("Keyboard-only terminal probe. No microphone or network access.")
    print("For 10 seconds, hold Ctrl+Q ~3 seconds; release Q first, then Ctrl.")
    print("No unrelated typing/pasting. Ctrl+C aborts. Only Q events/replies are saved.")
    input("Press Enter when ready: ")
    fd = sys.stdin.fileno()
    saved = termios.tcgetattr(fd)
    obs = Observation()
    pushed = False
    old_term = signal.getsignal(signal.SIGTERM)

    def abort(_number, _frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, abort)
    try:
        tty.setraw(fd, termios.TCSANOW)
        # Same push/query/DA sentinel as Pi. No persistent terminal setting edit.
        pushed = True
        os.write(sys.stdout.fileno(), b"\x1b[>7u\x1b[?u\x1b[c")
        os.write(sys.stdout.fileno(), b"\r\nREADY: hold Ctrl+Q, release Q first. Waiting 10 seconds...\r\n")
        deadline = time.monotonic() + 10
        while not obs.interrupted and time.monotonic() < deadline:
            ready, _, _ = select.select([fd], [], [], min(0.1, max(0, deadline - time.monotonic())))
            if ready:
                data = os.read(fd, 4096)
                if not data:
                    break
                obs.feed(data)
    except KeyboardInterrupt:
        obs.interrupted = True
    finally:
        try:
            if pushed:
                os.write(sys.stdout.fileno(), b"\x1b[<u")
        finally:
            termios.tcsetattr(fd, termios.TCSADRAIN, saved)
            signal.signal(signal.SIGTERM, old_term)
    report = {"scope": "Standalone main-screen terminal path, not the existing Pi process",
              "requested_flags": 7,
              "terminal_program_env": os.environ.get("TERM_PROGRAM"),
              "terminal_version_env": os.environ.get("TERM_PROGRAM_VERSION"),
              **obs.result()}
    stamp = datetime.datetime.now().strftime("%Y-%m-%d_%H-%M-%S-%f")
    target = Path(__file__).resolve().with_name(f"ctrl-q-protocol-{stamp}.json")
    target.write_text(json.dumps(report, indent=2) + "\n", encoding="utf8")
    print("\n" + json.dumps(report, indent=2))
    print(f"Saved: {target}")
    print("Limits: acknowledged flags are not a guarantee of full implementation; compare actual Q release bytes.")


if __name__ == "__main__":
    main()
