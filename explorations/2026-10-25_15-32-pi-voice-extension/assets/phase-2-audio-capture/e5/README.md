# E5 — One Ctrl+Q capture inside Pi, then local batch transcription

## Objective and authorization

Exploration-only diagnostic, not the production Pi Voice extension. The requester
selected Ctrl+Q **inside Pi in Herdr**, one recording of arbitrary speech with no
configured duration limit, explicit release/stop, then automatic local batch
transcription presented for their verdict. They said a satisfactory result is
sufficient to close basic capture feasibility; E3/E4 are not mandatory gates.

The existing selected stack remains **whisper.cpp v1.9.5, full multilingual
large-v3, Vulkan device 0**. No turbo, CPU fallback/retry, streaming ASR, VAD,
silence timeout, automatic prompt submission or editor insertion.

**Closed/accepted, 2026-10-26:** the requester completed `run-1zzjfxe5` inside
Pi/Herdr and explicitly recorded **`/voice-test pass`**. Valid 13.1395-second PCM
was batch-transcribed with full-large-v3/Vulkan, presented locally and approved.
Cleanup review passed. The **one-attempt grant is consumed (1/1)**; do not retry
or reset it. This is sufficient for basic phase-2 feasibility, not production
readiness or authorization for another phase. No extension/settings/package was
installed or modified outside this exploration; the main Pi session is unaffected.

## Original run procedure — completed; do not repeat

From the repository root:

```sh
bash explorations/2026-10-25_15-32-pi-voice-extension/assets/phase-2-audio-capture/e5/run-voice-trial.sh
```

1. Wait for the E5 widget: `idle`, microphone NOT open. The launcher first does a
   read-only artifact hash check; this may take a few seconds before Pi appears.
2. **Hold Ctrl+Q**, speak your own text for as long as you want, then **release Q
   first**, followed by Ctrl. Watch `starting` / `recording` status; stream-active
   is diagnostic readiness, not a guarantee of first-phoneme capture.
3. Release finalizes the recording and starts one batch transcription. Wait for
   `transcribing` to finish. There is no recording or inference duration timer.
4. A scrollable local transcript viewer opens after successful completion and
   cleanup. Use arrows, PageUp/PageDown or Home/End. Escape/Enter closes it.
   If it did not open automatically, run **`/voice-test view`**.
5. Compare the entire text with what you said. Close the viewer, then run
   **`/voice-test pass`** if satisfactory, or **`/voice-test fail`** otherwise.
   This writes only verdict metadata, never the dictated text.
6. Copy the displayed `Run:` path back to the assistant for metadata/verdict review.
   Exit this disposable Pi with `/quit`. The transcription is lost from this
   diagnostic's memory on exit; do not quit before validating it.

Emergency/explicit controls:

- **`/voice-test stop`** finishes if a release was lost; it does not start a new
  recording or change to toggle mode.
- **Escape** while recording/transcribing, or **`/voice-test cancel`**, cancels,
  terminates owned work and discards audio/text. Wait for cleanup/worker close.
- Ordinary prompts and user-entered shell commands are blocked in this diagnostic;
  no dictated text is sent to an LLM. Do not change Pi/provider/settings menus.
- **One attempt only.** Failure/cancel also spends the attempt. No reset/retry
  command exists. Do not delete `authorization-used.json`, duplicate this directory,
  or rerun after a spent attempt without review and fresh approval.

## What happens locally

The explicit extension module is loaded only by this launcher. The launcher uses
private agent/cache/temp directories, offline mode, no saved session, no discovered
extensions, MCP, tools, skills, prompts, context files or themes. It does not
register anything in normal Pi configuration. Default shared terminal input
settings are unchanged.

Factory/startup never opens audio or starts a worker. The first Ctrl+Q press starts
`worker.py --worker`, then sends a JSON `start`. Repeated ordinary/Kitty presses
are ignored; a delivered Q release is latched even if modifiers changed. Stop and
cancel are queued during worker startup, not discarded. Session replacement/fork
is blocked; orderly shutdown cancels and awaits worker close before removing UI.

The worker rechecks the agreed **SoundWire microphones** default source/mute and
local runtime without changing them. It refuses an unexpected route/default
rather than capturing another device. Its input target is:

```text
alsa_input.pci-0000_00_1f.3-platform-sof_sdw.HiFi__Mic__source
```

