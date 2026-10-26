// Locate an existing Pi installation only. Never install dependencies or start Pi.
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

function moduleRoot() {
  if (process.env.PI_VOICE_TEST_MODULE_ROOT) return resolve(process.env.PI_VOICE_TEST_MODULE_ROOT);
  const require = createRequire(import.meta.url);
  try {
    const entry = require.resolve('@earendil-works/pi-coding-agent');
    return resolve(dirname(entry), '../../..');
  } catch {}
  const install = join(homedir(), '.pi/agent/install');
  const versionFile = join(install, 'current-version');
  if (existsSync(versionFile)) {
    const version = readFileSync(versionFile, 'utf8').trim();
    if (/^[\w.-]+$/u.test(version)) {
      const root = join(install, 'releases', version, 'node_modules');
      if (existsSync(join(root, '@earendil-works/pi-coding-agent'))) return root;
    }
  }
  throw new Error('Tests need an existing Pi installation. Set PI_VOICE_TEST_MODULE_ROOT to its node_modules directory.');
}
export const root = moduleRoot();
export const load = (path) => import(pathToFileURL(join(root, '@earendil-works', path)).href);
export const tui = await load('pi-tui/dist/index.js');
const { createJiti } = await load('pi-coding-agent/dist/core/extensions/jiti-loader.js');
export const jiti = createJiti(import.meta.url, { fsCache: false, moduleCache: true,
  alias: { '@earendil-works/pi-tui': join(root, '@earendil-works/pi-tui/dist/index.js') } });
export const loadSource = (path) => jiti.import(fileURLToPath(new URL('../src/' + path, import.meta.url)));
export const { KeybindingsManager } = await load('pi-coding-agent/dist/core/keybindings.js');
export const { CustomEditor } = await load('pi-coding-agent/dist/modes/interactive/components/custom-editor.js');
export const { InteractiveMode } = await load('pi-coding-agent/dist/modes/interactive/interactive-mode.js');
export const theme = { borderColor: (x) => x, selectList: {
  selectedPrefix: (x) => x, selectedText: (x) => x, description: (x) => x,
  scrollInfo: (x) => x, noMatch: (x) => x,
} };
