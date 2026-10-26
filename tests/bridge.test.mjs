// Real Node socket-backed stdio -> production Python Worker with injected fake
// services. This never executes pw-record, wpctl, Whisper or an audio service.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { loadSource } from './host.mjs';

const { startWorker } = await loadSource('worker-client.ts');
const fake = fileURLToPath(new URL('./fake_audio.py', import.meta.url));
const python = process.env.PI_VOICE_TEST_PYTHON || '/usr/bin/python3';
function fixture(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'pi-voice-bridge-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const runtime = join(root, 'runtime'); mkdirSync(runtime, { mode: 0o700 });
  const source = join(root, 'source.json'), model = join(root, 'model.bin'), cli = join(root, 'whisper-cli');
  const header = Buffer.alloc(48);
  [0x67676d6c, 51866, 1500, 1280, 20, 32, 448, 1280, 20, 32, 128, 1].forEach((n, i) => header.writeUInt32LE(n, i * 4));
  writeFileSync(model, header, { mode: 0o600 });
  writeFileSync(cli, `#!${python}\nimport sys\nsys.path.insert(0, ${JSON.stringify(fileURLToPath(new URL('.', import.meta.url)))})\nfrom fake_audio import main\nraise SystemExit(main('inference', sys.argv[1:]))\n`, { mode: 0o700 });
  const spec = join(root, 'spec.json'), ledger = join(root, 'ledger.jsonl');
  writeFileSync(spec, JSON.stringify({ runtime, source, ledger, ...options }), { mode: 0o600 });
  const children = [];
  function start(callbacks) {
    const handle = startWorker({ python, whisperCli: cli, model, threads: 8, language: 'auto' }, callbacks, {
      spawn(executable, _argv, opts) {
        const child = spawn(executable, ['-B', fake, 'worker'], {
          ...opts, env: { ...process.env, PI_VOICE_TEST_SPEC: spec, PYTHONDONTWRITEBYTECODE: '1' },
        });
        children.push(child);
        return child;
      },
    });
    t.after(async () => {
      handle.cancel();
      // A test failure still closes the owner pipe; fakes have watchdogs too.
      await handle.done;
    });
    return handle;
  }
  return { start, children,
    setSource(name) { writeFileSync(source, JSON.stringify({ 'node.name': name, 'media.class': 'Audio/Source', 'node.description': 'Synthetic default ' + name })); },
    assertClean() {
      assert.deepEqual(readdirSync(runtime), []);
      const records = existsSync(ledger) ? readFileSync(ledger, 'utf8').trim().split('\n').map(JSON.parse) : [];
      for (const record of records.filter((x) => ['metadata', 'recorder', 'inference'].includes(x.role))) {
        assert.throws(() => process.kill(record.pid, 0), { code: 'ESRCH' });
      }
      return records;
    },
  };
}

test('real Node/Python bridge completes successive operations using fresh builtin/USB defaults', { timeout: 10_000 }, async (t) => {
  const f = fixture(t);
  for (const name of ['alsa_input.builtin', 'alsa_input.usb-default']) {
    f.setSource(name);
    let ready;
    const recording = new Promise((resolve) => { ready = resolve; });
    const handle = f.start({ state(state) { if (state === 'recording') ready(); }, warning() {} });
    await recording; handle.stop();
    const result = await handle.done;
    assert.equal(result.outcome, 'completed'); assert.equal(result.cleanupOk, true);
    assert.match(result.text, /SYNTHETIC TRANSCRIPT/u);
    const recorder = f.assertClean().filter((x) => x.role === 'recorder').at(-1);
    assert.equal(recorder.argv[recorder.argv.indexOf('--target') + 1], name);
  }
});

test('Node owner-pipe EOF during capture cancels and reaps before settlement', { timeout: 10_000 }, async (t) => {
  const f = fixture(t); f.setSource('alsa_input.usb-default');
  let ready;
  const recording = new Promise((resolve) => { ready = resolve; });
  const handle = f.start({ state(state) { if (state === 'recording') ready(); }, warning() {} });
  await recording;
  f.children[0].stdin.end();
  const result = await handle.done; assert.equal(result.outcome, 'canceled'); assert.equal(result.cleanupOk, true);
  const records = f.assertClean(); assert.equal(records.filter((x) => x.role === 'inference').length, 0);
});
