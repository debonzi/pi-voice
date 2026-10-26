// E5 exploration only. Explicit -e loading in the disposable offline launcher only.
// No process/audio at factory or session_start; the first Ctrl+Q owns the sole attempt.
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, lstatSync, realpathSync, openSync, writeFileSync, closeSync, constants } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isKeyRelease, isKeyRepeat, matchesKey, parseKey, ScrollView, stripTerminalSequences, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

const HERE = dirname(fileURLToPath(import.meta.url));
const WIDGET = "voice-e5-trial";
const STATES = new Set(["preflight", "starting", "recording", "stopping", "transcribing", "cleaning"]);
const safe = (text: string) => stripTerminalSequences(text).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "�");
const inside = (root: string, candidate: string) => {
  const rel = relative(root, candidate);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};

// Only a private real directory below this exploration can receive metadata.
// Exclusive creation prevents changing an earlier verdict or following a verdict symlink.
export function saveVerdict(run: string, accepted: boolean): string {
  const root = realpathSync(HERE);
  if (!isAbsolute(run) || !inside(root, resolve(run)) || realpathSync(run) !== resolve(run)) {
    throw new Error("Refusing an untrusted run path");
  }
  const st = lstatSync(run);
  if (!st.isDirectory() || st.isSymbolicLink() || (st.mode & 0o077) !== 0 ||
      (typeof process.getuid === "function" && st.uid !== process.getuid())) {
    throw new Error("Run must be an owned private directory");
  }
  const target = join(run, "verdict.json");
  const fd = openSync(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    writeFileSync(fd, JSON.stringify({
      accepted, userConfirmed: true,
      source: `Pi /voice-test ${accepted ? "pass" : "fail"}`,
      recordedAt: new Date().toISOString(),
    }) + "\n");
  } finally { closeSync(fd); }
  return target;
}

type Dependencies = {
  spawnWorker: () => ChildProcessWithoutNullStreams;
  saveVerdict: typeof saveVerdict;
  watchdogMs: number;
};
const defaults: Dependencies = {
  spawnWorker: () => spawn(existsSync("/usr/bin/python3") ? "/usr/bin/python3" : "python3",
    ["-B", join(HERE, "worker.py"), "--worker"], { stdio: ["pipe", "pipe", "pipe"], shell: false, cwd: HERE }),
  saveVerdict,
  watchdogMs: 30_000,
};

type Session = {
  ctx: ExtensionContext; active: boolean; shutting: boolean; held: boolean;
  state: string; detail: string; run?: string; child?: ChildProcessWithoutNullStreams;
  stop: boolean; cancel: boolean; sentStop: boolean; sentCancel: boolean; pipeClosed: boolean;
  pendingText?: string; text?: string; finished?: { ok: boolean; outcome: string; run: string | null };
  fault?: string; closed: boolean; closePromise?: Promise<void>; resolveClose?: () => void;
  unsubscribe?: () => void; watchdog?: ReturnType<typeof setTimeout>;
  viewOpen: boolean; closeView?: () => void; verdict?: string; prompts: number;
};

export default function voiceTrial(pi: ExtensionAPI) { installVoiceTrial(pi); }

