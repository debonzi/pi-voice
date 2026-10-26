#!/usr/bin/env python3
"""E1 synthetic-only format experiment; Python stdlib + existing ffprobe.

Run: python3 /absolute/path/to/format-checks.py
Each run exclusively allocates run-<random>/ beside this script (0700), then
creates fixtures and evidence with O_EXCL (0600). No audio API, recording,
playback, inference, network, external input file, or project integration.

Strict acceptance is deliberately narrower than a decoder: finalized RIFF/WAVE,
exact RIFF length, complete padded chunks, one fmt and one data chunk, canonical
PCM16 mono16k with internally consistent rates/alignment, and complete frames.
PCM fmt sizes 16 and 18 (zero extension size) are supported; extensible/RF64,
multiple data chunks, concatenated files, and other encodings are not.
Nonzero pad values and unknown chunks are allowed. No fixed 44-byte assumption.
Zero frames and <3200 frames are separate no-audio/too-short verdicts, not
structural corruption. 200ms is only the proposed UX guard, not ASR evidence.
ffprobe success/metadata is demuxer evidence, not full decoding or finalization.
Malformed ffprobe outcomes are recorded, never asserted as stable behavior.
"""
from __future__ import annotations

import collections
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import struct
import subprocess
import sys
import tempfile
import time

RATE = 16000
SHORT_FRAMES = 3200
MAX_BYTES = 1_000_000


def chunk(kind, payload, pad=b"\0"):
    return kind + struct.pack("<I", len(payload)) + payload + (pad if len(payload) % 2 else b"")


def riff(*chunks):
    body = b"WAVE" + b"".join(chunks)
    return b"RIFF" + struct.pack("<I", len(body)) + body


def fmt(tag=1, channels=1, rate=RATE, byte_rate=32000, align=2, bits=16, extra=b""):
    return chunk(b"fmt ", struct.pack("<HHIIHH", tag, channels, rate, byte_rate, align, bits) + extra)


def pcm(frames):
    # A bounded synthetic deterministic integer ramp, never microphone/speech.
    return b"".join(struct.pack("<h", ((i * 101) % 4001) - 2000) for i in range(frames))


def wav(frames, format_chunk=None, before=(), after=()):
    return riff(*(before + (fmt() if format_chunk is None else format_chunk, chunk(b"data", pcm(frames))) + after))


def validate(raw):
    """Chunk-aware byte validator: no decoder and no external file references."""
    def bad(reason):
        return {"verdict": "invalid", "reason": reason}
    if len(raw) > MAX_BYTES:
        return bad("size-limit")
    if len(raw) < 12:
        return bad("truncated-riff-header")
    if raw[:4] != b"RIFF" or raw[8:12] != b"WAVE":
        return bad("not-riff-wave")
    declared = struct.unpack_from("<I", raw, 4)[0]
    if declared != len(raw) - 8:
        return bad("riff-length-mismatch")
    pos, chunks, fmts, datas = 12, [], [], []
    while pos < len(raw):
        if len(raw) - pos < 8:
            return bad("truncated-chunk-header")
        kind, size = raw[pos:pos + 4], struct.unpack_from("<I", raw, pos + 4)[0]
        start, end = pos + 8, pos + 8 + size
        if end > len(raw):
            return bad("chunk-overrun")
        padded_end = end + size % 2
        if padded_end > len(raw):
            return bad("missing-chunk-padding")
        chunks.append({"id_hex": kind.hex(), "offset": pos, "size": size})
        if kind == b"fmt ":
            fmts.append(raw[start:end])
        elif kind == b"data":
            datas.append((start, size))
        pos = padded_end
    if len(fmts) != 1 or len(datas) != 1:
        return bad("require-exactly-one-fmt-and-data")
    f = fmts[0]
    if len(f) not in (16, 18) or (len(f) == 18 and f[16:] != b"\0\0"):
        return bad("unsupported-fmt-layout")
    tag, channels, rate, byte_rate, align, bits = struct.unpack_from("<HHIIHH", f)
    if (tag, channels, rate, bits) != (1, 1, RATE, 16):
        return bad("unexpected-pcm-format")
    if align != channels * bits // 8 or byte_rate != rate * align:
        return bad("inconsistent-pcm-rates")
    data_offset, data_size = datas[0]
    if data_size % align:
        return bad("partial-pcm-frame")
    frames = data_size // align
    verdict = "no-audio" if frames == 0 else "too-short" if frames < SHORT_FRAMES else "accepted"
    return {"verdict": verdict, "frames": frames, "duration_seconds": frames / rate,
            "data_offset": data_offset, "chunks": chunks,
            "reason": "zero-frames" if frames == 0 else "under-200ms" if frames < SHORT_FRAMES else "valid-and-long-enough"}


