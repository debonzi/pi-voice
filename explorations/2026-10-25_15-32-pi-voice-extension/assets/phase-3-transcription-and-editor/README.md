# Synthetic transcript-to-editor study

## Objective and boundaries

Validate delivery of completed synthetic transcription text into the installed
Pi 1.4.0 prompt editor, preserving existing content and manual submission.
Exploration only; no production extension installation or settings change.
The requester closed the study as sufficient feasibility and requested a local
commit; production implementation remains separately authorized.

`editor.test.mjs` imports installed local Pi/TUI modules and invokes actual UI
bridge and editor methods with a fake renderer/owner. It never constructs a Pi
session, opens a terminal, spawns a worker, contacts an audio service, reads speech
artifacts or runs inference. All strings are synthetic. Package imports are local;
no package acquisition is performed.

## Reproduce

From the repository root:

```sh
node --test explorations/2026-10-25_15-32-pi-voice-extension/assets/phase-3-transcription-and-editor/editor.test.mjs
```

Default module root:
`/home/debonzi/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works`.
Override `PI_TEST_MODULE_ROOT` only to point at an already installed local release;
recheck source/provenance before interpreting changed-version results. The suite
imports installed implementation files to exercise the actual bridge without
launching Pi. Such internal import paths are test instrumentation, **not proposed
production extension imports**.

## Findings and artifacts

- `editor.test.log`: final **21/21 passed** component/bridge checks.
- `closeout-tests.log`: closeout repeat, **21/21 passed**, no new live trial.
- `editor.test.initial.log`: initial 18/20; two incorrect test hypotheses were
  corrected, not Pi product defects. Marker movement is atomic, and bracketed
  paste still inserts when character-jump mode was pending. Four whitespace-only
  blank-line indentations in this text log were normalized at commit closeout;
  assertion content and results are unchanged.
- `source-provenance.log`: local date, Node/package versions and inspected-file
  SHA-256 hashes. No credentials, dictated text or audio.

Current-cursor insertion, existing-text preservation, successive parts, multiline
handling and undo work. Native paste collapses large text; direct insertion on an
owned `CustomEditor` does not. General separator spaces are not inserted by paste.
A status update after async paste requests rendering.

See [the phase record](../../phase-3-transcription-and-editor.md) for exact source
references, alternatives, confirmed native-paste/manual-spacing decisions and
validation deferred to post-implementation use at the requester's direction.
The tests do not prove physical rendering/focus, complete draft/session lifecycle
safety, or production recording/transcription concurrency. The requester considers
those additional checks premature for this exploration and will validate during
usage after implementation. They are unverified, not passed, and do not block
closing the implementation plan. No further trial is started or required here.