// Injection is solely for synthetic tests; normal loading uses the fixed local worker.
export function installVoiceTrial(pi: ExtensionAPI, overrides: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...overrides };
  let current: Session | undefined;
  let attempted = false; // Never reset by a session change, failure, or command.
  const live = (s: Session) => current === s && s.active;
  const notify = (s: Session, text: string, kind: "info" | "warning" | "error" = "info") => {
    if (live(s)) s.ctx.ui.notify(text, kind);
  };
  function render(s: Session) {
    if (!live(s)) return;
    s.ctx.ui.setStatus(WIDGET, `E5 local voice: ${s.state}`);
    s.ctx.ui.setWidget(WIDGET, [
      `E5 ONE-SHOT LOCAL VOICE | ${s.state} | ${s.detail}`,
      "Hold Ctrl+Q to record SoundWire mic; release Q to finish. No recording-duration limit.",
      "/voice-test stop finalizes; /voice-test cancel or Escape cancels while live.",
      "/voice-test view opens full local transcript; close viewer, then /voice-test pass or fail.",
      `Run: ${s.run ? safe(s.run) : "not created (no microphone until first Ctrl+Q)"}`,
      "No prompt submission, transcript saving, streaming ASR, reset, or retry. Exit this disposable Pi when done.",
    ]);
  }
  function clearWatch(s: Session) {
    if (s.watchdog) clearTimeout(s.watchdog);
    s.watchdog = undefined;
  }
  function watchCleanup(s: Session) {
    if (s.watchdog || s.closed) return;
    s.watchdog = setTimeout(() => {
      s.watchdog = undefined;
      if (!live(s) || s.closed) return;
      s.detail = "Cleanup has not confirmed exit. Keep this diagnostic visible; do not assume mic is closed.";
      render(s);
      notify(s, "Worker cleanup is taking longer than expected. No blind supervisor kill was sent; awaiting worker close.", "error");
    }, deps.watchdogMs);
    s.watchdog.unref?.();
  }
  function writeAction(s: Session, action: string) {
    if (!s.child || s.pipeClosed || s.closed) return;
    try {
      s.child.stdin.write(JSON.stringify({ action }) + "\n", (error) => {
        if (error && live(s) && !s.closed) fail(s, "Worker control pipe failed");
      });
    } catch { fail(s, "Worker control pipe failed"); }
  }
  function closePipe(s: Session) {
    if (!s.child || s.pipeClosed) return;
    s.pipeClosed = true;
    try { s.child.stdin.end(); } catch { /* EOF/error is worker cancellation, never restart. */ }
  }
  function flushControls(s: Session) {
    if (!s.child || s.closed) return;
    if (s.stop && !s.sentStop) { s.sentStop = true; writeAction(s, "stop"); }
    if (s.cancel && !s.sentCancel) { s.sentCancel = true; writeAction(s, "cancel"); closePipe(s); }
  }
  function stop(s: Session) {
    if (!live(s) || !attempted || s.closed || s.cancel || s.stop || (!s.child && !s.closePromise)) return;
    s.stop = true;
    s.held = false;
    s.state = "stopping";
    s.detail = "Release/stop requested; waiting for worker finalization.";
    watchCleanup(s);
    flushControls(s);
    render(s);
  }
  function cancel(s: Session) {
    if (!live(s) || s.closed || s.cancel) return;
    s.cancel = true;
    s.held = false;
    s.pendingText = s.text = undefined;
    if (!attempted || (!s.child && !s.closePromise)) { attempted = true; s.closed = true; s.state = "cancelled"; }
    else { s.state = "cancelling"; watchCleanup(s); }
    s.detail = "Cancelled; no retry is authorized. Awaiting cleanup if worker exists.";
    flushControls(s);
    render(s);
  }
  function fail(s: Session, reason: string) {
    if (!live(s) || s.fault) return;
    s.fault = safe(reason).slice(0, 240);
    cancel(s);
    s.detail = s.fault + (s.closed ? "" : "; cancelling and awaiting worker cleanup.");
    render(s);
  }
  function parseEvent(s: Session, line: string) {
    if (!live(s) || !line.trim()) return;
    try {
      const event = JSON.parse(line);
      if (!event || typeof event !== "object" || s.finished) throw new Error();
      if (event.event === "run") {
        if (typeof event.run !== "string" || !isAbsolute(event.run) || !inside(HERE, resolve(event.run)) || (s.run && s.run !== event.run)) throw new Error();
        s.run = event.run;
      } else if (event.event === "state" && STATES.has(event.state)) {
        if (!s.cancel) {
          s.state = s.stop && ["preflight", "starting", "recording"].includes(event.state) ? "stopping" : event.state;
          s.detail = s.state === "recording" ? "Recording while held. /voice-test stop if release is unavailable." : "Local worker progressing.";
        }
        if (event.state === "transcribing" && !s.cancel) clearWatch(s);
        else if (["stopping", "cleaning"].includes(event.state)) watchCleanup(s);
      } else if (event.event === "stream-active") {
        if (!s.cancel && !s.stop) { s.state = "recording"; s.detail = "SoundWire capture active; release Q to finalize."; }
      } else if (event.event === "transcript" && typeof event.text === "string" && s.pendingText === undefined) {
        if (!s.cancel) s.pendingText = event.text; // Never render before finished + successful close.
      } else if (event.event === "finished" && typeof event.ok === "boolean" &&
          ["transcribed", "cancelled", "error"].includes(event.outcome) &&
          event.ok === (event.outcome === "transcribed") &&
          (event.run === null || (typeof event.run === "string" && event.run === s.run))) {
        s.finished = { ok: event.ok, outcome: event.outcome, run: event.run };
        if (event.outcome === "error") s.fault = typeof event.error === "string" ? safe(event.error).slice(0, 240) : "Worker reported an error";
        s.state = "cleaning";
        s.detail = "Worker finished; waiting for process close before exposing any transcript.";
        watchCleanup(s);
      } else throw new Error();
      render(s);
    } catch { fail(s, "Invalid worker protocol; no transcript accepted"); }
  }
  async function view(s: Session, automatic = false) {
    if (!live(s) || s.shutting || s.viewOpen || s.text === undefined || s.state !== "complete" || (automatic && s.prompts > 0)) return;
    s.viewOpen = true;
    try {
      const text = safe(s.text); // Preserve full in-memory text; neutralize terminal controls for display.
      await s.ctx.ui.custom<void>((tui, theme, kb, done) => {
        // Do not steal focus from an existing visible overlay. Blocking extension
        // dialogs are also guarded by the public ui_prompt lifecycle hooks.
        if (automatic && tui.hasOverlay()) {
          done();
          return { render: () => [], invalidate() {} };
        }
        let cachedWidth = 0;
        let cachedLines: string[] = [];
        const scroll = new ScrollView({
          render(width) {
            width = Math.max(1, width);
            if (cachedWidth !== width) {
              cachedWidth = width;
              cachedLines = wrapTextWithAnsi(text || "[Empty transcript]", width);
            }
            return cachedLines;
          },
          invalidate() { cachedWidth = 0; cachedLines = []; },
        }, { scrollbar: "hidden", overscroll: "contain" });
        let page = 1;
        s.closeView = () => done();
        return {
          render(width: number) {
            page = Math.max(1, Math.min(24, tui.terminal.rows - 6));
            const all = scroll.render(Math.max(1, width));
            scroll.updateLayout(all.length, page, () => tui.requestRender());
            return [
              theme.fg("accent", "E5 full transcript — local memory only"),
              ...all.slice(scroll.scrollTop, scroll.scrollTop + page),
              `Lines ${scroll.scrollTop + 1}-${Math.min(all.length, scroll.scrollTop + page)} / ${all.length}`,
              "Up/Down, PageUp/PageDown, Home/End scroll. Escape/Enter closes.",
              "Then /voice-test pass or fail records metadata only; no text is saved.",
            ].map((line) => truncateToWidth(line, Math.max(1, width)));
          },
          handleInput(data: string) {
            if (isKeyRelease(data)) return;
            if (kb.matches(data, "tui.select.cancel") || kb.matches(data, "tui.select.confirm")) { done(); return; }
            if (kb.matches(data, "tui.select.up")) scroll.scrollBy(-1);
            else if (kb.matches(data, "tui.select.down")) scroll.scrollBy(1);
            else if (kb.matches(data, "tui.select.pageUp")) scroll.scrollBy(-page);
            else if (kb.matches(data, "tui.select.pageDown")) scroll.scrollBy(page);
            else if (matchesKey(data, "home")) scroll.scrollToStart();
            else if (matchesKey(data, "end")) scroll.scrollToEnd();
            tui.requestRender();
          },
          invalidate() { scroll.invalidate(); },
        };
      }, { overlay: true, overlayOptions: { width: "95%", maxHeight: "95%" } });
    } catch { notify(s, "Transcript viewer could not open. Use /voice-test view after closing other dialogs.", "error"); }
    finally { s.viewOpen = false; s.closeView = undefined; }
  }
  function start(s: Session) {
    if (!live(s) || s.shutting || attempted) return;
    attempted = true;
    s.state = "starting";
    s.detail = "Starting the single local worker; release is queued even during startup.";
    s.closePromise = new Promise((resolveClose) => { s.resolveClose = resolveClose; });
    render(s);
    try {
      const child = deps.spawnWorker();
      s.child = child;
      let buffer = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        if (!live(s) || s.closed) return;
        buffer += chunk;
        let end: number;
        while ((end = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          parseEvent(s, line);
        }
      });
      // Deliberately discard stderr: never accidentally show or persist ASR text/logs.
      child.stderr.on("data", () => {});
      child.stdout.on("error", () => { if (!s.closed) fail(s, "Worker output pipe failed"); });
      child.stderr.on("error", () => { if (!s.closed) fail(s, "Worker diagnostic pipe failed"); });
      child.stdin.on("error", () => { if (!s.closed) fail(s, "Worker control pipe closed unexpectedly"); });
      child.on("error", () => fail(s, "Worker could not start or encountered a process error"));
      child.on("close", (code, signal) => {
        if (!live(s) || s.closed) { s.resolveClose?.(); return; }
        if (buffer.trim()) parseEvent(s, buffer);
        buffer = "";
        s.closed = true;
        clearWatch(s);
        closePipe(s);
        const success = !s.shutting && !s.cancel && !s.fault && code === 0 && !signal &&
          s.finished?.ok && s.finished.outcome === "transcribed" && s.finished.run && s.pendingText !== undefined;
        if (success) {
          s.text = s.pendingText;
          s.state = "complete";
          s.detail = "One batch transcript ready. View it, then explicitly pass/fail; no retry.";
        } else {
          s.text = undefined;
          const cancelled = s.cancel || s.finished?.outcome === "cancelled";
          s.state = s.fault || !cancelled ? "error" : "cancelled";
          s.detail = s.fault || (cancelled ? "Cancelled and worker closed. No retry." : "Worker closed without a valid successful result. No retry.");
        }
        s.pendingText = undefined;
        render(s);
        s.resolveClose?.();
        if (success) {
          notify(s, "Transcript ready in local memory only. /voice-test view; then /voice-test pass or fail.");
          if (s.ctx.isIdle() && s.ctx.ui.getEditorText() === "") void view(s, true).catch(() => notify(s, "Use /voice-test view.", "error"));
        } else if (!s.shutting) notify(s, s.detail, s.state === "error" ? "error" : "info");
      });
      // Node queues writes made before its 'spawn' event. Always start BEFORE queued stop/cancel.
      writeAction(s, "start");
      flushControls(s);
    } catch {
      if (s.child) { fail(s, "Worker initialization failed"); return; }
      s.closed = true;
      s.state = "error";
      s.detail = "Could not spawn local worker. Attempt consumed; no retry.";
      clearWatch(s);
      s.resolveClose?.();
      render(s);
      notify(s, s.detail, "error");
    }
  }
  async function shutdown(s: Session) {
    if (!live(s)) return;
    s.shutting = true;
    if (s.closePromise && !s.closed) { cancel(s); closePipe(s); await s.closePromise; }
    // Keep the listener/UI until owned worker cleanup is confirmed by close.
    s.closeView?.();
    s.unsubscribe?.();
    clearWatch(s);
    s.active = false;
    s.held = false;
    s.text = s.pendingText = undefined;
    s.ctx.ui.setWidget(WIDGET, undefined);
    s.ctx.ui.setStatus(WIDGET, undefined);
    if (current === s) current = undefined;
  }
  pi.on("session_start", async (_event, ctx) => {
    if (current) await shutdown(current);
    if (ctx.mode !== "tui") return;
    const s: Session = { ctx, active: true, shutting: false, held: false,
      state: attempted ? "spent" : "idle", detail: attempted ? "One attempt already consumed. No retry." : "Ready; microphone is NOT open.",
      stop: false, cancel: false, sentStop: false, sentCancel: false, pipeClosed: false, closed: false, viewOpen: false, prompts: 0 };
    current = s;
    s.unsubscribe = ctx.ui.onTerminalInput((data) => {
      if (!live(s) || data.includes("\x1b[200~")) return undefined;
      const release = isKeyRelease(data);
      const chord = matchesKey(data, "ctrl+q");
      const latched = s.held && release && parseKey(data)?.split("+").at(-1) === "q";
      if (chord || latched) {
        if (s.shutting) return { consume: true };
        if (release) { s.held = false; stop(s); }
        else if (!isKeyRepeat(data) && !s.held && !attempted) { s.held = true; start(s); }
        return { consume: true };
      }
      if (!release && !isKeyRepeat(data) && matchesKey(data, "escape") && s.child && !s.closed) {
        cancel(s);
        return { consume: true };
      }
      return undefined;
    });
    render(s);
  });
  pi.registerCommand("voice-test", {
    description: "E5 single local voice trial: status, stop, cancel, view, pass, fail (no reset)",
    handler: async (args, ctx) => {
      const s = current;
      if (!s || s.ctx.mode !== "tui" || s.shutting) { ctx.ui.notify("E5 requires the disposable interactive offline launcher.", "error"); return; }
      const action = args.trim() || "status";
      if (action === "stop") { stop(s); render(s); }
      else if (action === "cancel") cancel(s);
      else if (action === "view") {
        if (s.text === undefined) notify(s, "No successfully completed transcript to view.", "warning");
        else await view(s);
      } else if (action === "pass" || action === "fail") {
        if (s.state !== "complete" || s.text === undefined || !s.run || !s.closed) { notify(s, "A successful result is required before a verdict.", "warning"); return; }
        if (s.verdict) { notify(s, `Verdict already recorded: ${s.verdict}`, "warning"); return; }
        try {
          s.verdict = deps.saveVerdict(s.run, action === "pass");
          s.detail = `Explicit ${action} verdict metadata: ${safe(s.verdict)}`;
          render(s);
          notify(s, s.detail);
        } catch { notify(s, "Verdict not written: untrusted/nonprivate path or verdict already exists. No transcript was saved.", "error"); }
      } else if (action === "status") render(s);
      else notify(s, "Usage: /voice-test [status|stop|cancel|view|pass|fail]. No reset/retry.", "warning");
    },
  });
  pi.on("input", (_event, ctx) => {
    ctx.ui.notify("E5 diagnostic blocks prompts. Use Ctrl+Q or /voice-test; nothing is sent to an agent.", "warning");
    return { action: "handled" };
  });
  pi.on("user_bash", () => ({ result: { output: "Shell input disabled in the E5 diagnostic.", exitCode: 1, cancelled: false, truncated: false } }));
  pi.on("ui_prompt_start", () => { if (current) current.prompts++; });
  pi.on("ui_prompt_end", () => { if (current) current.prompts = Math.max(0, current.prompts - 1); });
  pi.on("cache_warming_decision", () => ({ action: "stop" }));
  pi.on("session_before_switch", () => ({ cancel: true }));
  pi.on("session_before_fork", () => ({ cancel: true }));
  pi.on("session_shutdown", async () => { if (current) await shutdown(current); });
}
