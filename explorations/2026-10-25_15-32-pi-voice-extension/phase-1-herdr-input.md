# Phase 1 — Herdr terminal input investigation

**Current result:** the requester updated/restarted Herdr, and the [0.9.5 physical child probe](phase-1-herdr-0.9.5.md) delivered one Q release that Pi's parser accepts. The [0.7.5 release-routing blocker](phase-1-herdr-0.7.5.md) and current-master trace below are retained as historical investigation, not descriptions of the updated tested binary. The subsequent Pi diagnostic also passed the basic physical listener check (`press=49 repeat=0 release=1 held=no`).

## Objective and requester priority

The requester clarified that the intended operating environment is **Pi inside a terminal in a Herdr window**. Further native-WezTerm/Pi testing is not a priority unless it resolves uncertainty relevant to that path. The successful native Kitty-enabled trial is control evidence, not acceptance of a different user-facing environment.

Investigate, read-only, how the Herdr terminal path handles physical key-down/repeat/key-up events, Kitty negotiation, encoding, and forwarding to Pi. Do not modify Herdr, Pi, installed software, or persistent settings. Do not access a Herdr service/runtime, private endpoint, remote host, or private account without explicit authorization for that target/access. Supporting notes/experiments belong only in this exploration.

## Starting evidence

- [Herdr-window standalone report](assets/ctrl-q-protocol-2026-10-25_16-55-01-551331.json): flags 7 acknowledged, 58 explicit Kitty Ctrl+Q press events, no recognized Q release.
- [Initial Pi trial](phase-1-ctrl-q-test.md): Ctrl+Q activation recognized in the Herdr-window path; no recognized release after Q was released before Ctrl.
- [Native WezTerm control](assets/ctrl-q-protocol-2026-10-25_17-05-39-828611.json): temporary Kitty enablement produced one Q release accepted by the installed Pi key parser. This demonstrates a valid terminal-delivery/parser path, not that Herdr supports it.
- Full comparison, pinned WezTerm evidence, and limits: [phase-1-protocol-diagnosis.md](phase-1-protocol-diagnosis.md).

## Investigation questions

Questions guiding the public-source review and any later approved physical test:

1. Identify the Herdr revision/build and terminal component/dependency. Do not infer the actual component from inherited `TERM_PROGRAM` variables.
2. Trace key-down/repeat/key-up handling at the GUI/frontend boundary, including focus and shortcut handling. Does key-up enter the application at all?
3. Trace Kitty push/query state and advertised flags. Does acknowledgment of flag 2 reflect actual release/reporting behavior or merely stored requested bits?
4. Trace encoding and transport to the terminal's local PTY/input boundary. Is release dropped, encoded incorrectly, unimplemented, intercepted by a binding, or forwarded in an encoding the probe did not recognize?
5. Determine whether an existing supported option can enable delivery, or whether a Herdr change would be necessary. Distinguish verified behavior from hypotheses/proposals.
6. Evaluate Pi-extension-only options within this environment. Do not assume a raw listener can recover a release event that is absent upstream, and do not substitute keyboard-repeat timeouts for genuine release detection.
7. Report feasibility, evidence, minimal follow-up tests, and alternatives. Any implementation or settings change requires explicit approval.

## Source discovery and version scope

The requester has no local Herdr source checkout. Bounded local directory-name searches found only configuration directories; `/home/debonzi/.local/bin/herdr` is an installed ELF executable. It was subsequently queried only with `herdr --version`; no service/socket request was made.

