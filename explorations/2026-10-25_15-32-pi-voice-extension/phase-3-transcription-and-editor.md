# Phase 3 — Batch result and prompt-editor integration

## Status, objective and constraints

**Closed at the requester's direction as sufficient editor-integration feasibility.**
The requester explicitly asked to close this session and make a local commit.
Native paste and manual spacing review are selected. Additional lifecycle/UI
validations are premature for this exploration and deferred to the requester's
usage after implementation, not blockers to closing the implementation plan.
They remain unverified, not passed. No production implementation or extension
installation is authorized by this closeout. Preserve the accepted phases 1–2;
do not repeat their audio, keyboard or model/backend trials.

The requester confirmed:

- Insert at the cursor, including between existing typed portions; preserve both
  sides. Combine typing and dictation in the same prompt.
- Support successive dictated parts, with editing/typing between parts.
- Leave submission manual; no automatic Enter or model request.
- If the cursor moves during ASR, initially choose whichever position has the
  least implementation complexity. They did not require an anchored old position.
  With native paste selected, use the current cursor at result delivery.
- Use native `ctx.ui.pasteToEditor()`, accepting Pi's large-paste markers; do not
  introduce a custom editor solely to keep long transcriptions expanded.
- Leave separator spaces to manual review. Add no Pi Voice smart-spacing layer;
  preserve native paste normalization and its existing path-prefix heuristic.

The last two choices were explicitly confirmed by the requester: “1: colagem
nativa. 2: revisao manual”. The subsequent explicit closeout request closes this
exploration, not an Implementation session or production implementation grant.

Only installed local documentation/source inspection and synthetic in-process
component checks were performed. No microphone, playback, inference, child worker,
Pi session, service, network, installation or settings change was used. All new
assets are under [assets/phase-3-transcription-and-editor](assets/phase-3-transcription-and-editor/README.md).

## Verified editor findings

Reference base `P`:
`/home/debonzi/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-coding-agent/`.
Reference base `T`: sibling `pi-tui/`. Both packages report **1.4.0**; inspected-file
hashes are in [source-provenance.log](assets/phase-3-transcription-and-editor/source-provenance.log).
These are installed release files, not an assumption about upstream master.

Read the installed `README.md`, `docs/extensions.md`, `docs/tui.md`,
`docs/usage.md`, `docs/keybindings.md`, `examples/extensions/README.md` and
`examples/extensions/modal-editor.ts`. No public-web lookup was necessary.

1. **Simplest insertion: `ctx.ui.pasteToEditor(text)` at delivery-time cursor.**
   Public declaration: `P/dist/core/extensions/types.d.ts:132–137`. Actual bridge:
   `P/dist/modes/interactive/interactive-mode.js:2073–2075` sends bracketed paste
   to the currently installed editor. It does not get/set the whole prompt or
   synthesize Enter. There is no public cursor accessor on `ExtensionUIContext`.
2. **Prefix/suffix and intervening edits survive.**
   `T/dist/components/editor.js:961–994` inserts into the live line/cursor state,
   handles multiple lines and puts the cursor immediately after the insertion.
   No old draft snapshot is needed. Sequential parts naturally use that new
   cursor unless the user moves it. CRLF/CR becomes LF; tabs become four spaces.
3. **Each paste is one undo unit; multiline text does not submit.**
   Paste handling is before submit/autocomplete dispatch (`:569–592`), pushes an
   undo snapshot (`:1050–1054`) and inserts literally (`:1097–1106`). Actual submit
   is separate (`:1138–1151`). Tested with real `CustomEditor`, not just a mock
   string concatenator. No model or application command was invoked by tests.
4. **Important review limitation: large pastes collapse.**
   `:1085–1098`: more than 1000 JavaScript string units (UTF-16) **or** more than 10 lines becomes a
   `[paste #…]` marker. Full content remains in `getExpandedText()` and
   `ctx.ui.getEditorText()`, but is not all directly visible/editable in the main
   editor. Markers are atomic cursor units; ordinary left-arrow movement does
   not enter their hidden text. No corruption was observed in this check.
