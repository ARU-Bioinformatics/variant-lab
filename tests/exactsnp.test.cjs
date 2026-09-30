/* Genuine vendored WASM integration test; no browser or npm dependencies.
 * Run from any directory with Node 18+: node /path/to/tests/exactsnp.test.cjs
 * The Worker transport is adapted to Node's VM; the compiled scientific
 * programs, production worker, VFS, and exactSNP adapter run unchanged. */
'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');

const project = path.resolve(__dirname, '..');
const exactBase = path.join(project, 'assets/vendor/exactsnp');
const platform = {
  console, TextDecoder, TextEncoder, Uint8Array, Int8Array, Uint16Array,
  Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array, ArrayBuffer,
  WebAssembly, URL, Blob, Response, DecompressionStream, setTimeout,
  clearTimeout, setInterval, clearInterval, Promise, performance,
  crypto: require('node:crypto').webcrypto
};

function runWorker(job) {
  return new Promise((resolve, reject) => {
    const worker = {...platform};
    worker.self = worker;
    worker.location = {href: 'http://localhost/exactsnp/worker.js'};
    worker.postMessage = resolve;
    const context = vm.createContext(worker);
    worker.importScripts = () => {
      worker.Module.wasmBinary = fs.readFileSync(path.join(exactBase, 'exactSNP.wasm'));
      vm.runInContext(fs.readFileSync(path.join(exactBase, 'exactSNP.js'), 'utf8'), context);
    };
    try {
      vm.runInContext(fs.readFileSync(path.join(exactBase, 'worker.js'), 'utf8'), context);
      worker.onmessage({data: job}).catch(reject);
    } catch (error) { reject(error); }
  });
}

(async () => {
  let native;
  class Worker {
    postMessage(job) {
      runWorker(job).then(result => {
        native = result;
        this.onmessage({data: result});
      }).catch(error => this.onerror({message: error.message}));
    }
    terminate() {}
  }
  const app = {
    ...platform, Worker,
    document: {currentScript: {src: 'http://localhost/assets/js/exactsnp.js'}},
    MG: {bus: {emit() {}}}
  };
  app.window = app;
  const context = vm.createContext(app);
  for (const script of ['vfs.js', 'exactsnp.js']) {
    vm.runInContext(fs.readFileSync(path.join(project, 'assets/js', script), 'utf8'), context);
  }
  const vfs = new app.MG.VFS();
  vfs.mkdirp('temp');

  // Deterministic independent input: 80 reads, half with C>A at chrT:100.
  let seed = 41, sequence = '';
  for (let i = 0; i < 300; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    sequence += 'ACGT'[seed >>> 30];
  }
  const alt = [...'ACGT'].find(base => base !== sequence[99]);
  let sam = '@HD\tVN:1.6\tSO:coordinate\n@SQ\tSN:chrT\tLN:300\n';
  for (let i = 0; i < 80; i++) {
    const read = sequence.slice(30, 150).split('');
    if (i < 40) read[69] = alt;
    sam += `r${i}\t0\tchrT\t31\t60\t120M\t*\t0\t0\t${read.join('')}\t${'I'.repeat(120)}\n`;
  }
  // Include a second contig without reads: the header must cover all FASTA
  // contigs, not just the chromosome appearing in the native variant calls.
  const reference = '>chrT description\n' + sequence + '\n>chrU\n' + sequence.slice(0, 100) + '\n';
  vfs.writeText('in.sam', sam);
  vfs.writeText('ref.fa', reference);
  let logs = '';
  const code = await app.MG.shellTools.exactSNP.run({
    args: ['-i', 'in.sam', '-g', 'ref.fa', '-o', 'calls.vcf', '-C', 'temp'],
    fs: vfs, io: {note: text => { logs += text + '\n'; }},
    out: text => { logs += text; }, err: text => { logs += text; }
  });
  assert.equal(code, 0, 'native exactSNP succeeds');
  const output = await vfs.readText('calls.vcf');
  const raw = new TextDecoder().decode(native.files[0].bytes);
  assert.equal(output.slice(output.indexOf('#CHROM')), raw.slice(raw.indexOf('#CHROM')),
    'header completion preserves #CHROM and all native records byte for byte');
  for (const line of [
    '##contig=<ID=chrT,length=300>', '##contig=<ID=chrU,length=100>',
    '##source=exactSNP-2.0.1', '##INFO=<ID=MMsum,Number=1,Type=Integer',
    '##variantLabQualityScale='
  ]) assert(output.includes(line), 'missing required metadata: ' + line);
  assert(logs.includes('[exactSNP adapter]'), 'header changes are disclosed in logs');
  assert(logs.includes('Temp path : /home/student/temp'), 'native -C uses the supplied directory');

  const bcftoolsBase = path.join(project, 'assets/vendor/biowasm/bcftools/1.10');
  const data = fs.readFileSync(path.join(bcftoolsBase, 'bcftools.data'));
  let bcftoolsStderr = '';
  const bcftools = await require(path.join(bcftoolsBase, 'bcftools.js'))({
    wasmBinary: fs.readFileSync(path.join(bcftoolsBase, 'bcftools.wasm')),
    getPreloadedPackage: () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    locateFile: name => path.join(bcftoolsBase, name),
    print() {}, printErr: text => { bcftoolsStderr += text + '\n'; }, noInitialRun: true
  });
  bcftools.FS.writeFile('/ref.fa', reference);
  bcftools.FS.writeFile('/calls.vcf', output);
  bcftools.callMain(['norm', '-f', '/ref.fa', '-m', '-any', '-Ov', '-o', '/normalized.vcf', '/calls.vcf']);
  const normalized = bcftools.FS.readFile('/normalized.vcf', {encoding: 'utf8'});
  assert(!bcftoolsStderr.includes('not defined'), 'normalization has no missing-header warnings');
  assert(!bcftoolsStderr.includes('[E::'), 'normalization has no HTSlib errors');
  assert(normalized.includes('chrT\t100\t.\tC\tA\t40'), 'normalization retains the expected allele');

  const results = {
    execution: 'Genuine exactSNP and BCFtools WASM; Node VM transport; not a browser test',
    exactSNPCode: code,
    nativeRecordsUnchangedByAdapter: true,
    referenceContigs: ['chrT:300', 'chrU:100'],
    missingInfoDeclared: true,
    qualityScaleAndSourceDeclared: true,
    tempDirectoryWorked: true,
    bcftoolsNormStderr: bcftoolsStderr,
    normalizedRecords: normalized.split('\n').filter(line => line && !line.startsWith('#'))
  };
  fs.writeFileSync(path.join(__dirname, 'exactsnp-results.json'), JSON.stringify(results, null, 2) + '\n');
  console.log('PASS: genuine exactSNP -> metadata completion -> bcftools norm');
  console.log(JSON.stringify(results, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
