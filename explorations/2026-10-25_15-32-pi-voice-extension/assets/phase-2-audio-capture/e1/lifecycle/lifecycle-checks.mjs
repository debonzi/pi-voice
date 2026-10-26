// E1 ONLY: disposable fake processes, synthetic WAV bytes, no audio APIs or Pi API.
// Run: node --test lifecycle-checks.mjs
// Each run creates a private directory beside this script; no dependencies.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test, after } from 'node:test';

const self = fileURLToPath(import.meta.url);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function wav(frames = 4000) {
  const b = Buffer.alloc(44 + frames * 2); // Only this known fixture is canonical 44-byte WAV.
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(frames * 2, 40);
  return b; // Synthetic digital silence; not speech or VAD.
}
const fullWav = wav();
async function waitFor(fn, message, ms = 3500) {
  const until = performance.now() + ms;
  while (performance.now() < until) {
    if (await fn()) return;
    await sleep(5);
  }
  throw new Error(`Timed out: ${message}`);
}
async function exists(p) { try { await fs.stat(p); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } }

// The fake recorder owns only its new synthetic fixture. A 10-second watchdog
// bounds a harness bug. SIGINT exit 1 is deliberately simulated, NOT measured pw-record behavior.
async function fake(file, mode, readyMs) {
  const fd = await fs.open(file, 'wx', 0o600);
  await fd.write(Buffer.from('RIFF0000WAVE'));
  let ready = false, finishing = false;
  const finish = async () => {
    if (finishing) return;
    finishing = true;
    await fd.truncate(0); await fd.write(ready ? fullWav : wav(0), 0, ready ? fullWav.length : 44, 0);
    await fd.close(); process.exit(1);
  };
  process.on('SIGINT', () => { if (!['ignore-int', 'ignore-both'].includes(mode)) void finish(); });
  process.on('SIGTERM', () => { if (mode !== 'ignore-both') void finish(); });
  process.stdout.write('BOOT\n');
  process.stderr.write('fake diagnostic\n');
  if (mode === 'fail-valid') {
    await fd.truncate(0); await fd.write(fullWav, 0, fullWav.length, 0); await fd.close();
    process.stderr.write('FATAL simulated failure\n'); process.exit(1);
  }
  if (mode === 'flood') {
    process.stdout.write('x'.repeat(100000) + '\n');
    process.stderr.write('y'.repeat(100000) + '\n');
  }
  setTimeout(() => { ready = true; process.stdout.write('READY\n'); }, readyMs);
  setTimeout(() => process.exit(97), 10000);
}

