# E1 — Synthetic WAV format checks

## Objective, scope, and constraints

Exploration-only validation of the proposed finalized mono/16-kHz/signed-16-bit
little-endian RIFF/WAVE capture boundary. This is the format portion of E1,
not a production validator or the separate fake-recorder lifecycle experiment.
All generated samples are a deterministic integer ramp or digital silence.
No real speech, existing recordings, microphone, playback, audio device/service,
network, inference, software installation, or settings change is involved.
All files and results stay in this `formats/` directory.

## Files and reproduction

- `format-checks.py`: stdlib Python generator, chunk-aware validator, assertions,
  and local `ffprobe` metadata comparison.
- `run-y6vya749/`: executed run; 47 preserved synthetic `.wav` fixtures,
  `evidence.json` (expectations, verdicts, hashes, every assertion, full ffprobe
  commands/stdout/stderr/metadata), and `run.log` (human-readable results).

Exact executed command, from the repository root:

```sh
python3 explorations/2026-10-25_15-32-pi-voice-extension/assets/phase-2-audio-capture/e1/formats/format-checks.py
```

Use the same command to rerun; Python 3 and the already-installed `ffprobe` are
required. Each invocation exclusively allocates a different `run-<random>/`
directory (0700); every fixture and evidence file is exclusively created (0600).
No existing run is overwritten. The source and this README are also 0600.
The suite does not change its parent's umask. No cleanup of synthetic evidence
is automatic; successful and failed run artifacts remain available for review.

## Verified results

The recorded execution completed in 1.570 seconds with exit code 0:

| Measure | Result |
| --- | ---: |
| Fixtures / ffprobe calls | 47 / 47 |
| Assertions passed / failed | 216 / 0 |
| Strictly invalid | 34 |
| Structurally valid, zero frames (`no-audio`) | 1 |
| Structurally valid, 1–3199 frames (`too-short`) | 3 |
| Structurally valid, at least 3200 frames (`accepted`) | 9 |
| ffprobe exit 0 / exit 1 | 34 / 13 |
| Strictly invalid but ffprobe exit 0 and a stream reported | 21 |
| ffprobe timeouts | 0 |

Assertions cover verdicts, exact rejection reasons for invalid fixtures, valid
frame counts, private fixture/run permissions, bounded probe completion, and
selected PCM metadata on the 13 structurally valid fixtures. Malformed-fixture
ffprobe outcomes are observations, not hard-coded expectations. Probe metadata
checks use codec/type/rate/channels/bit-depth, not estimated duration or bitrate.

The validator walks RIFF chunks and checks exact RIFF size, chunk headers,
payload bounds and required odd padding, unique fmt/data chunks, supported fmt
layout, PCM tag/bit depth/channels/rate, block alignment, byte rate, and whole
frames. Unknown chunks are permitted; pad contents need not be zero. A valid
odd-sized JUNK chunk before fmt moves data to byte **56**, explicitly asserted:
there is no fixed-44-byte-header acceptance assumption. JUNK after data, several
unknown chunks, and 18-byte PCM fmt with zero extension size also pass.

Duration policy is distinct from container validity: zero frames is `no-audio`,
3199 frames is `too-short`, exactly 3200 (200 ms) is accepted. Silent 250-ms PCM
is accepted structurally, without VAD or a claim of useful speech.

### ffprobe divergence

The complete list is in `evidence.json` and `run.log`. Notable cases where
ffprobe returned success and stream metadata despite strict rejection include:

- Physical truncation, both with stale RIFF size and with repaired RIFF size
  but data size extending beyond EOF.
- Stale RIFF/data lengths, a maximal unsigned data length, and undeclared
  trailing bytes.
- Odd/misaligned PCM data, missing final odd-chunk padding, duplicate fmt/data,
  inconsistent block alignment/byte rate, and a zero block alignment.
- Validly recognizable but out-of-contract channel/rate/bit-depth/encoding
  choices; these are contract rejections, **not proof of malformed WAV**.

ffprobe also returned success for the zero-frame and three too-short fixtures.
Thus ffprobe exit 0/metadata is neither strict finalization nor nonempty/usable
clip acceptance. Some corrupt fixtures produce diagnostics even with exit 0;
the JSON preserves stderr instead of treating success as absence of warnings.

## Alternatives, limitations, and next steps

A fixed header/size check is simpler but rejects legitimate metadata chunks or
misses malformed length/padding. Delegating acceptance entirely to ffprobe is
convenient but demonstrably permissive here. The experimental strict parser
makes the proposed boundary explicit; this does not establish it is complete,
secure against hostile inputs, or suitable for direct production integration.

The accepted subset deliberately excludes RF64, RIFX, extensible fmt, multiple
data chunks and other decodable WAV variants. The `invalid` verdict includes
both corruption and unsupported/out-of-contract representations. These finite
fixtures are not exhaustive fuzzing. The in-memory validator bounds input at
1 MB; generated fixtures are at most about 32 KB. Reruns on other ffprobe builds
may differ on malformed files, and those differences do not fail assertions.
The tiny synthetic amplitudes/content are arbitrary, not audio quality tests.

No full audio decoding, whisper.cpp/inference, actual PipeWire behavior, WAV
finalization by a real recorder, lifecycle/timing, acoustic startup/tail,
Herdr/Pi integration, or production readiness was verified here. The 200-ms
guard remains a UX proposal, not a demonstrated transcription threshold.

Conclusion: chunk-aware validation can independently reject incomplete and
out-of-contract files while accepting padded extra chunks. Preserve these as
E1 evidence; any recorder/device trial or production integration needs its own
explicit authorization. No issues or failed assertions remain in this run.
