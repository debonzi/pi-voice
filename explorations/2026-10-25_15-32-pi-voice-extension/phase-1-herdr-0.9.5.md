# Phase 1 — Release delivered through updated Herdr 0.9.5

## Status and scope

**The required Herdr terminal path now delivers a recognized Ctrl+Q release in the recorded test.** This supersedes the 0.7.5 blocker as a description of the current tested environment. The [0.7.5 source finding](phase-1-herdr-0.7.5.md) remains valid historical evidence, not a limitation to attribute to 0.9.5.

The requester reported updating and restarting Herdr, then executed the existing Python probe inside the updated Herdr as instructed. The assistant did not install/update software or restart Herdr. The earlier explicitly authorized WezTerm `enable_kitty_keyboard = true` configuration remains in place.

The child probe validates host → Herdr → child-terminal delivery plus Pi parser acceptance. The requester subsequently completed the Pi diagnostic below and reported **`press=49 repeat=0 release=1 held=no`**, confirming basic physical dispatch to the extension listener in the intended environment. No audio capture, transcription, recorder, or production extension was implemented.

## Evidence

- User-executed report: [assets/ctrl-q-protocol-2026-10-25_18-59-45-650504.json](assets/ctrl-q-protocol-2026-10-25_18-59-45-650504.json).
- Read-only local `herdr --version`: **`herdr 0.9.5`**.
- Independent recorded-byte parsing: [assets/ctrl-q-herdr-0.9.5-result-analysis.log](assets/ctrl-q-herdr-0.9.5-result-analysis.log).

| Field | Observation |
| --- | --- |
| Reported terminal environment | `herdr` / `0.9.5` |
| Requested/reported Kitty flags | 7 / `[7]` |
| Device-attributes replies | 1 |
| Q press sequence | `ESC[113;5u`, 55 occurrences |
| Explicit Q repeat sequence | None |
| **Q release sequence** | **`ESC[113;5:3u`, 1 occurrence** |
| Modifier mask | 4 (Ctrl) |
| Interrupted | No |

The installed Pi 1.4.0 key parser recognizes both recorded sequences as Ctrl+Q and identifies the second as a release. The report is a physical user-run observation, not the earlier synthetic PTY smoke test. No Herdr private service/socket/runtime query was performed; version evidence comes from the local executable, report environment, and user update/restart statement.

## Conclusions and limits

1. **Hold-to-record/release-to-stop is feasible for the intended Herdr environment under the tested setup:** release-capable outer WezTerm with Kitty enabled and Herdr 0.9.5 forwarding the event.
2. The earlier observed missing release is no longer reproduced in this updated path. No exact claim is made about the first release that fixed forwarding or that 0.9.5 is the minimum required version.
3. Repeated physical holding still produces ordinary press events, not necessarily separately tagged repeats. A recording controller must start only once while idle and ignore additional presses while active; `isKeyRepeat()` filtering alone is insufficient.
4. Keep explicit stop/cancel and lifecycle cleanup for lost releases/focus changes. Only the instructed Q-before-Ctrl release order was tested; arbitrary modifier order and focus-loss behavior are not established.
5. The report records recognized Q events, not timing/focus traces. It does not independently distinguish immediate physical Q-up from every possible focus-cleanup mechanism; the user was instructed to maintain focus during the trial.
6. The Python child probe alone did not validate Pi-extension dispatch. The subsequently completed Pi diagnostic confirms that boundary for the basic gesture, but neither test validates recording/transcription behavior.

## Physical keyboard-only Pi check — basic flow passed

Unlike the deprioritized native-only Pi test, this check runs in the actual supported path: **WezTerm → Herdr 0.9.5 → Pi → extension raw-input listener**.

In a normal shell of a Herdr pane, from repository root (not via Pi `!`/`!!`), run the already prepared isolated diagnostic:

```bash
bash explorations/2026-10-25_15-32-pi-voice-extension/assets/run-ctrl-q-probe.sh
```

It starts the keyboard-only Pi probe with separate configuration/state, offline mode, other extensions/MCP/tools disabled, and no microphone. Hold Ctrl+Q for about three seconds and release Q before Ctrl, maintaining focus. Expected: `release` increases and `held=no` after release. Ordinary press count may increase due to auto-repeat. Report the widget counters; `/quit` ends only the diagnostic instance.

The requester supplied this output after running the diagnostic:

```text
Ctrl+Q probe: ARMED | press=49 repeat=0 release=1 held=no
```

Provenance: user-reported widget output from the instructed Pi diagnostic, not a saved raw terminal trace. Unlike the earlier synthetic checks, this is a physical basic-flow observation in **WezTerm with Kitty enabled → Herdr 0.9.5 → Pi → `ctx.ui.onTerminalInput`**.

The listener counted one release and cleared its held latch. Auto-repeat again appeared as ordinary press events. No recorder, microphone, Whisper invocation, or prompt insertion was involved. Arbitrary modifier-release order, focus changes, concurrent editor work, and fallback behavior were not covered by this successful basic trial.

## Handoff

The basic phase-1 feasibility and end-to-end keyboard/API check have passed in the intended environment. No more basic repeats of the same gesture are needed. Final shortcut confirmation, fallback UX, release-order/focus contract, and implementation remain separate decisions; record these limits rather than claiming broad robustness.

The requester subsequently closed phase 1 as a feasibility exploration and chose to resume phase-2 audio capture in a new clean-context session. Start that session from [HANDOFF.md](HANDOFF.md); deferred UX/robustness limits remain recorded. Phase 2 has not started here, and the successful diagnostic does not authorize implementation or further software/settings changes.
