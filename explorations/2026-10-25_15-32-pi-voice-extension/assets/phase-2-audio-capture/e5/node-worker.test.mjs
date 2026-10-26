// Synthetic-only Node stdio socketpair -> actual Python worker compatibility.
// Never invokes wpctl, pw-record, GPU enumeration or whisper-cli.
import { spawn } from 'node:child_process';
import { mkdtempSync, chmodSync, readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';
const here = dirname(fileURLToPath(import.meta.url));

test('Node socket-backed stdio can start/stop the actual synthetic worker and receive one completed batch result', { timeout: 10000 }, async () => {
  const root = mkdtempSync(join(here, 'selftest-node-')); chmodSync(root, 0o700);
  const child = spawn('/usr/bin/python3', ['-B', join(here, 'worker.py'), '--test-worker', root, 'normal'], { stdio: ['pipe', 'pipe', 'pipe'], shell: false });
  const events = []; let buffer = '', error = '', stopped = false;
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stderr.on('data', d => { error = (error + d).slice(-4096); });
  child.stdout.on('data', data => {
    buffer += data;
    let pos;
    while ((pos = buffer.indexOf('\n')) >= 0) {
      const item = JSON.parse(buffer.slice(0, pos)); buffer = buffer.slice(pos + 1); events.push(item);
      if (item.event === 'stream-active' && !stopped) {
        stopped = true; child.stdin.write('{"action":"stop"}\n');
      }
    }
  });
  const closed = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal }));
  });
  child.stdin.write('{"action":"start"}\n');
  let timer;
  try {
    const end = await Promise.race([closed, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('synthetic Node bridge timeout')), 7000); })]);
    assert.deepEqual(end, { code: 0, signal: null }, error);
    const finish = events.at(-1);
    assert.equal(finish.event, 'finished'); assert.equal(finish.ok, true);
    assert.equal(events.filter(e => e.event === 'transcript').length, 1);
    const result = JSON.parse(readFileSync(join(finish.run, 'result.json'), 'utf8'));
    assert.equal(result.simulation, true); assert.equal(result.outcome, 'transcribed'); assert.equal(result.audio_deleted, true);
    assert.equal(result.children.length, 2); assert.ok(result.children.every(c => c.reaped));
    assert.ok(result.children.every(c => c.argv.includes('--fake-capture') || c.argv.includes('--fake-asr')));
    assert.ok(!existsSync(join(finish.run, 'capture.wav')));
    assert.ok(!readFileSync(join(finish.run, 'result.json'), 'utf8').includes('SYNTHETIC-ONLY-TRANSCRIPT'));
    assert.equal(readdirSync(root).filter(n => n.startsWith('run-')).length, 1);
    writeFileSync(join(root, 'bridge-result.json'), JSON.stringify({ passed: true, scope: 'Node pipe -> Python fake services only', childCount: result.children.length, reaped: true, audioDeleted: true }) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(`Node worker bridge evidence: ${root}`);
  } finally {
    clearTimeout(timer);
    child.stdin.end();
    if (child.exitCode === null && child.signalCode === null) await closed; // EOF cancels the fake worker; never hide a live recorder.
  }
});
