# Phase 1 — Keyboard activation

## Status and scope

**Basic physical end-to-end hold/release is now verified in Pi inside Herdr 0.9.5 with outer Kitty enabled.** The initial Herdr-window trials recognized presses but no releases; a subsequent standalone native WezTerm trial with Kitty temporarily enabled delivered one Q release that Pi's parser recognizes. See the [protocol result](phase-1-protocol-diagnosis.md) and [initial Pi diagnostic record](phase-1-ctrl-q-test.md). No final binding or interaction mode has been selected.

Follow-up: [candidate availability comparison](phase-1-binding-candidates.md) examines local configuration/resolved bindings beyond this initial pass. It recommends **Ctrl+Q on the current Linux setup** for a physical diagnostic; Ctrl+R has contextual conflicts, Ctrl+T conflicts in Pi, and Ctrl+Shift+T conflicts in WezTerm. The requester subsequently selected Ctrl+Q for the experiment; see the [prepared isolated diagnostic](phase-1-ctrl-q-test.md). The first physical report showed `press=59 repeat=0 release=0 held=yes`; the requester confirmed Q was released before Ctrl before the snapshot. See the [protocol follow-up](phase-1-protocol-diagnosis.md) for pinned-version findings and the next bounded test.

Investigate hold-to-record/release-to-stop and explicit start/stop alternatives using the installed Pi extension APIs. No microphone was opened, recorder or transcription process started, extension loaded, package installed, or Pi/terminal configuration changed. All generated files are confined to this exploration. Real-time transcription and automatic end-of-speech detection remain explicitly unwanted.

## Environment and evidence boundary

Verified locally on 2026-10-25:

| Item | Observation |
| --- | --- |
| Pi coding agent | `@earendil-works/pi-coding-agent` 1.4.0 |
| Pi terminal UI | `@earendil-works/pi-tui` 1.4.0 |
| Node.js used for assertions | v24.16.0 |
| Inherited terminal environment | `TERM_PROGRAM=WezTerm`, `TERM=xterm-256color`, `COLORTERM=truecolor` |
| Available WezTerm CLI | `wezterm 20240203-110809-5046fc22` |

Environment variables and the available CLI do not prove which protocol the active terminal session negotiated. In the initial pass, effective terminal/Pi keybinding overrides, desktop shortcuts, and any intermediary/multiplexer behavior were not audited. The [follow-up](phase-1-binding-candidates.md) adds local configuration inspection and resolved assignment evidence, but no live-runtime or physical-event validation. No physical key events were captured.

Installed source roots used below:

- `AGENT=/home/debonzi/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-coding-agent`
- `TUI=/home/debonzi/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-tui`

Source fingerprints: [assets/phase-1-installed-sources.sha256](assets/phase-1-installed-sources.sha256). Recheck these references after Pi updates. Public upstream evidence/excerpts: [assets/phase-1-public-sources.md](assets/phase-1-public-sources.md).

## Verified findings

### 1. Hold/release is feasible at the Pi API level

The public `ctx.ui.onTerminalInput(handler)` API supplies raw terminal input in interactive mode and returns an unsubscribe function. The handler may consume an event with `{ consume: true }`, transform its data, or return `undefined` to leave it alone.

Evidence:

- `AGENT/dist/core/extensions/types.d.ts:53-57,81-82`: listener signature and public API.
- `AGENT/dist/modes/interactive/interactive-mode.js:2015-2032,2057`: listener registration, cleanup/rebinding, and UI exposure.
- `TUI/dist/tui.js:709-736,775-780`: input listeners execute **before** the normal focused-component release filter.
- `TUI/dist/index.js:29`: public exports include `matchesKey`, `parseKey`, `isKeyRelease`, and `isKeyRepeat`.

A raw listener can therefore observe press/repeat/release without replacing the editor, **provided those events reach Pi from the terminal**. This is terminal-focused input, not a system-wide/global keyboard shortcut.

Some terminal responses are consumed upstream, and earlier input listeners may consume or transform data. The API is not an unfiltered OS keyboard-event stream.

