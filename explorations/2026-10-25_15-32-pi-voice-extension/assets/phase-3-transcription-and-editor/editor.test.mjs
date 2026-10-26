// Exploration only. Real installed Pi UI bridge + CustomEditor, synthetic text,
// fake TUI owner. No Pi session, terminal, processes, microphone or model runs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.env.PI_TEST_MODULE_ROOT || '/home/debonzi/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works';
const load = (path) => import(pathToFileURL(join(root, path)).href);
const { CustomEditor } = await load('pi-coding-agent/dist/modes/interactive/components/custom-editor.js');
const { InteractiveMode } = await load('pi-coding-agent/dist/modes/interactive/interactive-mode.js');
const { KeybindingsManager } = await load('pi-coding-agent/dist/core/keybindings.js');
const { getKeybindings, setKeybindings } = await load('pi-tui/dist/keybindings.js');

const kb = new KeybindingsManager(); // Constructor only: no config files loaded.
const previous = getKeybindings();
setKeybindings(kb);
process.on('exit', () => setKeybindings(previous));
const identity = (x) => x;
const theme = { borderColor: identity, selectList: {
  selectedPrefix: identity, selectedText: identity, description: identity,
  scrollInfo: identity, noMatch: identity,
} };
function fixture(text = '') {
  const editor = new CustomEditor({ requestRender() {} }, theme, kb);
  const submitted = [];
  editor.onSubmit = (text) => submitted.push(text);
  editor.setText(text);
  let renders = 0;
  const owner = { editor, ui: { requestRender() { renders++; } },
    footerDataProvider: { setExtensionStatus() {} },
    setExtensionStatus: InteractiveMode.prototype.setExtensionStatus,
  };
  // Actual installed UI method, not a reimplementation of pasteToEditor.
  const ui = InteractiveMode.prototype.createExtensionUIContext.call(owner);
  return { editor, ui, owner, submitted, get renders() { return renders; } };
}
const left = (e, count) => { for (let i = 0; i < count; i++) e.handleInput('\x1b[D'); };
const undo = (e) => e.handleInput('\x1b[45;5u'); // Kitty Ctrl+-.
function safePayload(text) {
  // Experimental admission check, not production policy. Prevent bracketed-paste
  // delimiter injection. Reject rather than silently rewrite meaningful content.
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/u.test(text)) throw new Error('control byte');
  return text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').trim();
}

