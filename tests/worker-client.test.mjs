import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { test } from 'node:test';
import { loadSource } from './host.mjs';

const { startWorker } = await loadSource('worker-client.ts');
const config = { python: '/usr/bin/python3', whisperCli: '/synthetic/whisper-cli', model: '/synthetic/large-v3.bin', threads: 8, language: 'auto' };
const tick = () => new Promise((resolve) => setImmediate(resolve));
class FakeChild extends EventEmitter {
  constructor() {
    super(); this.pid = 12345; this.actions = [];
    this.stdout = new PassThrough(); this.stderr = new PassThrough();
    this.stdin = new Writable({ write: (data, _encoding, done) => { this.actions.push(JSON.parse(String(data))); done(); } });
  }
  send(value) { this.stdout.write(JSON.stringify(value) + '\n'); }
  finish(outcome = 'completed', cleanupOk = true) { this.send({ type: 'finished', outcome, cleanupOk }); }
  close(code = 0, signal = null) { this.emit('close', code, signal); }
  kill() { throw new Error('Never blindly kill the supervisor.'); }
}
function fixture(options = {}) {
  const child = new FakeChild(), states = [], warnings = [], calls = [];
  const handle = startWorker(config, { state: (...args) => states.push(args), warning: (text) => warnings.push(text) }, {
    watchdogMs: options.watchdogMs || 100_000,
    spawn(...args) { calls.push(args); if (options.throw) throw new Error('synthetic spawn failure'); return child; },
  });
  return { handle, child, states, warnings, calls };
}

test('launch uses argv/no shell/private pipes; text is staged until finished AND successful close', async () => {
  const f = fixture();
  assert.equal(f.calls[0][0], config.python);
  assert.deepEqual(f.calls[0][2], { shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
  assert.match(f.calls[0][1][1], /worker\/voice_worker.py$/u);
  assert.deepEqual(f.child.actions, [{ type: 'start', config: { whisperCli: config.whisperCli, model: config.model, threads: 8, language: 'auto' } }]);
  let settled = false; f.handle.done.then(() => { settled = true; });
  f.child.send({ type: 'state', state: 'recording', input: 'USB\x1b[2J name' });
  assert.doesNotMatch(f.states[0][1], /\x1b/u);
  f.child.send({ type: 'transcript', text: 'full synthetic text' }); await tick(); assert.equal(settled, false);
  f.child.finish(); await tick(); assert.equal(settled, false);
  f.child.close();
  assert.deepEqual(await f.handle.done, { outcome: 'completed', cleanupOk: true, message: undefined, text: 'full synthetic text' });
});

test('stop/cancel are idempotent and cancellation closes the owner pipe', async () => {
  const f = fixture(); f.handle.stop(); f.handle.stop(); f.handle.cancel(); f.handle.cancel();
  assert.deepEqual(f.child.actions.map((x) => x.type), ['start', 'stop', 'cancel']);
  assert.equal(f.child.stdin.writableEnded, true);
  f.child.send({ type: 'transcript', text: 'late' }); f.child.finish(); f.child.close();
  assert.deepEqual(await f.handle.done, { outcome: 'canceled', cleanupOk: true });
});

test('stream fragmentation and Unicode do not truncate the transcript', async () => {
  const f = fixture(); const text = 'ação início fim 🗣️'.repeat(200);
  const bytes = Buffer.from(JSON.stringify({ type: 'transcript', text }) + '\n');
  for (let n = 0; n < bytes.length; n += 7) f.child.stdout.write(bytes.subarray(n, n + 7));
  f.child.finish(); f.child.close(); assert.equal((await f.handle.done).text, text);
});

test('duplicate/missing/invalid/trailing protocol fails closed and blocks ambiguous cleanup', async () => {
  for (const mode of ['duplicate', 'missing', 'invalid', 'trailing', 'after-finished']) {
    const f = fixture();
    if (mode === 'invalid') f.child.stdout.write('not json\n');
    else if (mode === 'missing') f.child.finish();
    else {
      f.child.send({ type: 'transcript', text: 'first' });
      if (mode === 'duplicate') f.child.send({ type: 'transcript', text: 'second' });
      f.child.finish();
      if (mode === 'after-finished') f.child.send({ type: 'state', state: 'cleaning' });
      if (mode === 'trailing') f.child.stdout.write('unterminated');
    }
    f.child.close(); const result = await f.handle.done;
    assert.equal(result.outcome, 'error', mode); assert.equal(result.cleanupOk, false, mode); assert.equal(result.text, undefined);
  }
});

test('failed exit and helper signal never deliver staged text', async () => {
  for (const [code, signal] of [[2, null], [null, 'SIGKILL']]) {
    const f = fixture(); f.child.send({ type: 'transcript', text: 'never' }); f.child.finish(); f.child.close(code, signal);
    const result = await f.handle.done; assert.equal(result.outcome, 'error'); assert.equal(result.text, undefined);
    if (signal) assert.equal(result.cleanupOk, false);
  }
});

test('error/empty outcomes have no transcript and cleanup failure overrides cancel', async () => {
  for (const outcome of ['empty', 'error']) {
    const f = fixture(); f.child.finish(outcome); f.child.close(outcome === 'error' ? 1 : 0);
    const result = await f.handle.done; assert.equal(result.outcome, outcome); assert.equal(result.text, undefined);
    assert.equal(result.cleanupOk, true);
  }
  const f = fixture(); f.handle.cancel(); f.child.finish('error', false); f.child.close(1);
  assert.equal((await f.handle.done).cleanupOk, false);
});

test('spawn refusal is a safe failure; unexpected process/control errors are not assumed clean', async () => {
  const f = fixture({ throw: true }); assert.equal((await f.handle.done).cleanupOk, true);
  for (const stream of ['stdin', 'stdout', 'stderr']) {
    const f = fixture(); f.child[stream].emit('error', new Error('private synthetic error'));
    f.child.close(1); const result = await f.handle.done;
    assert.equal(result.outcome, 'error'); assert.equal(result.cleanupOk, false);
    assert.doesNotMatch(result.message, /private synthetic error/u);
  }
  const absent = fixture(); absent.child.pid = undefined; absent.child.emit('error', new Error('ENOENT')); absent.child.close(-2);
  assert.equal((await absent.handle.done).cleanupOk, true);
});

test('post-stop cleanup watchdog warns, never kills or caps recording/inference', async () => {
  const f = fixture({ watchdogMs: 10 });
  await new Promise((resolve) => setTimeout(resolve, 20)); assert.equal(f.warnings.length, 0);
  f.handle.stop(); await new Promise((resolve) => setTimeout(resolve, 25)); assert.equal(f.warnings.length, 1);
  f.child.send({ type: 'state', state: 'transcribing' });
  f.child.send({ type: 'transcript', text: 'safe' }); f.child.finish(); f.child.close();
  assert.equal((await f.handle.done).text, 'safe');
});
