# Pi Voice extension integration exploration

## Objective, scope, and constraints

Explore how a Linux Pi extension can start and stop microphone recording explicitly, transcribe the completed recording locally with whisper.cpp, and insert the result into the prompt editor.

This is an **Exploration** session, not authorization to implement or install the extension. Documentation, validation code, and generated evidence belong inside this directory. Do not change project implementation, Pi/terminal settings, system packages, or external state. Do not access remote hosts or private services. Any later implementation requires explicit authorization.

### Established requirements and context

- **Primary target: Pi running inside a terminal in a Herdr window.** Native WezTerm is only a control/comparison; success there does not fulfill the intended environment. Deprioritize further native-only tests unless they answer a question relevant to Herdr.
- Preferred interaction: hold a shortcut while speaking; releasing the recording key ends capture. **Ctrl+Q is the validated phase-1 candidate**, not yet a finalized product binding. The originally suggested Ctrl+Shift+R conflicts with WezTerm.
- If reliable hold/release is unavailable, investigate explicit start and stop shortcuts. A same-key toggle is an alternative to compare, not a selected requirement.
- **Real-time transcription is neither required nor desired.** Transcribe only after recording ends.
- **Automatic end-of-speech detection is neither required nor desired.** Silence must not decide when recording ends.
- The existing project selection is the **full Whisper large-v3 model, not large-v3-turbo, through whisper.cpp with Vulkan GPU acceleration**. Do not reopen model/backend selection without a specific reason or requester approval.
- Inserting text without automatically submitting the prompt is the initial proposal, not yet a confirmed editor contract.

Existing context: [project overview](../../README.md) and [previous local speech-to-text exploration](../2026-10-24_21-22-local-speech-to-text/README.md). Previous experiment permissions do not carry forward to new installations, recordings, or execution.

## Phased investigation

Each phase should record verified findings separately from assumptions/proposals, supporting source/version references, alternatives and trade-offs, validation commands/results and limitations, conclusions, unresolved decisions, and the next handoff. Investigate only the selected phase; completing one does not automatically start the next.

| Phase | Status | Record | Main output |
| --- | --- | --- | --- |
| 1. Keyboard activation | Closed as feasibility exploration: basic end-to-end hold/release verified; deferred UX/robustness limits retained | [phase-1-keybindings.md](phase-1-keybindings.md) | Feasible shortcut mechanisms, terminal prerequisites, and fallback options |
| 2. Audio capture | Closed as basic feasibility: E1/E2 passed; E5 Ctrl+Q → full-large-v3/Vulkan transcription explicitly accepted with `/voice-test pass` | [phase-2-audio-capture.md](phase-2-audio-capture.md) | Capture tool/API recommendation and recording lifecycle |
| 3. Batch transcription | E5 basic path passed; remaining contract work recommended for a combined phase with 4, not started | [Proposed combined-phase handoff](NEXT-PHASE-HANDOFF.md) | Batch process/result/cancellation ownership |
| 4. Prompt integration | Not started; recommended for the same lean combined phase as 3 | [Proposed combined-phase handoff](NEXT-PHASE-HANDOFF.md) | Safe asynchronous editor insertion and complete interaction contract |

### Phase 1 — Keyboard activation

Questions:

1. Can the installed Pi receive key press, repeat, and release events through a public extension API?
2. Which terminal/protocol capabilities are required? Can `Ctrl+Shift+R` be distinguished from `Ctrl+R`?
3. Can ordinary registered shortcuts implement hold/release, or is a raw-input listener/custom component required?
4. How should repeat events, release order, focus changes, built-in shortcut conflicts, and cancellation be handled?
5. Which fallback is most reliable: separate start/stop or toggle?

Completion criteria:

- Trace the installed API and dispatch path with source evidence.
- Validate event parsing/dispatch with isolated tests where practical.
- Distinguish source-level feasibility from actual terminal validation.
- Recommend options without silently selecting a final binding or modifying user settings.
- Record remaining interactive checks so another session can continue without conversation history.

### Phase 2 — Audio capture

Questions:

