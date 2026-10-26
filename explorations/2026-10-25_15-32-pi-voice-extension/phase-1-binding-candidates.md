# Phase 1 follow-up — Candidate shortcut availability

## Objective and scope

Find evidence of a simple unused recording shortcut. The requester specifically suggested `Ctrl+R`, `Ctrl+T`, and `Ctrl+Shift+T` as candidates. This continues the Exploration session; no final binding was installed or selected and no terminal/Pi configuration was changed. After this comparison, the requester chose Ctrl+Q for the [keyboard-only experiment](phase-1-ctrl-q-test.md). That later record now includes the first physical report: activation recognized, no repeat/release recognized. Statements below about unperformed physical tests describe the candidate-search stage, not the later experiment.

**Recommendation: test `Ctrl+Q` first on the current Linux setup.** It has no assignment in the inspected Pi resolved bindings, WezTerm assignment dump, or reviewed configured extension sources. This is bounded evidence of non-use, not a guarantee of physical delivery or absence from every desktop/multiplexer/runtime layer.

## Comparison

| Candidate | Pi 1.4.0 on this Linux setup | Locally generated WezTerm assignments | Assessment |
| --- | --- | --- | --- |
| `Ctrl+R` | `app.session.rename` in session selector; no main-editor action found | `search_mode`: cycle search match type; no normal-table assignment found | Possible only with careful context scoping, not globally unused |
| `Ctrl+T` | Toggle thinking blocks; hide tool results in tree view | No assignment found | Reject: conflicts with existing Pi behavior |
| `Ctrl+Shift+T` | No assignment found | Open a new tab (`SpawnTab`) | Reject without a terminal mapping change |
| **`Ctrl+Q`** | **No assignment found** | **No assignment in normal/copy/search tables** | **Preferred simple candidate for a physical diagnostic** |
| `Ctrl+Alt+R` | No assignment found | No assignment in normal/copy/search tables | Alternative with an R mnemonic, but three keys |
| `Ctrl+Shift+Y` | No assignment found | No assignment in normal/copy/search tables | Another clean candidate in the inspected scope, also three keys |

The reviewed extension sources contain no conflict for these candidates. They do not establish the active runtime's complete set of shortcuts.

## Evidence

### Pi resolved bindings and input parsing

The installed `KeybindingsManager.create('/home/debonzi/.pi/agent').getEffectiveConfig()` resolved **90 actions**. No user `~/.pi/agent/keybindings.json` exists. The candidate comparison normalizes modifier ordering rather than relying on exact string spelling.

Installed source root:

`/home/debonzi/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works/`

References relative to that root:

- `pi-coding-agent/dist/core/keybindings.js:38-41`: Ctrl+T toggles thinking blocks.
- `pi-coding-agent/dist/core/keybindings.js:94-97`: Ctrl+R renames sessions.
- `pi-coding-agent/dist/core/keybindings.js:134-137`: Ctrl+T filters tool results in tree view.
- `pi-coding-agent/dist/core/keybindings.js:298-323`: configuration loader and resolved bindings accessor.
- `pi-coding-agent/dist/modes/interactive/components/session-selector.js:493-499`: Ctrl+R action is checked in session-selector input handling.
- `pi-coding-agent/dist/core/extensions/runner.js:7-30`: editor-global reserved bindings include thinking toggle, but not session rename. An ordinary extension shortcut can therefore override the nonreserved binding with a warning; that does not make Ctrl+R unused.
- `pi-tui/dist/terminal.js:120-123`: interactive input enables raw mode. Ctrl+Q's legacy XON meaning should not be confused with a Pi assignment; any intermediary flow-control behavior remains a physical-test concern.

Synthetic checks passed for Ctrl+Q:

- Legacy byte `0x11` matches `ctrl+q`.
- Kitty sequences `ESC[113;5:1u`, `ESC[113;5:2u`, and `ESC[113;5:3u` match `ctrl+q`.
- Repeat and release helpers distinguish the latter two event types correctly.

**Legacy press recognition does not provide release events.** Hold/release still requires verified event delivery, even with this simpler chord. On Windows/WSL, Pi uses Ctrl+Q for queued follow-up messages; this recommendation is specific to the inspected native Linux configuration.

Machine-readable results: [assets/phase-1-binding-candidates.json](assets/phase-1-binding-candidates.json).

### WezTerm local configuration and assignment dump

`WEZTERM_CONFIG_FILE` points to `/home/debonzi/.config/wezterm/wezterm.lua`, a symlink to `/home/debonzi/devel/repos/debonzi/dotfiles/wezterm/wezterm.lua`.