It owns one non-detached `stdbuf -oL pw-record --verbose` process, requests mono
16-kHz/s16, writes a private WAV, consumes diagnostic pipes, and ends only on
explicit stop/cancel, owner EOF, failed startup or an error. No E2 four/five-second
safety abort is reused. A failed-start deadline is not an active-recording/silence
limit. Termination cleanup remains bounded by SIGINT, then SIGTERM after two
seconds and SIGKILL after three; this is not a speech-ending timer.

After the recorder is reaped and its RIFF chunks/PCM fields/frame lengths are
validated, it runs exactly:

```text
~/.local/bin/whisper-cli --model ~/.local/share/whisper.cpp/models/ggml-large-v3.bin
  --file <private-finalized.wav> --language auto --threads 8 --device 0 --no-timestamps
```

`GGML_VK_VISIBLE_DEVICES=0`, cache and temp variables are child-local; Vulkan/Mesa
cache and temporary artifacts stay under this run. `auto` detects spoken language;
translation is not enabled. No transcript-output file option, VAD or audio-duration
limit is passed. Runtime stderr must confirm Vulkan0 and **32 encoder / 32 decoder
layers** before text is accepted. Observed GPU unavailability aborts rather than
initiating a CPU/model retry.

Both inference pipes are consumed, but no partial transcript is shown. After batch
completion, owned readers have exited, the WAV is deleted, and the complete text is
sent once to Pi. The UI waits for successful `finished` **and process close** before
exposing it. ASR stdout remains in memory; raw ASR stderr is not persisted. Only
whitelisted backend facts, timings, process/format metadata and explicit verdict
are retained. Capture verbose diagnostics contain metadata, not PCM.

The seek-based WAV validator has no 1-MB synthetic-fixture cap and skips PCM payload
rather than reading the entire WAV into memory. Physical disk/memory limits and
RIFF's intrinsic 32-bit container limit remain; “no configured duration cap” is
not infinite physical storage or an infinite-memory inference promise.

## Selected local artifacts — read-only verification

`~/.local/share/whisper.cpp/installation.md` records the installed Vulkan build and
its earlier migration smoke result. Current hashes were rechecked without executing
inference and matched:

| Artifact | SHA-256 |
| --- | --- |
| `~/.local/bin/whisper-cli` | `6c2d7b6529155d77338719cdbd66ab287945716a3921a41fdf736af2e34a25c2` |
| Full `ggml-large-v3.bin` (3,095,033,483 bytes) | `64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2` |

`artifact-provenance.json` records paths, sizes, modification timestamps and hashes.
`worker.py --check` performs read-only full hashing before every launcher start;
its fast worker preflight rejects changes to that verified snapshot. No model,
executable or library was downloaded, rebuilt, installed or altered. Actual Vulkan
inference confirmation was not claimed from preparation; the accepted real run
below subsequently confirmed Vulkan0 and full model layer counts.

## Validation performed without real audio

| Check | Final result | Evidence |
| --- | --- | --- |
| Raw input / UI / ownership / verdict mocks with real Pi TUI helpers | 16/16 | `voice-trial.test.log` |
| Python fake capture → validation → fake ASR + failure/cleanup checks | 15/15 | `worker.test.log`, `selftest-suite-j7yt4yh2/` |
| Actual Node socket-backed stdio → actual Python fake-services worker | 1/1 | `node-worker.test.log`, `selftest-node-7tPkgO/` |
| Actual isolated Pi idle/prompt-blocking/command/shutdown, no Ctrl+Q | 5 checks | `startup-smoke.log`, `startup-smoke.ansi.log` |
| Existing executable/model hash verification | Matched | `artifact-check.log`, `artifact-provenance.json` |

A final repeat of the current sources passed **32/32 synthetic scenarios**
(17 Node/UI/bridge checks plus 15 Python checks): `final-tests.log`. Its generated
roots are `selftest-node-vFo2lp/` and `selftest-suite-oo1ufica/`; earlier successful
runs above are preserved, not overwritten. `preparation-validation.log` records
syntax/documentation/private-mode checks, no retained WAV or live recorded fake
PID, and the unused real E5 reservation at handoff.