5. **No general automatic word separation.**
   `antes|depois` + `ditado` becomes `antesditadodepois`. A special existing path
   heuristic adds a space for `/`, `~` or `.` after a word (`:1075–1084`). Do not
   describe paste as perfectly literal in that case. The simplest prototype
   leaves ordinary spacing to the user, as explicitly selected. No additional
   smart-spacing behavior is planned.
6. **Inline long-text alternative exists, but requires owning an editor.**
   `CustomEditor` publicly extends exported TUI `Editor`; its public inherited
   `insertTextAtCursor(text)` inserts inline without paste collapse, preserving
   cursor/prefix/suffix and one-step undo (`T/dist/components/editor.d.ts:115–121`,
   `editor.js:939–947`). A small `CustomEditor` subclass installed through
   `ctx.ui.setEditorComponent()` can retain its own instance. The checked modal
   example demonstrates this extension point. This is more invasive than one UI
   paste call and must account for other editor extensions and replacement.
7. **Do not expand by replacing the whole prompt as a workaround.**
   `setEditorText(getEditorText())` expands markers, but resets the cursor to the
   end and operates on the whole buffer (`editor.js:921–932`). Splitting into
   small pastes also introduces multiple undo units and per-chunk paste heuristics;
   it was not selected or tested as the product strategy.
8. **Asynchronous insertion needs a render request.**
   `pasteToEditor()` itself does not request a render. Updating the extension
   status afterwards does (`interactive-mode.js:1772–1775`). Synthetic checks
   verify the actual bridge/status implementation with a stub renderer; physical
   screen repaint/terminal focus has not been exercised.
9. **Admit text as data, not terminal input.**
   The UI bridge interpolates payload into bracketed paste. Reject unexpected
   control bytes, especially ESC/paste delimiters, before delivery; do not pass
   arbitrary raw ASR diagnostics. The experimental admission check normalizes
   line endings/tabs, trims outer whitespace and rejects other C0/C1 controls.
   This is a tested proposal, not a production sanitizer. The chosen manual
   spacing policy does not add separators or rewrite existing prompt text.

### Synthetic validation

[editor.test.mjs](assets/phase-3-transcription-and-editor/editor.test.mjs) invokes
**the installed `InteractiveMode.prototype.createExtensionUIContext()` and actual
`CustomEditor` methods**, with a minimal fake owner/TUI and synthetic strings. It
never constructs a Pi session or renderer. **21/21 checks passed** on the final
source; see [editor.test.log](assets/phase-3-transcription-and-editor/editor.test.log).

Coverage: empty/start/middle/end insertion; intervening typing and cursor movement
before asynchronous completion; successive parts; Unicode; multiline normalization;
atomic and per-part undo; spacing; exact collapse boundaries; atomic marker
movement; the rejected whole-buffer expansion workaround; inline long insertion;
editor replacement redirecting the UI bridge; pending character-jump mode;
control-byte admission and render feedback.

An initial run had **two incorrect test hypotheses**, preserved in
`editor.test.initial.log`: left-arrow was assumed to enter a paste marker, and
pending character-jump was assumed to swallow bracketed paste. Actual behavior
was atomic marker movement and successful paste; corrected checks verify those
facts. These were not product defects and no installed source was changed.

## Existing transcription boundary and lifecycle evidence

Reuse the accepted E5, not a new ASR trial. Its worker stages stdout only after
exit 0, required Vulkan/full-model facts and nonblank output
(`assets/phase-2-audio-capture/e5/worker.py:409–427`). It reaps owned children and
deletes the WAV before emitting `transcript` then `finished` (`:431–467`). The
TypeScript consumer additionally waits for worker close, successful finish and
no cancel/fault/shutdown (`voice-trial.ts:266–286`). This boundary already carries
complete text; it needs a different destination, not another transcription library.
E5 is one-shot exploration code and must not be copied as a production extension.

Verified installed lifecycle facts:

- Orderly new/resume/fork teardown awaits shutdown handlers, then disposes the old
  session (`P/dist/core/agent-session-runtime.js:102–113`). Reload similarly shuts
  down/invalidate/reloads (`P/dist/core/agent-session.js:2998–3038`). This does not
  automatically terminate extension-owned processes or protect captured UI objects.
