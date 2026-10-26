// Exploration-only keyboard diagnostic: no audio, network, subprocesses, or file writes.
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isKeyRelease, isKeyRepeat, isKittyProtocolActive, matchesKey, parseKey } from "@earendil-works/pi-tui";

const WIDGET = "voice-ctrl-q-probe";

export default function ctrlQProbe(pi: ExtensionAPI) {
  let unsubscribe: (() => void) | undefined;
  let active = false;
  let held = false;
  let presses = 0;
  let repeats = 0;
  let releases = 0;
  let last = "none";

  function reset() {
    active = true;
    held = false;
    presses = repeats = releases = 0;
    last = "none";
  }

  function summary() {
    return `press=${presses} repeat=${repeats} release=${releases} held=${held ? "yes" : "no"}`;
  }

  function render(ctx: ExtensionContext) {
    ctx.ui.setWidget(WIDGET, [
      `Ctrl+Q probe: ${active ? "ARMED" : "STOPPED"} | ${summary()}`,
      `Last: ${last} | Kitty advertised: ${isKittyProtocolActive() ? "yes" : "no"} (not proof of release support)`,
      "Hold Ctrl+Q, release Q first. Escape stops. /key-test reset starts a fresh trial.",
    ]);
  }

  pi.on("session_start", (_event, ctx) => {
    unsubscribe?.();
    unsubscribe = undefined;
    if (ctx.mode !== "tui") return;
    reset();
    unsubscribe = ctx.ui.onTerminalInput((data) => {
      if (!active || data.includes("\x1b[200~")) return undefined;
      const released = isKeyRelease(data);
      const repeated = isKeyRepeat(data);
      if (!released && !repeated && matchesKey(data, "escape")) {
        active = false;
        held = false; // Manual disarm, not evidence of a key release.
        last = "manual stop (Escape)";
        render(ctx);
        return { consume: true };
      }
      const chord = matchesKey(data, "ctrl+q");
      // Once activated, recognize a delivered Q release even if Ctrl was released first.
      // This does not guarantee the terminal reports such a release.
      const latchedRelease = held && released && parseKey(data)?.split("+").at(-1) === "q";
      if (!chord && !latchedRelease) return undefined;
      if (released) {
        releases++;
        held = false;
        last = chord ? "RELEASE Ctrl+Q" : "RELEASE Q (modifiers changed)";
      } else if (repeated) {
        repeats++;
        last = "REPEAT Ctrl+Q";
      } else {
        presses++;
        held = true;
        last = "PRESS Ctrl+Q (legacy auto-repeat may also appear as PRESS)";
      }
      render(ctx);
      return { consume: true };
    });
    render(ctx);
    ctx.ui.notify("Keyboard-only probe ready. No microphone, transcription, or model requests.", "info");
  });

  pi.registerCommand("key-test", {
    description: "Ctrl+Q diagnostic: result (default), reset, or stop",
    handler: (args, ctx) => {
      if (ctx.mode !== "tui") return;
      const action = args.trim() || "result";
      if (action === "reset") reset();
      else if (action === "stop") {
        active = false;
        held = false;
        last = "manual stop (/key-test stop)";
      } else if (action !== "result") {
        ctx.ui.notify("Usage: /key-test [result|reset|stop]", "warning");
        return;
      }
      render(ctx);
      ctx.ui.notify(summary(), "info");
    },
  });

  // Avoid an accidental plain-text submission initiating a model request.
  pi.on("input", (_event, ctx) => {
    ctx.ui.notify("Keyboard-only diagnostic. Use Ctrl+Q or /key-test; prompts are not sent.", "warning");
    return { action: "handled" };
  });

  pi.on("session_shutdown", (_event, ctx) => {
    active = false;
    held = false;
    unsubscribe?.();
    unsubscribe = undefined;
    if (ctx.mode === "tui") ctx.ui.setWidget(WIDGET, undefined);
  });
}
