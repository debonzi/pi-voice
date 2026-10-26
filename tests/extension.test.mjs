import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadSource, tui, KeybindingsManager, CustomEditor, InteractiveMode, theme } from './host.mjs';

const { installVoice } = await loadSource('extension.ts');
const { readConfig, admitText } = await loadSource('config.ts');
const press = '\x1b[113;5:1u', repeat = '\x1b[113;5:2u', release = '\x1b[113;5:3u';
const tick = () => new Promise((resolve) => setImmediate(resolve));
const config = { python: '/usr/bin/python3', whisperCli: '/synthetic/whisper-cli', model: '/synthetic/large-v3.bin', threads: 8, language: 'auto' };

function fixture(options = {}) {
  const kb = new KeybindingsManager(options.keybindings);
  tui.setKeybindings(kb);
  const handlers = new Map(), commands = new Map(), listeners = new Set();
  const notices = [], workers = [], submits = [], statuses = new Map();
  let widget, idle = true, queued = false, active = true, overlay = false, focus;
  let sessionId = 'synthetic-session', leafId = 'synthetic-leaf', factory;
  const makeEditor = () => new CustomEditor({ requestRender() {} }, theme, kb);
  const owner = { editor: makeEditor(), ui: { requestRender() {} },
    footerDataProvider: { setExtensionStatus() {} },
    setExtensionStatus: InteractiveMode.prototype.setExtensionStatus };
  focus = owner.editor;
  owner.editor.onSubmit = (text) => submits.push(text);
  const nativeUI = InteractiveMode.prototype.createExtensionUIContext.call(owner);
  const ctx = { mode: 'tui', hasUI: true,
    isIdle: () => idle, hasPendingMessages: () => queued,
    sessionManager: { getSessionId: () => sessionId, getLeafId: () => leafId },
    ui: { ...nativeUI,
      onTerminalInput(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      setStatus: (key, text) => statuses.set(key, text),
      notify: (...args) => notices.push(args),
      getEditorComponent: () => factory,
      setWidget(_key, value) {
        widget = typeof value === 'function' ? value({
          getFocusedComponent: () => focus, hasOverlay: () => overlay,
          requestRender() {}, terminal: { rows: 30 },
        }, { fg: (_key, text) => text }) : value;
      },
    },
  };
  const pi = {
    on(name, handler) { handlers.set(name, handler); },
    registerCommand(name, command) { commands.set(name, command); },
    sendUserMessage() { throw new Error('Dictation must never submit.'); },
    sendMessage() { throw new Error('Dictation must never submit.'); },
    appendEntry() { throw new Error('Dictation must never persist text.'); },
  };
  installVoice(pi, { config: () => { options.configHook?.(); return config; },
    platform: options.platform || 'linux', terminalActive: () => active,
    startWorker(actual, callbacks) {
      assert.deepEqual(actual, config);
      let settle;
      const worker = { callbacks, stops: 0, cancels: 0,
        done: new Promise((resolve) => { settle = resolve; }),
        stop() { worker.stops++; }, cancel() { worker.cancels++; },
        finish(text = 'ditado', overrides = {}) {
          settle({ outcome: 'completed', cleanupOk: true, text, ...overrides });
        },
      };
      workers.push(worker);
      options.spawnHook?.(f);
      return worker;
    },
  });
  const f = { ctx, handlers, commands, workers, submits, notices, statuses, listeners,
    get editor() { return owner.editor; },
    get text() { return nativeUI.getEditorText(); },
    get label() { return widget?.render(2000).join('\n') || ''; },
    setText(value) { owner.editor.setText(value); },
    dispatchSync(data) {
      let consumed = false;
      for (const listener of listeners) if (listener(data)?.consume) { consumed = true; break; }
      if (!consumed) focus?.handleInput?.(data);
      return consumed;
    },
    async dispatch(data) {
      const consumed = f.dispatchSync(data);
      await tick();
      return consumed;
    },
    event: (name, event = {}) => handlers.get(name)?.(event, ctx),
    command: (action) => commands.get('voice').handler(action, ctx),
    async start(mode = 'tui') { ctx.mode = mode; await handlers.get('session_start')({}, ctx); },
    shutdown: () => handlers.get('session_shutdown')({}, ctx),
    setIdle(value) { idle = value; }, setQueued(value) { queued = value; },
    setTerminal(value) { active = value; }, setOverlay(value) { overlay = value; },
    setFocus(value) { focus = value; },
    replaceEditor() { owner.editor = makeEditor(); focus = owner.editor; factory = () => {}; },
    changeSession() { sessionId += '-new'; }, changeLeaf() { leafId += '-new'; },
  };
  return f;
}
async function finish(f, text = 'ditado', overrides) { f.workers.at(-1).finish(text, overrides); await tick(); }

// All worker handles below are inert, in-memory fakes. Real Pi editor methods only.
test('factory and startup never access microphone/config; TUI is opt-in', async () => {
  let reads = 0;
  const f = fixture({ configHook: () => reads++ });
  assert.equal(f.listeners.size, 0);
  await f.start(); assert.equal(f.listeners.size, 1); assert.equal(reads, 0);
  assert.match(f.label, /system default microphone/);
  await f.shutdown(); assert.equal(f.listeners.size, 0); assert.equal(f.label, '');
  await f.start('rpc'); assert.equal(f.listeners.size, 0);
  await f.command('start'); assert.equal(f.workers.length, 0);
});

test('hold starts once for ordinary and Kitty repeats; modifier-loss Q release stops once', async () => {
  const f = fixture(); await f.start();
  await f.dispatch(repeat); assert.equal(f.workers.length, 0);
  await f.dispatch(press); await f.dispatch(press); await f.dispatch(repeat);
  assert.equal(f.workers.length, 1);
  await f.dispatch('\x1b[113;1:3u'); await f.dispatch(release);
  assert.equal(f.workers[0].stops, 1);
  await finish(f); assert.equal(f.text, 'ditado'); assert.deepEqual(f.submits, []);
  await f.shutdown();
});

test('a quick release during worker creation is latched and delivered after start', async () => {
  const f = fixture({ spawnHook: (f) => { for (const fn of f.listeners) fn(release); } });
  await f.start(); await f.dispatch(press);
  assert.equal(f.workers[0].stops, 1);
  await finish(f, '', { outcome: 'empty' }); await f.shutdown();
});

test('explicit commands are the release-independent fallback, single-flight, repeat-safe', async () => {
  const f = fixture(); await f.start();
  await f.command('start'); await f.command('start'); assert.equal(f.workers.length, 1);
  await f.command('stop'); await f.command('stop'); assert.equal(f.workers[0].stops, 1);
  await finish(f, 'um'); await f.dispatch(' ');
  await f.command('start'); await f.command('stop'); await finish(f, 'dois');
  assert.equal(f.text, 'um dois'); assert.deepEqual(f.submits, []); await f.shutdown();
});

test('delivery uses current cursor and preserves live prefix, suffix and intervening typing', async () => {
  const f = fixture(); await f.start(); f.setText('antes depois');
  await f.dispatch(press); await f.dispatch(release);
  await f.dispatch('!');
  for (let n = 0; n < 7; n++) await f.dispatch('\x1b[D');
  await finish(f, 'TRECHO'); assert.equal(f.text, 'antes TRECHOdepois!');
  assert.deepEqual(f.submits, []); await f.shutdown();
});

test('native multiline/large paste is one undo, no custom editor or smart spacing', async () => {
  const f = fixture(); await f.start(); f.setText('AB');
  await f.dispatch('\x1b[D'); await f.command('start');
  const long = 'texto '.repeat(210) + '\r\n\tfim';
  await finish(f, long);
  assert.equal(f.text, 'A' + admitText(long) + 'B');
  assert.match(f.editor.getText(), /\[paste #/);
  assert.deepEqual(f.submits, []);
  await f.dispatch('\x1b[45;5u'); assert.equal(f.text, 'AB'); await f.shutdown();
});

test('cancel wins over late completion, preserves previously inserted parts, starts again after cleanup', async () => {
  const f = fixture(); await f.start(); await f.command('start'); await finish(f, 'primeiro');
  await f.command('start'); await f.command('cancel'); await f.command('cancel');
  assert.equal(f.workers[1].cancels, 1);
  await f.command('start'); assert.equal(f.workers.length, 2);
  await finish(f, 'stale'); assert.equal(f.text, 'primeiro');
  await f.command('start'); await finish(f, 'segundo');
  assert.equal(f.text, 'primeirosegundo'); await f.shutdown();
});

test('draft submission cancels without consuming Enter or sending dictated text', async () => {
  const f = fixture(); await f.start(); f.setText('manual'); await f.command('start');
  const consumed = await f.dispatch('\r'); assert.equal(consumed, false);
  assert.deepEqual(f.submits, ['manual']); assert.equal(f.workers[0].cancels, 1);
  await finish(f, 'never'); assert.equal(f.text, ''); await f.shutdown();
});

test('own stop command Enter is not treated as draft submission cancellation', async () => {
  const f = fixture(); await f.start(); await f.command('start');
  await f.dispatch('/voice stop'); await f.dispatch('\r'); await f.command('stop');
  assert.equal(f.workers[0].cancels, 0);
  await finish(f); assert.equal(f.text, 'ditado'); await f.shutdown();
});

test('clear, history, queued submission and custom keybindings invalidate pending work', async () => {
  for (const [data, bindings] of [['\x03'], ['\x1b[A'], ['\x1b\r'], ['\x18', { 'app.clear': 'ctrl+x' }]]) {
    const f = fixture({ keybindings: bindings }); await f.start(); f.setText('manual');
    if (data === '\x1b[A') { f.editor.addToHistory('older draft'); await f.dispatch('\x01'); }
    await f.command('start'); await f.dispatch(data); await finish(f, 'never');
    assert.equal(f.workers[0].cancels, 1); assert.doesNotMatch(f.text, /never/); await f.shutdown();
  }
});

test('Up/Down cursor movement and batched typing keep native automatic insertion', async () => {
  for (const data of ['\x1b[A', '\x1b[B']) {
    const f = fixture(); await f.start(); f.setText('typed'); await f.command('start');
    await f.dispatch(data); await finish(f, 'dictated');
    assert.equal(f.workers[0].cancels, 0); assert.doesNotMatch(f.label, /pending/);
    assert.match(f.text, /dictated/); await f.shutdown();
  }
  const f = fixture(); await f.start(); f.setText('typed'); await f.command('start');
  f.dispatchSync('a'); f.dispatchSync('b'); f.dispatchSync('c');
  await finish(f, 'dictated'); assert.equal(f.text, 'typedabcdictated');
  assert.doesNotMatch(f.label, /pending/); await f.shutdown();
});

test('Enter/Escape used inside dialogs do not discard pending same-session transcription', async () => {
  const f = fixture(); await f.start(); await f.command('start');
  await f.event('ui_prompt_start'); f.setFocus({ handleInput() {} }); f.setOverlay(true);
  await finish(f, 'pending');
  await f.dispatch('\r'); await f.dispatch('\x1b');
  assert.match(f.label, /pending/);
  f.setFocus(f.editor); f.setOverlay(false); await f.event('ui_prompt_end');
  await f.command('accept'); assert.equal(f.text, 'pending'); await f.shutdown();
});

test('backslash Enter newline does not cancel a dictation', async () => {
  const f = fixture(); await f.start(); f.setText('typed\\'); await f.command('start');
  await f.dispatch('\r'); await finish(f, 'dictated');
  assert.equal(f.text, 'typed\ndictated'); assert.equal(f.workers[0].cancels, 0); await f.shutdown();
});

test('input/bash/agent and session/branch navigation invalidate before any await', async () => {
  for (const name of ['input', 'user_bash', 'before_agent_start', 'session_before_switch',
    'session_before_fork', 'session_before_tree', 'session_tree', 'session_before_compact']) {
    const f = fixture(); await f.start(); await f.command('start');
    await f.event(name); assert.equal(f.workers[0].cancels, 1);
    await finish(f, 'never'); assert.equal(f.text, ''); await f.shutdown();
  }
});

test('changed owner/session leaf prevents stale insertion even without lifecycle notification', async () => {
  for (const method of ['changeSession', 'changeLeaf']) {
    const f = fixture(); await f.start(); await f.command('start'); f[method]();
    await finish(f, 'never'); assert.equal(f.text, ''); assert.doesNotMatch(f.label, /pending/); await f.shutdown();
  }
});

test('dialogs require explicit same-session acceptance, not automatic delayed paste', async () => {
  const f = fixture(); await f.start(); await f.command('start');
  await f.event('ui_prompt_start'); f.setOverlay(true);
  await finish(f, 'pendente'); assert.equal(f.text, ''); assert.match(f.label, /pending/);
  await f.command('accept'); assert.equal(f.text, '');
  await f.event('ui_prompt_end'); f.setOverlay(false);
  f.setText('prefixo'); await f.command('accept'); assert.equal(f.text, 'prefixopendente');
  await f.command('accept'); assert.equal(f.text, 'prefixopendente'); await f.shutdown();
});

test('external-editor launch, replacement, unobserved text changes and stopped TUI do not auto-paste', async () => {
  for (const change of ['external', 'replace', 'text', 'terminal', 'overlay', 'focus']) {
    const f = fixture(); await f.start(); await f.command('start');
    if (change === 'external') await f.dispatch('\x07');
    if (change === 'replace') f.replaceEditor();
    if (change === 'text') f.setText('new draft');
    if (change === 'terminal') f.setTerminal(false);
    if (change === 'overlay') f.setOverlay(true);
    if (change === 'focus') f.setFocus({});
    await finish(f, 'never-auto'); assert.doesNotMatch(f.text, /never-auto/);
    assert.match(f.label, /pending/); await f.command('cancel'); await f.shutdown();
  }
});

test('pending text is discarded on submission or session teardown; never migrates', async () => {
  const f = fixture(); await f.start(); await f.command('start'); f.replaceEditor();
  await finish(f, 'never'); await f.event('input'); await f.command('accept'); assert.equal(f.text, '');
  await f.command('start'); f.replaceEditor(); await finish(f, 'never'); await f.shutdown();
  await f.start(); await f.command('accept'); assert.equal(f.text, ''); await f.shutdown();
});

test('pending acceptance also checks session and branch ownership at acceptance time', async () => {
  for (const method of ['changeSession', 'changeLeaf']) {
    const f = fixture(); await f.start(); await f.command('start'); f.replaceEditor();
    await finish(f, 'never'); assert.match(f.label, /pending/);
    f[method](); await f.command('accept'); assert.equal(f.text, '');
    assert.doesNotMatch(f.label, /Voice: pending/); await f.shutdown();
  }
});

test('recording status shows active input and has no elapsed timer after transcription/cancel', async () => {
  const f = fixture(); await f.start(); await f.command('start');
  const worker = f.workers[0]; worker.callbacks.state('recording', 'Synthetic USB microphone');
  assert.match(f.label, /recording 0s.*Synthetic USB microphone/);
  worker.callbacks.state('transcribing'); assert.doesNotMatch(f.label, /transcribing 0s/);
  await f.command('cancel'); await finish(f, 'never'); await f.shutdown();
});

test('busy/queued/non-editor/overlay/unsupported modes cannot open microphone', async () => {
  for (const change of ['busy', 'queued', 'focus', 'overlay']) {
    const f = fixture(); await f.start();
    if (change === 'busy') f.setIdle(false);
    if (change === 'queued') f.setQueued(true);
    if (change === 'focus') f.setFocus({});
    if (change === 'overlay') f.setOverlay(true);
    await f.command('start'); await f.dispatch(press); assert.equal(f.workers.length, 0); await f.shutdown();
  }
  const f = fixture({ platform: 'darwin' }); await f.start(); assert.equal(f.listeners.size, 0);
});

test('errors, empty and invalid-control results insert nothing and allow retry after safe cleanup', async () => {
  const f = fixture(); await f.start();
  for (const [text, outcome] of [['bad\x1b[201~text', 'completed'], ['', 'empty'], ['', 'error']]) {
    await f.command('start'); await finish(f, text, { outcome }); assert.equal(f.text, '');
  }
  await f.command('start'); await finish(f, 'valid'); assert.equal(f.text, 'valid'); await f.shutdown();
});

test('unconfirmed cleanup blocks further captures, including same-runtime session replacement', async () => {
  const f = fixture(); await f.start(); await f.command('start');
  await finish(f, 'never', { outcome: 'error', cleanupOk: false });
  await f.command('start'); assert.equal(f.workers.length, 1); assert.match(f.label, /blocked/);
  await f.shutdown(); await f.start(); await f.command('start'); assert.equal(f.workers.length, 1); await f.shutdown();
});

test('orderly shutdown waits for cleanup, invalidates early and removes resources', async () => {
  const f = fixture(); await f.start(); await f.command('start');
  let ended = false;
  const shutdown = f.shutdown().then(() => { ended = true; }); await tick();
  assert.equal(ended, false); assert.equal(f.workers[0].cancels, 1);
  f.workers[0].finish('never'); await shutdown;
  assert.equal(f.text, ''); assert.equal(f.listeners.size, 0); assert.equal(f.label, '');
});

test('bracketed paste is data, cannot activate voice, and preserves current draft edits', async () => {
  const f = fixture(); await f.start();
  await f.dispatch('\x1b[200~' + press + '\x1b[201~'); assert.equal(f.workers.length, 0);
  f.setText(''); await f.command('start');
  await f.dispatch('\x1b[200~typed\x1b[201~'); await finish(f, 'dictated');
  assert.equal(f.text, 'typeddictated'); await f.shutdown();
});

test('configuration is local/absolute and admission only normalizes paste-compatible whitespace', () => {
  const c = readConfig({}, '/home/synthetic'); assert.equal(c.model, '/home/synthetic/.local/share/whisper.cpp/models/ggml-large-v3.bin');
  assert.equal(readConfig({ PI_VOICE_MODEL: '~/model.bin' }, '/home/test').model, '/home/test/model.bin');
  assert.throws(() => readConfig({ PI_VOICE_WHISPER_CLI: 'relative' }, '/home/test'));
  assert.throws(() => readConfig({ PI_VOICE_MODEL: '/local\npath' }, '/home/test'));
  assert.equal(admitText('  ação\r\n\tdois  '), 'ação\n    dois');
  assert.throws(() => admitText('a\x1b[201~b'));
});