1. Which existing Linux capture tools or APIs can record the chosen input device without additional dependencies?
2. How can recording start/stop quickly and produce audio accepted by the selected whisper.cpp build?
3. How should process creation, readiness, short recordings, finalization, cancellation, errors, and temporary files work?
4. What visible status and explicit emergency stop are needed?

Completion criteria: recommend a capture approach, identify dependencies/permissions and any required approvals, and describe an explicit recording state machine. Do not open the microphone without a clearly agreed experiment. No silence-triggered stopping.

Handoff from phase 1: activation events, repeat behavior, terminal limits, and manual stop/cancel requirements.

### Recommended next phase — combine original phases 3 and 4

After E5 acceptance, the requester asked whether the remaining phases should be combined. **Recommendation: yes**, as one lean “Batch transcription and prompt-editor integration” phase with separate lifecycle and editor checklists. One CLI invocation per completed recording is the proven baseline; a persistent model service/benchmark campaign is optional follow-up only if a material requirement justifies it. The new uncertainty is safe delivery of the asynchronous result while preserving edits, cancellation and session ownership, not repeating model/capture feasibility.

[NEXT-PHASE-HANDOFF.md](NEXT-PHASE-HANDOFF.md) records the rationale, trade-offs, scope and ready-to-paste Exploration prompt. The consolidation is a recommendation for the requester to select next, not an automatically started phase. Its expected record is `phase-3-transcription-and-editor.md`. The original phase questions below remain a scope map, not two mandatory separate test campaigns.

### Original phase 3 — Batch transcription with whisper.cpp

Questions:

1. Compare one CLI process per completed recording against a persistent local process with the model loaded.
2. What are cold/warm latency, memory, cancellation, failure-recovery, and lifecycle implications for full large-v3 on Vulkan?
3. How should audio/output files, language settings, empty recordings, and non-speech output be handled without adding automatic end-of-speech detection?
4. What minimum measurements, reusing existing evidence where applicable, would support a choice?

Completion criteria: recommend a batch integration strategy, document invocation/protocol boundaries and resource handling, and distinguish measured results from estimates. No real-time/streaming transcription. Do not start a local service or new inference experiment without an agreed scope.

Handoff from phase 2: finalized audio format/path, recording ownership, stop/cancel semantics, and cleanup boundaries.

### Original phase 4 — Prompt editor integration

Questions:

1. Which public Pi APIs can insert transcription text, and with what cursor/selection semantics?
2. How can existing text and edits made during transcription be preserved?
3. What should happen if the session changes, the editor is replaced, Pi is busy, or another recording is requested?
4. Confirm insertion location, spacing, cancellation, status/error presentation, and whether submission always remains manual.

Completion criteria: document the recommended end-to-end flow and acceptance criteria, including concurrency and session cleanup. Do not implement the extension as a side effect of defining the contract.

Handoff from phase 3: asynchronous transcription result, cancellation/error contract, and resource/session ownership.

## Historical phase-1 session closeout

The requester closed this session after phase-1 basic feasibility passed and will start phase-2 audio capture in a clean-context session. **Start with [HANDOFF.md](HANDOFF.md)** for the concise result, environment/configuration history, remaining limits, authorization boundaries, and phase-2 objective. No project implementation or commit was created; phase 2 has not started.

## Resuming in an isolated session

1. Explicitly select **Exploration** mode.
2. Read this README and the selected phase record. Read the previous phase's conclusions/handoff, not the entire prior conversation.
3. Recheck source/version references if Pi or the environment changed.
4. State the bounded question/experiment before executing it. Follow the authorization limits above; do not infer implementation approval from these records.
5. Keep new scripts, logs, and notes under this directory. Update the phase record and status table with results, limits, and next steps.

Suggested request:

> Exploration session. Resume phase N of `explorations/2026-10-25_15-32-pi-voice-extension/`. Read its README and relevant phase handoff. Investigate only phase N; keep all assets in this exploration and do not implement the extension or change settings. Real-time transcription and automatic end-of-speech detection are explicitly unwanted.

## Current conclusions and open questions

