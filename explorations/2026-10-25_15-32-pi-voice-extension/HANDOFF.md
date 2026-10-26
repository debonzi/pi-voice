# Session closeout and handoff to audio capture exploration

> **Historical phase-1 record.** Phase 2 has since passed its requester-selected
> acceptance test and closed. For current status and the recommended combined
> phases 3–4 Exploration prompt, use [NEXT-PHASE-HANDOFF.md](NEXT-PHASE-HANDOFF.md).
> Statements below about phase 2 not starting or no commit being made describe
> the original phase-1 closeout, not the current repository state.

## Session status

The requester closed this session after **phase 1 basic keyboard feasibility passed end to end** and plans to explore **phase 2: audio capture** in a new, clean-context Exploration session.

Phase 2 has **not started**. No Pi Voice production extension, recorder, audio pipeline, or prompt insertion was implemented. Closing this session does not approve implementation or resolve the deferred UX decisions below.

Read this file and [README.md](README.md) to resume; the detailed chronological phase-1 records are optional evidence, not mandatory context to reload.

## Established project requirements

- Linux; **Pi inside Herdr is the required operating environment**.
- Preferred interaction is hold-to-record/release-to-stop. **Ctrl+Q is the physically validated candidate**, not a finalized product binding.
- **No real-time transcription. No automatic end-of-speech detection.** Recording ends by explicit user action; silence must not stop it.
- The selected transcription stack is **full Whisper large-v3, not turbo, through local whisper.cpp with Vulkan GPU acceleration**. Do not reopen model/backend selection as part of phase 2.
- Transcription happens only after a complete recording. Model process strategy belongs to phase 3; prompt/editor integration belongs to phase 4.

## Phase 1: verified findings

Tested setup:

- Pi coding-agent/TUI 1.4.0.
- WezTerm `20240203-110809-5046fc22` with `enable_kitty_keyboard = true`.
- Herdr 0.9.5 after an update/restart performed by the requester.

The final keyboard-only Pi diagnostic ran **inside Herdr** and the requester reported:

```text
Ctrl+Q probe: ARMED | press=49 repeat=0 release=1 held=no
```

This confirms the basic path **outer terminal → Herdr → Pi → extension raw-input listener**. It is a user-reported physical widget result, not a production recording test. Details/provenance: [phase-1-herdr-0.9.5.md](phase-1-herdr-0.9.5.md).

API implications:

- Use public `ctx.ui.onTerminalInput` to distinguish press/release before the default editor filters releases. `registerShortcut()` alone does not expose event type.
- Auto-repeat arrives as ordinary press events in the tested setup. **Start once when idle; ignore repeated starts while starting/recording.** Filtering `isKeyRepeat()` alone is insufficient.
- Stop/finalize must be idempotent. A quick release may occur while recorder startup is still in progress.
- Keep explicit stop/cancel and shutdown/reload/session cleanup; do not invent release from a timeout between repeats.
- Native-only tests were controls. The relevant Herdr path is now verified; do not reopen the historical native-vs-Herdr investigation without new evidence.

Historical diagnosis, if needed:

- Previously installed official Herdr 0.7.5 dropped release events in application routing; source and official binary identity were verified. [Exact-version record](phase-1-herdr-0.7.5.md).
- The requester updated Herdr themselves to 0.9.5, and release delivery then passed. No claim establishes the first fixed version or a universal minimum version.
- [Shortcut comparison](phase-1-binding-candidates.md): Ctrl+R has contextual conflicts, Ctrl+T is used by Pi, Ctrl+Shift+T opens a WezTerm tab, and Ctrl+Shift+R reloads WezTerm. Ctrl+Q had no assignment in the inspected native-Linux scope; Windows/WSL bindings differ.

## Changes and authorization history