### 2. Ordinary registered shortcuts alone are insufficient for hold/release

`pi.registerShortcut()` invokes `handler(ctx)` with no raw key data or event-type parameter. Pi's ordinary shortcut matching does not distinguish press from repeat or release. The default editor receives presses/repeats, but the TUI filters releases before forwarding to a focused component unless that component explicitly opts in.

Evidence:

- `AGENT/dist/core/extensions/types.d.ts:1233-1236`: shortcut handler takes context only.
- `AGENT/dist/modes/interactive/interactive-mode.js:1754-1767`: `matchesKey()` dispatch, asynchronous handler invocation, no repeat suppression.
- `AGENT/dist/modes/interactive/components/custom-editor.js:62-66`: extension shortcuts dispatch through editor input.
- `TUI/dist/tui.d.ts:75-83`: component `wantsKeyRelease` opt-in.
- `AGENT/examples/extensions/space-invaders.ts:127-128,320-363`: a shipped example opts in and handles release separately.
- `AGENT/examples/extensions/preset.ts:352-357`: ordinary registered-shortcut example.

A custom component/editor with `wantsKeyRelease = true` is an alternative, but replacing the main editor solely for this is more intrusive than a raw listener. Ordinary shortcut handlers also depend on editor focus; do not assume they receive events while a dialog owns focus.

### 3. Pi already requests Kitty release reporting

Pi requests Kitty progressive enhancement flags **7 = 1 + 2 + 4**:

- `1`: disambiguate escape codes.
- `2`: report press/repeat/release types.
- `4`: report alternate keys.

If Kitty is unavailable, the installed terminal implementation falls back to xterm modifyOtherKeys level 2. That can improve modifier/chord distinction but does **not** provide key-release events.

