# Phase 1 — Public documentation evidence

Consulted on 2026-10-25. These are short evidence excerpts from public upstream documentation, not tests of this machine's terminal or its effective configuration. No GitHub/private-service access was needed.

## Kitty keyboard protocol

Source: <https://sw.kovidgoyal.net/kitty/keyboard-protocol/>

Relevant sections: Event types, Progressive enhancement, Report event types, Report all keys as escape codes, and Why xterm's modifyOtherKeys should not be used.

Excerpts:

> The `press` event type has value `1` and is the default if no event type sub field is present. The `repeat` type is `2` and the `release` type is `3`.

> This progressive enhancement (`0b10`) causes the terminal to report key repeat and key release events.

The progressive enhancement flags are `1` (disambiguation), `2` (event types), `4` (alternate keys), `8` (all keys as escape codes), and `16` (associated text).

For flag `8`, the documentation states:

> Additionally, with this mode, events for pressing modifier keys are reported.

It also notes that ordinary text-generating keys need the all-keys mode for event reporting. Therefore flags `7`, as requested by Pi 1.4.0, must not be equated with complete standalone modifier-key tracking or guaranteed release coverage after arbitrary modifier changes.

The modifyOtherKeys limitations explicitly include:

> Does not support release events

## WezTerm keyboard encoding

Sources:

- <https://wezterm.org/config/key-encoding.html>
- <https://wezterm.org/config/lua/config/enable_kitty_keyboard.html>

Excerpts:

> The standard xterm compatible encoding generates events for key presses (but not releases)

> `enable_kitty_keyboard` controls whether wezterm will honor the application requests to modify the keyboard encoding.

For `enable_kitty_keyboard`:

> When set to `true`, wezterm will honor kitty keyboard protocol escape sequences that modify the keyboard encoding.

The option's page dates availability to WezTerm `20220624-141144-bd1b7c5d`. The locally available binary reports `20240203-110809-5046fc22`, but that version string is not proof that the option is enabled, that all relevant events are implemented correctly, or that the active input path preserves them. The consulted option page does not specify a default value; no claim about the effective/default boolean was verified here.

## WezTerm default shortcut conflict

Source: <https://wezterm.org/config/default-keys.html>

The default assignments table lists `CTRL+SHIFT` + `R` as `ReloadConfiguration`.

The keyboard-encoding page says:

> When input that doesn't match a key assignment is processed, it is encoded into a byte stream and sent to the PTY associated with the program that is running in the active pane.

Consequence: under the documented default mapping, the proposed shortcut is owned by WezTerm before Pi sees it. This is evidence of a default conflict, not proof that the user's effective custom mapping still contains it. No terminal configuration was inspected or modified.
