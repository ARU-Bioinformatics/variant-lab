/* Dedicated, disposable worker for the pinned exactSNP 2.0.1 port.
 * The upstream Emscripten build exposes Module, FS and quit_ globally.
 * Keeping it isolated avoids conflicts with the separate Aioli 3 runtime. */
'use strict';
let stdout = '', stderr = '', nativeExitCode = 0;
let resolveRuntime, rejectRuntime;
const ready = new Promise((resolve, reject) => {
  resolveRuntime = resolve;
  rejectRuntime = reject;
});
self.Module = {
  noInitialRun: true,
  locateFile: name => new URL(name, self.location.href).href,
  print: line => { stdout += line + '\n'; },
  printErr: line => { stderr += line + '\n'; },
  onRuntimeInitialized: () => resolveRuntime(),
  onAbort: reason => rejectRuntime(new Error(String(reason)))
};
importScripts('exactSNP.js');

function mkdirp(path) {
  let current = '';
  for (const part of path.split('/').filter(Boolean)) {
    current += '/' + part;
    if (!FS.analyzePath(current).exists) FS.mkdir(current);
  }
}
const parent = path => path.slice(0, path.lastIndexOf('/')) || '/';

self.onmessage = async event => {
  const job = event.data;
  try {
    await ready;
    mkdirp(job.cwd);
    for (const path of job.dirs) mkdirp(path);
    for (const file of job.files) {
      mkdirp(parent(file.path));
      FS.writeFile(file.path, file.bytes);
    }
    for (const path of job.outputs) mkdirp(parent(path));
    FS.chdir(job.cwd);
    stdout = ''; stderr = ''; nativeExitCode = 0;
    // callMain swallows Emscripten's ExitStatus; capture the actual native
    // status before that happens. This hook is specific to the pinned build.
    quit_ = (status, error) => { nativeExitCode = status; throw error; };
    Module.callMain(job.args);
    const files = [];
    if (nativeExitCode === 0) {
      for (const path of job.outputs) {
        if (path.startsWith('/dev/')) continue;
        if (FS.analyzePath(path).exists) files.push({path, bytes: FS.readFile(path)});
      }
    }
    self.postMessage({code: nativeExitCode, stdout, stderr, files}, files.map(f => f.bytes.buffer));
  } catch (error) {
    self.postMessage({code: 1, stdout, stderr: stderr + '\nexactSNP: ' + (error.message || error) + '\n', files: []});
  }
};
