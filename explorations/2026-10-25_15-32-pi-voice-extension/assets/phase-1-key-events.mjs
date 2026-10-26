// Exploration-only assertions against the installed Pi keyboard implementation.
// No stdin/TTY access, terminal writes, microphone, child process, or settings changes.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const tuiRoot = process.argv[2];
if (!tuiRoot) {
  console.error("Usage: node phase-1-key-events.mjs /absolute/path/to/@earendil-works/pi-tui");
  process.exit(1);
}
const load = (name) => import(pathToFileURL(path.resolve(tuiRoot, "dist", name)).href);
const keys = await load("keys.js");
const { TuiBase } = await load("tui.js");
const { StdinBuffer } = await load("stdin-buffer.js");
const { parseKeyboardProtocolNegotiationSequence } = await load("terminal.js");
const { matchesKey, parseKey, isKeyRelease, isKeyRepeat } = keys;
const press = "\x1b[114;6:1u";
const repeat = "\x1b[114;6:2u";
const release = "\x1b[114;6:3u";
let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`PASS ${passed}: ${name}`);
}

console.log(`Node: ${process.version}`);
console.log(`Pi TUI under test: ${path.resolve(tuiRoot)}`);

test("Kitty Ctrl+Shift+R identity matches press, repeat, and release", () => {
  for (const data of [press, repeat, release]) {
    assert(matchesKey(data, "ctrl+shift+r"));
    assert.equal(parseKey(data), "shift+ctrl+r");
  }
});

test("repeat/release helpers distinguish event types separately from identity", () => {
  assert(!isKeyRepeat(press) && !isKeyRelease(press));
  assert(isKeyRepeat(repeat) && !isKeyRelease(repeat));
  assert(isKeyRelease(release) && !isKeyRepeat(release));
});

test("legacy Ctrl+R has no Shift identity or release information", () => {
  assert(matchesKey("\x12", "ctrl+r"));
  assert(!matchesKey("\x12", "ctrl+shift+r"));
  assert(!isKeyRelease("\x12") && !isKeyRepeat("\x12"));
});

test("modifyOtherKeys distinguishes Ctrl+Shift+R but reports no release", () => {
  const data = "\x1b[27;6;82~";
  assert(matchesKey(data, "ctrl+shift+r"));
  assert(!isKeyRelease(data) && !isKeyRepeat(data));
});

test("R release after modifier changes no longer matches the activation chord", () => {
  for (const [modifier, identity] of [[1, "r"], [2, "shift+r"], [5, "ctrl+r"]]) {
    const data = `\x1b[114;${modifier}:3u`;
    assert(isKeyRelease(data));
    assert(matchesKey(data, identity));
    assert(!matchesKey(data, "ctrl+shift+r"));
  }
});

test("bracketed paste is not classified as repeat/release", () => {
  const data = `\x1b[200~${repeat}${release}\x1b[201~`;
  assert(!isKeyRelease(data) && !isKeyRepeat(data));
});

test("stdin buffer reconstructs split sequences and separates batched events", () => {
  const input = new StdinBuffer();
  const seen = [];
  input.on("data", (data) => seen.push(data));
  try {
    input.process(press.slice(0, 5));
    assert.deepEqual(seen, []);
    input.process(press.slice(5) + repeat + release);
    assert.deepEqual(seen, [press, repeat, release]);
  } finally {
    input.destroy();
  }
});

function fakeTui(listener, wantsKeyRelease = false) {
  const delivered = [];
  return {
    delivered,
    consumeTerminalColorResponse: () => false,
    consumeTerminalColorSchemeReport: () => false,
    consumeCellSizeResponse: () => false,
    inputListeners: new Set([listener]),
    overlayStack: [],
    getVisibleOverlayFocusRestore: () => ({ status: "none" }),
    focusedComponent: { wantsKeyRelease, handleInput: (data) => delivered.push(data) },
    requestImmediateRender: () => {},
  };
}
const dispatch = (tui, data) => TuiBase.prototype.handleTerminalInput.call(tui, data);

test("raw listener sees releases before default focused-component filtering", () => {
  const seen = [];
  const tui = fakeTui((data) => { seen.push(data); });
  dispatch(tui, press);
  dispatch(tui, repeat);
  dispatch(tui, release);
  assert.deepEqual(seen, [press, repeat, release]);
  assert.deepEqual(tui.delivered, [press, repeat]);
});

test("a component can opt in to releases", () => {
  const tui = fakeTui(() => undefined, true);
  dispatch(tui, release);
  assert.deepEqual(tui.delivered, [release]);
});

test("raw listener can consume owned input without delivering it to editor", () => {
  const tui = fakeTui((data) => matchesKey(data, "ctrl+shift+r") ? { consume: true } : undefined);
  for (const data of [press, repeat, release, "x"]) dispatch(tui, data);
  assert.deepEqual(tui.delivered, ["x"]);
});

test("Kitty negotiation parser retains flags, not just protocol presence", () => {
  assert.deepEqual(parseKeyboardProtocolNegotiationSequence("\x1b[?7u"), { type: "kitty-flags", flags: 7 });
  assert.deepEqual(parseKeyboardProtocolNegotiationSequence("\x1b[?1u"), { type: "kitty-flags", flags: 1 });
  assert.equal(7 & 2, 2);
  assert.equal(1 & 2, 0);
});

console.log(`Result: ${passed}/${passed} assertion groups passed.`);
console.log("Limit: synthetic events and dispatch harness only; no actual terminal validation.");