Phases 1 and 2 are closed as basic feasibility explorations at the requester's direction. [Phase-2 evidence and closeout](phase-2-audio-capture.md) include E1/E2 checks and the **user-accepted E5**: Ctrl+Q inside Pi/Herdr, user-ended recording without a configured duration cap, finalized mono/16-kHz/s16le WAV, then full-large-v3/Vulkan batch transcription. The requester recorded `/voice-test pass`; audio deletion and process cleanup were reviewed. E3/E4 are not required. General phases 3–4 have not started; the passed smoke test does not authorize broader investigation, another recording/inference, or production implementation.

- **Primary environment:** Pi inside Herdr, with release-capable outer terminal input. Native-only WezTerm tests are controls, not acceptance of a different target.
- **Pi API:** Pi 1.4.0 exposes `ctx.ui.onTerminalInput` before editor release filtering, with public event-type helpers. `registerShortcut()` alone does not separate press/release. See [phase-1-keybindings.md](phase-1-keybindings.md). All 11 parser/dispatch assertion groups, 10 diagnostic harness checks, and 4 synthetic real-Pi startup checks passed. A subsequent physical Pi listener trial also passed in updated Herdr, as recorded below.
- **Candidate binding:** Ctrl+Q had no assignment in the inspected Linux Pi/WezTerm/extension scope and was selected for experiments, not yet as the final binding. Ctrl+R/Ctrl+T/Ctrl+Shift+T have contextual/Pi/terminal conflicts. See [candidate comparison](phase-1-binding-candidates.md).
- **Historical blocker:** the official Herdr 0.7.5 binary was identified by version and matching release SHA-256; its [exact-version routing](phase-1-herdr-0.7.5.md) drops releases. The earlier current-master source review must not be treated as that installed implementation.
- **Authorized setting change:** at the requester's explicit instruction, the assistant added only `config.enable_kitty_keyboard = true` to the dotfiles-backed WezTerm config. Configuration loading and diff/whitespace checks passed. This persistent setting remains in place and is reversible by removing the line. No restart or software installation/update was performed by the assistant.
- **Phase-1 successful target test:** the requester updated/restarted Herdr and ran the child probe inside it. The [Herdr 0.9.5 report and analysis](phase-1-herdr-0.9.5.md) record flags 7, **55 Ctrl+Q presses and one release**. Both encodings independently match Ctrl+Q in Pi's parser. This establishes release delivery through the required Herdr path, not a claim about the first release that fixed it. The subsequent physical Pi diagnostic reported **`press=49 repeat=0 release=1 held=no`**, confirming the basic listener path end to end.

**Current proposal:** hold-to-record/release-to-stop is feasible under the tested setup. Start must be idempotent while held because ordinary presses can represent auto-repeat. Keep explicit stop/cancel and consider separate start/stop as the compatibility fallback. Final bindings, fallback UX, modifier-release order, and focus/lost-release behavior remain unresolved. No production recorder/audio/transcription integration is implemented; the isolated E5 diagnostic was run and accepted under the phase-2 exploration assets only.

**Basic phase-1 feasibility is verified:** WezTerm with Kitty enabled → Herdr 0.9.5 → Pi → extension raw-input listener. Full result/provenance and untested cases are in [phase-1-herdr-0.9.5.md](phase-1-herdr-0.9.5.md). No further repetition of the basic gesture is needed.

**Current handoff (2026-10-26):** use [NEXT-PHASE-HANDOFF.md](NEXT-PHASE-HANDOFF.md) for the accepted phase-2 summary, the recommendation to combine original phases 3–4, and the ready-to-paste next-session prompt. [phase-2-audio-capture.md](phase-2-audio-capture.md) and [E5 evidence/accepted verdict](assets/phase-2-audio-capture/e5/README.md) retain the detailed closeout. Keep the spent E2/E5 authorization ledgers and evidence. No extra capture, replay, inference retry, production extension or phase transition is automatic. The requester must select the next scope/session; no further E3/E4 battery is required. [HANDOFF.md](HANDOFF.md) remains the historical phase-1 closeout.

Historical source/terminal traces remain in [protocol diagnosis](phase-1-protocol-diagnosis.md) and [Herdr source investigation](phase-1-herdr-input.md). Only public source, local executable metadata/version, user-supplied reports, and isolated local diagnostic processes were examined. No private Herdr service/runtime or remote host was inspected or connected by the assistant. Additional settings changes, software updates, or private/remote access require explicit authorization.
