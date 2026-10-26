# Phase-2 closeout and next-phase handoff

## Current status and authority

**Phase 2 is closed as accepted basic feasibility, 2026-10-26.** The requester
accepted E5 through `/voice-test pass` and subsequently requested closeout, a local
commit and this handoff. No next phase or implementation is started by that request.

This is the current handoff. `HANDOFF.md` is preserved as the historical phase-1
closeout; do not treat its old “phase 2 not started” text as current status.

### Minimum context to resume

Read, in order:

1. [README.md](README.md): requirements, phase status and current conclusions.
2. [phase-2-audio-capture.md](phase-2-audio-capture.md): status, accepted E5 result,
   recommendation and closeout; the full chronological experiment history is
   supporting evidence, not mandatory context to reload.
3. [E5 diagnostic README](assets/phase-2-audio-capture/e5/README.md): the proven
   capture/transcription boundary, privacy and remaining limits.
4. Inspect the existing E5 diagnostic source only as needed. It is one-shot
   exploration code, **not** a production implementation to install or copy blindly.

## What is already established

- Required environment: **Linux, Pi inside Herdr**. The keyboard path was verified
  through WezTerm with Kitty enabled and Herdr, not merely in native WezTerm.
- Ctrl+Q hold/release is physically validated. Start once while held, including
  when repeat arrives as ordinary press; release explicitly stops/finalizes.
  Keep separate explicit stop/cancel. Final production binding remains a decision.
- Capture baseline: owned `pw-record` process, private finalized **mono/16-kHz/
  PCM-s16le WAV**, intentional SIGINT stop, wait/reap then chunk validation.
  Positive exit 1 occurred on normal stop; it is not universally a success code.
- **No configured recording-duration limit**, streaming transcription, VAD,
  silence-triggered stop, model/backend reselection or automatic submission.
- Selected stack: **full multilingual large-v3, not turbo; whisper.cpp/Vulkan**.
  Installed executable `~/.local/bin/whisper-cli`; model
  `~/.local/share/whisper.cpp/models/ggml-large-v3.bin`. Verified hashes/provenance
  are recorded in phase 2; preserve this selection.
- E5 `run-1zzjfxe5`: 13.1395 s of valid PCM; one batch-ASR child, 13.782518 s,
  exit 0; runtime Vulkan0 and 32 encoder/32 decoder layers. These are single-trial
  measurements, not an accuracy ranking or cold/warm benchmark.
- [Explicit verdict](assets/phase-2-audio-capture/e5/run-1zzjfxe5/verdict.json):
  accepted, user-confirmed. [Metadata/cleanup review](assets/phase-2-audio-capture/e5/run-1zzjfxe5/review.json)
  passed. WAV deleted; child processes reaped; transcript was shown locally but
  not saved. There is no retained E5 audio available for another transcription.
- **The transcript was displayed, not inserted into the prompt editor.** Editor
  behavior, concurrent edits, session invalidation and production concurrency
  policy have not been validated by that test.
- The requester said a satisfactory integrated capture/transcription trial was
  sufficient. Do not reopen capture acceptance or require E3/E4. Their exceptional
  failure/acoustic cases remain limits, not mandatory future test gates.

## Assessment: merge original phases 3 and 4

**Recommendation: combine the remaining work into one lean phase, provisionally
“Phase 3 — Batch transcription and prompt-editor integration”.** This is a
recommended roadmap consolidation, not permission to start it in this session.
The requester can select it by using the prompt below.

### Why merging is useful

E5 has already proven a completed recording can be transcribed with the selected
full model/backend using one local CLI child. The main new uncertainty is no longer
whether that path works, but **what happens to its asynchronous result in Pi**.
Result ownership, cancellation, stale sessions, busy states, concurrent typing,
status/error presentation and safe insertion cross the original phase boundary.
A shared end-to-end contract avoids deciding those concerns twice.

### Preserve scope rather than expand it

Use one CLI invocation per completed recording as the **proven initial baseline**,
not as an already finalized production decision. Do not require a persistent model
service or a benchmark campaign before editor work. Revisit residency/performance
only if a concrete requester requirement or material failure justifies it and its
experiment is separately approved. A persistent process is not proven unnecessary;
it is simply an optional optimization outside this minimal next scope.

Keep two workstreams/checklists within the combined phase:

1. **Transcription lifecycle contract:** launch/protocol, file ownership,
   cancellation, exit/backend validation, language/output handling, cleanup and
   late-result invalidation. Reuse existing evidence rather than record again.
2. **Editor contract:** public API capabilities, insertion/cursor/selection
   semantics, whitespace, existing text, edits made during ASR, session/editor
   replacement, busy/concurrent requests and explicit/manual submission behavior.

The earlier idea of inserting without automatically submitting remains a proposal
for the product contract to confirm. **Do not send any prompt automatically during
exploration.** Do not promise cursor/selection operations that the public API may
not expose; inspect the installed API/source first and surface meaningful limits.

### Expected output / completion criteria