- Tree navigation is not necessarily runtime replacement (`agent-session.js:3298–3415`).
  Invalidate an operation on branch navigation too, not only a session-ID change.
- Ordinary prompts pass `input` before processing, but extension commands run
  earlier (`agent-session.js:1631–1684`); built-in commands also have earlier TUI
  handling (`interactive-mode.js:2501` onward). Same session + idle at delivery
  is **not** proof that the original draft was never submitted/reset.
- `pasteToEditor` resolves the **current** editor at the instant of invocation.
  It is not an editor identity check. `getEditorComponent()` returns a factory,
  not the active editor instance (`types.d.ts:176–177`). Tests demonstrate that
  replacing the owner editor redirects an already-created UI context's paste.
- Extension UI dialogs emit `ui_prompt_start/end` (`types.d.ts:806–820`), queued
  as microtasks (`runner.js:369–401`). They are not a universal synchronous focus
  or editor-replacement API. A custom modal can save/restore the editor's old text
  (`interactive-mode.js:2288` onward), overwriting an insertion made while open.
- External-editor handling also saves expanded text and later sets it back
  (`interactive-mode.js:3730–3746`). Inserting during it can be lost. Do not infer
  safety just because the main editor object still exists.
- `ctx.signal` belongs to the agent operation, may be undefined, and is not a
  dictation lifetime token. Use extension-owned cancellation/generation state.

These are source findings, **not an exercised production lifecycle controller**.
There is no claim that public paste alone detects every draft reset or focus change.

## Proposed lean end-to-end contract — not yet all confirmed

1. One operation ID/runtime generation owns capture → finalized private WAV →
   one batch CLI → staged text → cleanup → delivery. Preserve the accepted full
   large-v3/Vulkan stack and explicit stop; no streaming, VAD or duration cap.
2. Keep the proven one-CLI-per-recording baseline. Do not add a persistent model
   service or repeat a latency campaign without a concrete requirement.
3. Single-flight: reject another start while capture/ASR/cleanup is busy, without
   queueing or opening the microphone. A new part is allowed after settlement.
   Cancel affects only the in-flight part, never earlier text already inserted.
4. Stop finalizes and transcribes; cancel invalidates delivery immediately, then
   terminates/reaps owned children and deletes owned audio. Repeat controls and
   callbacks settle once; late/duplicate results cannot insert twice.
5. Empty/failed/canceled/invalid-control results insert nothing and show a bounded
   non-sensitive status. Do not automatically retry, switch model/backend or
   retain transcripts in exploration logs/session entries.
6. At eligible delivery, insert synchronously at the **current** cursor, with no
   await between final validity checks and mutation; preserve current draft text.
   Use the selected native `ctx.ui.pasteToEditor()` without a custom editor or
   automatic separator spaces; native collapse/normalization rules remain intact.
   Update status afterwards to request rendering. Never call `sendUserMessage`,
   trigger-turn messages, shell execution or input submit to deliver the text.
7. Session replacement/reload/shutdown/tree navigation invalidates pending work
   before cleanup awaits. Use owned tokens, not a captured context or only idle
   state. Cleanup remains idempotent and awaited on orderly shutdown.
8. A user submitting/clearing/replacing the draft while ASR runs must not cause
   late insertion into a new draft. Recommended policy: the user's action wins;
   invalidate/cancel the pending part without blocking their submission. With
   native paste selected, validate detection limits rather than assuming owned
   custom-editor hooks are available.
9. Dialog/external-editor activity should defer insertion until safe or invalidate
   it; never paste into a hidden buffer and assume later restoration preserves it.
   If eligibility cannot be established, retain only a same-session in-memory
   pending result for explicit acceptance or discard, not blind automatic insertion.
   No cross-session migration or persisted dictation queue is proposed.

## Confirmed editor decisions and remaining validation

### A. Long-text review — native paste selected

Use `ctx.ui.pasteToEditor()`, accepting Pi's large-paste markers above its native
thresholds. Full inline visibility is not an initial requirement. The existing
external editor can receive expanded content for review, but none was launched
in this study. Do not automatically launch one or change its configuration.

