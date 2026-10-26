# E2 — Bounded interactive capture trial

## Scope and authorization

Exploration-only CLI supporting phase 2, not a Pi extension or product recorder.
The requester approved E2, then confirmed the built-in SoundWire input and deletion
of every WAV after structural validation. Maximum scope: three explicitly started
recordings, at most five seconds each; trials 1/3 finish, trial 2 cancels/discards.
No playback, transcription, installation, settings edits, uploads or private Herdr
service access. Full large-v3/Vulkan selection is unchanged and is not executed.

**Current status:** requester-run `run-nna5cbqo` completed all three authorized
attempts; basic recording lifecycle passed. All WAVs were deleted and cleanup
was reviewed. The authorization budget is **consumed (3/3)**. No further real
capture or retry is approved. An approximately 130-ms duration discrepancy in
trial 1 leaves acoustic readiness/boundaries unresolved; phase 2 remains open.

## Original run procedure — completed; do not repeat

From the repository root in a separate Herdr pane:

```sh
python3 -B explorations/2026-10-25_15-32-pi-voice-extension/assets/phase-2-audio-capture/e2/capture-trial.py
```

- Read the opening instructions; ENTER reserves the single run, `q` quits.
- For each trial, ENTER explicitly starts it. ENTER again explicitly stops
  (trials 1/3) or cancels (trial 2). Speak briefly or stay silent; **aim for 1–2
  seconds**. Do not paste several ENTERs or wait for silence-based completion.
- `RECORDING` means the stream-active verbose message was observed, not audible
  speech or first PCM arrival. Stop remains available while STARTING.
- At four seconds the worker initiates a safety **abort/discard**, reserving
  margin for SIGTERM/SIGKILL before five seconds. This is not normal automatic
  completion. A safety abort, changed route, permission problem or unexpected
  result ends the run without automatic retry.
- Send the printed result directory path back for review. Do not manually rerun
  or delete `authorization-used.json`; if a run is interrupted, report its path.
  Reuse/retry requires review and renewed approval rather than a fresh budget.

`authorization-used.json` reserves a single three-attempt run. Each real worker
also needs a private parent-issued pipe grant and exclusively reserves its trial
launch. This prevents accidental extra launches; it is not a security boundary
against a user deliberately modifying the script/files.

The target is fixed to:
`alsa_input.pci-0000_00_1f.3-platform-sof_sdw.HiFi__Mic__source`.

The preflight checks local PipeWire runtime/target environment, Herdr-context
presence, the selected default source and mute state without changing anything.
It refuses a changed default rather than selecting another input. It does not
inspect private Herdr runtime/socket values or configure terminal bindings.

## Lifecycle and retained evidence

A separate disposable worker owns `/usr/bin/stdbuf -oL /usr/bin/pw-record` with
mono/16-kHz/s16 requested, fixed target, private file and consumed diagnostic
pipes. The worker has independent monotonic deadlines and treats owner-pipe EOF
as discard. Stop sends SIGINT; delayed termination escalates and discards. Only
its owned recorder PID is signaled, never Pi, Herdr or the audio server.

The worker reaps the recorder, calls the E1 chunk-aware validator on the completed
file, and uses ffprobe metadata for a candidate normal result. Exit codes 0/1 are
only experimental candidates conditioned on stop intent, readiness, no observed
fatal diagnostics/escalation and accepted WAV; no universal exit-code rule is
established before a real test. No audio samples enter logs or terminal output.

Each `run-*/trial-*/result.json` retains command, PID, signal/exit tuple, bounded
verbose diagnostics, elapsed timestamps, WAV structural verdict/frame count,
optional ffprobe metadata, and deletion/reaping status. **All WAVs are deleted**,
including normal completion and cancellation, after recorder death is confirmed.
Run directories are 0700; created audio/metadata files are 0600 using this disposable
worker's umask, not the main Pi process's. Deletion is not secure physical erasure.

