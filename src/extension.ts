import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Editor, getKeybindings, isKeyRelease, isKeyRepeat, matchesKey, parseKey,
  truncateToWidth, type TUI } from "@earendil-works/pi-tui";
import { admitText, readConfig, type VoiceConfig } from "./config.ts";
import { startWorker, type WorkerCallbacks, type WorkerHandle } from "./worker-client.ts";

const KEY = "pi-voice";
type FocusTUI = TUI & { getFocusedComponent?(): unknown };
type Operation = {
  generation: number;
  sessionId: string;
  leafId: string | null;
  editor: Editor;
  factory: unknown;
  expectedDraft: string;
  requiresAcceptance: boolean;
  canceled: boolean;
  stopped: boolean;
  handle?: WorkerHandle;
};
type Session = {
  ctx: ExtensionContext;
  active: boolean;
  shutting: boolean;
  held: boolean;
  pasting: boolean;
  prompts: number;
  generation: number;
  state: string;
  detail: string;
  tui?: FocusTUI;
  operation?: Operation;
  pending?: { text: string; sessionId: string; leafId: string | null };
  input?: string;
  inputChange?: { operation?: Operation; before: string; history: boolean };
  unsubscribe?: () => void;
  recordingAt?: number;
  timer?: ReturnType<typeof setInterval>;
};
type Dependencies = {
  config(): VoiceConfig;
  startWorker(config: VoiceConfig, callbacks: WorkerCallbacks): WorkerHandle;
  terminalActive(): boolean;
  platform: string;
};
const defaults: Dependencies = {
  config: readConfig, startWorker,
  terminalActive: () => process.stdin.isRaw === true,
  platform: process.platform,
};

export default function voice(pi: ExtensionAPI) { installVoice(pi); }