The alternative owned `CustomEditor`/`insertTextAtCursor()` was validated only at
the component level and **was not selected**. Do not introduce it as a side effect
of lifecycle work or bypass native collapse by splitting/replacing the buffer.

### B. Whitespace — manual review selected

Leave separator spaces and punctuation corrections to the user. Add no automatic
Pi Voice spacing or text-rewriting layer. Native paste's line-ending/tab
normalization and path-prefix spacing heuristic remain part of the chosen API;
“manual review” does not mean overriding Pi's built-in paste behavior.

### Additional validation — premature here; deferred to post-implementation use

The requester explicitly chose to perform the remaining validations during their
usage after implementation. No extra pre-implementation suite or isolated Pi
trial is required to close this exploration's feasibility assessment or the
implementation plan. Preserve the following as **deferred/unverified**, not passed:

- Draft invalidation after ordinary/queued submission, slash/built-in commands,
  clear, history replacement, external editor, dialogs, editor replacement,
  branch/session replacement, reload and shutdown.
- Single-flight behavior, failed/empty/canceled/duplicate/late results and
  successive independently completed operations in the integrated extension.
- Actual terminal rendering/focus and any otherwise proposed isolated synthetic
  Pi trial. The existing component checks do not establish physical UI behavior.

The intended safeguards against stale insertion, unwanted submission and failed
cleanup remain implementation requirements/recommendations above; deferring their
validation does not remove them or establish production safety. Address concrete
failures discovered during use with targeted follow-up rather than reopening the
accepted capture/model feasibility work.

This decision authorizes no implementation, new microphone/inference run, service
access or reuse of the spent E2/E5 grants. Future implementation and any assistant-
executed live trial still require their own applicable authorization.

## Exploration outcome and plan readiness checklist

- [x] Public API and installed editor can insert without submitting.
- [x] Current-cursor delivery is simpler than maintaining an old edit anchor.
- [x] Prefix/suffix, intervening typing, Unicode, multiline and successive parts
  work in synthetic component tests; each part is independently undoable.
- [x] Long-paste review limitation and inline alternative identified and tested.
- [x] Requester selected native paste, accepting large-paste markers, and manual
  spacing review; no custom editor or additional smart-spacing layer.
- [x] Requester classified the additional lifecycle/UI validations as premature
  for this exploration and deferred them to usage after implementation. No such
  validation remains a pre-implementation plan-closing gate; none is marked passed.
- [x] Requester explicitly closed this exploration and requested a local commit;
  no additional technical exploration is required by the deferred items.
- [ ] Implementation is separately authorized before production changes.
  Capture/model feasibility is already accepted, not reopened.

## Session closeout and next-session handoff

- Feasible delivery path: accept complete local batch transcription text, then
  native `ctx.ui.pasteToEditor()` at the current delivery-time cursor. Preserve
  live prefix/suffix and manual submission; support successive completed parts.
- Accept native large-paste markers and leave spacing corrections to the user.
  Do not introduce a custom editor, chunking workaround or automatic submission.
- Source/component evidence: 21/21 synthetic checks passed, including a closeout
  repeat in `assets/phase-3-transcription-and-editor/closeout-tests.log`.
  Documentation links, Markdown fences and staged whitespace were checked.
- Deferred/unverified: integrated cancellation, stale results, draft/editor/session
  changes, concurrency/cleanup and physical rendering/focus. These are explicitly
  not additional exploration or plan-closing gates; retain the safeguards as
  implementation requirements/recommendations and validate during later usage.
- Commit scope: this phase record, exploration index and synthetic supporting
  assets only. No speech/audio, credentials, disposable Pi profile, settings,
  production code, package or external-repository change is included. No push.
- Resume from this record and the index. `NEXT-PHASE-HANDOFF.md` is the historical
  phase-2-to-3 handoff; its invitation to begin this study is now superseded.
- Any next production work requires an explicitly selected Implementation session
  with a direct request or selected task. This closeout neither creates Wyrd work
  nor authorizes implementation or fresh microphone/inference/service operations.
