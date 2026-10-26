// Synthetic events and fake subprocesses only. Never starts worker.py, audio or inference.
// node --test voice-trial.test.mjs [uses installed Pi 1.4.0; optional PI_TEST_MODULE_ROOT]
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { test } from "node:test";
import { mkdtempSync, chmodSync, mkdirSync, readFileSync, statSync, symlinkSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = process.env.PI_TEST_MODULE_ROOT || "/home/debonzi/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works";
const { visibleWidth } = await import(pathToFileURL(join(root, "pi-tui/dist/index.js")).href);
const { createJiti } = await import(pathToFileURL(join(root, "pi-coding-agent/dist/core/extensions/jiti-loader.js")).href);
const jiti = createJiti(import.meta.url, { fsCache: false, moduleCache: false,
  alias: { "@earendil-works/pi-tui": join(root, "pi-tui/dist/index.js") } });
const { installVoiceTrial, saveVerdict } = await jiti.import(fileURLToPath(new URL("./voice-trial.ts", import.meta.url)));
const here = dirname(fileURLToPath(import.meta.url));
const run = join(here, "synthetic-private-run"); // No path is touched by mocked worker tests.
const press = "\x1b[113;5:1u", repeat = "\x1b[113;5:2u", release = "\x1b[113;5:3u";
const plainRelease = "\x1b[113;1:3u";
const tick = () => new Promise((done) => setImmediate(done));
class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.actions = [];
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.stdin = new Writable({ write: (chunk, _enc, done) => { this.actions.push(JSON.parse(String(chunk)).action); done(); } });
    this.kills = [];
  }
  kill(signal) { this.kills.push(signal); throw new Error("The diagnostic must never blindly kill its supervisor"); }
  send(event) { this.stdout.write(JSON.stringify(event) + "\n"); }
  close(code = 0, signal = null) { this.emit("close", code, signal); }
}
function fixture(options = {}) {
  const handlers = new Map(), commands = new Map(), listeners = new Set(), widgets = new Map(), statuses = new Map();
  const notices = [], children = [], saves = [], views = [];
  let spawnHook;
  let factorySpawnCalls = 0;
  const ctx = { mode: "tui", hasUI: true, isIdle: () => options.idle ?? true, ui: {
    onTerminalInput(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    setWidget: (key, value) => widgets.set(key, value),
    setStatus: (key, value) => statuses.set(key, value),
    notify: (...args) => notices.push(args), getEditorText: () => options.editor || "",
    custom(factory) {
      let done, alreadyDone = false;
      const promise = new Promise((resolve) => { done = () => { alreadyDone = true; resolve(); }; });
      const kb = { matches: (data, action) => ({ "tui.select.up": "up", "tui.select.down": "down", "tui.select.pageUp": "pageUp", "tui.select.pageDown": "pageDown", "tui.select.cancel": "escape", "tui.select.confirm": "enter" })[action] === data };
      const tui = { terminal: { rows: 15 }, requestRender() {}, hasOverlay: () => !!options.overlay };
      const component = factory(tui, { fg: (_color, text) => text }, kb, done);
      if (!alreadyDone) views.push({ component, done, tui });
      return promise;
    },
  } };
  installVoiceTrial({
    on: (name, fn) => handlers.set(name, fn),
    registerCommand: (name, spec) => commands.set(name, spec),
    sendMessage() { throw new Error("Must not send transcript"); },
    appendEntry() { throw new Error("Must not persist transcript"); },
  }, {
    spawnWorker() {
      factorySpawnCalls++;
      if (options.spawnError) throw new Error("synthetic failure");
      const child = new FakeChild();
      children.push(child);
      spawnHook?.();
      return child;
    },
    saveVerdict(path, accepted) { saves.push({ path, accepted }); return join(path, "verdict.json"); },
    watchdogMs: options.watchdogMs ?? 100_000,
  });
  const dispatch = (data) => { for (const fn of listeners) { const result = fn(data); if (result?.consume) return result; } };
  const f = {
    ctx, handlers, commands, listeners, widgets, statuses, notices, children, saves, views, dispatch,
    get spawnCalls() { return factorySpawnCalls; },
    setSpawnHook(fn) { spawnHook = fn; },
    start: () => handlers.get("session_start")({}, ctx),
    shutdown: () => handlers.get("session_shutdown")({}, ctx),
    command: (args) => commands.get("voice-test").handler(args, ctx),
    text: () => widgets.get("voice-e5-trial")?.join("\n") || "",
  };
  return f;
}
function success(child, text = "PRIVATE FULL TRANSCRIPT") {
  child.send({ event: "run", run });
  child.send({ event: "state", state: "transcribing" });
  child.send({ event: "transcript", text });
  child.send({ event: "finished", ok: true, outcome: "transcribed", run });
}

test("factory/startup are process-free; non-TUI startup installs no listener", async () => {
  const f = fixture();
  assert.equal(f.spawnCalls, 0); assert.equal(f.listeners.size, 0);
  await f.start(); assert.equal(f.listeners.size, 1); assert.equal(f.spawnCalls, 0);
  assert.match(f.text(), /idle/); assert.match(f.text(), /microphone is NOT open/);
  await f.shutdown(); assert.equal(f.listeners.size, 0); assert.equal(f.text(), "");
  await f.handlers.get("session_start")({}, { mode: "rpc" }); assert.equal(f.listeners.size, 0);
});

test("first nonrepeat press only, ordinary/Kitty repeats ignored, changed-modifier Q release stops once", async () => {
  const f = fixture(); await f.start();
  assert.equal(f.dispatch(repeat)?.consume, true); assert.equal(f.spawnCalls, 0);
  assert.equal(f.dispatch("ordinary"), undefined);
  assert.equal(f.dispatch(`\x1b[200~${press}\x1b[201~`), undefined);
  assert(f.dispatch(press)?.consume);
  const c = f.children[0]; assert.deepEqual(c.actions, ["start"]);
  f.dispatch(press); f.dispatch(repeat); f.dispatch("\x11"); assert.equal(f.spawnCalls, 1);
  assert(f.dispatch(plainRelease)?.consume); assert.deepEqual(c.actions, ["start", "stop"]);
  assert.equal(f.dispatch(plainRelease), undefined);
  f.dispatch(release); await f.command("stop"); assert.deepEqual(c.actions, ["start", "stop"]);
  c.send({ event: "finished", ok: false, outcome: "cancelled", run: null }); c.close();
  f.dispatch(press); assert.equal(f.spawnCalls, 1);
  await f.shutdown();
});

test("release/cancel reentering during spawn are queued after start, never dropped", async () => {
  for (const cancelEarly of [false, true]) {
    const f = fixture(); await f.start();
    f.setSpawnHook(() => { f.dispatch(release); if (cancelEarly) void f.command("cancel"); });
    f.dispatch(press);
    assert.deepEqual(f.children[0].actions, cancelEarly ? ["start", "stop", "cancel"] : ["start", "stop"]);
    if (cancelEarly) assert.equal(f.children[0].stdin.writableEnded, true);
    f.children[0].close(1); await f.shutdown();
  }
});

test("legacy Ctrl+Q duplicates do not toggle; explicit stop handles absent release", async () => {
  const f = fixture(); await f.start(); f.dispatch("\x11"); f.dispatch("\x11");
  assert.equal(f.spawnCalls, 1); assert.deepEqual(f.children[0].actions, ["start"]);
  await f.command("stop"); assert.deepEqual(f.children[0].actions, ["start", "stop"]);
  f.children[0].close(1); await f.shutdown();
});

test("full transcript stays hidden until finished AND successful close, then scrollable memory viewer", async () => {
  const f = fixture(); await f.start(); f.dispatch(press); f.dispatch(release);
  const c = f.children[0];
  c.send({ event: "run", run });
  const secret = Array.from({ length: 90 }, (_, i) => `PRIVATE-LINE-${i} 中文`).join("\n");
  // Exercise fragmented JSON and UTF-8 decoding via real mock streams.
  const data = Buffer.from(JSON.stringify({ event: "transcript", text: secret }) + "\n");
  for (let n = 0; n < data.length; n += 7) c.stdout.write(data.subarray(n, n + 7));
  assert.equal(f.views.length, 0); assert(!f.text().includes("PRIVATE-LINE"));
  await f.command("view"); assert.equal(f.views.length, 0);
  c.send({ event: "finished", ok: true, outcome: "transcribed", run });
  assert.equal(f.views.length, 0);
  c.close(); await tick();
  assert.equal(f.views.length, 1); assert.match(f.text(), /complete/); assert(!f.text().includes("PRIVATE-LINE"));
  const v = f.views[0];
  assert(v.component.render(65).join("\n").includes("PRIVATE-LINE-0"));
  v.component.handleInput("\x1b[F"); // public matchesKey End
  assert(v.component.render(65).join("\n").includes("PRIVATE-LINE-89"));
  v.component.handleInput("pageUp"); assert(!v.component.render(65).join("\n").includes("PRIVATE-LINE-89"));
  v.component.handleInput("\x1b[H"); assert(v.component.render(65).join("\n").includes("PRIVATE-LINE-0"));
  assert(v.component.render(1).every((line) => visibleWidth(line) <= 1));
  v.component.invalidate(); v.component.handleInput("escape"); await tick();
  assert.equal(f.saves.length, 0);
  await f.command("pass"); assert.deepEqual(f.saves, [{ path: run, accepted: true }]);
  await f.command("fail"); assert.equal(f.saves.length, 1);
  assert.equal(c.stdin.writableEnded, true); await f.shutdown();
});

test("busy/editor-in-use avoids auto-opening; manual view remains available", async () => {
  for (const options of [{ idle: false }, { editor: "/voice-test status" }, { overlay: true }, { dialog: true }]) {
    const f = fixture(options); await f.start(); f.dispatch(press);
    if (options.dialog) f.handlers.get("ui_prompt_start")({ kind: "custom" }, f.ctx);
    success(f.children[0], "secret"); f.children[0].close();
    await tick(); assert.equal(f.views.length, 0);
    if (options.dialog) f.handlers.get("ui_prompt_end")({ kind: "custom" }, f.ctx);
    const p = f.command("view"); assert.equal(f.views.length, 1); f.views[0].done(); await p;
    await f.shutdown();
  }
});

test("nonzero/signal/missing finished/protocol failure never reveal buffered transcript or enable verdict", async () => {
  for (const kind of ["nonzero", "signal", "missing", "malformed", "duplicate", "badpath"]) {
    const f = fixture(); await f.start(); f.dispatch(press); const c = f.children[0];
    if (kind === "missing") c.send({ event: "transcript", text: "DO NOT EXPOSE" });
    else if (kind === "malformed") c.stdout.write("not-json\n");
    else if (kind === "badpath") c.send({ event: "run", run: "/tmp/not-approved" });
    else { success(c); if (kind === "duplicate") c.send({ event: "finished", ok: true, outcome: "transcribed", run }); }
    c.close(kind === "nonzero" ? 1 : 0, kind === "signal" ? "SIGTERM" : null);
    await tick(); assert.equal(f.views.length, 0); assert.match(f.text(), /error/);
    await f.command("pass"); assert.equal(f.saves.length, 0);
    f.dispatch(press); assert.equal(f.spawnCalls, 1); await f.shutdown();
  }
});

test("spawn and control pipe errors are handled; single attempt remains consumed", async () => {
  const bad = fixture({ spawnError: true }); await bad.start(); bad.dispatch(press);
  assert.match(bad.text(), /Could not spawn/); bad.dispatch(press); assert.equal(bad.spawnCalls, 1); await bad.shutdown();
  const f = fixture(); await f.start(); f.dispatch(press); f.children[0].stdin.emit("error", new Error("fake EPIPE"));
  assert.match(f.text(), /control pipe/); assert.deepEqual(f.children[0].actions, ["start", "cancel"]);
  f.children[0].close(1); await f.shutdown();
});

test("shutdown sends cancel+EOF and awaits worker close before removing listener/UI", async () => {
  const f = fixture(); await f.start(); f.dispatch(press); const c = f.children[0];
  let settled = false;
  const closing = f.shutdown().then(() => { settled = true; });
  await tick(); assert.equal(settled, false); assert.equal(f.listeners.size, 1); assert(f.text());
  assert.deepEqual(c.actions, ["start", "cancel"]); assert.equal(c.stdin.writableEnded, true);
  success(c, "SHOULD NOT SHOW"); c.close(); await closing;
  assert.equal(f.listeners.size, 0); assert.equal(f.text(), ""); assert.equal(f.views.length, 0); assert.deepEqual(c.kills, []);
  c.send({ event: "state", state: "recording" }); assert.equal(f.text(), "");
  await f.start(); assert.match(f.text(), /spent/); f.dispatch(press); assert.equal(f.spawnCalls, 1);
  const before = f.text(); c.emit("error", new Error("stale callback"));
  c.send({ event: "state", state: "recording" }); assert.equal(f.text(), before);
  await f.shutdown();
});

test("shutdown reentering during spawn still queues start/cancel/EOF and waits", async () => {
  const f = fixture(); await f.start(); let closing;
  f.setSpawnHook(() => { closing = f.shutdown(); });
  f.dispatch(press); const c = f.children[0];
  assert.deepEqual(c.actions, ["start", "cancel"]); assert.equal(c.stdin.writableEnded, true);
  assert.equal(f.listeners.size, 1); c.close(1); await closing;
  assert.equal(f.listeners.size, 0); assert.equal(f.text(), "");
});

test("stdout/stderr errors cancel cleanly, discard raw stderr and never expose failed text", async () => {
  for (const pipe of ["stdout", "stderr"]) {
    const f = fixture(); await f.start(); f.dispatch(press); const c = f.children[0];
    c.stderr.write("PRIVATE RAW STDERR"); c[pipe].emit("error", new Error("synthetic read error"));
    assert.deepEqual(c.actions, ["start", "cancel"]);
    c.close(1); assert.match(f.text(), /error/);
    assert(!JSON.stringify(f.notices).includes("PRIVATE RAW STDERR")); await f.shutdown();
  }
  const f = fixture(); await f.start(); f.dispatch(press); const c = f.children[0];
  c.send({ event: "transcript", text: "FAILED TEXT" });
  c.send({ event: "finished", ok: false, outcome: "error", run: null, error: "Explicit worker failure" }); c.close(1);
  assert.match(f.text(), /Explicit worker failure/); assert.equal(f.views.length, 0); await f.shutdown();
});

test("Escape and explicit cancel are idempotent; worker-cancelled outcome is not success", async () => {
  for (const local of [true, false]) {
    const f = fixture(); await f.start(); f.dispatch(press); const c = f.children[0];
    if (local) { assert(f.dispatch("\x1b")?.consume); await f.command("cancel"); assert.deepEqual(c.actions, ["start", "cancel"]); }
    c.send({ event: "finished", ok: false, outcome: "cancelled", run: null }); c.close(1);
    assert.match(f.text(), /cancelled/); assert.equal(f.views.length, 0); await f.shutdown();
  }
});

test("idle cancellation disarms without spawning; no reset/retry command", async () => {
  const f = fixture(); await f.start(); await f.command("cancel"); f.dispatch(press);
  await f.command("reset"); assert.equal(f.spawnCalls, 0); assert.match(f.text(), /cancelled/); await f.shutdown();
});

test("cleanup-only watchdog warns without kill; transcribing is not a recording/inference timer", async () => {
  const f = fixture({ watchdogMs: 15 }); await f.start(); f.dispatch(press); const c = f.children[0];
  await new Promise((r) => setTimeout(r, 25)); assert(!f.notices.some(([s]) => /taking longer/.test(s)));
  f.dispatch(release); c.send({ event: "state", state: "transcribing" });
  await new Promise((r) => setTimeout(r, 25)); assert(!f.notices.some(([s]) => /taking longer/.test(s)));
  await f.command("cancel"); await new Promise((r) => setTimeout(r, 25));
  assert(f.notices.some(([s]) => /taking longer/.test(s))); assert.deepEqual(c.kills, []);
  c.close(1); await f.shutdown();
});

test("ordinary input/user_bash blocked, cache warming disabled, session-switch/fork blocked", async () => {
  const f = fixture(); await f.start();
  assert.equal(f.handlers.get("input")({ text: "never send", source: "interactive" }, f.ctx).action, "handled");
  assert.equal(f.handlers.get("input")({ text: "never send", source: "extension" }, f.ctx).action, "handled");
  assert.equal(f.handlers.get("user_bash")({ command: "must not run" }).result.exitCode, 1);
  assert.deepEqual(f.handlers.get("cache_warming_decision")(), { action: "stop" });
  assert.deepEqual(f.handlers.get("session_before_switch")(), { cancel: true });
  assert.deepEqual(f.handlers.get("session_before_fork")(), { cancel: true });
  await f.shutdown();
});

test("real verdict writer creates ONLY exclusive 0600 metadata; rejects traversal/symlink/nonprivate paths", () => {
  const dir = mkdtempSync(join(here, ".ui-verdict-test-")); chmodSync(dir, 0o700);
  try {
    const good = join(dir, "private"); mkdirSync(good, { mode: 0o700 });
    const target = saveVerdict(good, false);
    assert.equal(statSync(target).mode & 0o777, 0o600);
    const data = JSON.parse(readFileSync(target, "utf8"));
    assert.equal(data.accepted, false); assert.equal(data.userConfirmed, true); assert.equal(data.source, "Pi /voice-test fail");
    assert.deepEqual(Object.keys(data).sort(), ["accepted", "recordedAt", "source", "userConfirmed"]);
    assert.throws(() => saveVerdict(good, true));
    const wide = join(dir, "public"); mkdirSync(wide, { mode: 0o700 }); chmodSync(wide, 0o755);
    assert.throws(() => saveVerdict(wide, true));
    const link = join(dir, "link"); symlinkSync(good, link); assert.throws(() => saveVerdict(link, true));
    assert.throws(() => saveVerdict(resolve(here, ".."), true));
    assert.throws(() => saveVerdict("relative/path", true));
    assert.throws(() => saveVerdict(join(here, "absent-fake-path"), true));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
