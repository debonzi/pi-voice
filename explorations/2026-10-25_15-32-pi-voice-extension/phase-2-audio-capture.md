# Phase 2 — Explicit Linux audio capture

## Status, objective, and authorization

**Closed 2026-10-26 as basic capture feasibility, at the requester's selected acceptance threshold.** E1/E2 passed, then E5 completed the physical Ctrl+Q → explicit release → finalized WAV → full-large-v3/Vulkan batch transcription path inside the isolated Pi/Herdr diagnostic. The requester recorded **`/voice-test pass`**; metadata and cleanup review passed. No E3/E4 battery is required. Remaining acoustic/failure/production limits are retained below, not reopened as acceptance gates. This closes phase 2 only; it does not authorize production implementation, further recordings/inference, or a general phase-3/4 investigation.

Objective: select a Linux capture boundary for a future Pi extension **running inside Herdr**, with explicit start and stop, producing a completed file for batch transcription.

Fixed requirements:

- Preserve **whisper.cpp + full multilingual large-v3 + Vulkan**, not turbo. Model residency/inference process strategy belongs to phase 3.
- No real-time transcription, voice activity detection, silence timeout, or automatic end-of-speech detection.
- Hold/release remains the preferred activation; Ctrl+Q is a tested candidate, not a final binding. Separate explicit start/stop is the compatibility fallback. Repeated ordinary presses must not start multiple recorders.
- Do not implement the production extension, install packages, alter settings, start services, upload audio, or inspect private Herdr services/remote hosts. The later E5 request specifically authorizes batch transcription of its one completed recording with the selected full-large-v3/Vulkan stack; it does not authorize other audio/inference experiments or a general phase-3 investigation.
- **No microphone access until the requester approves a specific bounded experiment.** Earlier capture permissions do not carry over.

The initial read-only pass created this phase record. The requester subsequently authorized E1 synthetic experiments, then E2 with a confirmed microphone and deletion policy. Experimental code/evidence stays under `assets/phase-2-audio-capture/`. The requester ran three transient E2 captures plus one E5 capture/transcription; all resulting WAVs were deleted. No production code, extension installation or global configuration change was made. The README status index now tracks phase 2; HANDOFF remains the historical phase-1 closeout.

## Evidence and limitations

### Initial tool/document inspection — before E2

Inspection used executable discovery, package metadata, help/version output, installed manual pages, configuration/source reads, and Git status. It did **not** connect to the audio server, enumerate live devices, inspect `/dev/snd`, or open an input.

| Item | Observed locally |
| --- | --- |
| PipeWire capture | `/usr/bin/pw-record` → `pw-cat`; compiled/linked libpipewire **1.0.5** |
| PipeWire packages | `pipewire`, `pipewire-bin`, `pipewire-alsa`, `pipewire-pulse`: **1.0.5-1ubuntu3.4~oem1** |
| Session-manager package | WirePlumber **0.4.17-1ubuntu4.1**; installation does not establish running status |
| ALSA | `arecord`/alsa-utils **1.2.9-1ubuntu5**; libasound2t64 **1.2.11-1ubuntu0.3** |
| WAV writer library | libsndfile **1.2.2-1ubuntu5.24.04.1** |
| FFmpeg/ffprobe | **6.1.1-3ubuntu5**; device registry includes PulseAudio and ALSA inputs, **not a native PipeWire audio input** |
| Buffering utility | `/usr/bin/stdbuf`, GNU coreutils **9.4** |
| Node | **v24.16.0** |
| Other discovery | `wpctl` and `pw-cli` installed; `pactl` and `sox` not found on inspected PATH |
| Selected CLI location | `/home/debonzi/.local/bin/whisper-cli` exists as an ELF executable, not a shell wrapper |

`/usr/share/alsa/alsa.conf.d/99-pipewire-default.conf` defines the ALSA default PCM/control as PipeWire. `50-pipewire.conf` defines a nonexclusive named PipeWire PCM. Thus `arecord -D default` is **not necessarily a direct-hardware alternative**. User overrides and the effective runtime route were not inspected/verified.

Installed `pw-cat(1)` establishes:

- Named PCM output uses libsndfile; extension selects container, with WAV the default.
- `-` means **raw PCM** on stdout, not WAV.
- `--target` accepts `auto`, `0` (do not link), or a target's **object.serial / node.name**. Do not confuse these with arbitrary transient node IDs shown by another tool.
- Defaults are 48 kHz, two channels, s16; request the intended rate/channels explicitly.
- Resampling is supported when stream and server rates differ. This does not establish the actual hardware rate or microphone channel mix.

That initial inspection did not measure input identity, mute/gain, permission, server availability, Herdr child's audio environment, startup latency, tail loss or signal exit behavior. Later E2 metadata and basic lifecycle observations are recorded below; acoustic boundaries remain unverified.

### Upstream source inspection — verified source behavior, not a local recording test

