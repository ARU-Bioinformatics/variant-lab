'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseVCF, compare, toTSV } = require('../assets/js/compare.js');
const head = '##fileformat=VCFv4.2\n##contig=<ID=chr1,length=1000>\n';
function vcf(rows, samples = ['S'], metadata = head) {
  return metadata + '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO' + (samples.length ? '\tFORMAT\t' + samples.join('\t') : '') + '\n' + rows.join('\n') + '\n';
}
function record(pos, ref, alt, gt = '0/1', qual = '50', filter = 'PASS') {
  return ['chr1', pos, '.', ref, alt, qual, filter, '.', 'GT', gt].join('\t');
}
test('exact allele sets, SNP/indel/MNV counts, and Jaccard are derived from VCF', () => {
  const a = vcf([record(5, 'A', 'G'), record(10, 'AC', 'A'), record(20, 'AC', 'GT')]);
  const b = vcf([record(5, 'A', 'G', '1/0'), record(30, 'T', 'C')]);
  const result = compare(a, b);
  assert.equal(result.metrics.shared, 1);
  assert.equal(result.metrics.onlyA, 2);
  assert.equal(result.metrics.onlyB, 1);
  assert.equal(result.metrics.jaccard, 0.25);
  assert.deepEqual(result.metrics.typesA, { SNP: 1, indel: 1, MNV: 1, other: 0, total: 3 });
  assert.equal(result.metrics.genotypes.concordance, 1);
  assert.equal(result.rows[1].status, 'onlyA');
});
test('phase and unphased allele order do not affect genotype concordance; ploidy does', () => {
  const a = vcf([record(5, 'A', 'G', '0|1'), record(10, 'A', 'C', '1'), record(20, 'C', 'T', '1')]);
  const b = vcf([record(5, 'A', 'G', '1/0'), record(10, 'A', 'C', '1'), record(20, 'C', 'T', '1/1')]);
  const g = compare(a, b).metrics.genotypes;
  assert.equal(g.comparable, 3);
  assert.equal(g.concordant, 2);
  assert.equal(g.discordant, 1);
  assert.equal(g.concordance, 2 / 3);
});
test('missing, invalid and unsplit multiallelic other-ALT genotypes are excluded', () => {
  const a = vcf([record(5, 'A', 'G', './1'), record(10, 'A', 'C,G', '1/2'), record(20, 'C', 'T', '2/2')]);
  const b = vcf([record(5, 'A', 'G'), record(10, 'A', 'C,G', '0/1'), record(20, 'C', 'T')]);
  const result = compare(a, b), g = result.metrics.genotypes;
  assert.equal(result.metrics.shared, 4);
  assert.equal(g.comparable, 0);
  assert.equal(g.excludedMissing, 1);
  assert.equal(g.excludedOtherAlt, 2);
  assert.equal(g.excludedInvalid, 1);
  assert.equal(g.concordance, null);
  assert.ok(result.warnings.some(w => w.includes('Unsplit multiallelic')));
});
test('multi-ALT index is mapped to the target allele when it is unambiguous', () => {
  const a = vcf([record(5, 'A', 'C,G', '0/2')]);
  const b = vcf([record(5, 'A', 'G', '1/0')]);
  const g = compare(a, b).metrics.genotypes;
  assert.equal(g.comparable, 1);
  assert.equal(g.concordant, 1);
});
test('duplicate alleles count once, but conflicting duplicate genotypes are excluded', () => {
  const a = vcf([record(5, 'A', 'G', '0/1'), record(5, 'A', 'G', '1/1')]);
  const b = vcf([record(5, 'A', 'G')]);
  const result = compare(a, b);
  assert.equal(result.metrics.countA, 1);
  assert.equal(result.metrics.shared, 1);
  assert.equal(result.metrics.genotypes.excludedDuplicateConflict, 1);
});
test('samples are matched by name and can be explicitly mapped', () => {
  const a = vcf([record(5, 'A', 'G')], ['sample-A']);
  const b = vcf([record(5, 'A', 'G')], ['sample-B']);
  assert.equal(compare(a, b).metrics.genotypes.concordance, null);
  assert.equal(compare(a, b, { sampleA: 'sample-A', sampleB: 'sample-B' }).metrics.genotypes.concordance, 1);
  assert.throws(() => compare(a, b, { sampleA: 'sample-A', sampleB: 'missing' }), /existing samples/);
});
test('multiple matched samples yield one observation per shared allele and sample', () => {
  const a = vcf([record(5, 'A', 'G', '0/1\t1/1')], ['S1', 'S2']);
  const b = vcf([record(5, 'A', 'G', '1/1\t1/1')], ['S1', 'S2']);
  const g = compare(a, b).metrics.genotypes;
  assert.equal(g.comparable, 2);
  assert.equal(g.concordance, 0.5);
});
test('QUAL and strict PASS filters affect callers, not the synthetic truth denominator', () => {
  const calls = vcf([record(5, 'A', 'G', '0/1', '60'), record(10, 'C', 'T', '0/1', '4'), record(20, 'G', 'A', '0/1', '60', '.')]);
  const truth = vcf([record(5, 'A', 'G', '0/1', '.'), record(10, 'C', 'T', '0/1', '.', '.')]);
  const result = compare(calls, calls, { minQual: 10, passOnly: true, truthText: truth });
  assert.equal(result.metrics.countA, 1);
  assert.equal(result.truth.a.truePositive, 1);
  assert.equal(result.truth.a.falseNegative, 1);
  assert.equal(result.truth.a.precision, 1);
  assert.equal(result.truth.a.recall, 0.5);
  assert.match(result.truth.label, /Apparent/);
});
test('BED masks are 0-based half-open and require the complete REF span', () => {
  const calls = vcf([record(5, 'A', 'G'), record(6, 'AC', 'A'), record(9, 'T', 'C')]);
  const truth = vcf([record(5, 'A', 'G'), record(6, 'AC', 'A')]);
  const result = compare(calls, calls, { truthText: truth, evaluationRegions: 'chr1\t4\t6\n' });
  assert.equal(result.metrics.countA, 1);
  assert.equal(result.truth.a.truthAlleles, 1);
  assert.equal(result.truth.a.precision, 1);
  assert.equal(result.truth.masked, true);
  assert.equal(compare(calls, calls, { evaluationRegions: [{ chrom: 'chr1', start: 4, end: 6 }, { chrom: 'chr1', start: 6, end: 7 }] }).metrics.countA, 2);
});
test('empty sets have undefined, not perfect, ratios', () => {
  const empty = vcf([]);
  const result = compare(empty, empty, { truthText: empty });
  assert.equal(result.metrics.jaccard, null);
  assert.equal(result.truth.a.precision, null);
  assert.equal(result.truth.a.recall, null);
});
test('incompatible reference lengths, assemblies, and overlapping REF bases are rejected', () => {
  const a = vcf([record(5, 'AC', 'A')]);
  assert.throws(() => compare(a, vcf([record(6, 'T', 'A')])), /REF mismatch/);
  assert.throws(() => compare(a, vcf([], ['S'], head.replace('1000', '900'))), /incompatible reference lengths/);
  const meta = name => '##fileformat=VCFv4.2\n##contig=<ID=chr1,length=1000,assembly=' + name + '>\n';
  assert.throws(() => compare(vcf([], ['S'], meta('GRCh37')), vcf([], ['S'], meta('GRCh38'))), /incompatible assembly/);
  // A SNP at the deletion's anchor is compatible with a longer REF.
  assert.doesNotThrow(() => compare(a, vcf([record(5, 'A', 'G')])));
});
test('optional reference sequence validates reference identity and cropped coordinates', () => {
  const a = vcf([record(5, 'AC', 'A')]);
  assert.doesNotThrow(() => compare(a, a, { referenceSequences: { chr1: { sequence: 'ACGT', start: 5 } } }));
  assert.throws(() => compare(a, a, { referenceSequences: { chr1: { sequence: 'TCGT', start: 5 } } }), /REF mismatch/);
  assert.throws(() => compare(a, a, { referenceSequences: { chr2: 'ACGT' } }), /absent/);
});
test('representationally different indels are not rewritten or silently merged', () => {
  const a = vcf([record(5, 'AA', 'A')]);
  const b = vcf([record(6, 'AA', 'A')]);
  const result = compare(a, b);
  assert.equal(result.metrics.shared, 0);
  assert.equal(result.metrics.union, 2);
  assert.match(result.notes[0], /No left alignment/);
});
test('VCF parser rejects missing headers or malformed columns and skips gVCF placeholders', () => {
  assert.throws(() => parseVCF(record(5, 'A', 'G')), /missing #CHROM/);
  assert.throws(() => parseVCF(vcf([record(5, 'A', 'G')]).replace('\tGT\t0/1', ' GT 0/1')), /tab-delimited columns/);
  const data = parseVCF(vcf([record(5, 'A', 'G,<NON_REF>,*'), record(10, 'C', '.'), record(20, 'T', '<DEL>')]));
  assert.equal(data.alleles.length, 2);
  assert.equal(data.alleles[1].type, 'other');
});
test('TSV exports exact allele records and benchmark membership without executing content', () => {
  const a = vcf([record(5, 'A', 'G')]);
  const result = compare(a, vcf([]), { truthText: a });
  const tsv = toTSV(result);
  assert.match(tsv, /^chrom\tpos\tref\talt/);
  assert.match(tsv, /chr1\t5\tA\tG\tSNP\tonlyA\t50\t\.\tPASS\t\.\ttrue/);
});
test('later input contig metadata also validates earlier input record bounds', () => {
  const noContigs = vcf([record(1000, 'AC', 'A')], ['S'], '##fileformat=VCFv4.2\n');
  assert.throws(() => compare(noContigs, vcf([])), /beyond the declared length/);
});
test('unusual contig and sample identifiers remain data, including object prototype names', () => {
  const text = vcf([record(5, 'A', 'G')], ['__proto__']).replaceAll('chr1', '__proto__');
  const result = compare(text, text);
  assert.equal(result.metrics.genotypes.concordance, 1);
  assert.equal(result.rows[0].chrom, '__proto__');
});
test('exactSNP headers retain source and quality metadata for callers and UI', () => {
  const metadata = head + '##source=exactSNP-2.0.1\n##variantLabQualityScale=min(40,-log10(p)); simple indels QUAL=1\n';
  const parsed = parseVCF(vcf([record(5, 'A', 'G')], ['S'], metadata));
  assert.deepEqual(parsed.metadata.sources, ['exactSNP-2.0.1']);
  assert.equal(parsed.metadata.exactSNP, true);
  assert.match(parsed.metadata.qualityScale, /min\(40/);
  assert.deepEqual(parsed.samples, ['S']);
});
test('mixed exactSNP and bcftools/shared unknown QUAL thresholds are rejected', () => {
  const exact = vcf([record(5, 'A', 'G')], ['S'], head + '##source=exactSNP-2.0.1\n');
  const bcf = vcf([record(5, 'A', 'G')], ['S'], head + '##source=bcftools_callCommand\n');
  const unknown = vcf([record(5, 'A', 'G')]);
  assert.throws(() => compare(exact, bcf, { minQual: 20 }), /Prefilter each caller separately/);
  assert.throws(() => compare(unknown, exact, { minQual: 0 }), /remove the shared QUAL threshold/);
  const result = compare(exact, bcf);
  assert.equal(result.metrics.shared, 1);
  assert.ok(result.warnings.some(w => w.includes('fixed QUAL=1')));
});
test('two exactSNP callsets permit QUAL filtering but explain indel removal', () => {
  const exact = vcf([record(5, 'A', 'G', '.', '25'), record(10, 'AC', 'A', '.', '1')], ['S'], head + '##source=exactSNP-2.0.1\n');
  const result = compare(exact, exact, { minQual: 10 });
  assert.equal(result.metrics.countA, 1);
  assert.equal(result.metrics.genotypes.concordance, null);
  assert.ok(result.warnings.some(w => w.includes('thresholds above 1 remove exactSNP indels')));
});
test('exactSNP quality-scale header alone activates the mixed-caller guard', () => {
  const exact = vcf([record(5, 'A', 'G')], ['S'], head + '##variantLabQualityScale=min(40, -log10(p))\n');
  assert.throws(() => compare(exact, vcf([]), { minQual: 10 }), /quality scales differ/);
});
