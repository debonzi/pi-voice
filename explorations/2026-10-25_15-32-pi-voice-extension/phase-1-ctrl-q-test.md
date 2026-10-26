# Phase 1 — Ctrl+Q physical diagnostic

## Status and authorization

The requester selected **Ctrl+Q for a keyboard-only experiment**, not as a final extension binding. The diagnostic is prepared and synthetic checks pass. **The first user-reported physical result recognized Ctrl+Q presses but no repeat/release events.** The requester subsequently confirmed that Q was released before Ctrl and before the snapshot. A later standalone trial acknowledged flags 7 but recorded only 58 Kitty press events; see the [protocol diagnosis and report](phase-1-protocol-diagnosis.md).

This experiment does not open a microphone, capture/transcribe audio, change terminal/Pi settings, install software, connect MCP servers, or contact a model. It is supporting validation code inside the exploration, not implementation of Pi Voice.

## Run in a separate terminal

From the `pi-voice` repository root:

```bash
bash explorations/2026-10-25_15-32-pi-voice-extension/assets/run-ctrl-q-probe.sh
```

Use a separate terminal pane/window rather than replacing the ongoing exploration conversation. The launcher starts a disposable Pi instance with:

- Offline mode; discovered/configured/built-in extensions disabled except the explicit diagnostic.
- MCP disabled and tools disabled.
- No persisted session, project resource approval, context files, skills, or prompt templates.
- An isolated agent/config/cache/temp directory under `assets/ctrl-q-runtime/`, leaving normal user configuration unchanged. Jiti disk caching and Node compile caching are disabled for the process.

A missing-model/auth warning is not a reason to log in: this experiment needs no model. The real-Pi synthetic startup check verified the widget starts with the isolated setup. Normal submitted text is handled locally by the diagnostic rather than forwarded to a model. Do not use login, shell, settings, or other unrelated commands during this keyboard test.

## First physical trial

The diagnostic arms automatically and displays a widget containing:

```text
Ctrl+Q probe: ARMED | press=0 repeat=0 release=0 held=no
```

1. Hold **Ctrl**, then press and hold **Q** for approximately three seconds.
2. **Release Q first**, while Ctrl remains pressed.
3. Release Ctrl.
4. Note the widget counters and its `Last` line, or run `/key-test result`.
5. Report those counters, the `Last` line, and `Kitty advertised: yes/no` back to the exploration session.

Expected if the event-reporting path works: at least one press, possibly repeat events, at least one release, and `held=no` after Q release. Do not assume the terminal must generate repeats.

If `release=0`, that is a useful negative result. It does not prove the extension cannot support hold/release; it means the tested input path did not produce a recognized release. **Do not change keyboard protocol settings as part of this first trial.**

`Kitty advertised: yes` is not proof that event-type/release reporting is functioning. Likewise, legacy auto-repeat can appear as multiple PRESS events, not REPEAT events. The diagnostic reports these observations rather than inventing a release from a timeout.

## Controls

- `/key-test result` (or `/key-test`): show current counters.
- `/key-test reset`: clear counters and re-arm for a separate trial.
- **Escape** or `/key-test stop`: stop interception manually. This clears the displayed held state but **does not increment the release counter**; manual disarm is not release evidence.
- `/quit`: exit the disposable Pi process. Ctrl+C twice with an empty editor is another normal Pi exit path.

Only Ctrl+Q events and a delivered Q release after activation affect the diagnostic. Unrelated keys and bracketed paste pass through without being logged. No raw keystroke/prompt log or physical-result file is written by the diagnostic; report the displayed summary manually. Runtime state is ignored by Git.

After the first trial, a separately reset trial can release Ctrl before Q to evaluate modifier-loss behavior. Focus changes and lost-release recovery are later phase-1 checks; success in the first trial does not establish those behaviors.

## Assets and validation