Public source: [PipeWire tag 1.0.5, `src/tools/pw-cat.c`](https://gitlab.freedesktop.org/pipewire/pipewire/-/blob/1.0.5/src/tools/pw-cat.c), fetched read-only from the corresponding raw URL on 2026-10-25. This matches the base library version, **not a verified source identity for the Ubuntu/OEM-patched executable**.

Important findings by function:

1. `main` registers **SIGINT and SIGTERM** with `do_quit`; `do_quit` quits the main loop. Ordinary cleanup destroys the stream, disconnects the core, and calls `sf_close(data.file)`. This is the expected WAV-finalization path. SIGKILL cannot run it.
2. **Do not require exit code zero for an intentional recording stop.** `exit_code` starts at `EXIT_FAILURE`; it changes to success only if `data.drained` is true. `on_drained` sets that flag; the capture branch of `on_process` writes frames and requeues buffers rather than initiating playback-style drain. Consequently an intentional SIGINT/SIGTERM capture stop is expected to return **1**, despite reaching `sf_close`. E2 subsequently observed exit code 1 after intentional SIGINT in all three real captures with structurally valid WAVs; SIGTERM behavior remains untested on the real recorder. Retain the intent/error/file checks rather than treating code 1 as universally successful.
3. Conversely, code 1 is **not sufficient evidence of success**: startup failures and stream/core errors can also exit unsuccessfully. Require an intentional stop, no observed fatal error/escalation, and a validated completed WAV. Ambiguous failures must not be silently transcribed.
4. `on_state_changed` prints stream transitions under `--verbose`, including streaming; errors/unconnected states can also print to **stdout**, while other errors use stderr. Drain both pipes.
5. These are human-readable messages, not a stable machine readiness protocol. With stdout piped, stdio buffering can delay them. E2 subsequently observed these transitions promptly with existing `stdbuf -oL`; `/proc` identity at the owned PID was `/usr/bin/pw-cat`, supporting exec-style ownership rather than an extra surviving wrapper. This validates basic diagnostic delivery, not a stable readiness API or first-sample timing.
6. `on_process` calls the libsndfile frame writer for capture. There is **no demonstrated capture-drain guarantee on stop**; finalizing the file does not prove every sample still in device/graph/resampler buffers was retained. Measure the end boundary.
7. Help/manual advertise “100ms” latency, but the inspected source selects `DEFAULT_LATENCY_REC = "none"` for recording and leaves node latency unset unless requested. Also, source defaults for quality differ from the help's advertised value. Do not convert help defaults into measured startup latency or assume recording uses a fixed 100-ms buffer. Begin with the unmodified capture defaults; compare an explicit `--latency=20ms` only if justified by evidence.

The installed `arecord(1)` explicitly documents SIGINT/SIGTERM/SIGABRT closing the recording file; SIGUSR1 rotates files and **must not be used as stop**. Its signaled exit codes/readiness/tail behavior were not tested.

### Existing audio compatibility evidence — historical, not rerun

The [previous exploration](../2026-10-24_21-22-local-speech-to-text/README.md#first-portuguese-microphone-prompt-reproduction-steps) records a requester-run capture using:

```bash
pw-record --rate 16000 --channels 1 --format s16 RECORDING.wav
```

It produced valid mono 16-kHz signed-16-bit PCM. The earlier full-large-v3/Vulkan trial used `prompt-002.wav` in the same format successfully. This supports the interchange format; it does **not** measure capture startup/stop, establish current device routing, or authorize another recording. Old recordings were not played or decoded in this inspection.

Existing local whisper.cpp source is version **1.9.5**, historically pinned to `d1be6fde11ac6e0407606b4e42fe72d34add8037`:

- `../2026-10-24_21-22-local-speech-to-text/source/whisper.cpp/include/whisper.h:33`: sample-rate constant 16000.
- `examples/common-whisper.cpp:45–58,96,122–162`: file decode requests float32 mono at 16 kHz, with conversion through miniaudio. A preexisting mono/16-kHz/s16 WAV is a conservative contract, **not the only decodable format**. FFmpeg fallback is conditional on build flags.
- `src/whisper.cpp:7026–7037`: a nominal spectrogram interval below 100 ms can return success without transcription. Do not equate successful inference exit with useful text or impose this as an exact wall-clock recording threshold.
- The decoder can tolerate some truncated WAVs; decodability alone does not establish clean finalization. Reject empty/partial files at the capture boundary instead of relying on inference to diagnose them.

The old `build-vulkan/CMakeCache.txt` is no longer present at its recorded location. Current installed binary/model paths, build options, and source-to-binary correspondence were **not** re-established. Do that in phase 3 without reopening the selected model/backend.

## Alternatives and trade-offs

| Approach | Benefits | Costs/risks | Recommendation |
| --- | --- | --- | --- |
| **One `pw-record` process per recording → named WAV** | Already installed; desktop PipeWire routing/resampling; no extension native dependency; libsndfile owns WAV header | Human-readable readiness; expected nonzero intentional-stop exit; startup race and unproven tail semantics | **Preferred first experiment and provisional baseline** |
| `pw-record ... -` → parent-owned PCM/WAV | First stdout PCM gives a stronger data-arrival observation; exact byte count; parent controls header | More integration code: backpressure, bounded buffering, write errors, EOF and header finalization; verbose stdout would corrupt PCM, so do not combine it with raw output | Second choice if direct-WAV readiness proves inadequate |
| `arecord` through ALSA default/PipeWire PCM | Installed; explicit WAV/format/device; documented graceful signals | May just add ALSA over PipeWire; effective routing can be overridden; no stable ready protocol | Compatibility option, not a presumed latency improvement |
| `arecord` to `hw:` / `plughw:` | Explicit hardware selection; plug variant can convert | Hardware often lacks mono/16-kHz mode; busy/exclusive access, permissions, device naming, conversion; bypasses desktop routing | Only with a concrete need and separate device agreement; no automatic fallback |
| FFmpeg PulseAudio/ALSA → WAV | Installed; conversion/filtering/progress facilities; can write `pcm_s16le`, `-ar 16000`, `-ac 1` | More options and buffering; this build needs PulseAudio compatibility or ALSA for capture; stdin interaction must be private/disabled; signals/progress need validation | Useful conversion/diagnostic tool, not first-choice recorder |
| Native PipeWire API helper/addon | Structured state/errors and audio callbacks; best control over readiness/lifetime | Native dependency/build/distribution; real-time callback discipline; most implementation effort | Escalate only if CLI experiments expose a material blocker |
| SDL2/PortAudio/PyAudio/browser capture | Familiar higher-level APIs | New dependencies or browser/IPC/permission surface; whisper streaming examples solve the wrong requirement | Not warranted for this phase |

Do not silently cascade to another backend or input after failure: that can capture an unintended microphone or system-output monitor. Report the problem and require an explicit retry/selection.

## Recommended recording contract (proposal)

### Format and device

- **Seekable, finalized RIFF/WAVE; PCM signed 16-bit little-endian; 16,000 Hz; one channel.** Byte rate 32,000 B/s (about 1.92 MB/minute), excluding container chunks.
- Ask PipeWire for that format directly. No routine FFmpeg conversion, compression, normalization, noise gate, silence trimming, or VAD. Let PipeWire negotiate/resample without changing its global rate/configuration.
- Avoid MP3/Opus and nonseekable WAV output for this boundary. Do not assume a fixed 44-byte header; WAV may contain additional chunks.
- Initially test the current default input **only after the requester confirms it**. Record the resolved input identity when available. For repeatable trials prefer an explicitly agreed `node.name`; rediscover serials after server restart, and never persist an arbitrary display ID as a stable identity.
- Future product must expose input/default policy and recording identity. Whether an active stream follows default changes, reconnects, or moves after device loss remains unverified. Fail closed on observed loss; do not promise pinning without testing session-manager behavior.
- No root, new audio-group membership, or permission/configuration edits are proposed. Same desktop user, accessible PipeWire socket/session manager and chosen input are prerequisites. A terminal does not inherently grant input permission, nor does Herdr inherently deny it. Sandbox/portal access, if relevant, needs a separate scope.

### Process ownership and readiness

1. One recording operation ID, private directory, child handle, and completion promise. Resolve an executable once; launch with an argument array and **no shell**. Do not interpolate target/path into a command string.
2. Keep the asynchronous child referenced and non-detached for the baseline; no `unref()`, background shell, `pkill`, or inherited terminal I/O. Use ignored stdin and consumed, size-bounded stdout/stderr pipes so Pi retains keyboard ownership. `stdbuf`, if used, must be verified to exec the intended recorder without leaving a process tree to manage.
3. Set `STARTING` immediately, but **spawn/PID/file existence are not microphone readiness**. Candidate direct-file signal: line-buffered verbose transition to streaming, labeled stream-active rather than proof of first sample. Confirm its usefulness in the trial. File-size growth can lag because of buffering. Do not introduce a PTY solely to force line buffering without a demonstrated need.
4. If reliable first-data readiness is required and this is inadequate, trial nonverbose raw-stdout capture with parent-owned WAV. Data-arrival observation is not VAD and does not establish audible speech or an unmuted microphone.
5. Use monotonic timestamps for requested start, spawn, stream-active/first-data observation, requested stop, child exit/close, validation, and handoff. No latency claims until measured **inside Herdr**.
6. Suggested initial startup deadline: 3 seconds; graceful stop deadline: 2 seconds, then SIGTERM with 1 second additional grace, then SIGKILL. These are test parameters, not measured optimal defaults or speech-ending timers. Any escalation beyond the normal stop path discards the recording for transcription.

Node process lifecycle evidence: installed `/usr/share/doc/nodejs/api/child_process.html`, sections `spawn`, `close`, `error`, `exit`, `kill`, and `killed`. `close` follows process termination and stdio closure; `spawn` is not application readiness; a sent signal/`killed` flag is not proof of termination. These are general process-management principles, not a verified Pi lifecycle-hook implementation.

### Stop, finalization, short clips, and cancellation

- **Stop means finish for possible transcription.** On release or explicit stop, latch stop intent and send **one SIGINT to the owned live recorder**, then await process completion/stdio `close`. If stop arrives during startup, latch it immediately, prevent readiness from returning to RECORDING, and signal as soon as the child exists. A signal before handlers are installed may terminate abruptly: discard an invalid/empty result; do not defer a quick release until audio starts and thereby record unexpectedly.
- SIGINT → cleanup/`sf_close` is the candidate normal stop. Validate the installed binary's result tuple `(code, signal)` first. Never globally redefine code 1 as success. Unexpected exit, fatal diagnostics, forced termination, or uncertain completion must not create a ready result.
- After close, parse/check the WAV: expected encoding/channels/rate, RIFF and data lengths consistent with the actual file, frame alignment and positive frame count. Check the relevant chunks rather than just total file size or `ffprobe` accepting it. Rename/publish as ready only after validation; no reader may access the active file.
- Zero frames: report “no audio captured”, delete. Very short clips: use actual frame duration, not key-held time. Proposed initial guard is <200 ms → “recording too short; try again”; 200 ms is a tunable UX proposal, not an ASR guarantee. Do not add silence to disguise an empty clip. Quiet but sufficiently long clips still finish only on explicit action; no signal-energy rejection is selected.
- No fixed post-release recording delay or invented speech tail. Stopping is not sample-exact; measure queued-buffer loss/overshoot. Any explicit tail grace would change the interaction/privacy contract and needs approval.
- **Cancel means stop and discard, never transcribe.** It uses the same bounded termination ladder, but sets an irreversible discard flag. Cancel wins even during STARTING, FINALIZING or validation; late callbacks/results cannot publish audio. Cancel after ownership transfers must notify the future phase-3 owner; inference cancellation details are deferred.
- Starts while STARTING/RECORDING are ignored idempotently. New starts while STOPPING/FINALIZING are rejected visibly rather than queued. Repeated stops/cancels settle the same operation once. Stale callbacks cannot change a newer operation.

### State machine and visible controls

| State | Event | Transition/action |
| --- | --- | --- |
| IDLE | Explicit start | Allocate operation/files → STARTING |
| STARTING | Stream readiness and no stop/cancel pending | RECORDING; visible active input and elapsed time |
| STARTING / RECORDING | Release or explicit stop | STOPPING; latch stop intent, initiate bounded graceful stop |
| STARTING / RECORDING / STOPPING | Cancel, owner/session invalidation, orderly shutdown | STOPPING with discard intent; never publish |
| STOPPING | Child close | FINALIZING if normal user stop; otherwise CLEANING |
| FINALIZING | Valid nonempty accepted WAV | READY; transfer ownership only to an explicit consumer |
| FINALIZING | Cancel / invalid / too short | CLEANING, with reason |
| READY | Consumer accepts | Transfer file ownership; capture becomes IDLE; later concurrency belongs to phase 3 |
| Any live state | Startup deadline / unexpected exit / device error / termination escalation | Stop owned child if necessary; CLEANING + visible error |
| CLEANING | Owned child confirmed gone and files removed | IDLE; retain only bounded nonsensitive diagnostics |
| CLEANING | Child death or deletion cannot be confirmed | Block new capture; persistent cleanup error, not false IDLE |

Visible states must distinguish **starting**, **recording**, **stopping/finalizing**, **canceled/too short**, and **error**. Display an explicit stop-and-finalize action and a separate **cancel/discard emergency action**, available independently of release delivery. Names/bindings remain undecided; do not silently reserve Escape/Ctrl+C or alter Pi/terminal keymaps.

Focus/lost-release handling cannot assume Herdr/Pi always supplies focus notifications. Retain manual stop/cancel. Any maximum-duration safety cutoff must be explicit, visible, consented and discard/report an error, not masquerade as end-of-speech detection. No automatic maximum duration is selected here.

### Cleanup, privacy, and crash limits

- Capture opens only after explicit start and closes before handing a completed file to transcription; no persistent warm microphone or pre-roll. Do not change global gain/mute/defaults or kill the desktop audio server.
- For experiments, keep all code/logs/WAVs under this exploration, e.g. `assets/phase-2-audio-capture/<unique-run>/`. Directories 0700 and audio files 0600; use unguessable names and exclusive allocation. Arrange restrictive **child-local** creation permissions (for example, a private helper with umask 077), not a process-wide umask change to the main Pi process. Private directories alone are not a claim that file mode is 0600.
- Future implementation should use a private user-runtime location where available, otherwise a private temporary directory; do not place speech in repository history. No production path/configuration is created by this record.
- Delete canceled, failed, empty, forced-killed, and consumed audio once no writer/reader owns it. READY has an owner and bounded lifetime; an unaccepted result must be discarded. Do not unlink first and leave a hidden recorder running. Report deletion failures. Deleting a file does not guarantee physical secure erasure on SSD/journal/swap.
- For approved trials, requester must select retain/delete policy. Default proposal: keep metadata/diagnostics, delete audio after validation; no playback, copying, upload, transcription, or commit. Old evidence is outside this cleanup scope.
- Orderly shutdown/reload/session switch should cancel the owned operation and await bounded termination. **A direct child does not automatically die when Pi is SIGKILLed or crashes**; non-detached spawn and JavaScript cleanup hooks are insufficient guarantees.
- If crash-safe microphone closure is an acceptance requirement, investigate a small local supervisor/helper whose private control pipe closes when the owner dies and which terminates/reaps the recorder. Linux parent-death signaling is another native-helper option with startup-race handling. E1 subsequently exercised a disposable control-pipe helper with fake children only; no production helper or dependency is implemented/approved. Native parent-death signaling remains untested. A raw PCM pipe's broken-pipe behavior alone is not a proven death guarantee. Test parent death in an isolated harness before claiming safety; never kill the main Pi/Herdr process.

## Proposed experiments — agreement required before microphone access

**E1 and E2 were explicitly approved and executed; E2 used all three authorized real captures. E3–E4 remain unapproved.** Each approval is limited to its stated target, count, duration, assets and actions; it does not approve extension integration or inference. Execute sequentially and stop on an unexpected route, permission request, hanging recorder, or effects outside scope.

### E1 — No-microphone lifecycle/format validation

- Generate synthetic mono/16-kHz/s16 WAV fixtures with Python/FFmpeg **lavfi**, entirely inside this exploration; no audio server/source/device and no playback.
- Use disposable fake recorder children to test stop-before-spawn, repeated start/stop, cancel during finalize, child failure, timeout/escalation, stale callbacks and owner disappearance. These validate a proposed controller contract, not real PipeWire behavior.
- Validate empty, tiny, ordinary and deliberately truncated WAV fixtures against chunk-aware checks and ffprobe; do not run whisper.cpp.
- Expected result: reproducible controller/validator assertions and cleanup checks. Supporting code remains experimental, not a production extension.

#### Executed E1 results — 2026-10-25

Authorization: requester said “pode executar e1”. Scope stayed entirely synthetic; no microphone, audio server, playback, inference, installation, settings change or extension integration.

| Suite | Result | Evidence |
| --- | --- | --- |
| WAV structure and contract | **216/216 assertions**, 47 synthetic fixtures / 47 ffprobe invocations; zero probe timeouts | [Format suite and reproduction](assets/phase-2-audio-capture/e1/formats/README.md), [JSON evidence](assets/phase-2-audio-capture/e1/formats/run-y6vya749/evidence.json), [run log](assets/phase-2-audio-capture/e1/formats/run-y6vya749/run.log) |
| Fake-recorder lifecycle | **14/14 scenarios**, repeated **three times on the final script** (42 scenario executions); preliminary run also 14/14 | [Lifecycle suite, reproduction and limits](assets/phase-2-audio-capture/e1/lifecycle/README.md), [repeat 1](assets/phase-2-audio-capture/e1/lifecycle/repeat-1.tap), [repeat 2](assets/phase-2-audio-capture/e1/lifecycle/repeat-2.tap), [repeat 3](assets/phase-2-audio-capture/e1/lifecycle/repeat-3.tap) |

Format verdicts: 34 invalid/out-of-contract, one structurally valid zero-frame file, three too-short files, nine accepted. Tests include exact 200-ms boundary, truncated/stale lengths, partial frames, unexpected format/rate/channels, duplicate/missing chunks, and valid padded extra chunks. Valid JUNK before fmt moved data to byte **56**, proving this experimental validator does not require a 44-byte header. A silent 250-ms fixture passed without VAD. The 200-ms guard remains a proposal.

**Observed divergence:** ffprobe returned exit 0 and stream metadata on **21 fixtures rejected by the strict validator**, including physical truncation, stale RIFF/data lengths, misalignment, missing padding and out-of-contract formats. “Invalid” includes unsupported format choices, not only corruption. ffprobe also accepted zero-frame/tiny files. Therefore metadata/probe success alone is demonstrably insufficient for this proposed finalization/acceptance boundary. No whisper.cpp decoder was executed.

Lifecycle cases covered stop before deferred spawn, repeated start/stop, stop/cancel while starting, cancel while recording/finalizing, startup deadline, ENOENT, unexpected exit 1 despite valid bytes, SIGTERM/SIGKILL escalation and discard, stale callbacks, bounded retained diagnostics while draining both pipes, and owner disappearance. For the latter, only a disposable test owner was SIGKILLed; its control-pipe EOF caused a disposable helper to terminate/reap a fake recorder and remove its synthetic WAV. No emergency cleanup was needed. Direct fake children were reaped and all lifecycle WAVs removed; JSON traces retain operation IDs/PIDs/signal tuples/outcomes.

The fake intentionally returns code 1 on graceful stop. This tests intent-sensitive handling; it **does not verify pw-record's actual exit code**. Fake deadlines, readiness messages and timing are not microphone/Herdr measurements. The lifecycle controller uses known fixture-byte comparison; the chunk-aware validator is tested independently, not yet wired into a real capture pipeline. Real deletion/write failures, READY expiry/cancel, helper death and all possible process races remain untested. There is no Pi API integration.

Supporting assets all remain inside this exploration. Synthetic format WAVs are retained as reproducible nonspeech evidence; lifecycle WAVs are deleted. Generated files are 0600 and directories 0700, verified locally. The [closeout audit](assets/phase-2-audio-capture/e1/validation.log) checked syntax, links/fences, evidence consistency, 70 private files / 11 directories, and 56 recorded PIDs with no live E1 command remaining. No existing recordings were read or removed. No production safety or acoustic boundary claim follows from these finite tests.

### E2 — Minimal real `pw-record` trial inside Herdr

**Authorization received:** requester said “Vamos executar e2”. Scope: read-only inspection of the **local desktop PipeWire/WirePlumber audio service only**, then **at most three recordings of up to five seconds each** from one requester-confirmed microphone, explicit start and SIGINT stop. No private Herdr service access. The requester subsequently confirmed (“Sim”) the proposed SoundWire microphone and deletion of every WAV after structural validation, without playback/transcription.

#### Initial E2 inspection — no microphone access

Executed existing `wpctl` help and read-only local `status --name`, `inspect @DEFAULT_AUDIO_SOURCE@`, and `get-volume @DEFAULT_AUDIO_SOURCE@`. No setting was changed. Only the relevant input summary is retained here, not the full unrelated device/application listing.

- Default input: **SoundWire microphones**, description **Meteor Lake-P HD Audio Controller SoundWire microphones**, on the Dell XPS 13 9340 / sof-soundwire card.
- `node.name`: `alsa_input.pci-0000_00_1f.3-platform-sof_sdw.HiFi__Mic__source`.
- Observed node ID / object serial: 55 / 55, a current observation only; future capture should use the agreed node name rather than assume ID stability.
- `media.class = Audio/Source`, `api.alsa.pcm.stream = capture`; this is the hardware microphone source, not an output-monitor node.
- Current source advertises two channels (FL,FR); the proposed recording still requests mono/16 kHz/s16 through PipeWire conversion.
- Reported volume: **0.98**, with no `[MUTED]` marker. This does not prove audible input or microphone fidelity.
- Shell has `XDG_RUNTIME_DIR=/run/user/1000`, no `PIPEWIRE_REMOTE` or `PULSE_SERVER` override, and Herdr-related environment variable names. This establishes inherited local/Herdr context, not a verified physical interaction/recording test; private Herdr socket/runtime values were not read or accessed.

**Confirmed:** use this built-in SoundWire microphone for up to three explicitly controlled captures of at most five seconds each, and delete every WAV after local structural validation (no playback/transcription). The requester subsequently completed the run recorded below. The **three-capture budget is now fully consumed**; no new captures/retries are authorized by that approval.

#### Interactive harness preparation — historical procedure

[Harness instructions and limitations](assets/phase-2-audio-capture/e2/README.md) and [experimental script](assets/phase-2-audio-capture/e2/capture-trial.py) are ready. The requester must run it in a separate Herdr terminal pane so start/stop remain physical explicit actions; it is not a Pi extension and does not record at preparation time.

```sh
python3 -B explorations/2026-10-25_15-32-pi-voice-extension/assets/phase-2-audio-capture/e2/capture-trial.py
```

The CLI reserves one three-attempt run. ENTER starts each attempt; another ENTER finishes trials 1/3 and cancels trial 2. Aim for 1–2 seconds. A separate worker owns the recorder and treats control-pipe EOF as discard. It initiates safety abort at 4 seconds, then escalation if necessary, leaving margin before the 5-second acceptance bound; **a safety timeout discards and ends the run, not normal successful automatic stopping**. This is not VAD. It refuses changed default input, mute or unexpected local PipeWire runtime overrides without reconfiguration. Private parent grants and per-trial exclusive launch reservations prevent accidental standalone or repeated real workers.

Before handoff, **4/4 synthetic-only worker cases passed** (stop, cancel, owner EOF, safety abort), including this worker + E1 chunk validator + ffprobe on fake silent WAV. All fake recorder children were reaped and synthetic WAVs removed. **3/3 refusal checks** passed (noninteractive run, standalone worker, missing private grant). Evidence: [self-test log](assets/phase-2-audio-capture/e2/self-test.log), [self-test summary](assets/phase-2-audio-capture/e2/selftest-ob3yeh7m/summary.json), [guard checks](assets/phase-2-audio-capture/e2/guard-checks.json). Static review and syntax/permission checks were performed; no real capture-budget reservation was created. Self-tests never call wpctl/pw-record or audio services.

At preparation closeout, actual installed-recorder behavior was still pending. The subsequently completed basic run is below. A worker's own crash/SIGKILL, OS scheduling, first-sample timing, actual graph-link identity and all device-loss/routing races remain outside the verified guarantee. Do not rerun/remove the authorization marker without review and renewed approval.

#### Executed E2 results — requester-run `run-nna5cbqo`

The requester supplied the resulting local directory after following the interactive Herdr procedure. `context.json` records Herdr-context presence, the confirmed source name and volume 0.98. The assistant reviewed only retained JSON/diagnostics and file/process existence; no audio was opened, replayed, transcribed or newly captured.

Evidence: [run context](assets/phase-2-audio-capture/e2/run-nna5cbqo/context.json), [summary](assets/phase-2-audio-capture/e2/run-nna5cbqo/summary.json), per-trial [1](assets/phase-2-audio-capture/e2/run-nna5cbqo/trial-1/result.json), [2](assets/phase-2-audio-capture/e2/run-nna5cbqo/trial-2/result.json), [3](assets/phase-2-audio-capture/e2/run-nna5cbqo/trial-3/result.json), and [independent metadata/cleanup review](assets/phase-2-audio-capture/e2/run-nna5cbqo/review.json).

| Trial | User intent / outcome | Process lifetime | Stream-active observed | Stop request → close | PCM frames / duration |
| --- | --- | --- | --- | --- | --- |
| 1 | Stop; completed, then deleted | 1.811732 s | 16.290 ms | 3.162 ms | 26,595 / 1.6621875 s |
| 2 | Cancel; discarded, then deleted | 2.268235 s | 14.891 ms | 2.665 ms | 36,152 / 2.2595000 s |
| 3 | Stop; completed, then deleted | 1.849689 s | 13.501 ms | 2.473 ms | 29,326 / 1.8328750 s |

Verified within this bounded run:

- All three requested only **SIGINT**, returned **positive exit code 1** (not termination by signal), reported no fatal diagnostics or stderr, and needed no escalation/safety timeout. Sum of measured recorder process lifetimes: **5.929656 s**, each below five seconds. SIGINT-send → close was 3.053, 2.556 and 2.362 ms, respectively.
- The integrated chunk-aware validator accepted all three finalized WAVs as the requested mono/16-kHz/signed-16-bit PCM subset; frame/data lengths were internally consistent. ffprobe separately confirmed `pcm_s16le`, 16000 Hz, one channel and 16 bits for the two completed clips. The canceled clip was structurally inspected but not sent to ffprobe or any transcription consumer.
- Actual owned executable was `/usr/bin/pw-cat` in every trial. Verbose diagnostics show `target.object` as the confirmed microphone name, the local `pipewire-0` server, `node.rate=1/16000`, and a running clock of 1/48000 in periodic stream diagnostics. That clock is not proof of the physical hardware rate; no server/global configuration was changed.
- Positive frames establish data production, not audible speech/fidelity. All three operations stopped at explicit user input; no silence/VAD rule was involved. Cancel remained a discard despite its valid WAV.
- The worker reported recorder `wait`/reaping and deletion for all three; review independently found no WAV in this run and all three recorded PID paths absent. Recorded WAV modes were 0600; retained metadata modes were 0600 and directories 0700. No cleanup of unrelated processes/old evidence was attempted.
- The authorization ledger points to this run, with exactly three trial launch reservations. **E2 budget consumed: 3/3.** Keep the ledger and evidence; do not infer permission to repeat.

**Timing interpretation and unresolved discrepancy:** times are monotonic harness observations referenced immediately before recorder `Popen`, excluding preflight and user-start-to-worker-start overhead; they are not total key-to-record latency. “Stream-active” is receipt of a line-buffered verbose state transition, **not first PCM, microphone wake-up completion, first phoneme, or an acoustic latency measurement**. “Close” includes child wait and diagnostic-pipe draining; it is not a sample-exact device boundary. This is three short observations, not a robust latency distribution.

Trial 1's stream-active → requested-stop interval was 1.792287 s, while the finalized PCM was 1.6621875 s: **130.0995 ms shorter**. Trial 2 PCM was 8.813 ms longer than its corresponding interval; trial 3 was 0.849 ms shorter. These comparisons use different observation boundaries. They cannot locate a missing interval at the start versus tail, establish clipped speech, or identify a cause. Device wake-up, graph/resampler timing, buffering and diagnostic timing are hypotheses, not verified explanations. No new latency setting, preroll or post-stop grace is selected from this evidence. Prioritize an explicitly approved E4/first-data investigation before claiming acoustic readiness or zero clipping.

**E2 conclusion:** basic manual start/stop, installed SIGINT exit behavior, WAV finalization/validation, cancel/discard and cleanup passed in the requester-run Herdr context. `pw-record` → named finalized WAV remains the recommended baseline for further work. This is not a Pi keybinding/hold-release integration, real crash/device-loss test, speech-quality acceptance, or phase-2 closeout. E3/E4 and any additional recordings require separate approval.

#### Approved experiment procedure (completed; do not rerun)

1. Run `wpctl status` / inspect only the chosen source to confirm input identity/default and mute information without setting anything. Avoid retaining unrelated device/application listings. Do not capture a monitor source. Resolve the target syntax before opening it.
2. Use a unique private run directory and the candidate invocation below, controlled by an isolated local harness/user from a Herdr terminal, not a production extension:

   ```text
   stdbuf -oL /usr/bin/pw-record --verbose --rate 16000 --channels 1 --format s16 --target <agreed-node.name> <private-run>/capture.wav
   ```

   This is the recorder command used by the approved interactive harness, **not a standalone command to run outside its lifecycle/guard**. The harness must own the process handle and stop only it; the angle-bracket values are not literal shell arguments. Observe SIGINT, exit tuple, both diagnostic pipes, finalized header/frame count, and elapsed times. Leave latency/quality/volume defaults untouched.
3. Trial 1: a short non-sensitive phrase, user stops within five seconds. Trial 2: cancel/discard within five seconds. Trial 3: repeat a short phrase to check fresh process/cleanup and absence of a recording lock. User may choose silence instead; silence must not trigger stopping.
4. No listening or inference. Verify only local WAV metadata/PCM structure and operation logs. Delete audio after checks unless retention is explicitly approved. If the five-second boundary is missed, abort/discard as an experiment safety failure, not successful finalization.

Expected evidence: installed-binary normal-stop exit tuple (especially code 1), valid WAV, readiness diagnostics visible through pipes, time to stream-active/close, cancellation deleting audio, and no owned child alive afterward. Metadata cannot establish speech fidelity, first-phoneme capture, or tail preservation.

### E3 — Races, errors, and crash cleanup (separate approval after E2)

Proposed budget: **up to ten captures, at most 30 seconds aggregate microphone-open time**, same agreed input and private assets; no server restart/configuration changes.

- Quick releases at several startup offsets, repeated press/stop, cancellation while starting/finalizing, two sequential completed captures.
- Nonexistent executable/output path/invalid target errors; observe bounded failure without switching source. Invalid target testing still contacts the audio service and needs scope agreement.
- Kill only an isolated test owner/helper to validate orphan cleanup; explicitly retain a supervising cleanup authority. Forced termination of only the owned test recorder checks discard behavior.
- Device-unplug/default-change tests are **excluded** unless specifically authorized; do not reconfigure or restart PipeWire to simulate them.

Expected evidence: zero orphan recorders, exactly-once settlement, quick releases never extending capture intentionally, invalid/partial files never published, and cleanup failures visible.

### E4 — Readiness and end-boundary quality (separate approval if needed)

If structural tests pass, propose **two captures of up to five seconds each** with the requester speaking a non-sensitive phrase including a clear initial/final syllable, explicitly stopping after the last syllable. Local playback/listening requires its own agreement; microphone metadata alone cannot measure lost speech. No loudspeaker loopback, test-source graph changes, or transcription is presumed.

Compare baseline against raw-stdout readiness or explicit latency only if the observed defect justifies the added variant and its recording budget is approved. Synthetic non-microphone tests can establish byte-level finalization but cannot prove acoustic boundaries. No automatic silence detection is introduced.

### E5 — Single free-form capture → batch transcription → requester verdict

**Requester-selected replacement acceptance test; completed and explicitly accepted on 2026-10-26.** After the proposed integrated test discussion, the requester asked for one recording with no duration limit, arbitrary spoken content of their choice, automatic transcription after stopping, and presentation of the transcript for their validation. They stated that a successful result is sufficient. E3/E4 therefore remain optional failure-specific investigations, **not required acceptance gates**.

Intended flow:

1. In an isolated exploration harness inside Herdr, explicitly start one capture from the already confirmed SoundWire microphone. **Control confirmed by the requester: Ctrl+Q inside Pi** (“crtl+q dentro do pi”). Hold records; delivered Q release finalizes; repeated ordinary/Kitty presses do not create more recorders. Keep explicit `/voice-test stop` and `/voice-test cancel` fallbacks.
2. Let the requester speak whatever text they want, for as long as they want. **No configured recording-duration cap, four/five-second E2 safety abort, fixed phrase, silence timer, VAD or live transcription.** Only explicit stop/release completes the clip; explicit cancel discards. Physical storage/container/resource failures remain errors, not a claim of infinite capacity.
3. Reap the recorder and validate/finalize mono/16-kHz/PCM-s16le WAV. Do not reuse E1's 1-MB synthetic-fixture ceiling as an accidental approximately 31-second recording limit. Suitable chunk validation must support the actual longer file without an arbitrary fixture-size cap.
4. Immediately run **one local batch transcription** of that completed file using the existing **full multilingual large-v3 / whisper.cpp / Vulkan**. Recheck actual executable/model paths and backend availability read-only before the trial. Do not download/build/install a replacement or fall back to CPU, turbo, another model or remote inference silently.
5. Present the complete transcription for the requester to compare with what they said. Do not automatically submit a Pi prompt or integrate prompt-editor insertion. No independent playback/listening stage is required by this revised acceptance test.
6. Delete the temporary WAV after its transcription reader has finished (also on cancellation/failure after processes stop). Preserve the earlier local deletion/privacy policy. Present dictated text without persisting it in exploration evidence by default; retain nonspeech metadata and the requester's pass/fail verdict instead. No upload or external service.

Keep visible recording/finalizing/transcribing/error states and explicit cancel/cleanup. No recording-duration timeout does **not** remove bounded process-termination cleanup after stop/cancel. Do not alter/reuse E2's consumed three-attempt grant; the new single trial needs a separate experiment entry and manual start. No automatic retries or extra variants.

**Acceptance:** one normal recording is explicitly ended, yields a valid completed file, transcribes with the selected full-large-v3/Vulkan stack, displays the result, cleans up, and the requester confirms that the transcription is satisfactory. Upon that confirmation, close basic capture feasibility as sufficient for this exploration at the requester's direction. Do not demand a separate 130-ms, crash, latency or acoustic test as a prerequisite. Record untested failure/quality limits honestly; this is not production readiness, extension implementation approval, or automatic phase-3/4 expansion.

If a material failure occurs, investigate only the relevant path first (activation/readiness, finalization, model invocation, cancellation or unacceptable transcript), then agree on any necessary retry. E3/E4 are available references, not a mandatory battery.

#### E5 preparation — historical checks before the accepted real run

The requester selected Ctrl+Q inside Pi. Created an **exploration-only diagnostic**, explicitly loaded into a separate disposable offline Pi, and a local owned worker. No production extension/configuration was installed. [E5 instructions, source, evidence and limits](assets/phase-2-audio-capture/e5/README.md).

Original procedure, now completed; **do not rerun the spent attempt**. It was launched in another Herdr terminal pane from the repository root:

```sh
bash explorations/2026-10-25_15-32-pi-voice-extension/assets/phase-2-audio-capture/e5/run-voice-trial.sh
```

Wait for the idle widget, hold Ctrl+Q, speak freely, then release Q first. No configured recording-duration cap or E2 four/five-second safety abort remains. On finalization the worker runs exactly one batch transcription; the completed text opens in a local scrollable viewer, or `/voice-test view` opens it manually. Close the viewer and use `/voice-test pass` or `/voice-test fail` to record **only an explicit verdict**, then send the run path for review. `/voice-test stop` handles a lost release; Escape or `/voice-test cancel` discards while live. Do not retry/reset after an attempt without review.

Preparation verification, without microphone or real inference:

- Installed `~/.local/bin/whisper-cli` SHA-256 `6c2d7b6529155d77338719cdbd66ab287945716a3921a41fdf736af2e34a25c2` and full model `~/.local/share/whisper.cpp/models/ggml-large-v3.bin` SHA-256 `64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2` matched the existing installation record. The model is 3,095,033,483 bytes; migration provenance records v1.9.5 Vulkan. [Recorded metadata](assets/phase-2-audio-capture/e5/artifact-provenance.json) and [read-only full hash check](assets/phase-2-audio-capture/e5/artifact-check.log). The launcher repeats full hashing before Pi starts; no CLI/model was downloaded, rebuilt or modified.
- **16/16 input/UI mock scenarios** passed with real installed TUI helpers, covering one-shot start, repeat/release ordering, changed modifiers, cancellation, full scrolling transcript display only after successful worker close, private verdicts and awaited shutdown. [Log](assets/phase-2-audio-capture/e5/voice-trial.test.log).
- **15/15 synthetic worker scenarios** passed: fake capture → seek-based WAV validation → fake batch ASR, owner EOF and cancel during capture/ASR, unavailable-GPU rejection without retries, signal escalation, unlink-failure reporting and one-shot reservation. A synthetic recording stayed active past the old five-second cap; a one-hour sparse WAV with padded chunks passed without the E1 1-MB ceiling. [Log](assets/phase-2-audio-capture/e5/worker.test.log).
- **Actual Node stdio → Python fake worker bridge passed**, covering socket-backed Node/libuv streams rather than only Python FIFO pipes. [Log](assets/phase-2-audio-capture/e5/node-worker.test.log). Static review corrected the stream-type guard and cleanup-error precedence before any real capture.
- **Real isolated Pi startup/shutdown smoke passed**, displaying the idle diagnostic, blocking ordinary prompts, refusing transcript view before capture, and exiting cleanly with `/quit`. It deliberately sent **no Ctrl+Q**, created no real worker/run reservation, queried no audio service and ran no inference. [Log](assets/phase-2-audio-capture/e5/startup-smoke.log). This is synthetic PTY startup, not the new physical gesture/recording test.

The worker requests mono/16-kHz/PCM-s16le, has no active-recording/inference duration cap, and recognizes only explicit stop/cancel or errors/owner EOF (a failed-start deadline and bounded post-stop termination cleanup remain). Capture and inference children are reaped before WAV deletion; ASR text/raw ASR diagnostics are not written to evidence. Text is delivered once in memory after completion/deletion, and Pi exposes it only after successful worker close. Inference uses `--language auto --threads 8 --device 0 --no-timestamps`, child-local GPU visibility/cache/temp variables, and requires runtime Vulkan0 plus 32 encoder/decoder-layer facts before accepting the result. No streaming/VAD/output-text-file option, prompt insertion, automatic LLM submission or model retry is enabled.

A [final repeat of the current sources](assets/phase-2-audio-capture/e5/final-tests.log) passed **32/32 synthetic scenarios** (17 Node/UI/bridge plus 15 Python). Initial test-only mistakes (missing test import; startup path assertion matching the launcher filename) were corrected, with initial logs preserved in E5. Full instructions distinguish preparation checks from the single real acceptance trial. Helper SIGKILL/crash, resource/RIFF limits, all device-loss/terminal-focus races and sample-exact audio boundaries remain prototype limits, not extra mandatory tests. Terminal display/scrollback may retain shown text even though no transcript/Pi session file is saved.

Preparation itself consumed no real attempt and performed no microphone/inference/playback/upload/installation/global configuration change. The requester subsequently ran the single approved real trial below.

#### Executed and accepted E5 — `run-1zzjfxe5`

The requester supplied [verdict.json](assets/phase-2-audio-capture/e5/run-1zzjfxe5/verdict.json): `accepted: true`, `userConfirmed: true`, source `Pi /voice-test pass`, recorded **2026-10-26T19:55:25.485Z**. This meets the selected sufficient acceptance criterion; no additional E3/E4 test is demanded.

Evidence: [original result](assets/phase-2-audio-capture/e5/run-1zzjfxe5/result.json), [explicit verdict](assets/phase-2-audio-capture/e5/run-1zzjfxe5/verdict.json), [independent metadata/verdict/cleanup review](assets/phase-2-audio-capture/e5/run-1zzjfxe5/review.json). The assistant reviewed metadata, reported process lifecycle and file/process existence only; the dictated text/audio was not opened, copied or transcribed again.

| Observation | Verified result |
| --- | --- |
| Physical interaction | Requester-run Ctrl+Q inside isolated Pi/Herdr; explicit stop, no configured recording cap, no VAD |
| Finalized audio | Mono PCM-s16le, 16 kHz; **210,232 frames / 13.1395 s**, 420,508 bytes; recorded mode 0600 |
| Capture process | **13.291642 s**, `/usr/bin/pw-cat`, one SIGINT, positive exit **1**, no escalation; stream-active observed |
| Batch ASR | Exactly one installed `whisper-cli` process, **13.782518 s**, exit **0**, no termination signals/retry |
| Runtime model/backend | **Vulkan0**, **32 encoder / 32 decoder layers**, selected full-large-v3 hash/path; auto language, eight threads, device 0 |
| Presentation/verdict | Complete text presented in local UI; requester explicitly passed it. Result metadata reports 165 characters, `transcript_persisted: false`; no dictated text is recorded here |
| Cleanup | Recorder, inference and both preflight children reported reaped; all four recorded PIDs independently absent at review; no WAV/text output file retained |
| Authorization | E5 separate ledger points to this run, max attempts 1, no duration cap; **1/1 consumed**, no repeat granted |

Recorded format/frame/byte fields are consistent, capture exit intent/signal match the earlier E2 behavior, and the inference command uses the verified full model without `--no-gpu`, `--vad`, duration limit or transcript-file output. Review confirmed private 0700 run directories/0600 retained evidence and original result/verdict hashes. No cleanup action against unrelated processes or artifacts was needed.

**Interpretation:** the real recording exceeded the old E2 five-second budget and ended explicitly, then transcribed successfully using the fixed stack. The single observed ASR runtime is not a controlled cold/warm latency or accuracy benchmark. The stream-active-to-stop versus PCM comparison still has an approximately **136.2-ms** difference in this run; it is not a first-sample/acoustic measurement and does not locate loss or prove clipping. The requester nevertheless found the presented transcript satisfactory. This remaining timing uncertainty is documented, **not a failed acceptance criterion or a requirement to run more tests**.

**Closeout:** basic audio-capture feasibility is accepted. Recommend the demonstrated explicit process/file lifecycle and batch boundary for future authorized work. No production extension was installed, prompt-editor integration implemented, package/configuration changed or remote service accessed. E3/E4 remain deferred unless a concrete material failure or new requirement warrants targeted investigation. Do not reset the ledger or initiate phase 3/4 automatically.

## Validation performed / not performed

**Performed:** README/HANDOFF and relevant prior record reads; current tool/version/package/manual/configuration inspection; PipeWire 1.0.5 public source review; existing whisper.cpp input/short-audio source review; Node child-process documentation review; authorized E1 format and fake-process lifecycle checks above, including disposable owner-death/cleanup tests. Evidence consistency and artifact permissions passed local checks. Documentation links/fences, syntax and whitespace were checked at E1 closeout.

**E2 performed:** local desktop audio-service source/default metadata and mute/volume query; requester confirmation; isolated CLI/static review; 4/4 synthetic worker tests and 3/3 refusal checks; three requester-run real captures and the metadata/diagnostic/cleanup review above. Basic explicit recording lifecycle passed; the first trial's duration discrepancy remains open.

**E5 performed:** preparation checks above, then one requester-run physical Pi/Herdr hold-release capture, actual full-large-v3/Vulkan batch transcription, explicit pass verdict and independent metadata/cleanup review. This satisfies the requester's **basic phase-2 acceptance**.

**Not performed:** playback/listening, first-sample/acoustic startup/tail measurement, controlled latency/quality benchmark, actual recorder owner-crash/device-loss test, production extension/editor integration, package installation or global configuration changes. These are retained limitations, not blockers to the accepted basic feasibility result. Closing review ran no new capture, audio-service query or inference.

## Conclusions, open decisions, and handoff

**Recommendation supported by E2 and user-accepted E5:** one owned `pw-record` child per explicitly started/stopped recording, directly to a private finalized WAV, at mono/16-kHz/PCM-s16le, then batch full-large-v3/Vulkan transcription. No configured recording-duration cap is selected. Retain production acoustic/readiness and failure-lifecycle limits; do not equate fast stream-active diagnostics with guaranteed first-phoneme capture. Use explicit SIGINT stop, cancellation as discard, chunk-aware post-close validation and strict process/file ownership. Keep raw-stdout/parent-owned WAV as the readiness fallback, ALSA as an explicitly selected compatibility path, and FFmpeg primarily for diagnostics/conversion.

Accepted outcome and deferred product decisions:

1. **Phase 2 is closed as basic feasibility.** E1/E2 passed and E5's real Ctrl+Q capture/transcription received the requester's explicit pass. Both E2/E5 grants are spent; no extra recordings, inference retries or automatic next phase are authorized.
2. The approximately 130–136-ms diagnostic/PCM interval differences, exact first-PCM/acoustic readiness, real owner-crash safety and device-loss behavior remain unverified limits. They were explicitly not required as separate tests after a satisfactory E5 verdict.
3. Product input policy, minimum useful duration, final bindings and production crash/cleanup guarantees remain future definition/implementation decisions. Any needed experiment should target a material failure/new requirement rather than restart a mandatory battery.

For future **explicitly authorized** work, the demonstrated handoff boundary is a completed, validated private file plus `{operationId, absolutePath, codec: pcm_s16le, sampleRate: 16000, channels: 1, frames, duration, inputIdentity, finalized: true, ownership}`. Cancel/error produces no transcription request. Ownership must cover reader completion and deletion. E5 proves this boundary is feasible in the diagnostic, not that production lifecycle/editor integration is implemented.

The installed executable/model paths and full-large-v3/Vulkan identity are now verified and recorded; no model/backend selection needs reopening. Broader model-residency/process strategy, repeated benchmarks, inference cancellation robustness and prompt integration remain uninvestigated or diagnostic-only. If phase 3/4 or production work is desired, select that scope/session explicitly. The E5 WAV was deleted and cannot be reused; this closeout grants no further audio access. HANDOFF remains the historical phase-1 record; this section and E5 evidence are the phase-2 closeout.

## Closeout packaging and next-phase recommendation

The requester explicitly asked to close this phase, make a **local commit**, create a next-session prompt and assess merging original phases 3 and 4. The phase remains closed; no new test/implementation phase was started while preparing that handoff.

**Recommendation:** combine the remaining transcription lifecycle and prompt-editor contract work into one lean phase, with separate checklists inside it. E5 already proves the CLI-per-recording path is viable; the important new uncertainty is safely applying its asynchronous result while preserving editor changes, cancellation and session ownership. A persistent model service and performance campaign are optional requirement-driven follow-up, not prerequisites. This is a recommended consolidation for the requester to select, not an automatic phase transition.

[NEXT-PHASE-HANDOFF.md](NEXT-PHASE-HANDOFF.md) contains the assessment, known facts versus pending decisions, narrow completion criteria and ready-to-paste **Exploration** prompt. It does not authorize production implementation or further microphone/inference access.

Commit packaging preserves this exploration's phase-1 prerequisites, phase-2 sources, nonspeech logs/metadata, explicit E5 verdict and verified E1 synthetic fixtures. Disposable Pi profiles (including credential/settings files), driver caches and temp directories remain local/ignored; real WAVs are excluded. Only the exact E1 synthetic-fixture directory is an audio exception, checked against recorded hashes. Raw ANSI terminal captures are marked binary in scoped Git attributes so control bytes, CRLF and meaningful screen padding remain unchanged. No local evidence/cache was deleted for version-control hygiene; no files from the separate dotfiles repository or earlier speech-to-text exploration were included. Functional test/acceptance evidence remains the recorded E1/E2/E5 results; [closeout checks](assets/closeout-validation.log) are static/documentation/staging checks, not a rerun of spent recording grants.