/** Dependency seams are for synthetic tests, not model-callable microphone tools. */
export function installVoice(pi: ExtensionAPI, overrides: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...overrides };
  let current: Session | undefined;
  // If the supervisor dies without confirmed cleanup, never assume its mic died.
  let blocked = false;
  const live = (s: Session) => current === s && s.active;
  const editor = (s: Session) => {
    const value = s.tui?.getFocusedComponent?.();
    return value instanceof Editor ? value : undefined;
  };
  const notify = (s: Session, message: string, kind: "info" | "warning" | "error" = "info") => {
    if (live(s) && !s.shutting) s.ctx.ui.notify(message, kind);
  };
  function render(s: Session) {
    if (live(s)) s.ctx.ui.setStatus(KEY, `Voice: ${s.state}`); // Also requests an async repaint.
  }
  function clearTimer(s: Session) {
    if (s.timer) clearInterval(s.timer);
    s.timer = undefined;
    s.recordingAt = undefined;
  }
  function mainFocus(s: Session) {
    return !s.prompts && !!editor(s) && s.tui?.hasOverlay() === false && deps.terminalActive();
  }
  function ready(s: Session) {
    return live(s) && !s.shutting && mainFocus(s) && s.ctx.isIdle() && !s.ctx.hasPendingMessages();
  }
  function flushInput(s: Session) {
    const change = s.inputChange;
    s.inputChange = undefined;
    if (!change || !live(s)) return;
    const after = s.ctx.ui.getEditorText();
    if (change.history && after !== change.before) {
      cancel(s, "Draft replaced from history; pending dictation discarded.");
    } else if (change.operation && s.operation === change.operation && !change.operation.canceled) {
      change.operation.expectedDraft = after;
    }
  }
  function unchangedOwner(s: Session, op: Operation) {
    return live(s) && !s.shutting && s.generation === op.generation && !op.canceled &&
      s.ctx.sessionManager.getSessionId() === op.sessionId &&
      s.ctx.sessionManager.getLeafId() === op.leafId;
  }
  function eligible(s: Session, op: Operation) {
    return unchangedOwner(s, op) && ready(s) && !op.requiresAcceptance &&
      editor(s) === op.editor && s.ctx.ui.getEditorComponent() === op.factory &&
      s.ctx.ui.getEditorText() === op.expectedDraft;
  }
  function insert(s: Session, text: string) {
    // No await between eligibility checking and mutation. No whole-draft snapshot,
    // synthetic Enter, extra separators, shell command, or model message.
    s.ctx.ui.pasteToEditor(text);
    s.state = "idle";
    s.detail = "Dictation inserted. Review spacing and send manually.";
    render(s);
  }
  function cancel(s: Session, reason = "Dictation canceled.") {
    s.pending = undefined;
    const op = s.operation;
    if (!op || op.canceled) {
      if (!op) { s.state = blocked ? "blocked" : "idle"; s.detail = reason; render(s); }
      return;
    }
    op.canceled = true; // Invalidate before any asynchronous cleanup.
    s.generation++;
    clearTimer(s);
    s.state = "canceling";
    s.detail = `${reason} Waiting for microphone/process cleanup.`;
    op.handle?.cancel();
    render(s);
  }
  function stop(s: Session) {
    const op = s.operation;
    if (!op || op.canceled || op.stopped) return;
    op.stopped = true;
    clearTimer(s);
    if (["starting", "recording"].includes(s.state)) {
      s.state = "stopping";
      s.detail = "Finishing audio; transcription starts only after finalization.";
    }
    op.handle?.stop();
    render(s);
  }
  function uncertain(s: Session) {
    if (s.operation) s.operation.requiresAcceptance = true;
  }
  function start(s: Session) {
    if (!live(s) || s.shutting) return;
    if (blocked) { notify(s, "Recording blocked: previous audio cleanup was not confirmed. Check the microphone/processes before restarting Pi.", "error"); return; }
    if (s.operation || s.pending !== undefined) {
      notify(s, "Voice is busy. Finish, /voice accept, or /voice cancel before starting another part.", "warning"); return;
    }
    if (deps.platform !== "linux" || !ready(s)) {
      notify(s, "Voice requires Linux, an idle main editor, and no open dialog. Close dialogs and try again.", "warning"); return;
    }
    let config: VoiceConfig;
    try { config = deps.config(); }
    catch { notify(s, "Invalid voice configuration. Executable and model overrides must be absolute local paths.", "error"); return; }
    const op: Operation = {
      generation: ++s.generation, sessionId: s.ctx.sessionManager.getSessionId(),
      leafId: s.ctx.sessionManager.getLeafId(), editor: editor(s)!,
      factory: s.ctx.ui.getEditorComponent(), expectedDraft: s.ctx.ui.getEditorText(),
      requiresAcceptance: false, canceled: false, stopped: false,
    };
    s.operation = op;
    s.input = undefined;
    s.state = "starting";
    s.detail = "Resolving the current system default microphone. Release Q or /voice stop to finish.";
    render(s);
    try {
      op.handle = deps.startWorker(config, {
        state(state, input) {
          if (!live(s) || s.operation !== op || op.canceled) return;
          if (input) s.input = input;
          s.state = op.stopped && ["starting", "recording"].includes(state) ? "stopping" : state;
          if (s.state === "recording" && !s.timer) {
            s.recordingAt = Date.now();
            s.timer = setInterval(() => render(s), 1000);
            s.timer.unref?.();
          } else if (s.state !== "recording") clearTimer(s);
          s.detail = state === "recording" ? "Release Q or /voice stop to finish; /voice cancel discards." :
            state === "transcribing" ? "Local large-v3 / Vulkan transcription. You may keep editing." :
            state === "cleaning" ? "Waiting for owned processes and temporary audio cleanup." : s.detail;
          render(s);
        },
        warning(message) { notify(s, message, "error"); },
      });
      if (op.canceled) op.handle.cancel();
      else if (op.stopped) op.handle.stop();
      void op.handle.done.then((result) => {
        if (!live(s) || s.operation !== op) return;
        clearTimer(s);
        flushInput(s);
        const ownerValid = unchangedOwner(s, op);
        const canInsert = eligible(s, op);
        s.operation = undefined;
        if (!result.cleanupOk) {
          blocked = true;
          s.pending = undefined;
          s.state = "blocked";
          s.detail = "Audio/process cleanup was not confirmed. New recording is blocked.";
          notify(s, s.detail, "error");
        } else if (!ownerValid || op.canceled || s.shutting) {
          s.state = "idle";
          s.detail = "Canceled; owned processes closed and temporary audio removed.";
        } else if (result.outcome === "completed" && typeof result.text === "string") {
          try {
            const text = admitText(result.text);
            if (!text) { s.state = "idle"; s.detail = "No speech text to insert."; }
            else if (canInsert) insert(s, text);
            else {
              s.pending = { text, sessionId: op.sessionId, leafId: op.leafId };
              s.state = "pending";
              s.detail = "Editor safety changed. Close dialogs, then /voice accept to paste or /voice cancel to discard.";
              notify(s, s.detail, "warning");
            }
          } catch {
            s.state = "error";
            s.detail = "Invalid transcription text was not inserted.";
            notify(s, s.detail, "error");
          }
        } else {
          s.state = result.outcome === "error" ? "error" : "idle";
          s.detail = result.outcome === "empty" ? "No audio or transcription text to insert." :
            result.outcome === "canceled" ? "Dictation canceled and cleaned up." :
            result.message || "Local voice operation failed. Nothing was inserted.";
          notify(s, s.detail, result.outcome === "error" ? "error" : "info");
        }
        render(s);
      }).catch(() => {
        if (!live(s) || s.operation !== op) return;
        clearTimer(s);
        s.operation = undefined;
        s.pending = undefined;
        blocked = true;
        s.state = "blocked";
        s.detail = "Voice failed without confirmed cleanup. New recording is blocked.";
        render(s);
        notify(s, s.detail, "error");
      });
    } catch {
      // The production bridge resolves launch failures rather than throwing.
      // An unexpected integration exception cannot establish process cleanup.
      op.canceled = true;
      op.handle?.cancel();
      blocked = true;
      s.state = "blocked";
      s.detail = "Voice initialization failed without confirmed cleanup.";
      render(s);
      notify(s, s.detail, "error");
    }
  }
  function onInput(s: Session, data: string) {
    if (!live(s) || s.shutting) return undefined;
    // Pi can dispatch several keys synchronously from one stdin batch. Settle
    // the previous native edit before checking this key against the live draft.
    flushInput(s);
    // Never interpret embedded shortcuts in a native bracketed paste.
    const wasPasting = s.pasting;
    if (data.includes("\x1b[200~")) s.pasting = true;
    if (data.includes("\x1b[201~")) s.pasting = false;
    const paste = wasPasting || data.includes("\x1b[200~") || data.includes("\x1b[201~");
    const release = isKeyRelease(data);
    if (!paste) {
      const chord = matchesKey(data, "ctrl+q");
      const latchedRelease = s.held && release && parseKey(data)?.split("+").at(-1) === "q";
      if (latchedRelease || (chord && (s.held || s.operation || ready(s)))) {
        if (release) { s.held = false; stop(s); }
        else if (!isKeyRepeat(data) && !s.held) { s.held = true; start(s); }
        return { consume: true };
      }
    }
    if (release) return undefined;
    const op = s.operation;
    if (!op && s.pending === undefined) return undefined;
    if (op && (editor(s) !== op.editor || s.ctx.ui.getEditorComponent() !== op.factory ||
        s.ctx.ui.getEditorText() !== op.expectedDraft)) uncertain(s);
    if (!mainFocus(s)) { uncertain(s); return undefined; }
    const before = s.ctx.ui.getEditorText();
    let history = false;
    if (!paste) {
      const kb = getKeybindings();
      const ownCommand = /^\/voice(?:\s+(?:start|stop|cancel|accept|status))?\s*$/u.test(s.ctx.ui.getEditorText());
      const replacement = (["app.clear", "app.exit", "app.suspend", "app.message.dequeue",
        "app.session.new", "app.session.tree", "app.session.fork", "app.session.resume",
        "tui.editor.historyPrevious", "tui.editor.historyNext"] as const).some((action) => kb.matches(data, action));
      const focused = editor(s)!;
      const autocomplete = focused.isShowingAutocomplete();
      const cursor = focused.getCursor();
      const line = focused.getLines()[cursor.line] || "";
      const backslashNewline = cursor.col > 0 && line[cursor.col - 1] === "\\";
      const submit = kb.matches(data, "app.message.followUp") ||
        (kb.matches(data, "tui.input.submit") && !backslashNewline &&
          (!autocomplete || before.trimStart().startsWith("/")));
      // Up/Down also move a cursor or select autocomplete entries. Only discard
      // if native handling actually replaces the text from history.
      history = !autocomplete && (kb.matches(data, "tui.editor.cursorUp") || kb.matches(data, "tui.editor.cursorDown"));
      if (replacement || (submit && !ownCommand)) {
        cancel(s, "Draft submitted, replaced, or cleared; pending dictation discarded.");
        return undefined; // The user's action always wins. Never consume Enter.
      }
      if (kb.matches(data, "app.editor.external") || kb.matches(data, "app.interrupt")) uncertain(s);
    }
    // Native typing/cursor movement/paste operates synchronously after listeners.
    // Flush either at the next key in this batch, or at the microtask boundary.
    s.inputChange = { operation: op, before, history };
    queueMicrotask(() => flushInput(s));
    return undefined;
  }
  async function shutdown(s: Session) {
    if (!live(s)) return;
    s.shutting = true;
    cancel(s);
    const handle = s.operation?.handle;
    if (handle) await handle.done; // Supervisor EOF/cancel owns bounded child termination.
    clearTimer(s);
    s.unsubscribe?.();
    s.pending = undefined;
    s.active = false;
    s.ctx.ui.setWidget(KEY, undefined);
    s.ctx.ui.setStatus(KEY, undefined);
    if (current === s) current = undefined;
  }
  pi.on("session_start", async (_event, ctx) => {
    if (current) await shutdown(current);
    if (ctx.mode !== "tui" || deps.platform !== "linux") return;
    const s: Session = { ctx, active: true, shutting: false, held: false, pasting: false,
      prompts: 0, generation: 0, state: blocked ? "blocked" : "idle",
      detail: "Hold Ctrl+Q to dictate using the system default microphone. /voice start is the fallback." };
    current = s;
    ctx.ui.setWidget(KEY, (tui) => {
      s.tui = tui as FocusTUI;
      return { render(width) {
        const elapsed = s.recordingAt === undefined ? "" : ` ${Math.floor((Date.now() - s.recordingAt) / 1000)}s`;
        const input = s.input && s.operation ? ` | ${s.input}` : "";
        return [truncateToWidth(`Voice: ${s.state}${elapsed}${input} — ${s.detail}`, Math.max(1, width))];
      }, invalidate() {} };
    });
    s.unsubscribe = ctx.ui.onTerminalInput((data) => onInput(s, data));
    render(s);
  });
  pi.registerCommand("voice", {
    description: "Local dictation: start, stop, cancel, accept, status (system default microphone)",
    handler: async (args, ctx) => {
      const s = current;
      if (!s || !live(s) || ctx.mode !== "tui" || s.shutting) {
        ctx.ui.notify("Voice requires Pi's Linux terminal UI.", "error"); return;
      }
      const action = args.trim() || "status";
      if (action === "start") start(s);
      else if (action === "stop") stop(s);
      else if (action === "cancel") cancel(s);
      else if (action === "accept") {
        if (s.pending === undefined) notify(s, "No pending transcription to accept.", "warning");
        else if (s.ctx.sessionManager.getSessionId() !== s.pending.sessionId ||
            s.ctx.sessionManager.getLeafId() !== s.pending.leafId) {
          cancel(s, "Session or branch changed; pending dictation discarded.");
        } else if (!ready(s)) notify(s, "Close dialogs and return to the idle main editor before accepting.", "warning");
        else {
          const text = s.pending.text;
          s.pending = undefined;
          insert(s, text);
        }
      } else if (action === "status") {
        render(s);
        notify(s, s.detail, blocked ? "error" : "info");
      } else notify(s, "Usage: /voice [start|stop|cancel|accept|status]", "warning");
    },
  });
  // Inputs through non-keyboard paths still invalidate delivery; do not block them.
  pi.on("input", () => { if (current) cancel(current, "Prompt submitted; pending dictation discarded."); });
  pi.on("user_bash", () => { if (current) cancel(current, "Shell input started; pending dictation discarded."); });
  pi.on("before_agent_start", () => { if (current) cancel(current, "Agent started; pending dictation discarded."); });
  pi.on("ui_prompt_start", () => { if (current) { current.prompts++; uncertain(current); } });
  pi.on("ui_prompt_end", () => { if (current) current.prompts = Math.max(0, current.prompts - 1); });
  const invalidateSession = () => { if (current) cancel(current, "Session or branch changed; pending dictation discarded."); };
  pi.on("session_before_switch", invalidateSession);
  pi.on("session_before_fork", invalidateSession);
  pi.on("session_before_tree", invalidateSession);
  pi.on("session_tree", invalidateSession);
  pi.on("session_before_compact", invalidateSession);
  pi.on("session_shutdown", async () => { if (current) await shutdown(current); });
}