Evidence: `TUI/dist/terminal.js:12-15,184-239`; public [Kitty protocol](https://sw.kovidgoyal.net/kitty/keyboard-protocol/) and [WezTerm encoding](https://wezterm.org/config/key-encoding.html).

**Capability caution:** Pi marks Kitty active for any nonzero reported flags (`terminal.js:224-239`). `isKittyProtocolActive()` alone therefore does not prove that event-type flag `2` is active or that the complete terminal path delivers releases. Do not enable reliable hold mode based only on that boolean or `$TERM`.

### 4. Key identity and event type must be handled separately

Synthetic Kitty examples for `Ctrl+Shift+R`:

| Event | Sequence notation |
| --- | --- |
| Press | `ESC[114;6:1u` |
| Repeat | `ESC[114;6:2u` |
| Release | `ESC[114;6:3u` |

All three match `matchesKey(data, "ctrl+shift+r")`, and all parse to the same key identity. Inspect `isKeyRelease(data)` / `isKeyRepeat(data)` independently; matching the shortcut is not enough to decide whether recording should start or stop.

Evidence: `TUI/dist/keys.js:373-485,490-504,1029-1034` and the synthetic assertions below.

### 5. `Ctrl+Shift+R` is not a portable, conflict-free choice

Two independent concerns:

1. **Legacy encoding:** Ctrl+R is byte `0x12`, with no Shift distinction. Pi does not treat that byte as Ctrl+Shift+R. modifyOtherKeys or Kitty can distinguish the chord, but only a release-capable protocol supports true hold/release. Evidence: `TUI/dist/keys.js:531-547,943-952`.
2. **WezTerm default conflict:** upstream lists `CTRL+SHIFT` + `R` as `ReloadConfiguration`. Terminal-owned mappings are processed before input is encoded for the application. Under that default mapping, Pi never receives the intended activation. Evidence: [WezTerm default keys](https://wezterm.org/config/default-keys.html) and [keyboard encoding](https://wezterm.org/config/key-encoding.html).

No default Ctrl+Shift+R assignment was found in Pi's inspected keybinding tables. Pi does use Ctrl+R for session-selector rename (`AGENT/dist/core/keybindings.js:94-97`), which is another reason not to silently alias the two chords.

WezTerm documents `enable_kitty_keyboard = true` as the option allowing application Kitty requests. Its effective value and the user's effective Ctrl+Shift+R mapping were **not verified or changed**. There is no basis yet to say that the current terminal delivers the required events.

### 6. Repeat, release order, focus, and cleanup matter

Verified API implications and resulting **proposals**, not an implemented contract:

- Ignore Kitty repeat events for activation. Ordinary shortcuts do not suppress repeats automatically.
- With separate start/stop actions, make both idempotent: start while starting/recording must not spawn a second recorder; stop while idle/stopping must not duplicate finalization/transcription.
- If modifiers are released before R, a delivered R-release event may have different modifier bits and no longer match `Ctrl+Shift+R`. Latch the activation key and recognize its release independently of the original modifiers **if the event arrives**.
- Pi requests flags `7`, not the all-keys flag `8`. Complete standalone modifier tracking and unmodified-key release behavior cannot be presumed. Stopping on release of **any chord member** is not established by this investigation. Initial physical validation should release R while Ctrl/Shift remain held, then separately test other release orders.
- A raw listener runs before focused-component dispatch, so it can intercept input even during dialogs. This is useful for emergency stop but means focus/arming behavior needs an explicit policy; do not assume “editor-only” scope.
- Raw input consumption bypasses ordinary registered-shortcut conflict protections. Consume only owned events and preserve unrelated controls.
- Registered-shortcut conflict checking skips reserved editor-global bindings, warns for nonreserved built-in conflicts, and lets later extension collisions win. Evidence: `AGENT/dist/core/extensions/runner.js:7-49,449-477`.
- Install session-bound listeners from an appropriate lifecycle hook, not by starting recording resources in the extension factory. Unsubscribe and release recording resources idempotently on session shutdown/replacement/reload. This follows `AGENT/docs/extensions.md` lifecycle guidance.
- Always provide an explicit stop/cancel path and visible recording state. A lost release or focus change must not leave the user unable to stop recording.
- A timeout based on gaps between keyboard repeats is **not reliable release detection**. It is not recommended as a substitute for true hold/release.

## Alternatives and trade-offs

| Option | Feasibility and advantages | Limitations |
| --- | --- | --- |
| Hold shortcut; release recording key to stop | Best fit for the preferred interaction; public raw-input API is sufficient at Pi level | Requires verified terminal release delivery, an available chord, repeat/release-order handling, and explicit stop/cancel fallback |
| Separate start and stop shortcuts | Most robust fallback; can use `registerShortcut`; idempotent actions tolerate repeats | Two bindings; chord availability still needs checking; ordinary shortcuts follow editor focus |
| Same-key toggle | One binding, simple interaction | Holding the shortcut can toggle repeatedly; Kitty repeats can be filtered via raw input, but legacy autorepeat is indistinguishable from additional presses; debounce alone is not a complete solution |
| Custom editor/component with release opt-in | Existing supported TUI mechanism and example | Additional focus/UI ownership and compatibility cost; unnecessary just to observe raw releases |

**Recommendation, not a selected implementation:** retain hold/release as the preferred candidate, gated by an actual terminal check. Use separate, explicit start/stop as the compatibility fallback. Do not choose Ctrl+Shift+R unchanged without resolving its terminal conflict. Do not introduce OS-level/global keyboard hooks or modify terminal protocol flags as an unreviewed workaround.

## Reproducible validation

Artifacts:

- [assets/phase-1-key-events.mjs](assets/phase-1-key-events.mjs): isolated assertions importing the installed keyboard and dispatch implementation; no production extension.
- [assets/phase-1-key-events.log](assets/phase-1-key-events.log): execution output.

From repository root:

```bash
node explorations/2026-10-25_15-32-pi-voice-extension/assets/phase-1-key-events.mjs \
  /home/debonzi/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-tui
```

Result: **11/11 assertion groups passed**, covering event identity/types, legacy ambiguity, modifyOtherKeys, modifier-loss identity, bracketed-paste exclusion, split/batched sequence reconstruction, raw-listener ordering, component release opt-in, consumption, and negotiation flag parsing.

These tests use synthetic events and an isolated TUI dispatch harness. They do not open stdin/TTY, negotiate with a live terminal, capture audio, test actual keyboard delivery, or exercise a real recorder. The dispatch harness calls an implementation method directly for evidence; it is not a proposed production extension API. Passing synthetic parsing/dispatch tests is not end-to-end push-to-talk validation.

## Remaining interactive validation and decisions

The [Ctrl+Q diagnostic](phase-1-ctrl-q-test.md) now observes only candidate recording-key events, shows press/repeat/release status, and avoids logging arbitrary editor text. Its code/results remain in this exploration and it loads explicitly only for the test, not through auto-discovery. It passed a synthetic factory harness and a real-Pi synthetic PTY startup/injection check. The user subsequently reported recognized physical Ctrl+Q presses but no recognized repeat/release events; see the diagnostic record for provenance and limits.

Before treating hold/release as validated:

1. Confirm whether the user wants a different chord or wants to consider releasing the WezTerm default Ctrl+Shift+R mapping. Any settings change needs explicit authorization.
2. Confirm the effective Kitty/event-reporting capability without changing settings as a hidden side effect. If release reporting is disabled, discuss the exact proposed setting change first.
3. Observe one press, a long hold with repeats, and R release with modifiers still held. Recording must not be involved in this keyboard-only test.
4. Test modifier-first release orders, rapid presses, pasted text containing escape-like content, dialog/focus changes, and terminal focus loss. Record what actually arrives; do not infer missing events.
5. Verify explicit stop/cancel remains usable when release is absent or focus changes. Select exact fallback bindings only after checking both terminal and Pi mappings.
6. Confirm whether “release” means R release or release of any chord member. The latter may materially change protocol/implementation scope.

## Conclusions and handoff

**Established:** Pi 1.4.0 has a public raw-input path suitable for hold/release, requests Kitty event reporting, and exposes event-type helpers. `registerShortcut()` alone cannot express separate press/release behavior. Synthetic API/dispatch assertions pass. Ctrl+Shift+R has a documented WezTerm default conflict.

**Subsequently established:** a physical standalone trial in native WezTerm with a temporary Kitty override delivered one Q release, and Pi's parser recognizes the physical press/release encodings as Ctrl+Q. See the [protocol record](phase-1-protocol-diagnosis.md).

**Historical target limitation:** official Herdr 0.7.5 consumes key releases in application routing before pane forwarding. See the [exact-version evidence](phase-1-herdr-0.7.5.md). The requester subsequently updated/restarted Herdr themselves.

**Current target delivery established:** the [Herdr 0.9.5 physical child probe](phase-1-herdr-0.9.5.md) records 55 Ctrl+Q presses and one Q release. Pi's parser independently accepts both observed encodings. The requester then ran the Pi diagnostic inside updated Herdr and reported **`press=49 repeat=0 release=1 held=no`**, validating basic physical extension-listener dispatch end to end.

**Not established:** all release orders/focus changes, final shortcut/fallback, or recorder/transcription integration. This does not establish the first fixed Herdr version. Further native-only Pi trials are not the primary target.

**Phase-1 basic feasibility result:** hold/release is verified for the tested gesture in Pi inside Herdr 0.9.5 with outer Kitty enabled. No further identical basic test is needed. Final binding/fallback behavior and additional robustness cases remain open.

**Closeout:** the requester closed this session as phase-1 feasibility complete and will explore phase-2 audio capture in a new clean-context session. Use [HANDOFF.md](HANDOFF.md) rather than reloading the chronological investigation. Additional installation/update, Herdr patching, recorder implementation, and automatic phase transition are not authorized by the successful diagnostic.

**Phase 2 handoff, when requested:** audio capture must accept explicit activation/stop/cancel events, reject duplicate starts/stops, handle stop during startup, expose readiness/recording/finalizing state, and clean up even if no key release arrives. It must not use silence to terminate capture or start live transcription. No phase 2 investigation has been started.