A cleanup failure blocks subsequent attempts and is reported; do not start another
run to work around it. OS scheduling and uninterruptible processes prevent a
hard real-time guarantee: five seconds is a measured upper-bound acceptance
condition, not a kernel-enforced promise. The control-pipe helper does not protect
against its own SIGKILL/crash, malicious configuration or every device-loss/routing
race. This remains a bounded experiment, not production crash-safety acceptance.

## Preparation validation — no real input

Executed:

```sh
python3 -B explorations/2026-10-25_15-32-pi-voice-extension/assets/phase-2-audio-capture/e2/capture-trial.py --self-test
```

**4/4 synthetic-only cases passed**: explicit stop, cancel/discard, owner-pipe EOF,
and safety timeout/discard. Every fake recorder was reaped; every synthetic WAV
was deleted. The stop case jointly exercised this worker, the E1 validator and
ffprobe on synthetic silence. These are not real-recorder timing measurements.

Evidence: `self-test.log`, `selftest-ob3yeh7m/summary.json`, and per-case
`result.json`. The initial `unconnected -> connecting` fake diagnostic is not
misclassified as failure. The safety fake uses a shortened 0.6-second test limit.

Static review corrected control-pipe lifetime in self-tests, guarded real-worker
entry and runtime overrides, and suppressed late readiness announcements after
stop. Three additional refusal checks passed (noninteractive invocation,
standalone worker, missing private grant), recorded in `guard-checks.json`.
Python syntax and private artifact modes were checked; real authorization marker
remains absent and the three-capture budget is unused at preparation closeout.

No self-test calls wpctl, pw-record, audio services/devices, playback or inference.
The existing ffprobe reads only newly generated synthetic files in that mode.
The real authorization marker was subsequently created by the requester-run trial
below; it must now remain in place.

## Executed real run — `run-nna5cbqo`

The requester supplied this local result path after the instructed Herdr trial.
`context.json` records the confirmed source and Herdr-context presence. The
assistant reviewed JSON/diagnostics and file/process existence only, not audio.

| Trial | Intent / outcome | Child lifetime | PCM duration | Exit |
| --- | --- | --- | --- | --- |
| 1 | Stop; completed then deleted | 1.811732 s | 1.6621875 s | 1 |
| 2 | Cancel; discarded then deleted | 2.268235 s | 2.2595000 s | 1 |
| 3 | Stop; completed then deleted | 1.849689 s | 1.8328750 s | 1 |

All used SIGINT only, without fatal diagnostics, escalation or safety abort.
`owned_executable` was `/usr/bin/pw-cat`, supporting stdbuf exec-style ownership.
The chunk validator accepted the three WAV structures; ffprobe independently
confirmed mono/16-kHz/PCM-s16le on the two completed clips. Cancel did not run
ffprobe or any consumer. No playback/transcription occurred.

The worker reported all recorder children reaped and audio deleted. Review found
no retained WAV and no `/proc` entry for any of the three recorded PIDs. Retained
metadata is 0600, directories 0700; recorded WAV modes were 0600. Ledger and
per-trial launch reservations confirm that the three-attempt scope is exhausted.

Stream-active text was observed at 16.290 / 14.891 / 13.501 ms after spawn-start;
stop-request to wait/pipe-close was 3.162 / 2.665 / 2.473 ms. These are harness
observations, not acoustic startup/stop latency or first-sample evidence.

**Open discrepancy:** trial 1 PCM was 130.0995 ms shorter than the interval from
stream-active text receipt to stop request; trial 2 was 8.813 ms longer and trial
3 was 0.849 ms shorter. Different observation boundaries prevent attributing
this to start versus tail loss, device wake-up or any particular cause. It does
not prove clipped speech, nor does it establish that speech boundaries are safe.
No playback/reference/first-PCM timestamps exist. Further acoustic/first-data
investigation needs separate approval; no latency/preroll/tail setting was changed.

Evidence: `run-nna5cbqo/context.json`, `summary.json`, `trial-{1,2,3}/result.json`
and `review.json` (derived timing, consistency/cleanup audit and source JSON
hashes). See `phase-2-audio-capture.md` for the full interpretation and handoff.
The run validates basic start/stop/finalize/cancel/cleanup, not Pi integration,
real owner-crash/device-loss behavior, speech fidelity or production readiness.