Worker tests include capture continuing past the old five-second limit; a one-hour
sparse synthetic WAV and padded extra chunks; early release without spawning a
recorder; capture/ASR cancellation and owner EOF; unavailable-GPU rejection; SIGKILL
escalation of an unresponsive fake; no automatic retries; private modes; no WAV
retention; and a simulated unlink failure remaining an error even on cancellation.
The Node bridge specifically covers Linux Node/libuv socketpair stdio (not just
Python FIFO pipes). The static review caught and corrected that compatibility
issue and cleanup-error precedence before any real recording.

Two initial test-only errors were corrected and their logs preserved: a missing
`wave` import in a validator test (`worker.test.initial.log`), and a startup-smoke
path assertion that mistook `run-voice-trial.sh` for a real `run-*` directory
(`startup-smoke.initial.log`). Neither opened the microphone or ran inference.

Synthetic tests can be rerun only before the real attempt:

```sh
node --test voice-trial.test.mjs
/usr/bin/python3 -B worker.test.py
node --test node-worker.test.mjs
/usr/bin/python3 -B startup-smoke.py
```

Run these from this directory. They are not part of the user's acceptance
procedure and must not be confused with real microphone/backend validation.

## Accepted real execution — `run-1zzjfxe5`

The requester supplied [verdict.json](run-1zzjfxe5/verdict.json): `accepted: true`,
`userConfirmed: true`, source `Pi /voice-test pass`, recorded at
**2026-10-26T19:55:25.485Z**. The assistant inspected metadata/verdict and cleanup
only, not audio/transcript content. No new capture, service query or inference
was performed during review.

| Measure | Result |
| --- | --- |
| Recording control | Explicit Ctrl+Q hold/release, no configured duration cap, VAD false |
| Validated PCM | Mono/16-kHz/s16le, 210,232 frames, **13.1395 s**, 420,508 bytes, mode 0600 |
| Recorder | `/usr/bin/pw-cat`; **13.291642 s**, SIGINT only, exit 1, no escalation |
| Batch ASR | One existing `whisper-cli` process; **13.782518 s**, exit 0, no retries/signals |
| Runtime identity | Vulkan0, 32 encoder and 32 decoder layers; verified full-large-v3 artifact |
| User verdict | Passed after viewing the local result; result reports 165 characters, not saved here |
| Cleanup | Capture/ASR/preflight children reaped; all four recorded PIDs absent; WAV deleted |

Original evidence: [result](run-1zzjfxe5/result.json), [verdict](run-1zzjfxe5/verdict.json),
[metadata/hash/cleanup review](run-1zzjfxe5/review.json). Private metadata/directory
modes were checked and no WAV/text output file remains. The run ledger points
here with max attempts 1 and duration cap null. Keep all evidence and the spent
ledger; no automatic reset, replay or inference retry is approved.

These are single-trial observations, not an accuracy or cold/warm performance
benchmark. Stream-active-to-stop versus PCM duration still differs by about
136.2 ms; those boundaries do not locate acoustic loss or establish clipping.
The requester found the actual displayed transcript satisfactory, so this limit
is retained without demanding E3/E4. The acceptance criterion is met.

## Privacy, cleanup and limits

Real run directories/files are 0700/0600. A single exclusive authorization record
is created only on the first explicit Ctrl+Q attempt; E2's grant is not reused.
`run-*/result.json` retains nonspeech evidence; `/voice-test pass|fail` creates an
exclusive private `verdict.json`. No transcript file or Pi session file is saved.
Terminal display/scrollback may still contain the presented text; the harness
cannot guarantee erasure of terminal/OS storage. Deleting WAVs is not secure
physical erasure on SSD/journal/swap.

Owner-pipe EOF cancels work; the helper terminates/reaps owned children before
unlinking audio. Cleanup failure is visible and blocks success. The Pi UI waits
rather than blindly killing a supervisor and hiding a possibly active recorder.
The worker's own SIGKILL/crash, OS-uninterruptible waits, resource exhaustion,
device-loss/movement races and every possible terminal/dialog interaction are not
production-proven. A cleanup watchdog warns only after stop/cancel; it never caps
recording or transcription. There is no claim of sample-exact readiness/tail or
zero clipping from the earlier stream-state timing observations.

**Acceptance met:** one user-ended capture transcribed with the fixed stack,
presented its complete text, cleaned up, and the requester explicitly passed it.
Basic phase-2 feasibility is closed as sufficient at their direction. No mandatory
E3/E4 battery, hidden extra recording, general phase-3 benchmark, production
extension installation or prompt integration is authorized. Investigate a later
material failure/new requirement only when separately requested.
