// Packaging/discovery checks only: no real Pi session, installation or audio.
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { InteractiveMode, jiti, load } from './host.mjs';

const repository = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8'));
const { discoverAndLoadExtensions } = await load('pi-coding-agent/dist/core/extensions/loader.js');
const labels = (extensions) => InteractiveMode.prototype.getCompactExtensionLabels.call(InteractiveMode.prototype, extensions);
function temporary(t) {
  const root = mkdtempSync(join(tmpdir(), 'pi-voice-package-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('package has one public root entry and keeps its runtime files together', async (t) => {
  assert.equal(manifest.name, 'pi-voice');
  assert.deepEqual(manifest.pi.extensions, ['./index.ts']);
  const root = temporary(t), packaged = join(root, 'pi-voice');
  mkdirSync(packaged);
  cpSync(join(repository, 'package.json'), join(packaged, 'package.json'));
  // Stage only declared runtime payload, not the whole development checkout.
  for (const entry of manifest.files) {
    const destination = join(packaged, entry);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(join(repository, entry), destination, { recursive: true });
  }
  assert.ok(existsSync(join(packaged, 'index.ts')));
  assert.ok(existsSync(join(packaged, 'src/extension.ts')));
  assert.ok(existsSync(join(packaged, 'worker/voice_worker.py')));
  assert.equal(existsSync(join(packaged, 'explorations')), false);
  const loaded = await jiti.import(join(packaged, 'index.ts'));
  assert.equal(typeof loaded.default, 'function');
  // Capture argv without spawning: relocation must retain the packaged worker.
  const { startWorker } = await jiti.import(join(packaged, 'src/worker-client.ts'));
  let script;
  const worker = startWorker({ python: '/synthetic/python', whisperCli: '/synthetic/whisper',
    model: '/synthetic/model', language: 'auto', threads: 8 }, { state() {}, warning() {} }, {
    spawn(_executable, argv) { script = argv[1]; throw new Error('Synthetic refusal; no process is started.'); },
  });
  assert.equal(script, join(packaged, 'worker/voice_worker.py'));
  assert.equal((await worker.done).cleanupOk, true);
});

test('global directory discovery identifies the extension as pi-voice, not extension.ts', async (t) => {
  const root = temporary(t), agentDir = join(root, 'agent'), cwd = join(root, 'project');
  const extensionsDir = join(agentDir, 'extensions');
  mkdirSync(extensionsDir, { recursive: true }); mkdirSync(cwd);
  symlinkSync(repository, join(extensionsDir, 'pi-voice'), 'dir');
  // Use an isolated agent directory; do not read/write actual personal settings.
  const result = await discoverAndLoadExtensions([], cwd, agentDir);
  assert.deepEqual(result.errors, []);
  assert.equal(result.extensions.length, 1);
  assert.equal(result.extensions[0].path, resolve(extensionsDir, 'pi-voice/index.ts'));
  assert.deepEqual(labels(result.extensions), ['pi-voice']);
  assert.ok(result.extensions[0].commands.has('voice'));
});

test('npm global package compact label has no implementation-path suffix', () => {
  const baseDir = '/synthetic/pi/npm/node_modules/pi-voice';
  assert.deepEqual(labels([{ path: join(baseDir, 'index.ts'),
    sourceInfo: { source: 'npm:pi-voice', scope: 'user', origin: 'package', baseDir } }]), ['pi-voice']);
});
