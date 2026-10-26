// Synthetic validation only: loads the diagnostic factory with a mocked Pi UI.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = process.argv[2];
if (!root) throw new Error("Pass the installed @earendil-works module directory");
const { createJiti } = await import(pathToFileURL(path.resolve(root, "pi-coding-agent/dist/core/extensions/jiti-loader.js")).href);
const jiti = createJiti(import.meta.url, {
  fsCache: false,
  moduleCache: false,
  alias: { "@earendil-works/pi-tui": path.resolve(root, "pi-tui/dist/keys.js") },
});
const factory = await jiti.import(fileURLToPath(new URL("./ctrl-q-probe.ts", import.meta.url)), { default: true });
const events = new Map();
const commands = new Map();
const listeners = new Set();
const widgets = new Map();
const notifications = [];
factory({
  on: (event, handler) => events.set(event, handler),
  registerCommand: (name, options) => commands.set(name, options),
});
const ctx = { mode: "tui", ui: {
  onTerminalInput: (handler) => { listeners.add(handler); return () => listeners.delete(handler); },
  setWidget: (key, lines) => widgets.set(key, lines),
  notify: (...args) => notifications.push(args),
} };
const dispatch = (data) => {
  for (const listener of listeners) {
    const result = listener(data);
    if (result?.consume) return result;
  }
};
const text = () => widgets.get("voice-ctrl-q-probe").join("\n");
const command = (args) => commands.get("key-test").handler(args, ctx);
const press = "\x1b[113;5:1u";
const repeat = "\x1b[113;5:2u";
const release = "\x1b[113;5:3u";
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`PASS ${passed}: ${name}`); }

test("factory registers only hooks/command, without installing a listener", () => {
  assert.equal(listeners.size, 0);
  assert(commands.has("key-test"));
});
test("interactive startup arms one listener and shows the diagnostic", () => {
  events.get("session_start")({}, ctx);
  assert.equal(listeners.size, 1);
  assert(text().includes("ARMED") && text().includes("press=0 repeat=0 release=0 held=no"));
});
test("unrelated input and bracketed paste pass through without changing the display", () => {
  const before = text();
  assert.equal(dispatch("secret text"), undefined);
  assert.equal(dispatch(`\x1b[200~${press}\x1b[201~`), undefined);
  assert.equal(text(), before);
});
test("press/repeat/release are consumed and counted separately", () => {
  for (const data of [press, repeat, repeat, release]) assert(dispatch(data)?.consume);
  assert(text().includes("press=1 repeat=2 release=1 held=no"));
});
test("Q release after Ctrl changes is recognized only after activation", () => {
  command("reset");
  dispatch(press);
  assert(dispatch("\x1b[113;1:3u")?.consume);
  assert(text().includes("release=1 held=no") && text().includes("modifiers changed"));
  assert.equal(dispatch("\x1b[113;1:3u"), undefined);
});
test("legacy Ctrl+Q is visible but never invents a release event", () => {
  command("reset");
  dispatch("\x11");
  dispatch("\x11");
  assert(text().includes("press=2 repeat=0 release=0 held=yes"));
});
test("Escape manually stops without incrementing the release count", () => {
  assert(dispatch("\x1b")?.consume);
  assert(text().includes("STOPPED") && text().includes("release=0 held=no"));
  assert.equal(dispatch(press), undefined);
});
test("reset/result/stop commands work; invalid command leaves listener state alone", () => {
  command("reset");
  dispatch(press);
  command("");
  assert(notifications.at(-1)[0].includes("press=1"));
  const before = text();
  command("invalid");
  assert.equal(text(), before);
  command("stop");
  assert.equal(dispatch(press), undefined);
});
test("submitted prompts are handled locally rather than starting a model request", () => {
  assert.equal(events.get("input")({ text: "do not send" }, ctx).action, "handled");
});
test("replacement/startup and shutdown do not leak listeners", () => {
  events.get("session_start")({}, ctx);
  assert.equal(listeners.size, 1);
  events.get("session_start")({}, ctx);
  assert.equal(listeners.size, 1);
  events.get("session_shutdown")({}, ctx);
  assert.equal(listeners.size, 0);
  assert.equal(widgets.get("voice-ctrl-q-probe"), undefined);
  events.get("session_start")({}, { mode: "rpc" });
  assert.equal(listeners.size, 0);
});
console.log(`Result: ${passed}/${passed} synthetic diagnostic checks passed.`);
console.log("No physical key events, microphone access, or network/service connections tested.");
