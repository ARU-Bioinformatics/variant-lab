/* Exact-allele comparison after bcftools norm -f REF -m -any.
   Deliberately does not trim, left-align, or infer biological equivalence. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.VariantCompare = api;
}(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  function fail(message) { throw new Error('VCF comparison: ' + message); }
  function ratio(a, b) { return b ? a / b : null; }
  function key(chrom, pos, ref, alt) { return [chrom, pos, ref, alt].join('\t'); }
  function variantType(ref, alt) {
    if (!/^[ACGTN]+$/i.test(alt)) return 'other';
    if (ref.length === 1 && alt.length === 1) return 'SNP';
    return ref.length !== alt.length ? 'indel' : 'MNV';
  }
  function parseMetaFields(line) {
    const out = Object.create(null);
    const body = line.slice(line.indexOf('<') + 1, line.lastIndexOf('>'));
    const re = /(?:^|,)([^=,]+)=("(?:[^"\\]|\\.)*"|[^,]*)/g;
    let m;
    while ((m = re.exec(body))) out[m[1]] = m[2].replace(/^"|"$/g, '');
    return out;
  }
  function parseVCF(text) {
    if (typeof text !== 'string') fail('expected VCF text.');
    const output = { metadata: { reference: null, contigs: Object.create(null), sources: [], qualityScale: null, exactSNP: false }, samples: [], records: [], alleles: [], warnings: [] };
    let header = false;
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
    lines.forEach(function (line, index) {
      const lineNo = index + 1;
      if (!line.trim()) return;
      if (line.startsWith('##contig=<')) {
        const fields = parseMetaFields(line);
        if (fields.ID) {
          const length = fields.length == null ? null : Number(fields.length);
          if (length !== null && (!Number.isSafeInteger(length) || length < 1)) fail('invalid contig length on line ' + lineNo + '.');
          output.metadata.contigs[fields.ID] = { length: length, assembly: fields.assembly || null };
        }
        return;
      }
      if (line.startsWith('##reference=')) { output.metadata.reference = line.slice(12); return; }
      if (/^##source=/i.test(line)) {
        const source = line.slice(line.indexOf('=') + 1);
        output.metadata.sources.push(source);
        if (/exactSNP/i.test(source)) output.metadata.exactSNP = true;
        return;
      }
      if (/^##variantLabQualityScale=/i.test(line)) {
        output.metadata.qualityScale = line.slice(line.indexOf('=') + 1);
        if (/exactSNP/i.test(output.metadata.qualityScale) || /min\(40,-log10\(p\)\)/i.test(output.metadata.qualityScale.replace(/\s/g, ''))) output.metadata.exactSNP = true;
        return;
      }
      if (/^##exactSNP(?:[A-Za-z_]*=|[A-Za-z_]*Command)/i.test(line)) output.metadata.exactSNP = true;
      if (line.startsWith('##')) return;
      if (line.startsWith('#CHROM\t')) {
        if (header) fail('duplicate #CHROM header.');
        const columns = line.split('\t');
        if (columns.slice(0, 8).join('\t') !== '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO') fail('invalid column header.');
        if (columns.length > 8 && columns[8] !== 'FORMAT') fail('ninth column must be FORMAT.');
        if (columns.length === 9) fail('FORMAT column requires a sample.');
        output.samples = columns.slice(9);
        if (new Set(output.samples).size !== output.samples.length) fail('duplicate sample names.');
        header = true;
        return;
      }
      if (line.startsWith('#')) return;
      if (!header) fail('missing #CHROM tab-delimited header before line ' + lineNo + '.');
      const columns = line.split('\t');
      const expected = output.samples.length ? output.samples.length + 9 : 8;
      if (columns.length !== expected) fail('expected ' + expected + ' tab-delimited columns on line ' + lineNo + '.');
      const chrom = columns[0], pos = Number(columns[1]), ref = columns[3].toUpperCase();
      if (!chrom || !Number.isSafeInteger(pos) || pos < 1 || !/^[ACGTN]+$/.test(ref)) fail('invalid CHROM, POS, or REF on line ' + lineNo + '.');
      const qual = columns[5] === '.' ? null : Number(columns[5]);
      if (qual !== null && (!Number.isFinite(qual) || qual < 0)) fail('invalid QUAL on line ' + lineNo + '.');
      const alts = columns[4] === '.' ? [] : columns[4].split(',').map(function (alt) { return /^[ACGTN]+$/i.test(alt) ? alt.toUpperCase() : alt; });
      if (alts.some(function (alt) { return !alt || alt === '.'; })) fail('invalid ALT on line ' + lineNo + '.');
      const format = columns[8] ? columns[8].split(':') : [];
      const gtIndex = format.indexOf('GT');
      const genotypes = Object.create(null);
      output.samples.forEach(function (sample, i) {
        const raw = gtIndex < 0 ? null : (columns[i + 9].split(':')[gtIndex] || '.');
        genotypes[sample] = raw;
      });
      const record = { chrom: chrom, pos: pos, id: columns[2], ref: ref, alts: alts, qual: qual, filter: columns[6], info: columns[7], genotypes: genotypes, line: lineNo };
      output.records.push(record);
      alts.forEach(function (alt, i) {
        // gVCF placeholders and spanning-deletion placeholders are not concrete ALT alleles.
        if (alt === '<NON_REF>' || alt === '<*>' || alt === '*') return;
        output.alleles.push({ key: key(chrom, pos, ref, alt), chrom: chrom, pos: pos, ref: ref, alt: alt, type: variantType(ref, alt), altIndex: i + 1, record: record });
      });
    });
    if (!header) fail('missing #CHROM tab-delimited header.');
    if (output.records.some(function (r) { return r.alts.length > 1; })) output.warnings.push('Unsplit multiallelic records found: allele overlap is exact, but genotype comparisons containing another ALT allele are excluded. Normalize and split both files with bcftools norm -f REF -m -any.');
    if (output.alleles.some(function (a) { return a.type === 'other'; })) output.warnings.push('Symbolic or breakend ALT records are matched by their literal allele strings only; END/SVLEN and structural-variant equivalence are not evaluated.');
    return output;
  }

  function checkReferences(parsed, options, warnings) {
    const lengths = new Map(), assemblies = new Map(), assertions = new Map();
    const references = new Set(parsed.map(function (p) { return p.metadata.reference; }).filter(Boolean));
    if (references.size > 1) warnings.push('VCF reference header values differ. File paths alone cannot establish genome identity; check that every input was normalized against the same reference.');
    parsed.forEach(function (p) {
      Object.keys(p.metadata.contigs).forEach(function (chrom) {
        const c = p.metadata.contigs[chrom];
        if (c.length != null) {
          if (lengths.has(chrom) && lengths.get(chrom) !== c.length) fail('incompatible reference lengths for ' + chrom + '.');
          lengths.set(chrom, c.length);
        }
        if (c.assembly) {
          if (assemblies.has(chrom) && assemblies.get(chrom) !== c.assembly) fail('incompatible assembly identifiers for ' + chrom + '.');
          assemblies.set(chrom, c.assembly);
        }
      });
    });
    parsed.forEach(function (p) {
      p.records.forEach(function (r) {
        if (lengths.has(r.chrom) && r.pos + r.ref.length - 1 > lengths.get(r.chrom)) fail('REF extends beyond the declared length of ' + r.chrom + '.');
        if (!assertions.has(r.chrom)) assertions.set(r.chrom, new Map());
        const bases = assertions.get(r.chrom);
        for (let i = 0; i < r.ref.length; i++) {
          const pos = r.pos + i, base = r.ref[i], old = bases.get(pos);
          if (base !== 'N' && old && old !== 'N' && old !== base) fail('REF mismatch at ' + r.chrom + ':' + pos + ' (' + old + '/' + base + ').');
          if (!old || old === 'N') bases.set(pos, base);
        }
        if (options.referenceSequences) {
          const entry = options.referenceSequences[r.chrom];
          if (!entry) fail('contig ' + r.chrom + ' is absent from the supplied reference sequences.');
          const sequence = typeof entry === 'string' ? entry : entry.sequence;
          const start = typeof entry === 'string' ? 1 : (entry.start || 1);
          const offset = r.pos - start;
          if (typeof sequence !== 'string' || offset < 0 || offset + r.ref.length > sequence.length) fail('REF is outside the supplied sequence for ' + r.chrom + ':' + r.pos + '.');
          const expected = sequence.slice(offset, offset + r.ref.length).toUpperCase();
          if (expected !== r.ref) fail('REF mismatch against supplied reference at ' + r.chrom + ':' + r.pos + '.');
        }
      });
    });
    const a = new Set(parsed[0].records.map(function (r) { return r.chrom; }));
    const b = new Set(parsed[1].records.map(function (r) { return r.chrom; }));
    if (a.size && b.size && !Array.from(a).some(function (c) { return b.has(c); })) warnings.push('Inputs have no observed contig names in common. Check genome choice, selected regions, and chr-prefix naming; contig aliases are not inferred.');
  }

  function regionMap(input) {
    if (input == null) return null;
    const regions = typeof input === 'string' ? input.split(/\r?\n/).filter(function (line) {
      return line.trim() && !/^\s*(#|track\b|browser\b)/.test(line);
    }).map(function (line) {
      const f = line.trim().split(/\s+/); return { chrom: f[0], start: Number(f[1]), end: Number(f[2]) };
    }) : input;
    if (!Array.isArray(regions)) fail('evaluationRegions must be BED text or an array of {chrom,start,end}.');
    const map = new Map();
    regions.forEach(function (r) {
      if (!r.chrom || !Number.isSafeInteger(r.start) || !Number.isSafeInteger(r.end) || r.start < 0 || r.end <= r.start) fail('invalid evaluation region; coordinates must be 0-based, half-open.');
      if (!map.has(r.chrom)) map.set(r.chrom, []);
      map.get(r.chrom).push([r.start, r.end]);
    });
    // Union touching/overlapping intervals, so a REF span across a merged boundary remains eligible.
    map.forEach(function (rs, chrom) {
      const merged = [];
      rs.sort(function (a, b) { return a[0] - b[0]; }).forEach(function (r) {
        const last = merged[merged.length - 1];
        if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else merged.push(r.slice());
      });
      map.set(chrom, merged);
    });
    return map;
  }
  function inRegions(allele, regions) {
    if (!regions) return true;
    const intervals = regions.get(allele.chrom) || [];
    const start = allele.pos - 1, end = start + allele.ref.length;
    return intervals.some(function (r) { return start >= r[0] && end <= r[1]; });
  }
  function genotype(allele, sample) {
    const raw = allele.record.genotypes[sample];
    if (raw == null || raw === '' || raw.split(/[\/|]/).some(function (part) { return part === '.'; })) return { value: null, reason: 'missing', raw: raw || '.' };
    const parts = raw.split(/[\/|]/);
    if (!parts.length || parts.some(function (part) { return !/^\d+$/.test(part) || Number(part) > allele.record.alts.length; })) return { value: null, reason: 'invalid', raw: raw };
    const numbers = parts.map(Number);
    if (numbers.some(function (n) { return n !== 0 && n !== allele.altIndex; })) return { value: null, reason: 'otherAlt', raw: raw };
    const copies = numbers.filter(function (n) { return n === allele.altIndex; }).length;
    return { value: numbers.length + ':' + copies, ploidy: numbers.length, copies: copies, raw: raw, reason: null };
  }
  function combinedGenotype(alleles, sample) {
    const genotypes = alleles.map(function (a) { return genotype(a, sample); });
    if (genotypes.some(function (g) { return g.value === null; })) return genotypes.find(function (g) { return g.value === null; });
    if (new Set(genotypes.map(function (g) { return g.value; })).size > 1) return { value: null, raw: genotypes.map(function (g) { return g.raw; }).join(';'), reason: 'duplicateConflict' };
    return genotypes[0];
  }
  function alleleMap(parsed, filters, regions) {
    const map = new Map();
    parsed.alleles.forEach(function (a) {
      if (filters.passOnly && a.record.filter !== 'PASS') return;
      if (filters.minQual != null && (a.record.qual === null || a.record.qual < filters.minQual)) return;
      if (!inRegions(a, regions)) return;
      if (!map.has(a.key)) map.set(a.key, []);
      map.get(a.key).push(a);
    });
    return map;
  }
  function typeCounts(map) {
    const counts = { SNP: 0, indel: 0, MNV: 0, other: 0, total: map.size };
    map.forEach(function (entries) { counts[entries[0].type]++; });
    return counts;
  }
  function truthMetrics(callset, truth) {
    let tp = 0;
    callset.forEach(function (_v, k) { if (truth.has(k)) tp++; });
    const fp = callset.size - tp, fn = truth.size - tp;
    return { truePositive: tp, falsePositive: fp, falseNegative: fn, precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn), f1: ratio(2 * tp, 2 * tp + fp + fn), calls: callset.size, truthAlleles: truth.size };
  }
  function compare(textA, textB, options) {
    options = options || {};
    if (options.minQual != null && (!Number.isFinite(Number(options.minQual)) || Number(options.minQual) < 0)) fail('minQual must be a non-negative number.');
    const parsedA = parseVCF(textA), parsedB = parseVCF(textB);
    const truth = options.truthText == null ? null : parseVCF(options.truthText);
    const parsed = truth ? [parsedA, parsedB, truth] : [parsedA, parsedB];
    const warnings = Array.from(new Set(parsed.flatMap(function (p) { return p.warnings; })));
    if (parsedA.metadata.exactSNP || parsedB.metadata.exactSNP) {
      warnings.push('exactSNP QUAL uses min(40, -log10(p)) for SNPs in this practical, while its simple indels have fixed QUAL=1. These values are not on the bcftools Phred QUAL scale. Across callers, a shared QUAL threshold compares different meanings; thresholds above 1 remove exactSNP indels. Native exactSNP output has no GT; genotype concordance is unavailable for those records.');
      if (options.minQual != null && parsedA.metadata.exactSNP !== parsedB.metadata.exactSNP) fail('a shared QUAL threshold cannot compare exactSNP with a different or unidentified caller because their quality scales differ. Prefilter each caller separately using its own quality scale, or remove the shared QUAL threshold.');
    }
    checkReferences(parsed, options, warnings);
    const filters = { minQual: options.minQual == null ? null : Number(options.minQual), passOnly: !!options.passOnly };
    const regions = regionMap(options.evaluationRegions);
    // The mask scopes every metric, not just truth metrics, making counts comparable.
    const a = alleleMap(parsedA, filters, regions), b = alleleMap(parsedB, filters, regions);
    let samplePairs;
    if (options.sampleA != null || options.sampleB != null) {
      if (!parsedA.samples.includes(options.sampleA) || !parsedB.samples.includes(options.sampleB)) fail('sampleA and sampleB must both name existing samples.');
      samplePairs = [[options.sampleA, options.sampleB]];
    } else samplePairs = parsedA.samples.filter(function (s) { return parsedB.samples.includes(s); }).map(function (s) { return [s, s]; });
    if (!samplePairs.length) warnings.push('No matched sample names: genotype concordance is unavailable. Explicitly map sampleA/sampleB only when they represent the same sample.');
    const genotypeStats = { concordant: 0, discordant: 0, comparable: 0, excluded: 0, excludedMissing: 0, excludedOtherAlt: 0, excludedInvalid: 0, excludedDuplicateConflict: 0, concordance: null, samplePairs: samplePairs };
    const allKeys = new Set(Array.from(a.keys()).concat(Array.from(b.keys())));
    const rows = [];
    let shared = 0, onlyA = 0, onlyB = 0;
    allKeys.forEach(function (k) {
      const aa = a.get(k), bb = b.get(k), allele = (aa || bb)[0];
      const status = aa && bb ? 'shared' : aa ? 'onlyA' : 'onlyB';
      if (status === 'shared') shared++; else if (status === 'onlyA') onlyA++; else onlyB++;
      const perSample = [];
      if (aa && bb) samplePairs.forEach(function (pair) {
        const ga = combinedGenotype(aa, pair[0]), gb = combinedGenotype(bb, pair[1]);
        let concordant = null, excludedReason = null;
        if (ga.value == null || gb.value == null) {
          excludedReason = ga.reason || gb.reason;
          genotypeStats.excluded++;
          const countKey = { missing: 'excludedMissing', otherAlt: 'excludedOtherAlt', invalid: 'excludedInvalid', duplicateConflict: 'excludedDuplicateConflict' }[excludedReason];
          genotypeStats[countKey]++;
        } else {
          concordant = ga.value === gb.value;
          genotypeStats.comparable++;
          genotypeStats[concordant ? 'concordant' : 'discordant']++;
        }
        perSample.push({ sampleA: pair[0], sampleB: pair[1], gtA: ga.raw, gtB: gb.raw, concordant: concordant, excludedReason: excludedReason });
      });
      const qualities = function (entries) { return entries ? entries.map(function (x) { return x.record.qual; }).filter(function (q) { return q != null; }) : []; };
      const qa = qualities(aa), qb = qualities(bb);
      rows.push({ key: k, chrom: allele.chrom, pos: allele.pos, ref: allele.ref, alt: allele.alt, type: allele.type, status: status, qualA: qa.length ? Math.max.apply(null, qa) : null, qualB: qb.length ? Math.max.apply(null, qb) : null, filterA: aa ? Array.from(new Set(aa.map(function (x) { return x.record.filter; }))).join(';') : null, filterB: bb ? Array.from(new Set(bb.map(function (x) { return x.record.filter; }))).join(';') : null, genotypes: perSample });
    });
    rows.sort(function (x, y) { return x.chrom.localeCompare(y.chrom, undefined, { numeric: true }) || x.pos - y.pos || x.ref.localeCompare(y.ref) || x.alt.localeCompare(y.alt); });
    genotypeStats.concordance = ratio(genotypeStats.concordant, genotypeStats.comparable);
    const duplicateCount = function (map) { let n = 0; map.forEach(function (entries) { n += entries.length - 1; }); return n; };
    if (duplicateCount(a) || duplicateCount(b)) warnings.push('Duplicate allele records are counted once. Conflicting genotypes in duplicate records are excluded from genotype concordance.');
    const result = {
      metrics: { shared: shared, onlyA: onlyA, onlyB: onlyB, union: allKeys.size, jaccard: ratio(shared, allKeys.size), countA: a.size, countB: b.size, typesA: typeCounts(a), typesB: typeCounts(b), genotypes: genotypeStats },
      rows: rows, filters: filters, evaluation: { masked: regions !== null, coordinateConvention: 'BED: 0-based, half-open; the whole REF span must lie inside the interval union' },
      warnings: warnings,
      notes: [
        'Alleles are matched by exact CHROM, POS, REF and ALT after external normalization. No left alignment or trimming is performed here. An MNV/complex call and separate SNPs can describe the same haplotype but count as different alleles; this is not haplotype-aware benchmarking.',
        'Counts describe ALT alleles present in VCF records, including records with a reference genotype. They do not count individuals or infer biological equivalence.',
        'Genotype concordance covers shared alleles and matched samples only. Phase is ignored; allele dosage and ploidy must both match. Missing, invalid, conflicting duplicate, or other-ALT genotypes are excluded.',
        'QUAL scales and FILTER definitions differ between callers. A shared numeric QUAL threshold is not equivalent evidence across algorithms.',
        'Agreement between callers does not establish accuracy. Without an independent matching benchmark and appropriate evaluation regions, these metrics do not measure precision or sensitivity.'
      ]
    };
    if (truth) {
      // Truth defines the benchmark: never apply the caller QUAL/FILTER threshold to it.
      const truthMap = alleleMap(truth, {}, regions);
      result.truth = { label: regions ? 'Precision/recall against supplied synthetic truth within evaluation regions' : 'Apparent precision/recall against all supplied synthetic truth (no callable mask)', masked: regions !== null, a: truthMetrics(a, truthMap), b: truthMetrics(b, truthMap) };
      result.notes.push('Truth metrics score exact alleles against the supplied synthetic benchmark, not biological or clinical truth. Caller filters do not filter the truth set. No true-negative or specificity estimate is made.');
      if (!regions) warnings.push('No callable/evaluation mask supplied: apparent precision and recall may include regions that were not sequenced or callable. Supply evaluationRegions to scope the benchmark.');
      rows.forEach(function (row) { row.inTruth = truthMap.has(row.key); });
    }
    return result;
  }

  function toTSV(result) {
    const fields = ['chrom', 'pos', 'ref', 'alt', 'type', 'status', 'qualA', 'qualB', 'filterA', 'filterB', 'inTruth'];
    const safe = function (v) { return v == null ? '.' : String(v).replace(/[\t\r\n]/g, ' '); };
    return fields.join('\t') + '\n' + result.rows.map(function (row) {
      return fields.map(function (f) { return safe(row[f]); }).join('\t');
    }).join('\n') + (result.rows.length ? '\n' : '');
  }
  function render(container, result, labels) {
    if (!container || !container.ownerDocument) fail('render requires a DOM container.');
    labels = labels || {};
    const doc = container.ownerDocument, labelA = labels.labelA || 'A', labelB = labels.labelB || 'B';
    const el = function (tag, text, className) {
      const node = doc.createElement(tag);
      if (text != null) node.textContent = String(text);
      if (className) node.className = className;
      return node;
    };
    const pct = function (v) { return v == null ? 'N/A' : (100 * v).toFixed(1) + '%'; };
    container.replaceChildren();
    const section = el('section', null, 'variant-comparison');
    section.setAttribute('aria-label', 'Variant callset comparison');
    section.appendChild(el('h3', labelA + ' compared with ' + labelB));
    const metrics = el('dl', null, 'comparison-metrics');
    const m = result.metrics;
    [
      ['Shared alleles', m.shared], [labelA + ' only', m.onlyA], [labelB + ' only', m.onlyB], ['Jaccard overlap', pct(m.jaccard)],
      [labelA + ' SNP / indel / MNV / other', [m.typesA.SNP, m.typesA.indel, m.typesA.MNV, m.typesA.other].join(' / ')],
      [labelB + ' SNP / indel / MNV / other', [m.typesB.SNP, m.typesB.indel, m.typesB.MNV, m.typesB.other].join(' / ')],
      ['Genotype concordance', pct(m.genotypes.concordance) + ' (' + m.genotypes.concordant + '/' + m.genotypes.comparable + ' comparable; ' + m.genotypes.excluded + ' excluded)']
    ].forEach(function (pair) { metrics.appendChild(el('dt', pair[0])); metrics.appendChild(el('dd', pair[1])); });
    section.appendChild(metrics);
    if (result.truth) {
      section.appendChild(el('h4', result.truth.label));
      const table = el('table', null, 'comparison-truth');
      table.appendChild(el('caption', 'Exact-allele benchmark scores; N/A means the denominator is zero.'));
      const head = el('thead'), hr = el('tr');
      ['Callset', 'TP', 'FP', 'FN', 'Precision', 'Recall', 'F1'].forEach(function (t) { const th = el('th', t); th.scope = 'col'; hr.appendChild(th); });
      head.appendChild(hr); table.appendChild(head);
      const body = el('tbody');
      [[labelA, result.truth.a], [labelB, result.truth.b]].forEach(function (pair) {
        const tr = el('tr'), t = pair[1], th = el('th', pair[0]); th.scope = 'row'; tr.appendChild(th);
        [t.truePositive, t.falsePositive, t.falseNegative, pct(t.precision), pct(t.recall), pct(t.f1)].forEach(function (v) { tr.appendChild(el('td', v)); });
        body.appendChild(tr);
      });
      table.appendChild(body); section.appendChild(table);
    }
    result.warnings.forEach(function (warning) { section.appendChild(el('p', warning, 'comparison-warning')); });
    const details = el('details'), summary = el('summary', 'How these metrics are calculated');
    details.appendChild(summary);
    result.notes.forEach(function (note) { details.appendChild(el('p', note)); });
    details.appendChild(el('p', result.evaluation.masked ? 'All metrics are restricted to the supplied evaluation interval union; the full REF span must be contained.' : 'Allele overlap includes all retained records; no evaluation mask is applied.'));
    section.appendChild(details);
    const controls = el('div', null, 'comparison-controls'), label = el('label', 'Show alleles: '), select = el('select');
    [['all', 'All alleles'], ['shared', 'Shared'], ['onlyA', labelA + ' only'], ['onlyB', labelB + ' only']].forEach(function (pair) { const option = el('option', pair[1]); option.value = pair[0]; select.appendChild(option); });
    label.appendChild(select); controls.appendChild(label);
    const download = el('button', 'Download all alleles (TSV)'); download.type = 'button';
    download.addEventListener('click', function () {
      const win = doc.defaultView, url = win.URL.createObjectURL(new win.Blob([toTSV(result)], { type: 'text/tab-separated-values;charset=utf-8' }));
      const a = el('a'); a.href = url; a.download = 'variant-comparison.tsv'; doc.body.appendChild(a); a.click(); a.remove(); win.setTimeout(function () { win.URL.revokeObjectURL(url); }, 1000);
    });
    controls.appendChild(download); section.appendChild(controls);
    const status = el('p'); status.setAttribute('aria-live', 'polite'); section.appendChild(status);
    const wrap = el('div', null, 'comparison-table-wrap'); wrap.style.overflowX = 'auto';
    const table = el('table', null, 'comparison-alleles'); table.appendChild(el('caption', 'Exact normalized ALT alleles retained after selected filters'));
    const head = el('thead'), hr = el('tr');
    const columns = ['Contig', 'Position', 'REF', 'ALT', 'Type', 'Present in', labelA + ' QUAL', labelB + ' QUAL', 'Genotypes'];
    if (result.truth) columns.push('In supplied truth');
    columns.forEach(function (title) { const th = el('th', title); th.scope = 'col'; hr.appendChild(th); });
    head.appendChild(hr); table.appendChild(head);
    const body = el('tbody'); table.appendChild(body); wrap.appendChild(table); section.appendChild(wrap);
    const draw = function () {
      body.replaceChildren();
      const rows = result.rows.filter(function (row) { return select.value === 'all' || row.status === select.value; });
      // Bounded rendering keeps this usable with larger uploads; export always includes all rows.
      const displayed = rows.slice(0, 1000);
      status.textContent = rows.length + ' matching alleles' + (rows.length > displayed.length ? '; showing the first ' + displayed.length + '. Download TSV for all rows.' : '.');
      displayed.forEach(function (row) {
        const tr = el('tr');
        const gt = row.genotypes.map(function (g) { return g.sampleA + (g.sampleB !== g.sampleA ? ' / ' + g.sampleB : '') + ': ' + g.gtA + ' / ' + g.gtB + ' (' + (g.concordant == null ? 'excluded: ' + g.excludedReason : g.concordant ? 'concordant' : 'discordant') + ')'; }).join('; ') || '—';
        const values = [row.chrom, row.pos, row.ref, row.alt, row.type, row.status === 'shared' ? 'Both' : row.status === 'onlyA' ? labelA : labelB, row.qualA == null ? '.' : row.qualA, row.qualB == null ? '.' : row.qualB, gt];
        if (result.truth) values.push(row.inTruth ? 'Yes' : 'No');
        values.forEach(function (v) { tr.appendChild(el('td', v)); }); body.appendChild(tr);
      });
      if (!rows.length) { const tr = el('tr'), td = el('td', 'No alleles match this filter.'); td.colSpan = columns.length; tr.appendChild(td); body.appendChild(tr); }
    };
    select.addEventListener('change', draw); draw(); container.appendChild(section);
    return section;
  }
  return { parseVCF: parseVCF, compare: compare, render: render, toTSV: toTSV };
}));
