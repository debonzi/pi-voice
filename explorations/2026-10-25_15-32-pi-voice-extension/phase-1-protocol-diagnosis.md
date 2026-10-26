# Phase 1 — Missing Ctrl+Q release: protocol diagnosis

**Latest result:** after the requester updated/restarted Herdr, the [0.9.5 child probe](phase-1-herdr-0.9.5.md) delivered one Ctrl+Q release through the required Herdr path, accepted by Pi's parser. The [0.7.5 routing blocker](phase-1-herdr-0.7.5.md) below is historical and does not describe the updated tested environment. The subsequent physical Pi listener diagnostic reported `press=49 repeat=0 release=1 held=no`, completing basic end-to-end keyboard validation in the intended environment. Further identical/native-only tests are not needed for that feasibility question; UX/robustness decisions remain open.

## Status and confirmed observation

The requester confirmed that the previously reported `press=59 repeat=0 release=0 held=yes` snapshot was taken after Q had been released before Ctrl. The first physical trial therefore failed to deliver a release recognized by the Pi diagnostic. This is a confirmed user report, not an independently captured raw-event trace.

The exact protocol reply and raw Q bytes from that initial Pi trial were not recorded. A later standalone physical report, analyzed below, now captures a numeric acknowledgment and Q encodings on the main-screen terminal path.

## Version-specific source findings

The available CLI and inherited `TERM_PROGRAM_VERSION` both identify WezTerm `20240203-110809-5046fc22`. That public release resolves to commit `5046fc225992db6ba2ef8812743fadfdfe4b184a`. Public source review used `gh-axi` and pinned raw-source fetches; no private services were accessed.

### Release support exists; repeat differentiation does not