Public research identified the official [herdrdev/herdr repository](https://github.com/herdrdev/herdr), linked to [herdr.dev](https://herdr.dev). Its public metadata declares default branch `master`; the branch resolved during this investigation to **`5608de0608918aba2f9d501e7793b984a0ca9cfa`**. Source claims below are pinned to that commit. Public GitHub research used `gh-axi`, and bounded source passages were fetched from public raw URLs. No checkout/clone, installation, or software update was performed.

The initial current-master review did not establish the installed version. Subsequent local version/hash checks identified official **0.7.5**, whose routing differs materially; see the exact-version record. This current-master analysis is not proof that the installed binary contains all reviewed behavior. No Herdr daemon/socket, live session, private endpoint/account, remote host, or other private runtime state was inspected.

Official [keyboard documentation](https://herdr.dev/docs/keyboard/) says pane input follows app-requested keyboard modes and Kitty apps receive requested modifiers/events. The README describes Herdr as a terminal multiplexer running in an outer terminal, not proof that the outer terminal's protocol capability is automatically available inside every pane.

## Verified public-source trace

### 1. Host terminal and pane application negotiate separately

Herdr's normal Unix client setup requests enhanced keyboard modes from the **outer host**:

- [Client setup, lines 77–80](https://github.com/herdrdev/herdr/blob/5608de0608918aba2f9d501e7793b984a0ca9cfa/src/client/terminal_setup.rs#L77-L80) calls the enhancement setup.
- [Mode push, lines 730–734](https://github.com/herdrdev/herdr/blob/5608de0608918aba2f9d501e7793b984a0ca9cfa/src/client/terminal_setup.rs#L730-L734) uses `ime_compatible_keyboard_enhancement_flags()`.
- [Flag definition, lines 278–283](https://github.com/herdrdev/herdr/blob/5608de0608918aba2f9d501e7793b984a0ca9cfa/src/input/model.rs#L278-L283) combines disambiguation, event types, and alternate keys: **flags 7**.

A child program's Kitty push/query is handled by the pane's terminal emulator instead:

- [Pane keyboard-stack push](https://github.com/herdrdev/herdr/blob/5608de0608918aba2f9d501e7793b984a0ca9cfa/vendor/libghostty-vt/src/terminal/stream_terminal.zig#L439-L443) stores flags on that pane screen.
- [Pane query reply, lines 1538–1544](https://github.com/herdrdev/herdr/blob/5608de0608918aba2f9d501e7793b984a0ca9cfa/vendor/libghostty-vt/src/terminal/stream_terminal.zig#L1538-L1544) returns `self.terminal.screens.active.kitty_keyboard.current().int()` as `CSI ? flags u`.

**A flags-7 reply inside Herdr therefore describes pane-local state, not end-to-end release delivery from the outer host.** This explains how the inner and native-baseline reports can differ without contradicting each other.

### 2. Incoming event kind is parsed and can be forwarded

- [Input parser, lines 379–384](https://github.com/herdrdev/herdr/blob/5608de0608918aba2f9d501e7793b984a0ca9cfa/src/input/parse.rs#L379-L384) maps event types 1/2/3 to press/repeat/release; absent type defaults to press.
- [Client routing, lines 396–443](https://github.com/herdrdev/herdr/blob/5608de0608918aba2f9d501e7793b984a0ca9cfa/src/client/shell/input.rs#L396-L443) associates forwarded presses with a target pane. A matching release returns to that target via `push_pane_key`; unmatched releases and Herdr-consumed shortcuts are not blindly forwarded.
- [Wire input, lines 313–328](https://github.com/herdrdev/herdr/blob/5608de0608918aba2f9d501e7793b984a0ca9cfa/src/protocol/wire.rs#L313-L328) carries event kind and repeat count.

Legacy Ctrl+Q bytes have no physical key-up information. Re-encoding those bytes cannot reconstruct a genuine physical release.

### 3. Pane encoding preserves a supplied release when requested

- [Pane key conversion, lines 21–32](https://github.com/herdrdev/herdr/blob/5608de0608918aba2f9d501e7793b984a0ca9cfa/src/pane/input.rs#L21-L32) maps press/release/repeat to Ghostty key actions.
- [Encoder options, lines 59–67](https://github.com/herdrdev/herdr/blob/5608de0608918aba2f9d501e7793b984a0ca9cfa/vendor/libghostty-vt/src/input/key_encode.zig#L59-L67) use the pane's active Kitty flags.
- [Release gating, lines 112–123](https://github.com/herdrdev/herdr/blob/5608de0608918aba2f9d501e7793b984a0ca9cfa/vendor/libghostty-vt/src/input/key_encode.zig#L112-L123) permits releases when event reporting is requested (with additional restrictions for Enter/Tab/Backspace, not Q).
- [Event conversion, lines 248–253](https://github.com/herdrdev/herdr/blob/5608de0608918aba2f9d501e7793b984a0ca9cfa/vendor/libghostty-vt/src/input/key_encode.zig#L248-L253) maps the action into the Kitty event type.
- [Server pane input, lines 327–332](https://github.com/herdrdev/herdr/blob/5608de0608918aba2f9d501e7793b984a0ca9cfa/src/server/pane_input.rs#L327-L332) sends encoded bytes toward the PTY; [Unix actor, lines 938–941](https://github.com/herdrdev/herdr/blob/5608de0608918aba2f9d501e7793b984a0ca9cfa/src/pty/actor/unix.rs#L938-L941) writes them.

The source includes conformance coverage for this dependency:

> A host that never reports releases gives nobody a release to forward.

[Conformance expectation, lines 500–504](https://github.com/herdrdev/herdr/blob/5608de0608918aba2f9d501e7793b984a0ca9cfa/src/client/shell/tests/input_conformance.rs#L500-L504). A [separate supplied-release test, lines 1292–1307](https://github.com/herdrdev/herdr/blob/5608de0608918aba2f9d501e7793b984a0ca9cfa/src/client/shell/tests/input_conformance.rs#L1292-L1307) expects a letter release to reach a Kitty-event pane. These tests were inspected, **not executed**.

### 4. Version and physical-test cautions

- The initial review did not know the installed binary's version. It is now verified as official 0.7.5; that release has a routing blocker documented separately. The reviewed encoder omits explicit `:1` for ordinary presses, whereas the earlier physical Herdr report includes it. Both represent valid Kitty presses, but the installed path must not be assumed identical to the pinned current source.
- Herdr can generate cleanup releases when releasing input leases (for example, focus changes). See [cleanup, lines 448–467](https://github.com/herdrdev/herdr/blob/5608de0608918aba2f9d501e7793b984a0ca9cfa/src/client/shell/input.rs#L448-L467). A future physical trial should keep focus steady and distinguish immediate Q-up from a later cleanup event.
- The trace concerns the normal Unix client/pane path; direct-attach and other frontends may have different boundaries.

## Historical host-only hypothesis — incomplete for installed 0.7.5

The initial combined evidence was consistent with this chain. It is not a sufficient remedy for the installed release: the subsequently verified 0.7.5 routing branch independently consumes releases even when the host supplies them.

```text
Outer WezTerm with Kitty disabled
  -> host delivers only Ctrl+Q press bytes
  -> Herdr receives presses, not physical releases
  -> pane independently acknowledges flags 7 and re-encodes presses
  -> Pi/probe sees Kitty presses but no Q release
```

The native Kitty-enabled control proves that the outer WezTerm can deliver a release when enabled. The **missing comparison is that same enabled host with Herdr in the middle**. The existing observations do not yet prove a Herdr bug or prove that no Herdr change is needed for the installed version.

## Prior agreed experiment and configuration record

The requester agreed to testing the required nested path and offered to enable Kitty in the existing WezTerm hosting this Herdr session, asking for instructions. Initially this authorized explaining the steps only. The requester subsequently explicitly asked the assistant to configure WezTerm and leave restart to them. That narrow configuration change is now applied; no Herdr runtime has been accessed.

Open a **fresh/re-attached local Herdr client from a WezTerm host with Kitty enabled**, then run the existing standalone protocol/Q probe inside a Herdr pane. Keep focus on that pane while pressing and releasing Q. This directly tests the required outer-host → Herdr → child path; an additional native-only Pi test is not the current priority.

### Manual instructions for the existing local session

The inspected WezTerm config is `/home/debonzi/.config/wezterm/wezterm.lua` (a symlink into the user's dotfiles). Tell the requester to add this line before `return config`:

```lua
config.enable_kitty_keyboard = true
```

This is a **persistent user configuration change**, unlike the earlier one-process override. Removing the line later restores the prior default. On the requester's subsequent explicit instruction, the assistant added exactly `config.enable_kitty_keyboard = true` to `/home/debonzi/devel/repos/debonzi/dotfiles/wezterm/wezterm.lua`, the target of the config symlink. `wezterm show-keys --lua` successfully loaded the configuration, and the dotfiles diff contains only that added line. No client/server/application was restarted by the assistant. A later report now exists with 59 presses and no release; restart/reattach context is not yet separately confirmed. Successful config loading alone is not proof of live release delivery, and the verified 0.7.5 routing blocker remains regardless of that context.

WezTerm's [configuration documentation](https://wezterm.org/config/files.html) says saving a watched config reloads most options automatically; Ctrl+Shift+R forces reload. A fresh/re-attached Herdr client is recommended because its earlier host-mode push may have been ignored before the option was enabled.

For a default-prefix local Herdr session, the [official quick start](https://herdr.dev/docs/quick-start/) documents Ctrl+B, release, then Q to detach, followed by `herdr` from the outer shell to reattach. Detach preserves the server, panes, and Pi process. Do not stop the server or exit Pi. If the requester uses a custom prefix or a nondefault target, use their existing detach/reattach workflow rather than guessing a service/remote target.

In another Herdr pane, from the `pi-voice` repository root, run in its normal shell (not Pi `!`/`!!`):

```bash
python3 explorations/2026-10-25_15-32-pi-voice-extension/assets/ctrl-q-protocol.py
```

Press Enter, hold Ctrl+Q for roughly three seconds, release Q before Ctrl, and keep focus steady until the ten-second trial finishes. The report is saved in the exploration. Do not count focus-cleanup releases as proof of physical Q-up. No microphone or inference is involved.

Do not launch or inspect a Herdr service/client runtime on the requester's behalf or access private/remote state without explicit scope. Before supplying a launch command, account for any automatic connection behavior; the experiment must not silently connect to remote machines. No command for a new Herdr client, runtime connection, or native-host setting override beyond the previously approved standalone test has been executed by the assistant.

If release arrives in this nested trial, proceed toward Pi-extension validation in the same Herdr path. If not, establish the installed Herdr version/frontend and narrow the input boundary using matching public version source before proposing a change. Neither outcome authorizes implementing Pi Voice or patching Herdr.

## Conclusions and open decisions

Public source is available; a local checkout is not required for this investigation. It supports the two-negotiation model and a release-forwarding path conditional on host input. The installed-version follow-up now establishes a release-dropping branch in 0.7.5, superseding more generic host-enable/retry experiments as the next action.

The requester subsequently updated/restarted Herdr themselves. Version output and the latest report identify 0.9.5, and the report records 55 presses plus one Q release. See the [updated-environment record](phase-1-herdr-0.9.5.md).

The existing Pi diagnostic subsequently passed in updated Herdr, completing the basic physical listener boundary check. Next: ask whether to explore phase-2 audio capture or first resolve final shortcut/fallback and focus/lost-release behavior. No further installation/update or patch is authorized by this result. No private/runtime service has been inspected or modified. Phase 2 has not started.
