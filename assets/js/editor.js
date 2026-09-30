/* A small browser text editor using nano-style save and exit shortcuts. */
(function () {
  'use strict';
  const MG = window.MG = window.MG || {};
  const MAX_BYTES = 2 * 1024 * 1024;
  let active = false;
  let editorNumber = 0;

  function error(message) { return new Error('nano: ' + message); }
  function describe(cause) {
    const message = cause && cause.message ? cause.message : String(cause);
    return message.startsWith('nano: ') ? message : 'nano: ' + message;
  }
  function checkPath(fs, input, cwd) {
    if (typeof input !== 'string' || !input.trim()) throw error('enter a filename.');
    if (/[\x00-\x1f\x7f]/.test(input)) throw error('the filename contains a control character.');
    if (/\/$/.test(input)) throw error(input + ': is a directory path.');
    const absolute = fs.resolve(input, cwd);
    if (fs.isDir(absolute)) throw error(absolute + ': is a directory.');
    const parent = absolute.slice(0, absolute.lastIndexOf('/')) || '/';
    if (!fs.exists(parent)) throw error(parent + ': parent directory does not exist. Create it before opening or saving this file.');
    if (!fs.isDir(parent)) throw error(parent + ': is not a directory.');
    return absolute;
  }
  function isReadOnly(entry) {
    if (!entry) return false;
    if (entry.readOnly || entry.readonly || entry.writable === false) return true;
    let mode = entry.mode;
    if (typeof mode === 'string' && /^[0-7]{3,6}$/.test(mode)) mode = parseInt(mode, 8);
    return typeof mode === 'number' && Number.isInteger(mode) && (mode & 0o222) === 0;
  }
  function checkText(text) {
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(text)) throw error('this file contains binary data or control characters. The editor accepts UTF-8 text only.');
  }
  function normaliseLines(text) { return text.replace(/\r\n?/g, '\n'); }
  function lineStyle(text) {
    const crlf = /\r\n/.test(text), bare = text.replace(/\r\n/g, '');
    const cr = /\r/.test(bare), lf = /\n/.test(bare);
    const mixed = Number(crlf) + Number(cr) + Number(lf) > 1;
    return { separator: mixed ? '\n' : crlf ? '\r\n' : cr ? '\r' : '\n', mixed: mixed };
  }

  MG.openTextEditor = async function (options) {
    options = options || {};
    if (active) throw error('a text editor is already open.');
    const fs = options.fs;
    if (!fs || typeof fs.resolve !== 'function' || typeof fs.readBytes !== 'function' || typeof fs.writeText !== 'function') throw error('the file system is unavailable.');
    active = true;
    const cwd = fs.cwd;
    let currentPath = null, originalText = '', bom = false, existing = false;
    try {
      if (options.path != null && options.path !== '') {
        currentPath = checkPath(fs, options.path, cwd);
        existing = fs.exists(currentPath);
        if (existing) {
          const entry = fs.get(currentPath);
          const size = typeof fs.size === 'function' ? fs.size(entry) : entry.size;
          if (Number.isFinite(size) && size > MAX_BYTES) throw error('this file is larger than the 2 MiB editor limit.');
          const data = await fs.readBytes(currentPath);
          const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
          if (bytes.byteLength > MAX_BYTES) throw error('this file is larger than the 2 MiB editor limit.');
          if ((bytes[0] === 0x1f && bytes[1] === 0x8b) || (bytes[0] === 0x42 && bytes[1] === 0x41 && bytes[2] === 0x4d && bytes[3] === 1)) throw error('this is a compressed or binary file. The editor accepts UTF-8 text only.');
          bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
          try { originalText = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bom ? bytes.subarray(3) : bytes); }
          catch (_) { throw error('this file is not valid UTF-8 text.'); }
          checkText(originalText);
        }
      }
    } catch (cause) {
      active = false;
      throw error(describe(cause).slice(6));
    }

    return new Promise(function (resolve) {
      const doc = document, previousFocus = doc.activeElement, id = 'nano-editor-' + (++editorNumber);
      const el = function (tag, className, text) {
        const node = doc.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
      };
      const button = function (action, text, handler) {
        const node = el('button', 'nano-button', text);
        node.type = 'button'; node.dataset.editorAction = action;
        node.addEventListener('click', handler);
        return node;
      };
      const overlay = el('div', 'nano-overlay');
      const dialog = el('section', 'nano-dialog');
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-label', 'Text editor');
      dialog.setAttribute('aria-describedby', id + '-help');
      dialog.dataset.editorDirty = 'false';
      const header = el('header', 'nano-header');
      const heading = el('h2', '', 'Text editor');
      const controls = el('div', 'nano-controls');
      const saveButton = button('save', 'Save (Ctrl+O)', function () { openFilename(false); });
      const exitButton = button('exit', 'Exit (Ctrl+X)', requestExit);
      controls.append(saveButton, exitButton); header.append(heading, controls);
      const help = el('p', 'nano-help', 'A nano-style browser editor. Ctrl+O saves; Ctrl+X exits. Tab inserts a tab; Shift+Tab moves to the controls.');
      help.id = id + '-help';
      const pathLabel = el('p', 'nano-path'); pathLabel.dataset.editorPath = '';
      const buffer = el('textarea', 'nano-buffer');
      buffer.setAttribute('aria-label', 'File contents');
      buffer.setAttribute('aria-describedby', help.id);
      buffer.spellcheck = false; buffer.wrap = 'off'; buffer.autocomplete = 'off';
      buffer.setAttribute('autocapitalize', 'off'); buffer.setAttribute('autocorrect', 'off');
      buffer.value = normaliseLines(originalText);
      let savedDisplay = buffer.value, style = lineStyle(originalText), dirty = false, closed = false, busy = false, prompt = null;
      const footer = el('div', 'nano-footer');
      const position = el('span', 'nano-position'); position.dataset.editorPosition = '';
      const state = el('span', 'nano-state'); state.dataset.editorState = '';
      footer.append(position, state);
      const status = el('p', 'nano-status'); status.dataset.editorStatus = ''; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
      const promptHost = el('div', 'nano-prompt-host');
      dialog.append(header, help, pathLabel, buffer, footer, status, promptHost); overlay.append(dialog);
      const background = Array.from(doc.body.children).map(function (node) { return { node: node, inert: node.inert, inertAttr: node.hasAttribute('inert'), hidden: node.getAttribute('aria-hidden') }; });
      const oldOverflow = doc.body.style.overflow;
      doc.body.append(overlay); doc.body.style.overflow = 'hidden';
      background.forEach(function (entry) { entry.node.inert = true; entry.node.setAttribute('inert', ''); entry.node.setAttribute('aria-hidden', 'true'); });

      function report(message, failure) {
        status.textContent = message;
        status.dataset.editorError = String(!!failure);
        status.setAttribute('role', failure ? 'alert' : 'status');
      }
      function update() {
        dirty = buffer.value !== savedDisplay;
        dialog.dataset.editorDirty = String(dirty);
        pathLabel.textContent = currentPath ? (typeof fs.pretty === 'function' ? fs.pretty(currentPath) : currentPath) : 'New file';
        state.textContent = dirty ? 'Unsaved changes' : existing ? 'Saved' : 'New file';
        const before = buffer.value.slice(0, buffer.selectionStart), lines = before.split('\n');
        position.textContent = 'Line ' + lines.length + ', column ' + (Array.from(lines[lines.length - 1]).length + 1);
      }
      function lineNotice() {
        if (style.mixed) return 'Mixed line endings. Saving edits converts them to LF; saving unchanged text preserves the original bytes.';
        if (style.separator === '\r\n') return 'CRLF line endings will be preserved.';
        if (style.separator === '\r') return 'CR line endings will be preserved.';
        return 'Changes are written to the file only when you save.';
      }
      function clearPrompt(focusBuffer) {
        prompt = null; promptHost.replaceChildren();
        buffer.disabled = false; saveButton.disabled = false; exitButton.disabled = false;
        if (focusBuffer !== false) buffer.focus();
      }
      function cancelPrompt() {
        if (busy) return;
        clearPrompt(); report('Cancelled. Your edits are still in the editor.');
      }
      function makePrompt(kind, title) {
        clearPrompt(false);
        const panel = el('section', 'nano-prompt'); panel.dataset.editorPrompt = kind;
        panel.setAttribute('role', 'group'); panel.setAttribute('aria-label', title);
        panel.append(el('h3', '', title));
        promptHost.append(panel); prompt = { kind: kind, panel: panel };
        buffer.disabled = true; saveButton.disabled = true; exitButton.disabled = true;
        return panel;
      }
      function openFilename(exitAfterSave) {
        if (busy) return;
        const panel = makePrompt('filename', 'Save file');
        const form = el('form', 'nano-filename-form');
        const label = el('label', '', 'Filename'); label.htmlFor = id + '-filename';
        const input = el('input', 'nano-filename'); input.id = label.htmlFor;
        input.type = 'text'; input.dataset.editorFilename = ''; input.autocomplete = 'off'; input.spellcheck = false;
        input.value = currentPath || '';
        const actions = el('div', 'nano-prompt-actions');
        const save = button('confirm-save', 'Save', function () { form.requestSubmit(); });
        const cancel = button('cancel', 'Cancel', cancelPrompt);
        actions.append(save, cancel); form.append(label, input, actions);
        form.addEventListener('submit', function (event) { event.preventDefault(); if (!busy) beginSave(input.value, exitAfterSave); });
        panel.append(form); input.focus(); input.setSelectionRange(input.value.length, input.value.length);
        report('Enter a filename, then press Enter to save. Escape or Ctrl+C cancels.');
      }
      function requestExit() {
        if (busy || closed) return;
        update();
        if (!dirty) { close(); return; }
        const panel = makePrompt('unsaved', 'Save changes before closing?');
        panel.append(el('p', '', 'You have edits that have not been saved.'));
        const actions = el('div', 'nano-prompt-actions');
        const save = button('save', 'Save', function () { openFilename(true); });
        const discard = button('discard', 'Discard changes', close);
        const cancel = button('cancel', 'Cancel', cancelPrompt);
        actions.append(save, discard, cancel); panel.append(actions); cancel.focus();
        report('Choose Save, Discard changes or Cancel.');
      }
      function writable(target) {
        const entry = fs.get(target);
        const parent = target.slice(0, target.lastIndexOf('/')) || '/';
        if (isReadOnly(entry) || isReadOnly(fs.get(parent))) throw error(target + ': permission denied (read-only).');
        return entry;
      }
      function beginSave(filename, exitAfterSave) {
        let target;
        try { target = checkPath(fs, filename, cwd); writable(target); }
        catch (cause) { report(describe(cause), true); return; }
        if (target !== currentPath && fs.exists(target)) {
          const panel = makePrompt('overwrite', 'Replace the existing file?');
          panel.append(el('p', 'nano-overwrite-path', target));
          panel.append(el('p', '', 'Saving will replace its contents.'));
          const actions = el('div', 'nano-prompt-actions');
          const overwrite = button('overwrite', 'Replace file', function () { saveTo(target, exitAfterSave); });
          const cancel = button('cancel', 'Cancel', cancelPrompt);
          actions.append(overwrite, cancel); panel.append(actions); cancel.focus();
          report('The destination already exists.');
          return;
        }
        saveTo(target, exitAfterSave);
      }
      async function saveTo(target, exitAfterSave) {
        if (busy) return;
        busy = true;
        if (prompt) Array.from(prompt.panel.querySelectorAll('button,input')).forEach(function (node) { node.disabled = true; });
        try {
          checkPath(fs, target, cwd);
          const targetEntry = writable(target);
          const display = buffer.value;
          checkText(display);
          // Unchanged text is byte-preserving, including mixed endings and missing final newline.
          const contents = display === savedDisplay ? originalText : display.replace(/\n/g, style.separator);
          const text = (bom ? '\ufeff' : '') + contents;
          if (text.length > MAX_BYTES || new TextEncoder().encode(text).byteLength > MAX_BYTES) throw error('the edited file exceeds the 2 MiB limit.');
          const attributes = { fresh: true };
          if (targetEntry && targetEntry.mode != null) attributes.mode = targetEntry.mode;
          await fs.writeText(target, text, attributes);
          currentPath = target; originalText = contents; savedDisplay = display; existing = true;
          style = lineStyle(contents); update();
          busy = false; clearPrompt(); report('Saved ' + (typeof fs.pretty === 'function' ? fs.pretty(target) : target) + '.');
          if (exitAfterSave) close();
        } catch (cause) {
          busy = false;
          if (prompt) Array.from(prompt.panel.querySelectorAll('button,input')).forEach(function (node) { node.disabled = false; });
          report(describe(cause), true);
          const input = prompt && prompt.panel.querySelector('input');
          if (input) input.focus(); else if (prompt) prompt.panel.querySelector('button')?.focus();
        }
      }
      function close() {
        if (busy || closed) return;
        closed = true;
        doc.removeEventListener('keydown', onKey, true);
        doc.removeEventListener('focusin', trapFocus, true);
        window.removeEventListener('beforeunload', beforeUnload);
        overlay.remove(); doc.body.style.overflow = oldOverflow;
        background.forEach(function (entry) {
          entry.node.inert = entry.inert;
          if (!entry.inertAttr) entry.node.removeAttribute('inert');
          if (entry.hidden == null) entry.node.removeAttribute('aria-hidden'); else entry.node.setAttribute('aria-hidden', entry.hidden);
        });
        active = false;
        if (previousFocus && previousFocus.isConnected && typeof previousFocus.focus === 'function') previousFocus.focus();
        resolve(0);
      }
      function focusables() {
        const region = prompt ? prompt.panel : dialog;
        return Array.from(region.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),[tabindex="0"]')).filter(function (node) { return !node.hidden; });
      }
      function trapFocus(event) {
        const region = prompt ? prompt.panel : dialog;
        if (!region.contains(event.target)) {
          const items = focusables();
          if (items.length) items[0].focus();
        }
      }
      function onKey(event) {
        if (closed) return;
        const key = event.key.toLowerCase();
        if (prompt && (key === 'escape' || (event.ctrlKey && key === 'c'))) {
          event.preventDefault(); event.stopPropagation(); cancelPrompt(); return;
        }
        if (!prompt && event.ctrlKey && key === 'c') {
          // Keep the browser's copy action, without reaching a terminal interrupt handler.
          event.stopPropagation(); return;
        }
        if (event.ctrlKey && (key === 'o' || key === 'x')) {
          event.preventDefault(); event.stopPropagation();
          if (!prompt && !busy) { if (key === 'o') openFilename(false); else requestExit(); }
          return;
        }
        if (event.key === 'Tab') {
          if (!prompt && event.target === buffer && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
            event.preventDefault(); event.stopPropagation();
            let inserted = false;
            try { inserted = typeof doc.execCommand === 'function' && doc.execCommand('insertText', false, '\t'); } catch (_) { /* setRangeText is the fallback. */ }
            if (!inserted) { buffer.setRangeText('\t', buffer.selectionStart, buffer.selectionEnd, 'end'); buffer.dispatchEvent(new Event('input', { bubbles: true })); }
            update(); return;
          }
          const items = focusables(), first = items[0], last = items[items.length - 1];
          if (!items.length) { event.preventDefault(); return; }
          if (event.shiftKey && (doc.activeElement === first || !dialog.contains(doc.activeElement))) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && (doc.activeElement === last || !dialog.contains(doc.activeElement))) { event.preventDefault(); first.focus(); }
        }
        // Escape in the main editor leaves the buffer open; only prompts are cancelled.
        if (!prompt && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); }
      }
      function beforeUnload(event) {
        update();
        if (dirty) { event.preventDefault(); event.returnValue = ''; }
      }
      buffer.addEventListener('input', update);
      buffer.addEventListener('click', update);
      buffer.addEventListener('keyup', update);
      buffer.addEventListener('select', update);
      doc.addEventListener('keydown', onKey, true);
      doc.addEventListener('focusin', trapFocus, true);
      window.addEventListener('beforeunload', beforeUnload);
      update();
      const readOnly = currentPath && isReadOnly(fs.get(currentPath));
      report(readOnly ? 'This file is read-only. Save your edits under a different filename.' : lineNotice());
      buffer.focus(); buffer.setSelectionRange(0, 0); update();
    });
  };
}());