test('empty prompt: actual UI paste inserts, positions cursor and never submits', () => {
  const f = fixture();
  f.ui.pasteToEditor('Texto ditado.');
  assert.equal(f.ui.getEditorText(), 'Texto ditado.');
  assert.deepEqual(f.editor.getCursor(), { line: 0, col: 13 });
  assert.deepEqual(f.submitted, []);
});
test('asynchronous paste needs rendering feedback; actual setStatus requests it', () => {
  const f = fixture();
  f.ui.pasteToEditor('texto');
  assert.equal(f.renders, 0);
  f.ui.setStatus('voice', 'Inserted; review before sending');
  assert.equal(f.renders, 1);
});
test('append after typing preserves existing prefix', () => {
  const f = fixture('Leia o README. ');
  f.ui.pasteToEditor('Depois execute os testes.');
  assert.equal(f.ui.getEditorText(), 'Leia o README. Depois execute os testes.');
});
test('middle insertion preserves prefix and suffix', () => {
  const f = fixture('antes depois');
  left(f.editor, 6);
  f.ui.pasteToEditor('TRECHO ');
  assert.equal(f.ui.getEditorText(), 'antes TRECHO depois');
  assert.deepEqual(f.editor.getCursor(), { line: 0, col: 13 });
});
test('start insertion preserves entire old prompt', () => {
  const f = fixture('fim');
  f.editor.handleInput('\x01'); // Ctrl+A.
  f.ui.pasteToEditor('início ');
  assert.equal(f.ui.getEditorText(), 'início fim');
});
test('async result uses cursor at delivery and preserves intervening typing', async () => {
  const f = fixture('Antes.');
  const result = Promise.resolve('TRECHO ');
  f.editor.handleInput(' Mais texto.');
  f.editor.handleInput('\x01');
  f.ui.pasteToEditor(await result);
  assert.equal(f.ui.getEditorText(), 'TRECHO Antes. Mais texto.');
});
test('successive parts plus typing need no submission between them', () => {
  const f = fixture('Digitado. ');
  f.ui.pasteToEditor('Parte um.');
  f.editor.handleInput(' Complemento. ');
  f.ui.pasteToEditor('Parte dois.');
  assert.equal(f.ui.getEditorText(), 'Digitado. Parte um. Complemento. Parte dois.');
  assert.deepEqual(f.submitted, []);
});
test('multiline result inserts literally, normalizes CRLF/tabs, no submission', () => {
  const f = fixture('AB');
  left(f.editor, 1);
  f.ui.pasteToEditor('um\r\n\tdois\rtrês');
  assert.equal(f.ui.getEditorText(), 'Aum\n    dois\ntrêsB');
  assert.deepEqual(f.editor.getCursor(), { line: 2, col: 4 });
  assert.deepEqual(f.submitted, []);
});
test('single undo removes the entire dictated part only', () => {
  const f = fixture('prefixo sufixo');
  left(f.editor, 6);
  const cursor = f.editor.getCursor();
  f.ui.pasteToEditor('uma\nparte ');
  undo(f.editor);
  assert.equal(f.ui.getEditorText(), 'prefixo sufixo');
  assert.deepEqual(f.editor.getCursor(), cursor);
});
test('successive parts are separate undo units', () => {
  const f = fixture('base ');
  f.ui.pasteToEditor('um ');
  f.ui.pasteToEditor('dois');
  undo(f.editor);
  assert.equal(f.ui.getEditorText(), 'base um ');
  undo(f.editor);
  assert.equal(f.ui.getEditorText(), 'base ');
});
test('Unicode movement is delegated to editor grapheme handling', () => {
  const f = fixture('ação 👩‍💻 fim');
  left(f.editor, 4);
  f.ui.pasteToEditor('🙂');
  assert.equal(f.ui.getEditorText(), 'ação 👩‍💻🙂 fim');
});
test('paste does not add general word spacing automatically', () => {
  const f = fixture('antesdepois');
  left(f.editor, 6);
  f.ui.pasteToEditor('ditado');
  assert.equal(f.ui.getEditorText(), 'antesditadodepois');
});
test('paste has a path-prefix spacing heuristic (not literal insertion)', () => {
  const f = fixture('palavra');
  f.ui.pasteToEditor('/caminho');
  assert.equal(f.ui.getEditorText(), 'palavra /caminho');
});
test('1000 characters remain inline; 1001 collapse without losing expanded text', () => {
  for (const n of [1000, 1001]) {
    const f = fixture('prefixo '), text = 'x'.repeat(n);
    f.ui.pasteToEditor(text);
    assert.equal(f.ui.getEditorText(), 'prefixo ' + text);
    assert.equal(f.editor.getText().includes('[paste #'), n > 1000);
    assert.deepEqual(f.submitted, []);
  }
});
test('10 lines remain inline; 11 collapse even below character threshold', () => {
  for (const lines of [10, 11]) {
    const f = fixture(), text = Array(lines).fill('linha').join('\n');
    f.ui.pasteToEditor(text);
    assert.equal(f.ui.getEditorText(), text);
    assert.equal(f.editor.getText().includes('[paste #'), lines > 10);
  }
});
test('collapsed marker is an atomic cursor unit, not inline editable transcript', () => {
  const f = fixture();
  f.ui.pasteToEditor('x'.repeat(1001));
  left(f.editor, 1);
  assert.deepEqual(f.editor.getCursor(), { line: 0, col: 0 });
  f.editor.handleInput('!');
  assert.equal(f.ui.getEditorText(), '!' + 'x'.repeat(1001));
  assert.match(f.editor.getText(), /\[paste #1/);
});
test('explicit setEditorText(expanded) expands marker but puts cursor at end', () => {
  const f = fixture('fim');
  f.editor.handleInput('\x01');
  f.ui.pasteToEditor('x'.repeat(1001));
  const full = f.ui.getEditorText();
  f.ui.setEditorText(full);
  assert.equal(f.editor.getText(), full);
  assert.deepEqual(f.editor.getCursor(), { line: 0, col: full.length });
});
test('public CustomEditor method inserts long text inline, atomically, no submit', () => {
  const f = fixture('AB'), text = 'x'.repeat(1001) + '\n' + Array(11).fill('y').join('\n');
  left(f.editor, 1);
  f.editor.insertTextAtCursor(text);
  assert.equal(f.editor.getText(), 'A' + text + 'B');
  assert.deepEqual(f.submitted, []);
  undo(f.editor);
  assert.equal(f.editor.getText(), 'AB');
});
test('public UI has no cursor access; replacing editor redirects UI paste', () => {
  const f = fixture('old');
  assert.equal(f.ui.getCursor, undefined);
  assert.equal(f.ui.insertTextAtCursor, undefined);
  const next = fixture('new ');
  f.owner.editor = next.editor;
  f.ui.pasteToEditor('result');
  assert.equal(next.editor.getText(), 'new result');
  assert.equal(f.editor.getText(), 'old');
});
test('bracketed paste cancels pending character-jump mode and still inserts', () => {
  const f = fixture('abc');
  const jump = '\x1b[93;5u'; // Kitty Ctrl+].
  assert.equal(kb.matches(jump, 'tui.editor.jumpForward'), true);
  f.editor.handleInput(jump);
  f.ui.pasteToEditor('abc');
  assert.equal(f.editor.getText(), 'abcabc');
  assert.deepEqual(f.submitted, []);
});
test('safe payload admission rejects embedded paste-end/control sequences', () => {
  for (const text of ['x\x1b[201~\r', 'x\0', 'x\x7f', 'x\x85']) {
    assert.throws(() => safePayload(text), /control byte/);
  }
  assert.equal(safePayload('  ação\r\n\tlinha  '), 'ação\n    linha');
});
