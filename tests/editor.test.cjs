/* Text-editor interaction tests. Run with jsdom on NODE_PATH.
 * Uses the production VFS, shell and editor; no browser rendering or WASM work.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {JSDOM, VirtualConsole} = require('jsdom');
const root = path.resolve(__dirname, '..');
const failures = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', error => failures.push(error.message));
const dom = new JSDOM('<!doctype html><html><head></head><body><button id="origin">Open editor</button></body></html>', {
  url: 'http://variant-lab.test/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole,
  beforeParse(w) {
    w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder; w.Blob = Blob;
    w.matchMedia = () => ({matches: false, addListener() {}, removeListener() {}});
  }
});
const w = dom.window;
for (const name of ['core', 'icons', 'vfs', 'shell', 'editor']) {
  w.eval(fs.readFileSync(path.join(root, 'assets/js', name + '.js'), 'utf8'));
}
const MG = w.MG;
const doc = w.document;
const checks = [];
const assertBytes = (actual, expected) => assert.deepEqual(Array.from(actual), Array.from(expected));
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function waitFor(find, message = 'expected editor state') {
  for (let i = 0; i < 100; i++) { const result = find(); if (result) return result; await tick(); }
  throw new Error(message);
}
const editor = () => doc.querySelector('.nano-overlay [role="dialog"][aria-label="Text editor"]');
const prompt = kind => doc.querySelector(`[data-editor-prompt="${kind}"]`);
const button = (action, scope = editor()) => {
  const found = scope?.querySelector(`[data-editor-action="${action}"]`);
  assert(found, 'Missing editor action: ' + action); return found;
};
function type(text) {
  const buffer = editor().querySelector('.nano-buffer'); buffer.value = text;
  buffer.setSelectionRange(text.length, text.length);
  buffer.dispatchEvent(new w.Event('input', {bubbles: true})); return buffer;
}
function key(target, key, extra = {}) {
  target.dispatchEvent(new w.KeyboardEvent('keydown', {key, bubbles: true, cancelable: true, ...extra}));
}
async function open(vfs, filename) {
  let done = false;
  const completion = MG.openTextEditor({fs: vfs, path: filename}).then(code => { done = true; return code; });
  await waitFor(editor, 'Editor did not open');
  return {completion, isDone: () => done, buffer: editor().querySelector('.nano-buffer')};
}
async function saveAs(name, shortcut = false) {
  if(shortcut) key(editor().querySelector('.nano-buffer'), 'o', {ctrlKey: true}); else button('save').click(); const box = await waitFor(() => prompt('filename'));
  const input = box.querySelector('[data-editor-filename]'); input.value = name;
  input.dispatchEvent(new w.Event('input', {bubbles: true})); button('confirm-save', box).click(); await tick();
}
async function cancelPrompts() {
  for (let i = 0; i < 3; i++) {
    const box = doc.querySelector('[data-editor-prompt]'); if (!box) break;
    button('cancel', box).click(); await tick();
  }
  assert.equal(doc.querySelector('[data-editor-prompt]'), null);
}
async function closeClean(handle) {
  button('exit').click(); assert.equal(await handle.completion, 0);
  assert.equal(editor(), null, 'Editor closed');
}
async function check(label, test) { await test(); checks.push(label); console.log('PASS:', label); }
(async () => {
  const vfs = new MG.VFS(); vfs.mkdirp('work');
  await check('create, save and reopen UTF-8 text in the shared filesystem', async () => {
    const h = await open(vfs, 'work/new notes.txt');
    assert.equal(vfs.exists('work/new notes.txt'), false, 'Opening a new buffer does not write it');
    type('café ΔNA\n'); assert.equal(editor().dataset.editorDirty, 'true');
    await saveAs('work/new notes.txt', true); await waitFor(() => !prompt('filename'));
    assert.equal(await vfs.readText('work/new notes.txt'), 'café ΔNA\n');
    assert.equal(vfs.get('work/new notes.txt').fresh, true);
    assert.equal(editor().dataset.editorDirty, 'false'); assert.equal(h.isDone(), false, 'Save does not exit');
    await closeClean(h);
    const again = await open(vfs, 'work/new notes.txt'); assert.equal(again.buffer.value, 'café ΔNA\n');
    await closeClean(again);
  });
  await check('cancel and discard preserve existing bytes and leave no new file', async () => {
    const original = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('saved\r\n')]);
    vfs.put('work/preserve.txt', {kind: 'blob', blob: new Blob([original])});
    const h = await open(vfs, 'work/preserve.txt'); type('unsaved\n'); button('exit').click();
    let box = await waitFor(() => prompt('unsaved')); button('cancel', box).click(); await tick();
    assert.equal(h.isDone(), false); assert.equal(editor().querySelector('.nano-buffer').value, 'unsaved\n');
    assertBytes(await vfs.readBytes('work/preserve.txt'), original);
    button('exit').click(); box = await waitFor(() => prompt('unsaved')); button('discard', box).click();
    assert.equal(await h.completion, 0); assertBytes(await vfs.readBytes('work/preserve.txt'), original);
    const fresh = await open(vfs, 'work/discarded.txt'); type('do not write'); button('exit').click();
    box = await waitFor(() => prompt('unsaved')); button('discard', box).click(); await fresh.completion;
    assert.equal(vfs.exists('work/discarded.txt'), false);
  });
  await check('save-as overwrite requires confirmation and preserves the source', async () => {
    vfs.writeText('work/source.txt', 'source\n'); vfs.writeText('work/target.txt', 'target\n');
    const h = await open(vfs, 'work/source.txt'); type('replacement\n');
    await saveAs('work/target.txt'); let box = await waitFor(() => prompt('overwrite'));
    assert.equal(await vfs.readText('work/target.txt'), 'target\n'); button('cancel', box).click(); await tick();
    assert.equal(await vfs.readText('work/target.txt'), 'target\n'); await cancelPrompts();
    await saveAs('work/target.txt'); box = await waitFor(() => prompt('overwrite')); button('overwrite', box).click();
    await waitFor(() => !prompt('overwrite') && !prompt('filename'));
    assert.equal(await vfs.readText('work/target.txt'), 'replacement\n');
    assert.equal(await vfs.readText('work/source.txt'), 'source\n'); await closeClean(h);
  });
  await check('BOM and CRLF are preserved when a text file is edited', async () => {
    const original = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('one\r\ntwo\r\n')]);
    vfs.put('work/crlf.txt', {kind: 'blob', blob: new Blob([original])});
    const h = await open(vfs, 'work/crlf.txt'); type('one\nthree\n'); await saveAs('work/crlf.txt');
    await waitFor(() => !prompt('filename'));
    assertBytes(await vfs.readBytes('work/crlf.txt'), new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('one\r\nthree\r\n')]));
    await closeClean(h);
  });
  await check('invalid UTF-8, binary files and missing parent paths are rejected without writes', async () => {
    for (const [name, bytes] of [['invalid.txt', [0x61, 0xc3, 0x28]], ['binary.bin', [0x00, 0x42, 0x41, 0x4d]], ['compressed.gz', [0x1f, 0x8b, 0x08, 0x00]]]) {
      const original = new Uint8Array(bytes); vfs.put('work/' + name, {kind: 'blob', blob: new Blob([original])});
      await assert.rejects(MG.openTextEditor({fs: vfs, path: 'work/' + name}), /nano:|UTF-8|binary|compressed/i);
      assert.equal(editor(), null); assertBytes(await vfs.readBytes('work/' + name), original);
    }
    await assert.rejects(MG.openTextEditor({fs: vfs, path: 'missing/new.txt'}), /directory|parent|exist/i);
    assert.equal(vfs.exists('missing'), false);
    const h = await open(vfs, 'work/source.txt'); type('keep buffer\n'); await saveAs('missing/output.txt');
    await waitFor(() => editor()?.querySelector('[data-editor-error="true"]'));
    assert.equal(vfs.exists('missing'), false); assert.equal(await vfs.readText('work/source.txt'), 'source\n');
    await cancelPrompts(); button('exit').click(); const box = await waitFor(() => prompt('unsaved')); button('discard', box).click(); await h.completion;
  });
  await check('relative save paths use the directory in which the editor opened', async () => {
    vfs.mkdirp('elsewhere'); const h = await open(vfs, 'work/source.txt'); type('relative path\n');
    vfs.cwd = '/home/student/elsewhere'; await saveAs('work/relative.txt'); await waitFor(() => !prompt('filename'));
    assert.equal(await vfs.readText('/home/student/work/relative.txt'), 'relative path\n');
    assert.equal(vfs.exists('/home/student/elsewhere/work/relative.txt'), false); await closeClean(h); vfs.cwd = vfs.home;
  });
  await check('nano blocks a command chain until exit; quoted paths and literal tabs reach cat', async () => {
    assert.equal(typeof MG.shellBuiltins.nano, 'function');
    const shell = new MG.Shell({fs: vfs}); let out = '', err = '', done = false;
    const pending = shell.run('nano "work/regions with spaces.bed" && cat "work/regions with spaces.bed"', {out: text => { out += text; }, err: text => { err += text; }, note() {}}).then(code => { done = true; return code; });
    await waitFor(editor); assert.equal(done, false); assert.equal(out, '');
    const buffer = type('yeast_chrM'); key(buffer, 'Tab');
    assert.equal(buffer.value, 'yeast_chrM\t', 'Tab inserts an actual tab');
    type(buffer.value + '10'); key(buffer, 'Tab'); type(buffer.value + '20\n');
    await saveAs('work/regions with spaces.bed'); await waitFor(() => !prompt('filename'));
    assert.equal(done, false, 'The chain remains paused after saving'); assert.equal(out, '');
    key(buffer, 'x', {ctrlKey: true}); assert.equal(await pending, 0, err);
    assert.equal(out, 'yeast_chrM\t10\t20\n'); assert.equal(err, '');
    const fields = (await vfs.readText('work/regions with spaces.bed')).trim().split('\t');
    assert.deepEqual(fields, ['yeast_chrM', '10', '20']);
    vfs.writeText('work/valuable.txt', 'preserve me\n'); vfs.writeText('nano', 'command-name glob fixture\n');
    for (const command of ['echo text | nano work/source.txt', 'nano work/source.txt | cat', 'nano work/source.txt > work/redirect.txt', 'echo overwritten > work/valuable.txt | nano work/source.txt', 'nano work/source.txt | echo overwritten > work/valuable.txt', 'nano work/source.txt 2> work/valuable.txt', 'nano work/source.txt 2>&1', 'nano work/source.txt &> work/valuable.txt', 'n* work/source.txt > work/valuable.txt']) {
      let finished = false;
      const pendingGuard = shell.run(command, {out() {}, err() {}, note() {}}).then(code => { finished = true; return code; });
      await waitFor(() => finished || editor(), 'Interactive command guard did not finish');
      assert.equal(editor(), null, 'Rejected interactive syntax does not open a modal: ' + command);
      const status = await pendingGuard;
      assert.notEqual(status, 0, 'Interactive editor rejects pipelines/redirections'); assert.equal(editor(), null);
      assert.equal(await vfs.readText('work/valuable.txt'), 'preserve me\n', 'Preflight runs before any destructive stage or redirection');
      assert.equal(vfs.exists('work/redirect.txt'), false, 'Rejected redirection creates no output');
    }
  });
  assert.deepEqual(failures, [], 'No jsdom runtime errors');
  console.log(`PASS: ${checks.length} editor interaction checks; no rendered-browser geometry claims.`);
  w.close();
})().catch(error => { console.error(error); console.error('jsdom errors:', failures); w.close(); process.exitCode = 1; });