// Experimental control-pipe supervisor: no audio, and no claim of production safety.
// The owner alone holds its stdin writer. On owner death EOF triggers stop/reap.
async function supervisor(dir) {
  let eof = false, child;
  const timers = [];
  const stop = () => {
    if (eof) return;
    eof = true;
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGINT');
      timers.push(setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 300));
    }
  };
  process.stdin.on('end', stop); process.stdin.resume();
  process.on('SIGTERM', stop);
  child = spawn(process.execPath, [self, 'fake', path.join(dir, 'owner.wav'), 'normal', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const ended = once(child, 'close');
  child.stdout.on('data', data => { process.stdout.write(data); });
  child.stderr.resume();
  await fs.writeFile(path.join(dir, 'pids.json'), JSON.stringify({ supervisor: process.pid, fake: child.pid }), { flag: 'wx', mode: 0o600 });
  const watchdog = setTimeout(stop, 5000);
  const [code, signal] = await ended;
  clearTimeout(watchdog); timers.forEach(clearTimeout);
  await fs.rm(path.join(dir, 'owner.wav'), { force: true });
  await fs.writeFile(path.join(dir, 'supervisor-done.json'), JSON.stringify({ eof, code, signal, reaped: true }), { flag: 'wx', mode: 0o600 });
  process.exit(0);
}
async function owner(dir) {
  const helper = spawn(process.execPath, [self, 'supervisor', dir], { stdio: ['pipe', 'pipe', 'pipe'] });
  helper.stdout.on('data', data => { process.stdout.write(data); }); helper.stderr.resume();
  helper.on('close', () => process.exit(0));
  // Keep stdin writer open until THIS disposable owner is killed by the test.
  setTimeout(() => process.exit(98), 8000);
}
const role = process.argv[2];
if (role === 'fake') await fake(process.argv[3], process.argv[4], Number(process.argv[5]));
else if (role === 'supervisor') await supervisor(process.argv[3]);
else if (role === 'owner') await owner(process.argv[3]);
else {
  const run = await fs.mkdtemp(path.join(path.dirname(self), 'run-'));
  await fs.chmod(run, 0o700);
  const controllers = [], summaries = [];

  // Deliberately small experimental controller, NOT an extension or pw-record adapter.
  // Fixture acceptance compares known generated bytes. General WAV parsing is
  // independently tested by ../formats/format-checks.py, not this fake controller.
  class Controller {
    constructor(opts = {}) { this.opts = opts; this.state = 'IDLE'; this.events = []; this.ops = []; this.current = null; controllers.push(this); }
    log(op, event, more = {}) { this.events.push({ op: op?.id, event, t: performance.now(), ...more }); }
    stateTo(op, state) { if (this.current !== op) return; this.state = state; this.log(op, 'state', { state }); }
    start() {
      if (this.state !== 'IDLE') { this.log(this.current, 'start-ignored'); return this.current; }
      const id = this.ops.length + 1;
      const op = { id, file: path.join(run, `${controllers.indexOf(this)}-${id}.wav`), stop: false, discard: false, escalated: false, signals: [], fatal: false, settled: 0, pids: [], tail: { stdout: '', stderr: '' }, timers: [] };
      op.done = new Promise(resolve => { op.resolve = resolve; });
      this.current = op; this.ops.push(op); this.stateTo(op, 'STARTING');
      op.launch = setTimeout(() => this.launch(op), this.opts.spawnDelay ?? 0);
      return op;
    }
    launch(op) {
      if (op.stop) { void this.finish(op, 'stopped-before-spawn'); return; }
      const args = [self, 'fake', op.file, this.opts.mode ?? 'normal', String(this.opts.readyDelay ?? 0)];
      const child = spawn(this.opts.missing ? path.join(run, 'missing-executable') : process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false, detached: false });
      op.child = child;
      if (child.pid) op.pids.push(child.pid);
      child.on('spawn', () => this.log(op, 'spawn'));
      let stdoutPending = '';
      child.stdout.on('data', data => {
        op.tail.stdout = (op.tail.stdout + data.toString()).slice(-4096);
        // Small line protocol is only for our fake, not PipeWire verbose parsing.
        stdoutPending += data.toString();
        const lines = stdoutPending.split('\n'); stdoutPending = lines.pop().slice(-4096);
        for (const line of lines) {
          if (line === 'BOOT') { op.boot = true; this.log(op, 'boot'); }
          if (line === 'READY') this.ready(op);
        }
      });
      child.stderr.on('data', data => {
        op.tail.stderr = (op.tail.stderr + data.toString()).slice(-4096);
        if (op.tail.stderr.includes('FATAL')) op.fatal = true;
      });
      child.on('error', err => { op.fatal = true; this.log(op, 'error', { code: err.code }); });
      child.on('close', (code, signal) => {
        op.closed = true; op.code = code; op.signal = signal;
        op.timers.forEach(clearTimeout); this.log(op, 'close', { code, signal });
        void this.finish(op);
      });
      op.timers.push(setTimeout(() => {
        if (!op.ready && !op.closed) { op.discard = true; this.log(op, 'startup-timeout'); this.stop(); }
      }, this.opts.startupMs ?? 1500));
    }
    ready(op) {
      if (this.current !== op || op.closed || op.stop || op.discard) { this.log(op, 'stale-or-late-ready'); return; }
      op.ready = true; this.stateTo(op, 'RECORDING');
    }
    send(op, signal) {
      if (!op.child || op.closed || op.child.exitCode !== null || op.child.signalCode !== null) return;
      op.signals.push(signal); op.child.kill(signal); this.log(op, 'signal', { signal });
    }
    stop() {
      const op = this.current;
      if (!op || op.settled || op.stop) return;
      op.stop = true; this.stateTo(op, 'STOPPING');
      if (!op.child) { clearTimeout(op.launch); void this.finish(op, 'stopped-before-spawn'); return; }
      this.send(op, 'SIGINT');
      op.timers.push(setTimeout(() => {
        if (!op.closed) { op.escalated = true; this.send(op, 'SIGTERM'); }
      }, 150));
      op.timers.push(setTimeout(() => {
        if (!op.closed) { op.escalated = true; this.send(op, 'SIGKILL'); }
      }, 300));
    }
    cancel() { const op = this.current; if (!op || op.settled) return; op.discard = true; this.log(op, 'cancel'); this.stop(); }
    async finish(op, earlyReason) {
      if (op.finishing) return;
      op.finishing = true;
      this.stateTo(op, 'FINALIZING');
      await sleep(this.opts.finalizeMs ?? 0);
      let reason = earlyReason;
      if (!reason && (!op.stop || op.fatal || op.escalated || op.signal || op.code !== 1)) reason = 'failed';
      if (op.discard) reason = 'discard';
      if (!reason) {
        try { if (!(await fs.readFile(op.file)).equals(fullWav)) reason = 'empty-or-invalid'; }
        catch (e) { reason = e.code ?? 'file-error'; }
      }
      if (op.discard) reason = 'discard'; // Cancellation wins across async validation.
      if (!reason) { op.published = true; this.stateTo(op, 'READY'); }
      else { this.stateTo(op, 'CLEANING'); await fs.rm(op.file, { force: true }); this.stateTo(op, 'IDLE'); }
      op.settled++; op.reason = reason ?? 'ready'; this.log(op, 'settled', { reason: op.reason });
      op.resolve(op);
    }
    async consume() { const op = this.current; assert.equal(this.state, 'READY'); await fs.rm(op.file); this.stateTo(op, 'IDLE'); }
  }
  const runCase = (name, body) => test(name, { timeout: 7000 }, async () => {
    await body(); summaries.push({ name, passed: true });
  });
  async function recording(c) { const op = c.start(); await waitFor(() => c.state === 'RECORDING', 'fake ready'); return op; }
  async function settled(op) {
    let timer;
    try { await Promise.race([op.done, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('settlement timeout')), 4000); })]); }
    finally { clearTimeout(timer); }
    assert.equal(op.settled, 1);
  }

  runCase('stop before deferred spawn creates no child or file', async () => {
    const c = new Controller({ spawnDelay: 100 }); const op = c.start(); c.stop(); c.stop(); await settled(op);
    assert.equal(op.pids.length, 0); assert.equal(await exists(op.file), false); assert.equal(c.state, 'IDLE');
  });
  runCase('repeated starts and stops settle once; consumed ready WAV is deleted', async () => {
    const c = new Controller(); const op = await recording(c);
    assert.equal(c.start(), op); assert.equal(c.start(), op); c.stop(); c.stop();
    assert.equal(c.start(), op); await settled(op);
    assert.deepEqual(op.signals, ['SIGINT']); assert.equal(op.pids.length, 1);
    assert.equal(c.state, 'READY'); assert.equal(op.code, 1); assert.equal(op.signal, null);
    assert.deepEqual(await fs.readFile(op.file), fullWav); assert.equal((await fs.stat(op.file)).mode & 0o777, 0o600);
    await c.consume(); assert.equal(await exists(op.file), false);
  });
  runCase('stop during STARTING never becomes RECORDING and discards zero-frame fixture', async () => {
    const c = new Controller({ readyDelay: 1000 }); const op = c.start();
    await waitFor(() => op.boot, 'boot while starting'); c.stop(); c.ready(op); await settled(op);
    assert.equal(op.published, undefined); assert.equal(op.reason, 'empty-or-invalid'); assert.equal(await exists(op.file), false);
    assert.equal(c.events.some(e => e.state === 'RECORDING'), false);
  });
  runCase('cancel during starting discards; late ready cannot resurrect recording', async () => {
    const c = new Controller({ readyDelay: 1000 }); const op = c.start();
    await waitFor(() => op.boot, 'boot'); c.cancel(); c.cancel(); c.ready(op); await settled(op);
    assert.equal(op.reason, 'discard'); assert.equal(c.state, 'IDLE'); assert.equal(await exists(op.file), false);
  });
  runCase('cancel during recording deletes completed bytes instead of publishing', async () => {
    const c = new Controller(); const op = await recording(c); c.cancel(); await settled(op);
    assert.equal(op.published, undefined); assert.equal(await exists(op.file), false);
  });
  runCase('cancel during finalization wins and start is not queued', async () => {
    const c = new Controller({ finalizeMs: 80 }); const op = await recording(c); c.stop();
    await waitFor(() => c.state === 'FINALIZING', 'finalizing'); assert.equal(c.start(), op); c.cancel(); await settled(op);
    assert.equal(op.reason, 'discard'); assert.equal(op.published, undefined); assert.equal(await exists(op.file), false);
  });
  runCase('unexpected failure exit 1 with valid bytes never publishes', async () => {
    const c = new Controller({ mode: 'fail-valid' }); const op = c.start(); await settled(op);
    assert.equal(op.code, 1); assert.equal(op.reason, 'failed'); assert.equal(await exists(op.file), false);
  });
  runCase('spawn ENOENT settles exactly once without a file', async () => {
    const c = new Controller({ missing: true }); const op = c.start(); await settled(op);
    assert.equal(op.pids.length, 0); assert.equal(op.reason, 'failed'); assert.equal(await exists(op.file), false);
  });
  runCase('startup deadline cancels instead of simulating release/speech end', async () => {
    const c = new Controller({ readyDelay: 1000, startupMs: 200 }); const op = c.start(); await settled(op);
    assert.equal(op.reason, 'discard'); assert.equal(c.events.some(e => e.event === 'startup-timeout'), true);
  });
  runCase('ignored SIGINT escalates to SIGTERM and discards even valid bytes', async () => {
    const c = new Controller({ mode: 'ignore-int' }); const op = await recording(c); c.stop(); await settled(op);
    assert.deepEqual(op.signals, ['SIGINT', 'SIGTERM']); assert.equal(op.reason, 'failed'); assert.equal(await exists(op.file), false);
  });
  runCase('ignored graceful signals escalate to SIGKILL; partial file is deleted', async () => {
    const c = new Controller({ mode: 'ignore-both' }); const op = await recording(c); c.stop(); await settled(op);
    assert.deepEqual(op.signals, ['SIGINT', 'SIGTERM', 'SIGKILL']); assert.equal(op.signal, 'SIGKILL'); assert.equal(op.reason, 'failed'); assert.equal(await exists(op.file), false);
  });
  runCase('stale callback cannot mutate a new operation', async () => {
    const c = new Controller(); const a = await recording(c); c.cancel(); await settled(a);
    const b = c.start(); c.ready(a); assert.equal(c.state, 'STARTING');
    await waitFor(() => c.state === 'RECORDING', 'second ready'); c.stop(); await settled(b);
    assert.equal(c.ops.length, 2); assert.equal(b.reason, 'ready'); await c.consume();
  });
  runCase('stdout/stderr flood is drained with bounded retained diagnostics', async () => {
    const c = new Controller({ mode: 'flood' }); const op = await recording(c); c.stop(); await settled(op);
    assert.ok(op.tail.stdout.length <= 4096); assert.ok(op.tail.stderr.length <= 4096); assert.equal(op.reason, 'ready'); await c.consume();
  });
  runCase('disposable owner SIGKILL closes private pipe; supervisor stops/reaps fake', async () => {
    const dir = await fs.mkdtemp(path.join(run, 'owner-')); await fs.chmod(dir, 0o700);
    const ownerProc = spawn(process.execPath, [self, 'owner', dir], { stdio: ['ignore', 'pipe', 'pipe'] });
    const ended = once(ownerProc, 'close'); let text = '';
    ownerProc.stdout.on('data', d => { text = (text + d.toString()).slice(-4096); }); ownerProc.stderr.resume();
    try {
      await waitFor(() => text.includes('READY'), 'owned fake ready');
      ownerProc.kill('SIGKILL'); const [code, signal] = await ended; assert.equal(code, null); assert.equal(signal, 'SIGKILL');
      await waitFor(() => exists(path.join(dir, 'supervisor-done.json')), 'supervisor reaped fake');
      const done = JSON.parse(await fs.readFile(path.join(dir, 'supervisor-done.json')));
      assert.deepEqual(done, { eof: true, code: 1, signal: null, reaped: true });
      assert.equal(await exists(path.join(dir, 'owner.wav')), false);
      // The completion report precedes helper exit; allow that exit to happen
      // instead of racing it with the emergency cleanup assertion.
      const pids = JSON.parse(await fs.readFile(path.join(dir, 'pids.json')));
      await waitFor(async () => {
        try { return !(await fs.readFile(`/proc/${pids.supervisor}/cmdline`, 'utf8')).includes(self); }
        catch (e) { if (e.code === 'ENOENT') return true; throw e; }
      }, 'supervisor exit');
    } finally {
      if (ownerProc.exitCode === null && ownerProc.signalCode === null) { ownerProc.kill('SIGKILL'); await ended; }
      // Emergency fallback limited to PIDs reported by this very test, with identity check.
      if (await exists(path.join(dir, 'pids.json'))) {
        const pids = JSON.parse(await fs.readFile(path.join(dir, 'pids.json')));
        for (const [roleName, pid] of Object.entries(pids)) {
          try {
            const command = await fs.readFile(`/proc/${pid}/cmdline`, 'utf8');
            if (command.includes(self) && command.includes(roleName)) { process.kill(pid, 'SIGKILL'); throw new Error(`Emergency cleanup required: ${roleName}`); }
          } catch (e) { if (e.code !== 'ENOENT' && e.code !== 'ESRCH') throw e; }
        }
      }
    }
  });

  after(async () => {
    // Cleanup runs even after assertion failures; only explicitly owned children.
    for (const c of controllers) for (const op of c.ops) {
      clearTimeout(op.launch); op.timers.forEach(clearTimeout);
      if (op.child && !op.closed) { const closed = once(op.child, 'close'); op.child.kill('SIGKILL'); await closed; }
      await fs.rm(op.file, { force: true });
    }
    const operations = controllers.flatMap(c => c.ops.map(op => ({ id: `${controllers.indexOf(c)}-${op.id}`, pids: op.pids, code: op.code, signal: op.signal, settled: op.settled, reason: op.reason, published: Boolean(op.published), signals: op.signals, closed: op.closed ?? false })));
    for (const c of controllers) for (const op of c.ops) {
      if (op.child?.pid) {
        try { process.kill(op.child.pid, 0); assert.fail(`owned fake still alive: ${op.child.pid}`); }
        catch (e) { if (e.code !== 'ESRCH') throw e; }
      }
      assert.equal(await exists(op.file), false);
    }
    await fs.writeFile(path.join(run, 'evidence.json'), JSON.stringify({ node: process.version, scope: 'E1 fake children only; no audio access', tests: summaries, operations, traces: controllers.map(c => c.events), cleanup: 'all directly owned fake children reaped; all operation WAVs removed' }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(`E1 lifecycle evidence: ${run}`);
  });
}