Create `phase-3-transcription-and-editor.md` in this exploration when that next
phase is explicitly started. It should distinguish verified facts, proposals,
confirmed decisions and remaining limits, and provide:

- One coherent state/result/ownership/cancellation contract from a completed WAV
  to a user-visible result or editor insertion, with no accidental submission.
- A confirmed strategy for preserving existing text and edits made during ASR;
  do not silently replace the user's whole current prompt with an old snapshot.
- Defined behavior for empty/failed/canceled results, a changed session/editor,
  another request while busy, and shutdown/reload.
- Public Pi API evidence and an implementable acceptance checklist, including
  cases where insertion must be deferred, rejected or explicitly confirmed.
- Any material unresolved product decisions asked of the requester, not guessed.
- The narrowest necessary validation: source inspection and synthetic/mock editor
  tests first. A single isolated editor trial with a synthetic completed transcript
  may suffice if a material behavior cannot be established from source/mocks.
  Do not launch it as a hidden real-microphone/transcription test.

This is still Exploration. It does not authorize a production extension, package
installation, settings changes, broad performance research or new live services.
If two phases are preferred later, preserve these two checklists without repeating
already accepted capture/model feasibility work.

## Authorization, privacy and retained limits

- E2's three-capture grant and E5's one-attempt grant are **spent**. Keep their
  ledgers and evidence. Do not reset, duplicate or rerun them to obtain more audio.
- No microphone, playback, inference, persistent service, remote/private service,
  upload, package installation or settings change is authorized by this handoff.
  Request a specific scope before any newly necessary operation of those kinds.
- Never inspect private Herdr services/runtime or remote hosts as a prerequisite.
  Terminal routing already passed; its historical issues do not justify access.
- Keep experiment code/artifacts within this exploration. Real WAVs and transcripts
  are not commit content. Private disposable Pi profiles, caches and temp state
  stay local/ignored; only specifically verified E1 synthetic WAV fixtures are
  versioned. No local evidence was deleted for commit hygiene.
- No source/fixture/diagnostic credential file should be added by future work.
  Inspect content/ignore rules before staging; no push or external publication is
  implied by the local closeout commit.
- First-sample/acoustic boundaries, the roughly 130–136-ms diagnostic/PCM interval
  differences, helper's own crash/SIGKILL, real device loss and complete production
  lifecycle safety remain unproven. They are not blockers to this accepted phase;
  address only relevant requirements/failures in later authorized work.
- The previously authorized WezTerm Kitty setting lives in a **separate dotfiles
  repository**. Do not edit, revert or commit it as part of this repository.

## Ready-to-paste next-session prompt

Use this prompt if selecting the recommended combined phase. It explicitly selects
Exploration, not Implementation, and authorizes no new microphone/inference run.

```text
Mode: Exploration.

Resume Pi Voice in explorations/2026-10-25_15-32-pi-voice-extension/.
Read NEXT-PHASE-HANDOFF.md, README.md, the accepted E5 result and closeout in
phase-2-audio-capture.md, and assets/phase-2-audio-capture/e5/README.md.
HANDOFF.md is the historical phase-1 record, not the current handoff.

Select the recommended combined next phase: batch transcription and prompt-editor
integration (the remaining scope of original phases 3 and 4). Do not implement
or install the production extension.

Treat phases 1 and 2 as accepted. Ctrl+Q hold/release capture inside Pi/Herdr,
finalized mono/16-kHz/PCM-s16le WAV, and one full-large-v3/Vulkan batch transcription
were validated and explicitly passed by me. Preserve full large-v3/whisper.cpp/
Vulkan. No real-time transcription, VAD, automatic speech-end detection or
configured recording-duration cap. Do not repeat capture/model feasibility or
require the deferred E3/E4 test battery.

Start with read-only inspection of the installed public Pi editor/lifecycle APIs,
following the project's Pi documentation rules. Use the proven CLI-per-recording
path as the initial baseline; do not introduce a persistent model service or
performance comparison unless a material requirement first makes it necessary.

Define one lean end-to-end contract for the completed file, batch process, result
ownership, cancellation/cleanup, stale sessions/editors, concurrent requests and
safe editor insertion. Clarify insertion/cursor/selection and whitespace semantics,
preserve existing prompt content and edits made during transcription, and confirm
manual submission/no-auto-submit behavior. Ask me about material ambiguities;
do not assume an unavailable public API or silently overwrite a newer prompt.

Prefer source evidence and synthetic/mock editor checks. Propose a narrowly
scoped diagnostic only if an important question remains; do not run a new
microphone, playback, inference or service experiment without specific agreement.
The E2/E5 grants are spent; never reset their ledgers or reuse deleted audio.
Do not access private Herdr services or remote hosts, upload data, install
software, change settings, or modify project implementation outside this
exploration. Do not automatically submit an editor prompt.

Record findings, confirmed decisions, limits and implementation acceptance
criteria in phase-3-transcription-and-editor.md within this exploration.
Keep the next phase lean and investigate specific failures only when relevant.
Closing it will not authorize implementation; wait for an explicitly selected
Implementation session/direct implementation request.
```