Read-only inspection found two custom key entries: F11 toggles fullscreen; Alt+Enter disables the corresponding default mapping. The file does not disable all default bindings and does not define any candidate shortcut. It contains no `enable_kitty_keyboard` setting; its absence alone does not establish the running process's effective protocol behavior.

Executed the standalone read-only command:

```bash
wezterm show-keys --lua > explorations/2026-10-25_15-32-pi-voice-extension/assets/phase-1-wezterm-show-keys.lua
```

This prints the assignments resolved by the locally available WezTerm CLI with its configuration; it does not query a remote/private service or prove the running GUI has identical in-memory state.

Evidence in [assets/phase-1-wezterm-show-keys.lua](assets/phase-1-wezterm-show-keys.lua):

- Lines 77–78 and 109: shifted T opens a new tab.
- Lines 75–76 and 107: shifted R reloads configuration, corroborating the earlier documented conflict.
- Line 215: Ctrl+R is used in terminal search mode.
- No Ctrl+Q, Ctrl+Alt+R, or Ctrl+Shift+Y assignment found across the normal, copy-mode, and search-mode tables.

The dump contains uppercase letter aliases such as `key = 'T', mods = 'CTRL'` as well as lowercase shifted spellings. These are not evidence that plain lowercase Ctrl+T opens a tab. The bounded comparison script accounts for implicit Shift on uppercase letters.

### Configured extension sources

Static source review only; no extensions were imported/executed and no Pi process was launched.

Reviewed keyboard registration/interception points in:

- `~/.pi/agent/extensions/herdr-agent-state.ts`: no shortcut or raw-input hooks.
- `~/.pi/agent/npm/node_modules/pi-web-access/dist/index.js`: default shortcuts Ctrl+Shift+S and Ctrl+Shift+W (`:25268`); registrations at `:26240,26253`. No candidate conflicts/raw terminal listener found. No local `~/.pi/agent/web-search.json` override exists in this environment.
- `/home/debonzi/devel/repos/debonzi/pi-ssubs/index.ts` and `src/*.ts`: no shortcut or terminal-input hooks; subprocess stdin is not terminal keyboard interception.
- `/home/debonzi/devel/repos/debonzi/ai-tools/agents/pi/extensions/pi-context-meter.ts`: no shortcut or raw-input hooks.
- `/home/debonzi/devel/repos/debonzi/ai-tools/packages/pi-codex-usage/agents/pi/extensions/codex-usage/{index.ts,core.ts}`: no shortcut or raw-input hooks.
- Resource-root checks for the other configured local packages (`wyrd`, `archdev`, `devflow`, and `db11-skills`) identified no additional conventional extension entrypoints in the checked discovery locations.

A separately configured older Codex-usage path does not exist locally. No unrelated settings or configuration contents are copied into this record.

This review is evidence about configured local sources, not a live `/hotkeys` inventory. Launch-time extensions, load failures, runtime resource selection, arbitrary dependency behavior, or later configuration changes may alter the active shortcut set.

## Reproduce the candidate comparison

After regenerating the WezTerm dump above, run from repository root:

```bash
node explorations/2026-10-25_15-32-pi-voice-extension/assets/phase-1-binding-candidates.mjs \
  /home/debonzi/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works \
  /home/debonzi/.pi/agent \
  explorations/2026-10-25_15-32-pi-voice-extension/assets/phase-1-wezterm-show-keys.lua
```

The script resolves only Pi core keybindings, parses alphabetic candidate assignments from the saved WezTerm output, and performs synthetic Ctrl+Q parsing assertions. Extension-source findings are recorded separately above. It does not load extension code, access stdin/TTY, or change configuration. It is a deliberately bounded evidence script, not a general Lua parser.

## Conclusion and next step

- Of the requester's examples, **Ctrl+R is the closest fit**, but it is only unused in the main prompt editor, not in all Pi/WezTerm contexts. A global raw listener would need to avoid stealing session-rename/search-mode behavior.
- **Ctrl+Q has stronger non-use evidence and uses only two keys**, so it is the preferred candidate for a keyboard-only physical test on this Linux setup.
- Ctrl+Alt+R is a clean alternative in the inspected scope if retaining the R mnemonic is more important than minimizing keys.
- No final binding was selected. No physical-key, desktop shortcut, focus-loss, or terminal protocol delivery test was performed. All earlier phase-1 release/reporting caveats remain applicable.

Next: the requester has confirmed Ctrl+Q for testing. Run the [prepared isolated keyboard diagnostic](phase-1-ctrl-q-test.md) and record the physical result; the broader constraints remain in [phase-1-keybindings.md](phase-1-keybindings.md). No audio capture or phase-2 investigation is authorized by this candidate search.
