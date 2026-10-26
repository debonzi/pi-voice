// Exploration-only evidence: resolve Pi's configured keybindings and compare
// selected alphabetic chords with a saved WezTerm show-keys dump.
// Does not load extensions, open a terminal, or change configuration.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [moduleRoot, agentDir, weztermDump] = process.argv.slice(2);
if (!moduleRoot || !agentDir || !weztermDump) {
  console.error("Usage: node phase-1-binding-candidates.mjs <@earendil-works-dir> <agent-dir> <wezterm-show-keys.lua>");
  process.exit(1);
}
const load = (relative) => import(pathToFileURL(path.resolve(moduleRoot, relative)).href);
const { KEYBINDINGS, KeybindingsManager } = await load("pi-coding-agent/dist/core/keybindings.js");
const { matchesKey, isKeyRepeat, isKeyRelease } = await load("pi-tui/dist/keys.js");
const resolved = KeybindingsManager.create(agentDir).getEffectiveConfig();
const canonical = (s) => [...new Set(s.toLowerCase().split("+"))].sort().join("+");
const candidates = ["ctrl+r", "ctrl+t", "ctrl+shift+t", "ctrl+q", "ctrl+alt+r", "ctrl+shift+y"];
const rows = [];
let table = "keys";
for (const [i, line] of fs.readFileSync(weztermDump, "utf8").split("\n").entries()) {
  const heading = line.match(/^\s+(copy_mode|search_mode) = \{$/);
  if (heading) table = heading[1];
  // Deliberately bounded to alphabetic candidates, not a general Lua parser.
  const row = line.match(/key = '([a-zA-Z])', mods = '([^']+)', action = (.+) \},?$/);
  if (!row) continue;
  const [, key, modifierText, action] = row;
  const modifiers = modifierText.toLowerCase().split("|").filter((v) => v !== "none");
  // WezTerm dumps shifted letters in both uppercase and lowercase spellings.
  if (key !== key.toLowerCase()) modifiers.push("shift");
  rows.push({ chord: canonical([...modifiers, key.toLowerCase()].join("+")), table, line: i + 1, action });
}
const result = {
  node: process.version,
  platform: process.platform,
  coreActionCount: Object.keys(KEYBINDINGS).length,
  userKeybindingsFileExists: fs.existsSync(path.join(agentDir, "keybindings.json")),
  candidates: candidates.map((candidate) => ({
    candidate,
    piActions: Object.entries(resolved)
      .filter(([, values]) => (Array.isArray(values) ? values : [values]).some((v) => canonical(v) === canonical(candidate)))
      .map(([id]) => id),
    weztermAssignments: rows.filter((row) => row.chord === canonical(candidate)),
  })),
  ctrlQParser: {
    legacy: matchesKey("\x11", "ctrl+q"),
    kitty: [1, 2, 3].map((type) => {
      const data = `\x1b[113;5:${type}u`;
      return { type, matches: matchesKey(data, "ctrl+q"), repeat: isKeyRepeat(data), release: isKeyRelease(data) };
    }),
  },
  limits: "Core resolved bindings and saved WezTerm tables only; extension review recorded separately. Synthetic parsing is not physical-key delivery validation.",
};
assert(result.ctrlQParser.legacy);
assert(result.ctrlQParser.kitty.every((event) => event.matches));
assert(result.ctrlQParser.kitty[1].repeat && result.ctrlQParser.kitty[2].release);
assert(result.candidates.find((item) => item.candidate === "ctrl+shift+t").weztermAssignments.length > 0);
console.log(JSON.stringify(result, null, 2));