def fixtures():
    ordinary = wav(4000)
    examples = []
    def add(name, raw, verdict, frames=None, reason=None, probe_pcm=False):
        examples.append((name, raw, {"verdict": verdict, "frames": frames, "reason": reason, "probe_pcm": probe_pcm}))
    add("empty-file", b"", "invalid", reason="truncated-riff-header")
    add("header-only-zero-frames", wav(0), "no-audio", 0, probe_pcm=True)
    for name, frames, verdict in (("tiny-one-frame", 1, "too-short"), ("tiny-10ms", 160, "too-short"),
                                  ("boundary-just-under-200ms", 3199, "too-short"),
                                  ("boundary-exactly-200ms", 3200, "accepted"),
                                  ("ordinary-250ms", 4000, "accepted"), ("ordinary-1s", 16000, "accepted")):
        add(name, wav(frames), verdict, frames, probe_pcm=True)
    add("silent-250ms", riff(fmt(), chunk(b"data", b"\0" * 8000)), "accepted", 4000, probe_pcm=True)
    add("odd-junk-before-fmt", wav(4000, before=(chunk(b"JUNK", b"abc"),)), "accepted", 4000, probe_pcm=True)
    add("odd-junk-nonzero-pad", wav(4000, before=(chunk(b"JUNK", b"abc", b"\xff"),)), "accepted", 4000, probe_pcm=True)
    add("odd-junk-after-data", wav(4000, after=(chunk(b"JUNK", b"z"),)), "accepted", 4000, probe_pcm=True)
    add("multiple-unknown-chunks", wav(4000, before=(chunk(b"JUNK", b""), chunk(b"abcd", b"12345")), after=(chunk(b"tail", b"xyz"),)), "accepted", 4000, probe_pcm=True)
    add("pcm-fmt18-zero-extension", wav(4000, fmt(extra=b"\0\0")), "accepted", 4000, probe_pcm=True)
    # RIFF-consistent malformed chunks isolate bounds checks from top-level size.
    add("truncated-data-raw", ordinary[:-17], "invalid", reason="riff-length-mismatch")
    add("truncated-data-repaired-riff", riff(fmt(), ordinary[36:-17]), "invalid", reason="chunk-overrun")
    add("truncated-chunk-header", riff(fmt(), b"data\x00\x00"), "invalid", reason="truncated-chunk-header")
    add("truncated-riff-header", ordinary[:9], "invalid", reason="truncated-riff-header")
    add("stale-riff-zero-length", ordinary[:4] + b"\0" * 4 + ordinary[8:], "invalid", reason="riff-length-mismatch")
    add("stale-riff-too-large", ordinary[:4] + struct.pack("<I", len(ordinary) + 100) + ordinary[8:], "invalid", reason="riff-length-mismatch")
    add("stale-data-too-large", riff(fmt(), b"data" + struct.pack("<I", 9000) + pcm(4000)), "invalid", reason="chunk-overrun")
    add("stale-data-zero-length", riff(fmt(), b"data\0\0\0\0" + pcm(4000)), "invalid", reason="chunk-overrun")
    add("odd-data-misaligned-padded", riff(fmt(), chunk(b"data", b"\0" * 33)), "invalid", reason="partial-pcm-frame")
    add("missing-final-odd-padding", riff(fmt(), chunk(b"data", pcm(4000)), b"JUNK\x03\0\0\0abc"), "invalid", reason="missing-chunk-padding")
    add("missing-internal-odd-padding", riff(b"JUNK\x03\0\0\0abc", fmt(), chunk(b"data", pcm(4000))), "invalid", reason="chunk-overrun")
    for name, f in (("wrong-encoding-float", fmt(tag=3)), ("wrong-channels-stereo", fmt(channels=2, align=4, byte_rate=64000)),
                    ("wrong-rate-48000", fmt(rate=48000, byte_rate=96000)), ("wrong-bits-8", fmt(bits=8, align=1, byte_rate=16000)),
                    ("wrong-block-align", fmt(align=4)), ("wrong-byte-rate", fmt(byte_rate=1)),
                    ("zero-rate", fmt(rate=0, byte_rate=0)), ("zero-channels", fmt(channels=0)),
                    ("zero-align", fmt(align=0)), ("fmt-extension-nonzero", fmt(extra=b"\x02\0"))):
        reason = "inconsistent-pcm-rates" if name in ("wrong-block-align", "wrong-byte-rate", "zero-align") else "unsupported-fmt-layout" if name == "fmt-extension-nonzero" else "unexpected-pcm-format"
        add(name, wav(4000, f), "invalid", reason=reason)
    add("missing-fmt", riff(chunk(b"data", pcm(4000))), "invalid", reason="require-exactly-one-fmt-and-data")
    add("missing-data", riff(fmt()), "invalid", reason="require-exactly-one-fmt-and-data")
    add("duplicate-fmt", riff(fmt(), fmt(), chunk(b"data", pcm(4000))), "invalid", reason="require-exactly-one-fmt-and-data")
    add("duplicate-data", riff(fmt(), chunk(b"data", pcm(2000)), chunk(b"data", pcm(2000))), "invalid", reason="require-exactly-one-fmt-and-data")
    add("short-fmt", riff(chunk(b"fmt ", b"\0" * 8), chunk(b"data", pcm(4000))), "invalid", reason="unsupported-fmt-layout")
    add("not-wave", ordinary[:8] + b"NOPE" + ordinary[12:], "invalid", reason="not-riff-wave")
    add("big-endian-rifx", b"RIFX" + ordinary[4:], "invalid", reason="not-riff-wave")
    add("arbitrary-garbage", bytes(range(64)), "invalid", reason="not-riff-wave")
    add("max-chunk-length", riff(fmt(), b"data\xff\xff\xff\xff"), "invalid", reason="chunk-overrun")
    add("trailing-undeclared-bytes", ordinary + b"trailer", "invalid", reason="riff-length-mismatch")
    add("riff-consistent-trailing-fragment", riff(fmt(), chunk(b"data", pcm(4000)), b"abc"), "invalid", reason="truncated-chunk-header")
    add("empty-riff-wave", riff(), "invalid", reason="require-exactly-one-fmt-and-data")
    return examples


