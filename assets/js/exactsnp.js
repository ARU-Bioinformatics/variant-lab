/* Real exactSNP 2.0.1, run in a fresh worker against current workspace bytes.
 * Source, build caveats and GPL licence: assets/vendor/exactsnp/NOTICE.md. */
(function () {
  'use strict';
  const MG = window.MG;
  const T = (MG.shellTools = MG.shellTools || {});
  const scriptURL = document.currentScript.src;
  const workerURL = new URL('../vendor/exactsnp/worker.js', scriptURL).href;
  const inputOptions = new Set(['i', 'g', 'a', 'N', '7']);
  const valueOptions = new Set('7NCaigoQpfnrxwstT'.split(''));

  async function referenceContigs(bytes) {
    if (!bytes) return [];
    // FASTA headers and lengths come from the exact reference supplied to -g.
    if (bytes[0] === 31 && bytes[1] === 139) {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    }
    const contigs = [];
    let current;
    for (const line of new TextDecoder().decode(bytes).split(/\r?\n/)) {
      if (line.startsWith('>')) {
        const match = /^>(\S+)/.exec(line);
        current = match ? {id: match[1], length: 0} : null;
        if (current) contigs.push(current);
      } else if (current && !line.startsWith(';')) current.length += line.replace(/\s/g, '').length;
    }
    return contigs;
  }

  function completeVcfHeader(text, contigs) {
    const marker = /^#CHROM\t/m.exec(text);
    if (!marker) return {text, added: []}; // Other native output modes are untouched.
    const header = text.slice(0, marker.index);
    const existing = kind => new Set(Array.from(header.matchAll(new RegExp('^##' + kind + '=<ID=([^,>]+)', 'gm')), m => m[1]));
    const declaredContigs = existing('contig'), infos = existing('INFO'), filters = existing('FILTER');
    const lines = [], added = [];
    for (const contig of contigs) {
      if (!declaredContigs.has(contig.id)) {
        lines.push(`##contig=<ID=${contig.id},length=${contig.length}>`);
        declaredContigs.add(contig.id);
        added.push('contig:' + contig.id);
      }
    }
    // Definitions verified against the pinned native SNPCalling.c. Optional
    // CTRL/VS fields occur only when a background alignment is supplied.
    const definitions = {
      MMsum: ['1', 'Integer', 'Total reads supporting alternate SNP alleles'],
      CTRL_DP: ['1', 'Integer', 'Read depth in the background alignment'],
      CTRL_MM: ['1', 'Integer', 'Alternate-supporting reads in the background alignment'],
      CTRL_QV: ['1', 'Float', 'Background SNP significance on the exactSNP minus-log10 scale'],
      VS_QV: ['1', 'Float', 'Case-versus-background significance reported by exactSNP']
    };
    const usedInfo = new Map(), usedFilters = new Set();
    for (const line of text.slice(marker.index).split(/\r?\n/)) {
      if (!line || line[0] === '#') continue;
      const fields = line.split('\t');
      if (fields.length < 8) continue;
      for (const filter of fields[6].split(';')) {
        if (filter && filter !== '.' && filter !== 'PASS') usedFilters.add(filter);
      }
      for (const field of fields[7].split(';')) {
        if (!field || field === '.') continue;
        const equal = field.indexOf('='), id = equal < 0 ? field : field.slice(0, equal);
        // Unknown valued fields receive a conservative string declaration,
        // without inferring scientific semantics from an observed value.
        usedInfo.set(id, (usedInfo.get(id) || false) || equal >= 0);
      }
    }
    // Declare MMsum even for an empty callset so the output's schema is stable.
    if (!usedInfo.has('MMsum')) usedInfo.set('MMsum', true);
    for (const [id, hasValue] of usedInfo) {
      if (infos.has(id)) continue;
      const [number, type, description] = definitions[id] || (hasValue
        ? ['.', 'String', 'Undeclared field emitted by exactSNP; adapter supplies a string declaration']
        : ['0', 'Flag', 'Undeclared flag emitted by exactSNP; declaration supplied by adapter']);
      lines.push(`##INFO=<ID=${id},Number=${number},Type=${type},Description="${description}">`);
      added.push('INFO:' + id);
    }
    for (const id of usedFilters) {
      if (filters.has(id)) continue;
      lines.push(`##FILTER=<ID=${id},Description="Filter emitted by exactSNP; declaration supplied by adapter">`);
      added.push('FILTER:' + id);
    }
    if (!/^##source=exactSNP-2\.0\.1\r?$/m.test(header)) {
      lines.push('##source=exactSNP-2.0.1');
      added.push('source');
    }
    if (!/^##variantLabQualityScale=/m.test(header)) {
      lines.push('##variantLabQualityScale="SNP: min(40, -log10(p)); NOT PHRED; indel: fixed QUAL 1.0"');
      added.push('quality scale');
    }
    if (lines.length) lines.push('##variantLabHeaderRepair="Added reference contigs, missing field declarations and provenance; native variant records unchanged"');
    const newline = header.includes('\r\n') ? '\r\n' : '\n';
    return {text: header + (lines.length ? lines.join(newline) + newline : '') + text.slice(marker.index), added};
  }

  async function prepare(ctx) {
    const args = ctx.args.slice();
    const files = new Map(), outputs = [], dirs = [];
    let referencePath;
    if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) args.length = 0;
    if (args.length === 1 && args[0] === '--version') args[0] = '-v';
    // Parse short option bundles solely to resolve filenames and protect the
    // single-threaded port. The program itself validates all other options.
    for (let i = 0; i < args.length; i++) {
      const token = args[i];
      if (!/^-[^-]/.test(token)) continue;
      for (let j = 1; j < token.length; j++) {
        const option = token[j];
        if (!valueOptions.has(option)) continue;
        const attached = j + 1 < token.length;
        const valueIndex = attached ? i : i + 1;
        const value = attached ? token.slice(j + 1) : args[valueIndex];
        if (value == null) break;
        if (option === 'T' && Number(value) !== 1) {
          throw new Error('This exactSNP browser build supports one thread. Use -T 1; higher values are not safe in this port.');
        }
        if (inputOptions.has(option) || option === 'o' || option === 'C') {
          const path = ctx.fs.resolve(value);
          if (inputOptions.has(option)) {
            if (!ctx.fs.exists(path) || ctx.fs.isDir(path)) throw new Error(value + ': No such input file');
            files.set(path, {path, bytes: await ctx.fs.readBytes(path)});
            if (option === 'g') referencePath = path;
          } else if (option === 'o') outputs.push(path);
          else {
            if (!ctx.fs.isDir(path)) throw new Error(value + ': temporary directory does not exist');
            dirs.push(path);
          }
          args[valueIndex] = attached ? token.slice(0, j + 1) + path : path;
        }
        if (!attached) i++;
        break;
      }
    }
    if (ctx.isPipedIn && ctx.stdin != null && ctx.stdin !== '') {
      throw new Error('exactSNP reads a SAM/BAM filename with -i. Save the upstream output to a file, then use -i FILE.');
    }
    const contigs = await referenceContigs(referencePath && files.get(referencePath).bytes);
    return {args, files: Array.from(files.values()), outputs: [...new Set(outputs)], dirs, cwd: ctx.fs.cwd, contigs};
  }

  function execute(job, ctx) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(workerURL);
      let finished = false;
      const finish = (error, result) => {
        if (finished) return;
        finished = true;
        clearInterval(cancelPoll);
        worker.terminate();
        error ? reject(error) : resolve(result);
      };
      const cancelPoll = setInterval(() => {
        if (ctx.term && ctx.term.cancelled) finish(new Error('exactSNP cancelled'));
      }, 100);
      worker.onerror = event => finish(new Error(event.message || 'Could not start exactSNP'));
      worker.onmessage = event => finish(null, event.data);
      // Structured-clone the inputs: transferring them could detach a buffer
      // still owned by the shared Aioli filesystem.
      worker.postMessage(job);
    });
  }

  T.exactSNP = {
    summary: 'independent SNP caller using local background noise (real WebAssembly)',
    man: [
      'exactSNP 2.0.1 — genuine Subread caller, compiled to WebAssembly by Junli Li.',
      '  exactSNP -b -i aligned.bam -g reference.fa -o calls.vcf',
      '  exactSNP -i aligned.sam -g reference.fa -o calls.vcf',
      '  -Q N  significance cutoff; -f F  minimum alternate fraction;',
      '  -n N  minimum alternate reads; -r N  minimum depth; -s N  base quality.',
      '  -C DIR  temporary file directory (create it first with mkdir).',
      '  exactSNP --help  shows the native help; exactSNP -v  shows the native version.',
      'This port runs one thread (-T 1). There is no sample GT field.',
      'SNP QUAL is min(40, -log10(p)), not Phred. Reported simple indels have QUAL 1.',
      'Compare alleles with bcftools; do not apply the same QUAL threshold across callers.',
      'Input bytes are copied into an isolated worker and output VCF returns to this workspace.',
      'The adapter adds reference contigs and missing VCF metadata; native variant records are unchanged.'
    ].join('\n'),
    async run(ctx) {
      const start = performance.now();
      let result = {code: 1, files: []};
      const created = [];
      try {
        if (ctx.io && ctx.io.note) ctx.io.note('Running exactSNP 2.0.1 on the current input files…');
        const job = await prepare(ctx);
        result = await execute(job, ctx);
        if (result.stdout) ctx.out(result.stdout);
        if (result.stderr) ctx.err(result.stderr);
        if (result.code === 0) {
          for (const file of result.files) {
            const completed = completeVcfHeader(new TextDecoder().decode(file.bytes), job.contigs);
            ctx.fs.writeText(file.path, completed.text, {fresh: true});
            if (completed.added.length) ctx.err('[exactSNP adapter] Added VCF header metadata (' + completed.added.join(', ') + '); native variant records unchanged.\n');
            created.push(file.path);
          }
          if (job.outputs.length && !created.length && !job.outputs.some(path => path.startsWith('/dev/'))) {
            result.code = 1;
            ctx.err('exactSNP did not create the requested output file.\n');
          }
        }
      } catch (error) {
        result.code = 1;
        ctx.err('exactSNP: ' + error.message + '\n');
      }
      MG.bus.emit('tool:run', {program: 'exactSNP', sub: '', args: ctx.args, code: result.code,
        secs: (performance.now() - start) / 1000, created, real: true, line: ctx.rawLine});
      return result.code;
    }
  };
})();