- All exploration documents, test code, reports, and generated evidence are under this exploration directory. Disposable diagnostic runtime state is ignored under `assets/ctrl-q-runtime/`; do not delete evidence as an assumed cleanup step.
- **One explicitly authorized external configuration edit:** the assistant added only `config.enable_kitty_keyboard = true` to `/home/debonzi/devel/repos/debonzi/dotfiles/wezterm/wezterm.lua`, reached by the `~/.config/wezterm/wezterm.lua` symlink. Configuration loading and diff checks passed. The setting remains persistent; do not revert or change it without a request.
- The assistant did not install/update software or restart Herdr/WezTerm. The requester performed the Herdr update/restart.
- No microphone was opened, audio captured/transcribed, private Herdr runtime/service inspected, or remote host accessed in this session.
- No commit was created. At closeout, the new exploration directory is untracked in `pi-voice`, and the authorized WezTerm line is an uncommitted change in the separate dotfiles repository. Preserve unrelated work and do not assume permission to commit either repository.
- If a keyboard-only diagnostic instance is still open, the requester can exit it with `/quit`; do not stop the main Pi session or Herdr server as cleanup.

## Validation and remaining phase-1 limits

Closeout rechecks passed: **11/11 parser/dispatch groups**, **10/10 diagnostic factory/UI groups**, standalone protocol parser self-tests, and launcher shell syntax. Output: [assets/session-close-checks.log](assets/session-close-checks.log). Four synthetic real-Pi PTY startup checks passed earlier; the physical user-run checks are documented separately and must not be conflated with synthetic evidence.

Still untested/unresolved:

- Releasing Ctrl before Q or stopping on release of any chord member.
- Focus changes/lost releases, dialogs, and concurrent editor interactions.
- Final product binding, fallback shortcuts, cancellation UX, and error/status presentation.
- Real recorder startup/finalization, short recordings, and transcription/editor integration.

These are retained limits, not reasons to repeat the already-passed basic gesture. Audio capture exploration can proceed without silently deciding the full extension contract.

## Phase 2: bounded objective and acceptance criteria

**Objective:** recommend the most appropriate Linux microphone-capture approach for explicit start/stop from a future Pi extension, producing finalized audio accepted by the selected whisper.cpp stack.

Investigate:

1. Existing tools/APIs and trade-offs: PipeWire capture, ALSA, and ffmpeg as relevant; do not add dependencies simply to start investigating.
2. Audio format and any conversion needs; explicit device selection, defaults, permissions, and user-visible recording readiness.
3. Process management: startup latency, quick release/stop during startup, clean finalization, trailing audio, empty/short recordings, repeated start/stop, cancellation, failure recovery, and shutdown cleanup.
4. Temporary-file ownership, local privacy, cleanup, and visible recording/finalizing/error states.
5. A proposed state machine and recording contract usable by phases 3–4, without integrating production code.

Expected output: create `phase-2-audio-capture.md` here with verified evidence, alternatives/trade-offs, recommendation, dependencies/permissions, lifecycle/state machine, validation performed/not performed, open decisions, and next handoff. Keep supporting scripts/logs/audio inside this exploration. Mark measurements versus assumptions.

Begin with read-only local inspection and a bounded experiment proposal. **Do not open the microphone without agreement on the specific recording experiment.** Do not install software, alter settings/project implementation, start remote/private services, upload audio, perform new model inference, or integrate the extension without separate explicit authorization. Previous recording/inference permissions from older explorations do not carry over.

## Useful prior capture evidence — historical, recheck as needed

The older [local speech-to-text exploration](../2026-10-24_21-22-local-speech-to-text/README.md) reports PipeWire and existing `pw-record`, `arecord`, and ffmpeg tools. Its section **First Portuguese microphone prompt: reproduction steps** (around lines 202–245) documents a recording made manually by the requester with:

```bash
pw-record --rate 16000 --channels 1 --format s16 RECORDING.wav
```

The resulting sample was valid mono 16 kHz signed-16-bit PCM and was transcribed successfully. This is useful evidence for a candidate approach, **not** a selected phase-2 implementation or authorization to execute the command now. Do not overwrite earlier recordings. The old CPU/small-model command is historical; current selected inference remains full large-v3/Vulkan.

For a clean-context start, read only the relevant old sections if necessary, not the entire chronological benchmark record.