In this exact release, [the GUI Kitty encoder](https://github.com/wez/wezterm/blob/5046fc225992db6ba2ef8812743fadfdfe4b184a/wezterm-input-types/src/lib.rs#L1638-L1693) does the following:

```rust
if !flags.contains(KittyKeyboardFlags::REPORT_EVENT_TYPES) && !self.key_is_down {
    return String::new();
}
```

And:

```rust
let event_type =
    if flags.contains(KittyKeyboardFlags::REPORT_EVENT_TYPES) && !self.key_is_down {
        ":3"
    } else {
        ""
    };
```

Consequences:

- Key-up can produce Kitty release event type 3 when flag 2 is active.
- Key-down omits event type, which means press. There is no event-type-2 branch in this encoder, so auto-repeat can remain a succession of presses.
- The source includes a [key-up regression test](https://github.com/wez/wezterm/blob/5046fc225992db6ba2ef8812743fadfdfe4b184a/wezterm-input-types/src/lib.rs#L2220-L2252) expecting `ESC[111;1:3u` with flags 1|2.
- The [GUI dispatch](https://github.com/wez/wezterm/blob/5046fc225992db6ba2ef8812743fadfdfe4b184a/wezterm-gui/src/termwindow/keyevent.rs#L200-L209) calls this encoder when Kitty configuration/encoding is active. A separate fallback encoder discarding key-up does not prove that the GUI Kitty path discards it.

Therefore **`repeat=0` is compatible with this release's implementation, but its general lack of release support is not an explanation for `release=0`**. This is source-level evidence, not a build/run of upstream WezTerm or proof of the active terminal path.

### Default configuration and protocol reporting

The [pinned option documentation](https://github.com/wez/wezterm/blob/5046fc225992db6ba2ef8812743fadfdfe4b184a/docs/config/lua/config/enable_kitty_keyboard.md) explicitly says `enable_kitty_keyboard = false`. The local config file inspected earlier contains no assignment of this option. This establishes an upstream default and a static file observation, **not** the running GUI's effective value.

The [pinned terminal handler](https://github.com/wez/wezterm/blob/5046fc225992db6ba2ef8812743fadfdfe4b184a/term/src/terminalstate/performer.rs#L506-L554):

- Honors set/push requests only when the option is enabled.
- Replies to a Kitty query only when the option is enabled.
- Returns current keyboard-stack flags, not an independently validated implementation-capability mask.

The [flags parser](https://github.com/wez/wezterm/blob/5046fc225992db6ba2ef8812743fadfdfe4b184a/termwiz/src/escape/csi.rs#L1772-L1814) preserves defined flag bits using `from_bits_truncate`; the defined bits include 1, 2, 4, 8, and 16. Acknowledging bit 2 does not establish full repeat/release fidelity: this release can acknowledge it without differentiating repeats.

Pi 1.4.0 requests flags 7 and treats any nonzero returned flags as Kitty active (`pi-tui/dist/terminal.js:12-15,224-239`). Thus the Pi boolean does not reveal the returned numeric flags.

The observed positive indicator and the pinned default-disabled behavior are not reconciled yet. The version of a CLI/inherited environment is not proof of the actual terminal GUI, effective runtime configuration, or intermediary behavior. No terminal service/daemon was contacted to inspect those layers.

## Standalone raw protocol/Q probe

A direct terminal test can distinguish numeric flag acknowledgments and actual Q-event encodings without modifying Pi or persistent settings. It is a new bounded experiment, **not a replay/capture of the existing Pi process's negotiation**.

Assets:

- [assets/ctrl-q-protocol.py](assets/ctrl-q-protocol.py)
- [assets/ctrl-q-protocol.self-test.log](assets/ctrl-q-protocol.self-test.log)

### Run

In the separate test terminal, first leave the Pi diagnostic with `/quit`. From the repository root, run in the normal shell, **not via Pi `!`/`!!`**:

```bash
python3 explorations/2026-10-25_15-32-pi-voice-extension/assets/ctrl-q-protocol.py
```

1. Read the instructions and press Enter when ready.
2. Hold Ctrl+Q for approximately three seconds, release Q first, then Ctrl.
3. Do not type or paste anything else; the observation lasts ten seconds. Ctrl+C aborts.
4. The script restores modes, prints its report, and saves a timestamped `assets/ctrl-q-protocol-*.json` within this exploration. Tell the assistant when it is ready to read the report.

### Scope and safety

- Uses Python standard library only; no installation, network, private-service access, audio, inference, or subprocess execution.
- Temporarily switches the script's terminal into raw input and pushes Kitty flags 7 (`ESC[>7u`), queries them (`ESC[?u`), and sends a device-attributes sentinel (`ESC[c`), matching Pi's request sequence. Finally it pops the protocol stack and restores termios on normal exit, Ctrl+C, and handled SIGTERM.
- These are temporary terminal modes, not edits to terminal configuration files. As with any raw-mode program, an uncatchable kill or terminal destruction cannot be covered by normal cleanup.
- Records only numeric protocol replies, counts of device-attribute replies, and Q-related encodings/events. Other key data is discarded, and bracketed-paste contents are excluded. Do not type secrets during the diagnostic.
- The test uses the terminal's **main screen**. Pi's fullscreen mode can use a separate protocol stack, so a different outcome narrows the investigation but does not alone identify the cause.
- Existing Pi source, installed terminal, persistent settings, and the earlier diagnostic are unchanged by preparing this test.

### Validation completed

The script's `--self-test` passed checks for flags/DA replies, legacy repeated presses, split Kitty events, modifier changes, modifyOtherKeys, unrelated/paste exclusion, Ctrl+C parsing, and partial flags. Its non-TTY guard was also exercised and correctly refused execution without an interactive terminal. No physical trial of this standalone script has been performed by the assistant.

```bash
python3 explorations/2026-10-25_15-32-pi-voice-extension/assets/ctrl-q-protocol.py --self-test
```

### Interpreting the report

- No Kitty reply, but a DA reply: no Kitty acknowledgment observed for this path/request. Do not infer a specific setting or terminal identity from absence alone.
- Numeric flags omit bit 2: event types were not acknowledged, explaining why the Pi boolean alone is insufficient.
- Bit 2 acknowledged but no release bytes: missing terminal-side reporting remains a concern on this path; investigate effective terminal/layer behavior before suggesting changes.
- Recognized `:3` Q release bytes: release is emitted on this standalone path. Compare with Pi's fullscreen/dispatch path rather than assuming a universal lack of terminal support.

## Standalone physical result — 2026-10-25

**Terminal-path clarification:** the requester subsequently identified the test location as a terminal in a **Herdr window**, not a native WezTerm-window comparison. The observed behavior applies to that Herdr-window terminal path. The inherited WezTerm environment/version and available CLI do not establish which encoder that path actually uses. No Herdr implementation, runtime, service, or private state has been inspected; naming the application is not authorization to inspect its service.

After the requester said the test was ready, the assistant read [assets/ctrl-q-protocol-2026-10-25_16-55-01-551331.json](assets/ctrl-q-protocol-2026-10-25_16-55-01-551331.json). This is a user-executed main-screen terminal observation, not a synthetic PTY result.

| Field | Observed value |
| --- | --- |
| Requested flags | 7 |
| Reported flags | `[7]` |
| Event-type bit 2 acknowledged | Yes |
| Device-attributes replies | 1 |
| Interrupted | No |
| Recorded Q sequences | 58 copies of `ESC[113;5:1u` |
| Encoding/event | Kitty / explicit press type 1 |
| Modifier mask | 4 (Ctrl) |
| Recorded Q repeat/release sequences | None |

The recorded hex `1b5b3131333b353a3175` decodes to `ESC[113;5:1u`. Re-parsing it independently with the installed Pi TUI confirmed Ctrl+Q identity and `isKeyRepeat=false`, `isKeyRelease=false` for all 58 recorded events. Output: [assets/ctrl-q-protocol-result-analysis.log](assets/ctrl-q-protocol-result-analysis.log).

### Supported conclusions

- Ctrl+Q reaches the terminal application as Kitty-encoded input; these recorded inputs are **not legacy Ctrl+Q bytes**.
- This standalone path acknowledges all requested bits, including event reporting. The cause cannot be reduced to an acknowledgment missing bit 2 on this particular trial.
- No Q release was recorded even outside Pi. Pi's ordinary focused-editor release filtering alone therefore cannot explain the complete observed behavior.
- Hold/release is not usable as validated on the tested path. Explicit stop remains necessary.

### Limits and unresolved cause

- The probe deliberately discards unrelated/unknown sequences. It establishes absence of a **recognized Q-release sequence**, not the absence of every conceivable unrecognized input event.
- This is a separate main-screen trial, not a capture of the existing Pi process's negotiation or alternate-screen protocol stack.
- Environment variables still identify WezTerm, but they do not identify the actual GUI, intermediary, or encoder responsible for these bytes.
- The pinned upstream encoder reviewed above omits the event-type suffix for presses, whereas the observed path sends explicit `:1`. Both are valid Kitty press representations, but this difference cautions against equating inherited CLI/version markers with the exact unmodified upstream encoder in use. It does not identify a specific intermediary or prove a defect in one.
- No terminal service/private service, GUI live state, or external host was inspected to attribute the discrepancy. Persistent configurations remain unchanged.

## Native WezTerm baseline — 2026-10-25

The requester subsequently ran the same probe directly in WezTerm, outside the Herdr-window terminal. Report: [assets/ctrl-q-protocol-2026-10-25_17-01-26-372966.json](assets/ctrl-q-protocol-2026-10-25_17-01-26-372966.json).

| Field | Native baseline value |
| --- | --- |
| Requested flags | 7 |
| Reported flags | `[]` (no Kitty reply observed) |
| Device-attributes replies | 1 |
| Event-type bit acknowledged | No |
| Recorded Q events | 63 copies of hex `11` (`0x11`, legacy Ctrl+Q) |
| Interrupted | No |

This differs from the Herdr-window path: there, flags 7 were acknowledged and Q arrived as Kitty explicit presses; here, the terminal answered the device-attributes query but did not acknowledge Kitty and sent legacy control bytes.

**Interpretation:** the native baseline did not negotiate Kitty event reporting. That is consistent with the pinned WezTerm default `enable_kitty_keyboard = false` and absence of that option from the inspected config. It is not evidence that this WezTerm build lacks release support when Kitty is enabled. No persistent setting was changed for this baseline. The subsequent temporary Kitty-enabled physical test is recorded below.

## Temporary Kitty-enabled native instance — executed by requester

The installed `wezterm --help` documents `--config <name=value>` for process configuration overrides. `wezterm start --help` documents `--always-new-process` (do not reuse a GUI instance) and `--no-auto-connect` (do not auto-connect configured domains). Only these help commands were executed; no GUI was launched and no override was applied by the assistant.

The requester approved preparation of the temporary-instance command, then reported completion after executing it. The supplied command runs the same probe with Kitty enabled only for a new local instance:

```bash
wezterm --config enable_kitty_keyboard=true start \
  --always-new-process --no-auto-connect -- \
  python3 /home/debonzi/devel/repos/debonzi/pi-voice/explorations/2026-10-25_15-32-pi-voice-extension/assets/ctrl-q-protocol.py
```

This command edits no configuration file and is not an installation/update. It changes the option for the newly launched process only and avoids reusing an existing GUI. The probe writes its report inside this exploration; the test window may close when the script finishes. Approval of this experiment does not authorize persistent configuration changes.

## Kitty-enabled native physical result — 2026-10-25

Report: [assets/ctrl-q-protocol-2026-10-25_17-05-39-828611.json](assets/ctrl-q-protocol-2026-10-25_17-05-39-828611.json).

| Field | Observed value |
| --- | --- |
| Requested/reported flags | 7 / `[7]` |
| Device-attributes replies | 1 |
| Press events | 68 copies of `ESC[113;133u` |
| Repeat events | None explicitly differentiated |
| Release events | **1 copy of `ESC[113;133:3u`** |
| Modifier mask | 132 = Ctrl (4) + NumLock (128) |
| Interrupted | No |

Independent parsing with the installed Pi TUI confirmed that **both sequences match Ctrl+Q**; the lock modifier is ignored for shortcut identity, and the second sequence is recognized as a release. Evidence: [assets/ctrl-q-native-kitty-result-analysis.log](assets/ctrl-q-native-kitty-result-analysis.log).

**Conclusion:** the standalone native WezTerm path delivers a usable Q-release event when Kitty is enabled, and Pi's key parser accepts the observed physical encodings. This validates the terminal-delivery prerequisite for hold/release. It does not yet constitute a physical end-to-end Pi-extension trial in that native Kitty-enabled instance; the earlier extension harness/PTY checks remain synthetic.

**Implementation implication, still a proposal:** start only when idle, latch the key, and ignore subsequent presses while held. Filtering `isKeyRepeat()` alone is insufficient because this WezTerm version emits auto-repeat as ordinary presses. A recognized Q release should finalize once; explicit stop/cancel remains necessary for lost releases/focus changes. No audio behavior has been implemented.

## Next handoff

**Requester priority update:** the intended environment is Pi inside Herdr. The additional native-WezTerm Pi-extension trial is deprioritized; the successful native result is control evidence only. The [Herdr input-path investigation](phase-1-herdr-input.md) has now located and reviewed public source, pinned at commit `5608de0608918aba2f9d501e7793b984a0ca9cfa`. It supports separate host/pane negotiations and release forwarding conditional on receiving host releases. The next relevant proposal is an enabled-host → Herdr → probe trial; the installed Herdr version/path remains unverified. No Herdr service/runtime/private endpoint has been accessed.

The source-level and native terminal-delivery feasibility questions are answered positively, conditional on Kitty enablement. Remaining phase-1 decisions/checks: select the actual supported user-facing terminal path, decide final binding and fallback behavior, and optionally repeat the existing Pi diagnostic in the same temporary native Kitty-enabled configuration to complete the physical extension-dispatch check. Modifier-first release order and focus-loss handling remain untested physically.

The earlier missing release in the Herdr-window path remains a separate unresolved observation. Herdr's terminal encoder, protocol adaptation, and other layers remain possible causes, not verified ones. If investigating Herdr itself is preferred, obtain explicit authorization and scope (for example, public/local source review versus service/runtime access) before inspecting that additional target.

Alternatively, the requester can accept separate explicit start/stop for the tested Herdr-window environment while retaining hold mode as a capability conditional on a verified terminal path, such as the successful native Kitty-enabled trial. That behavior decision has not been made. Do not replace release detection with a timeout between repeats. Phase 2 remains not started.
