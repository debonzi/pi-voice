import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { VoiceConfig } from "./config.ts";

export type WorkerState = "starting" | "recording" | "stopping" | "transcribing" | "cleaning";
export type WorkerResult = {
  outcome: "completed" | "canceled" | "empty" | "error";
  cleanupOk: boolean;
  text?: string;
  message?: string;
};
export type WorkerHandle = { stop(): void; cancel(): void; done: Promise<WorkerResult> };
export type WorkerCallbacks = {
  state(state: WorkerState, input?: string): void;
  warning(message: string): void;
};
export type ClientDependencies = {
  spawn: typeof spawn;
  watchdogMs: number;
};
const defaults: ClientDependencies = { spawn, watchdogMs: 10_000 };
const states = new Set(["starting", "recording", "stopping", "transcribing", "cleaning"]);
const outcomes = new Set(["completed", "canceled", "empty", "error"]);
const MAX_LINE_BYTES = 32 * 1024 * 1024;
const safe = (text: string) => text.replace(/[\x00-\x1f\x7f-\x9f]/gu, " ").slice(0, 256);

/** One private supervisor per operation. Never kill it while it may own a recorder. */
export function startWorker(config: VoiceConfig, callbacks: WorkerCallbacks,
  overrides: Partial<ClientDependencies> = {}): WorkerHandle {
  const deps = { ...defaults, ...overrides };
  let child: ChildProcessWithoutNullStreams | undefined;
  let closed = false, stopped = false, canceled = false, pipeEnded = false;
  let fault: string | undefined, buffer = "", staged: string | undefined;
  let finished: WorkerResult | undefined;
  let spawnFailed = false;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let resolveDone!: (result: WorkerResult) => void;
  const done = new Promise<WorkerResult>((resolve) => { resolveDone = resolve; });
  const clearWatch = () => { if (watchdog) clearTimeout(watchdog); watchdog = undefined; };
  function watch() {
    if (closed || watchdog) return;
    watchdog = setTimeout(() => {
      watchdog = undefined;
      if (!closed) callbacks.warning("Voice cleanup is not confirmed yet. Do not assume the microphone is closed.");
    }, deps.watchdogMs);
    watchdog.unref?.();
  }
  function endPipe() {
    if (!child || pipeEnded) return;
    pipeEnded = true;
    // EOF is an independent cancellation signal to the supervisor.
    try { child.stdin.end(); } catch { /* Keep awaiting close; never restart. */ }
  }
  function send(type: string, extra: object = {}) {
    if (!child || closed || pipeEnded) return;
    try {
      child.stdin.write(JSON.stringify({ type, ...extra }) + "\n", (error) => {
        if (error && !closed) fail("Voice control pipe failed.");
      });
    } catch { fail("Voice control pipe failed."); }
  }
  function cancel() {
    if (closed || canceled) return;
    canceled = true;
    staged = undefined;
    send("cancel");
    endPipe();
    watch();
  }
  function fail(message: string) {
    if (closed || fault) return;
    fault = message;
    buffer = "";
    cancel();
  }
  function line(value: string) {
    if (fault) return;
    try {
      if (Buffer.byteLength(value) > MAX_LINE_BYTES || !value || finished) throw new Error();
      const event = JSON.parse(value);
      if (!event || typeof event !== "object") throw new Error();
      if (event.type === "state" && states.has(event.state) &&
          (event.input === undefined || typeof event.input === "string")) {
        if (!canceled) callbacks.state(event.state, event.input === undefined ? undefined : safe(event.input));
        if (event.state === "transcribing" && !canceled) clearWatch();
        if (event.state === "cleaning") watch();
      } else if (event.type === "transcript" && typeof event.text === "string" && staged === undefined) {
        if (!canceled) staged = event.text;
      } else if (event.type === "finished" && outcomes.has(event.outcome) &&
          typeof event.cleanupOk === "boolean" &&
          (event.message === undefined || typeof event.message === "string") &&
          (event.cleanupOk || event.outcome === "error") &&
          (event.outcome !== "completed" || staged !== undefined || canceled)) {
        finished = { outcome: event.outcome, cleanupOk: event.cleanupOk,
          message: event.message === undefined ? undefined : safe(event.message) };
        watch();
      } else throw new Error();
    } catch { fail("Invalid voice worker protocol; no text was accepted."); }
  }
  try {
    child = deps.spawn(config.python, ["-B", fileURLToPath(new URL("../worker/voice_worker.py", import.meta.url))],
      { stdio: ["pipe", "pipe", "pipe"], shell: false }) as ChildProcessWithoutNullStreams;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (closed || fault) return; // Still drain the stream without retaining it.
      buffer += chunk;
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0 && !fault) {
        const value = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        line(value);
      }
      if (Buffer.byteLength(buffer) > MAX_LINE_BYTES) fail("Voice output resource limit exceeded.");
    });
    child.stderr.on("data", () => {}); // Do not show or persist raw diagnostics.
    child.stdout.on("error", () => fail("Voice output pipe failed."));
    child.stderr.on("error", () => fail("Voice diagnostic pipe failed."));
    child.stdin.on("error", () => fail("Voice control pipe failed."));
    child.on("error", () => {
      spawnFailed = child?.pid === undefined;
      fail("The local voice worker could not run.");
    });
    child.on("close", (code, signal) => {
      if (closed) return;
      // Require complete JSON lines, including a final newline.
      if (buffer) fail("Incomplete voice worker protocol; no text was accepted.");
      closed = true;
      clearWatch();
      endPipe();
      const cleanupOk = spawnFailed || (!fault && !signal && finished?.cleanupOk === true);
      let result: WorkerResult;
      if (fault || signal || !finished || (code !== 0 && finished.outcome !== "error")) {
        result = { outcome: "error", cleanupOk, message: fault || "Voice worker exited without a valid result." };
      } else if (!cleanupOk) {
        result = { outcome: "error", cleanupOk: false, message: "Audio cleanup failed; recording is blocked." };
      } else if (canceled) {
        result = { outcome: "canceled", cleanupOk: true };
      } else {
        result = { ...finished, text: finished.outcome === "completed" ? staged : undefined };
      }
      staged = buffer = "";
      resolveDone(result);
    });
    // Node queues this before spawn. Subsequent stop/cancel always follow start.
    const { python: _python, ...workerConfig } = config;
    send("start", { config: workerConfig });
  } catch {
    if (child) fail("Voice worker initialization failed.");
    else {
      closed = true;
      resolveDone({ outcome: "error", cleanupOk: true, message: "Could not spawn the local voice worker." });
    }
  }
  return { done, cancel, stop() {
    if (closed || stopped || canceled) return;
    stopped = true;
    send("stop");
    watch();
  } };
}