- [assets/ctrl-q-probe.ts](assets/ctrl-q-probe.ts): public `ctx.ui.onTerminalInput` listener and widget; no custom editor, audio process, network code, or filesystem writes.
- [assets/run-ctrl-q-probe.sh](assets/run-ctrl-q-probe.sh): isolated launcher.
- [assets/ctrl-q-probe.test.mjs](assets/ctrl-q-probe.test.mjs): diagnostic factory/UI harness using installed Pi key parsing, with Jiti filesystem caching disabled.
- [assets/ctrl-q-probe.test.log](assets/ctrl-q-probe.test.log): **10/10 synthetic checks passed** (registration/startup, event types, unrelated/pasted input, modifier changes, legacy behavior, manual disarm, commands, prompt guard, lifecycle cleanup).
- [assets/ctrl-q-probe.smoke.py](assets/ctrl-q-probe.smoke.py): real isolated Pi startup in a synthetic PTY, injection of a legacy Ctrl+Q and a Kitty-form release, and clean `/quit` shutdown.
- [assets/ctrl-q-probe.smoke.log](assets/ctrl-q-probe.smoke.log): **4/4 synthetic startup checks passed**. Its raw ANSI output stays in ignored `assets/ctrl-q-runtime/synthetic-startup.ansi.log`.

Reproduce automated checks from repository root:

```bash
node explorations/2026-10-25_15-32-pi-voice-extension/assets/ctrl-q-probe.test.mjs \
  /home/debonzi/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works
bash -n explorations/2026-10-25_15-32-pi-voice-extension/assets/run-ctrl-q-probe.sh
python3 explorations/2026-10-25_15-32-pi-voice-extension/assets/ctrl-q-probe.smoke.py
```

The smoke test does not operate the actual WezTerm keyboard path: it directly injects bytes into a local pseudo-terminal and simulates only a device-attributes reply. It must not be counted as physical release validation. It does not enable Kitty support in the user's terminal.

API/lifecycle/UI examples and CLI isolation flags were checked against the installed Pi 1.4.0 `docs/extensions.md`, `docs/tui.md`, `docs/cli.md`, `docs/environment-variables.md`, `examples/extensions/widget-placement.ts`, and `examples/extensions/input-transform.ts`.

## First user-reported physical result

The requester supplied this diagnostic output:

```text
Ctrl+Q probe: ARMED | press=59 repeat=0 release=0 held=yes
Last: PRESS Ctrl+Q (legacy auto-repeat may also appear as PRESS) | Kitty advertised: yes (not proof of release support)
```

Verified provenance: user-reported UI output, not a captured raw-event trace or an independently observed keyboard trial. The requester subsequently confirmed the preceding question: Q had already been released before Ctrl when the output was copied. Hold duration was not separately reported.

Interpretation:

- Ctrl+Q activation reaches the Pi listener and is recognized.
- During this observation the diagnostic counted 59 inputs as presses, zero as repeats, and zero as releases. This is compatible with auto-repeat delivered as repeated press events, but no raw sequence was captured to distinguish legacy bytes from Kitty-form press events.
- `held=yes` is the diagnostic's latched state, not an OS-level observation that the user still holds Q. It stays set until a recognized release or manual stop.
- `Kitty advertised: yes` did not establish working repeat/release reporting. Partial protocol support, negotiation/configuration, an intermediary, or another delivery limitation remain hypotheses, not an identified root cause.
- **Hold/release failed in this reported trial:** the requester confirmed Q had already been released, but the diagnostic never recognized that release.
- This result supports the usefulness of an explicit stop path. It does not prove true hold/release impossible in Pi or in every terminal configuration.

No configuration change or additional physical trial was performed by the assistant in response. Escape or `/key-test stop` can disarm the latch without being counted as release evidence.

## Next handoff

1. Confirmation is complete: Q was released before Ctrl before the snapshot.
2. [Version-specific protocol investigation](phase-1-protocol-diagnosis.md) found release support but no repeat differentiation in the pinned WezTerm GUI encoder. This can explain zero repeats, not zero releases by itself.
3. The requester completed the standalone protocol/Q probe: flags 7 were acknowledged, but only 58 `ESC[113;5:1u` press events were recorded. This main-screen experiment is distinct from the existing Pi process and shows missing recognized release also outside Pi. See the protocol follow-up for evidence and limits. Identify whether a native or embedded terminal path was tested before attributing the cause.
4. Retain explicit start/stop as the fallback; do not approximate key release from gaps in auto-repeat.

No phase-2 capture work is started by this experiment.