def exclusive_write(path, raw):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as handle:
        handle.write(raw)


def main():
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        raise SystemExit("Existing ffprobe required; no software is installed by this suite")
    root = Path(__file__).resolve().parent
    run = Path(tempfile.mkdtemp(prefix="run-", dir=root))
    results, checks = [], []
    started = time.time()
    def check(label, condition):
        checks.append({"label": label, "passed": bool(condition)})
    check("run-directory-mode-0700", stat.S_IMODE(run.stat().st_mode) == 0o700)
    for name, raw, expected in fixtures():
        path = run / (name + ".wav")
        exclusive_write(path, raw)
        check(name + ":mode-0600", stat.S_IMODE(path.stat().st_mode) == 0o600)
        observed = validate(path.read_bytes())
        check(name + ":verdict", observed["verdict"] == expected["verdict"])
        if expected["frames"] is not None:
            check(name + ":frames", observed.get("frames") == expected["frames"])
        if expected["reason"]:
            check(name + ":reason", observed["reason"] == expected["reason"])
        if name == "odd-junk-before-fmt":
            check(name + ":not-fixed-44-header", observed.get("data_offset") == 56)
        command = [ffprobe, "-v", "error", "-protocol_whitelist", "file", "-show_entries",
                   "stream=codec_type,codec_name,sample_fmt,sample_rate,channels,bits_per_sample,duration:format=format_name,duration,size",
                   "-of", "json", "-i", str(path)]
        try:
            proc = subprocess.run(command, stdin=subprocess.DEVNULL, capture_output=True, timeout=5, check=False)
            stdout, stderr = proc.stdout.decode("utf-8", "replace"), proc.stderr.decode("utf-8", "replace")
            try:
                metadata = json.loads(stdout)
            except json.JSONDecodeError:
                metadata = None
            probe = {"command": command, "returncode": proc.returncode, "stdout": stdout,
                     "stderr": stderr, "metadata": metadata, "timeout": False}
        except subprocess.TimeoutExpired as error:
            probe = {"command": command, "returncode": None, "timeout": True,
                     "stdout": (error.stdout or b"").decode("utf-8", "replace"),
                     "stderr": (error.stderr or b"").decode("utf-8", "replace"), "metadata": None}
        check(name + ":probe-bounded-completion", not probe["timeout"])
        if expected["probe_pcm"]:
            check(name + ":probe-exit", probe["returncode"] == 0)
            streams = (probe["metadata"] or {}).get("streams", [])
            selected = [{k: stream.get(k) for k in ("codec_type", "codec_name", "sample_rate", "channels", "bits_per_sample")} for stream in streams]
            check(name + ":probe-pcm-metadata", selected == [{"codec_type": "audio", "codec_name": "pcm_s16le", "sample_rate": "16000", "channels": 1, "bits_per_sample": 16}])
        results.append({"name": name, "path": str(path), "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(),
                        "expected": expected, "validator": observed, "ffprobe": probe})
    counts = dict(collections.Counter(item["validator"]["verdict"] for item in results))
    divergent = [item["name"] for item in results if item["validator"]["verdict"] == "invalid" and item["ffprobe"]["returncode"] == 0]
    divergences_with_stream = [item["name"] for item in results if item["name"] in divergent and (item["ffprobe"]["metadata"] or {}).get("streams")]
    failures = [entry["label"] for entry in checks if not entry["passed"]]
    summary = {"fixtures": len(results), "assertions": len(checks), "assertions_passed": len(checks) - len(failures),
               "assertions_failed": len(failures), "failures": failures, "validator_verdict_counts": counts,
               "ffprobe_exit_counts": dict(collections.Counter(str(item["ffprobe"]["returncode"]) for item in results)),
               "invalid_but_ffprobe_exit_zero": divergent,
               "invalid_but_ffprobe_exit_zero_with_stream": divergences_with_stream,
               "elapsed_seconds": round(time.time() - started, 3)}
    report = {"experiment": "E1 synthetic-only chunk-aware WAV format validation", "run_directory": str(run),
              "python": sys.version, "ffprobe_path": ffprobe, "short_guard_frames": SHORT_FRAMES,
              "summary": summary, "assertions": checks, "fixtures": results}
    exclusive_write(run / "evidence.json", (json.dumps(report, indent=2) + "\n").encode())
    log = ["E1 synthetic WAV format checks", "run: " + str(run), json.dumps(summary, indent=2), "", "Per-fixture validator / ffprobe exit / audio stream count:"]
    for item in results:
        probe = item["ffprobe"]
        log.append(f"{item['name']}: {item['validator']['verdict']} ({item['validator']['reason']}); ffprobe={probe['returncode']}; streams={len((probe['metadata'] or {}).get('streams', []))}")
    exclusive_write(run / "run.log", ("\n".join(log) + "\n").encode())
    print(json.dumps({"run_directory": str(run), **summary}, indent=2))
    return bool(failures)


if __name__ == "__main__":
    sys.exit(main())
