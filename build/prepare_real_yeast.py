#!/usr/bin/env python3
"""Reproduce the authentic BY4741 mitochondrial teaching read subset.

Python standard library plus minimap2 2.22 are required. Downloads at most
64 MiB from each archived mate file, plus a 3.8 MB complete sacCer3 reference.
Run: python build/prepare_real_yeast.py --minimap2 /path/to/minimap2
No simulated sequence, quality values, variants, or truth labels are created.
"""
import argparse
import collections
import concurrent.futures
import hashlib
import json
import re
import shutil
import statistics
import subprocess
import tarfile
import urllib.request
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'data' / 'yeast'
RUN = 'SRR1569870'
PREFIX_BYTES = 64 * 1024 * 1024
PAIR_COUNT = 800000
PINNED_SHA256 = {
    'SRR1569870_1.prefix.gz': '276133c9bc1cfcbc7dc862bdeefb0736c333fcb98bc82d72eb7dcf016e87a538',
    'SRR1569870_2.prefix.gz': 'd6e3fb655b35ecf625e49153d25e18830cfe5ba42e72141cc3a16e9caf345d7e',
    'chromFa.tar.gz': '7538d736aa80168448819c75faf299abe6672061fa38a4606fec8ca4f575c35d'
}
EXPECTED_READ_SHA256 = [
    'd67bc8d903d35f6f7c7f858e55c9a3f28680e0a84299e59f7e8054793ebb0831',
    '7674afdb31fde4994e8febe510fdbc1b87632ea5afec8f0d621405dd8fa321e5'
]
REF_URL = 'https://hgdownload.soe.ucsc.edu/goldenPath/sacCer3/bigZips/chromFa.tar.gz'
FASTQ_URLS = [f'https://ftp.sra.ebi.ac.uk/vol1/fastq/SRR156/000/{RUN}/{RUN}_{mate}.fastq.gz' for mate in (1, 2)]
ENA_URL = ('https://www.ebi.ac.uk/ena/portal/api/filereport?accession=SRR1569870&result=read_run'
           '&fields=run_accession,sample_accession,study_accession,experiment_accession,scientific_name,'
           'sample_title,library_strategy,library_layout,instrument_model,fastq_ftp,fastq_md5,fastq_bytes&format=tsv')


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def download(url, target, prefix=None):
    if target.exists() and (prefix is None or target.stat().st_size == prefix):
        return
    headers = {'Range': f'bytes=0-{prefix - 1}'} if prefix else {}
    temporary = target.with_suffix(target.suffix + '.part')
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=90) as response:
        if prefix and (response.status != 206 or not response.headers.get('Content-Range', '').startswith('bytes 0-')):
            raise RuntimeError('The archive did not honour the bounded HTTP Range request')
        with temporary.open('wb') as handle:
            remaining = prefix
            while remaining is None or remaining:
                block = response.read(1024 * 1024 if remaining is None else min(1024 * 1024, remaining))
                if not block:
                    break
                handle.write(block)
                if remaining is not None:
                    remaining -= len(block)
            if prefix and remaining:
                raise RuntimeError('Incomplete compressed prefix download')
    temporary.replace(target)


def gzip_prefix_lines(path):
    """Decode a deliberately partial gzip stream; yield only complete lines."""
    decoder = zlib.decompressobj(16 + zlib.MAX_WBITS)
    pending = b''
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            lines = (pending + decoder.decompress(block)).split(b'\n')
            pending = lines.pop()
            for line in lines:
                yield line + b'\n'
    # No flush: the final gzip member is intentionally truncated. Never
    # manufacture a newline or accept an incomplete FASTQ record.


def records(lines):
    it = iter(lines)
    while True:
        row = []
        for _ in range(4):
            line = next(it, None)
            if line is None:
                return
            row.append(line)
        if not row[0].startswith(b'@') or not row[2].startswith(b'+'):
            raise ValueError('Invalid source FASTQ record')
        if len(row[1].rstrip(b'\r\n')) != len(row[3].rstrip(b'\r\n')):
            raise ValueError('Source sequence/quality lengths differ')
        yield b''.join(row)


def read_id(record):
    return record.split(b'\n', 1)[0].split()[0][1:].decode('ascii').removesuffix('/1').removesuffix('/2')


def fasta_records(path):
    result, name = {}, None
    for line in path.read_text().splitlines():
        if line.startswith('>'):
            name = line[1:].split()[0]
            result[name] = ''
        elif name:
            result[name] += line.strip().upper()
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, default=ROOT.parent / '.cache-real-yeast')
    parser.add_argument('--minimap2', default=shutil.which('minimap2'))
    args = parser.parse_args()
    if not args.minimap2:
        parser.error('Install minimap2 2.22 or pass --minimap2 /path/to/minimap2')
    version = subprocess.check_output([args.minimap2, '--version'], text=True).strip()
    if version != '2.22-r1101':
        raise RuntimeError(f'Reproducible selection requires minimap2 2.22-r1101; found {version}')
    cache = args.cache.resolve()
    cache.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    prefix_files = [cache / f'{RUN}_{mate}.prefix.gz' for mate in (1, 2)]
    tasks = [(FASTQ_URLS[i], prefix_files[i], PREFIX_BYTES) for i in (0, 1)]
    tasks += [(REF_URL, cache / 'chromFa.tar.gz', None), (ENA_URL, cache / 'ena-run-metadata.tsv', None)]
    with concurrent.futures.ThreadPoolExecutor(4) as pool:
        for future in [pool.submit(download, *task) for task in tasks]:
            future.result()
    for name, expected in PINNED_SHA256.items():
        if sha256(cache / name) != expected:
            raise RuntimeError(f'{name}: checksum differs from the pinned source; no dataset replaced')

    full_reference = cache / 'sacCer3-full.fa'
    with tarfile.open(cache / 'chromFa.tar.gz', 'r:gz') as archive, full_reference.open('wb') as handle:
        members = sorted((m for m in archive.getmembers() if m.isfile() and m.name.endswith('.fa')), key=lambda m: m.name)
        for member in members:
            handle.write(archive.extractfile(member).read())
    references = fasta_records(full_reference)
    bundled_reference = fasta_records(OUT / 'reference.fa')
    if bundled_reference != {'yeast_chrM': references['chrM']}:
        raise RuntimeError('Bundled mitochondrial reference differs from UCSC chrM; rebuild matching indexes first')

    candidates = [cache / f'candidates_R{mate}.fastq' for mate in (1, 2)]
    iterators = [records(gzip_prefix_lines(p)) for p in prefix_files]
    with candidates[0].open('wb') as forward, candidates[1].open('wb') as reverse:
        for _ in range(PAIR_COUNT):
            a, b = next(iterators[0], None), next(iterators[1], None)
            if a is None or b is None:
                raise RuntimeError('Compressed prefixes contain fewer than 800000 complete paired records')
            if read_id(a) != read_id(b):
                raise RuntimeError('Mate files are not in identical read-pair order')
            forward.write(a)
            reverse.write(b)

    sam_path = cache / 'candidates.full.sam'
    command = [args.minimap2, '-ax', 'sr', '--secondary=no', '-t', '2', '-o', str(sam_path), str(full_reference), *map(str, candidates)]
    with (cache / 'selection-minimap2.log').open('w') as log:
        subprocess.run(command, stderr=log, check=True)
    selected = set()
    with sam_path.open() as alignments:
        for line in alignments:
            if line.startswith('@'):
                continue
            fields = line.split('\t')
            if fields[2] == 'chrM' and not int(fields[1]) & (4 | 256 | 2048):
                selected.add(fields[0])
    before_cap = len(selected)
    if len(selected) > 10000:
        selected = set(sorted(selected, key=lambda value: hashlib.sha256(value.encode()).digest())[:10000])
    if len(selected) < 2000:
        raise RuntimeError(f'Only {len(selected)} mitochondrial pairs recovered; refusing an inadequate replacement')

    lengths, emitted, total_bases = collections.Counter(), [], 0
    temporary_reads = [OUT / f'reads_R{mate}.fastq.part' for mate in (1, 2)]
    with candidates[0].open('rb') as a, candidates[1].open('rb') as b, temporary_reads[0].open('wb') as forward, temporary_reads[1].open('wb') as reverse:
        for left, right in zip(records(a), records(b)):
            identity = read_id(left)
            if identity not in selected:
                continue
            assert identity == read_id(right)
            forward.write(left)
            reverse.write(right)
            emitted.append(identity)
            for read in (left, right):
                length = len(read.split(b'\n')[1])
                lengths[length] += 1
                total_bases += length
    assert len(emitted) == len(selected)
    for temporary, expected in zip(temporary_reads, EXPECTED_READ_SHA256):
        if sha256(temporary) != expected:
            raise RuntimeError('Rebuilt reads differ from the validated deterministic subset; no dataset replaced')

    # Coverage is measured from primary alignments to the complete assembly.
    length = len(references['chrM'])
    delta, mapq = [0] * (length + 1), collections.Counter()
    primary_mt_reads = 0
    with sam_path.open() as alignments:
        for line in alignments:
            if line.startswith('@'):
                continue
            fields = line.split('\t')
            flag = int(fields[1])
            if fields[0] not in selected or fields[2] != 'chrM' or flag & (4 | 256 | 2048):
                continue
            primary_mt_reads += 1
            mapq[int(fields[4])] += 1
            position = int(fields[3]) - 1
            for count, operation in re.findall(r'(\d+)([MIDNSHP=X])', fields[5]):
                count = int(count)
                if operation in 'M=X':
                    end = min(length, position + count)
                    if end > position >= 0:
                        delta[position] += 1
                        delta[end] -= 1
                if operation in 'MDN=X':
                    position += count
    depth, running = [], 0
    for value in delta[:-1]:
        running += value
        depth.append(running)
    for temporary, mate in zip(temporary_reads, (1, 2)):
        temporary.replace(OUT / f'reads_R{mate}.fastq')
    for stale in ['truth.vcf', 'simulation.json', 'low_coverage.bed']:
        (OUT / stale).unlink(missing_ok=True)
    (OUT / 'regions.bed').write_text(f'yeast_chrM\t0\t{length}\tmitochondrial_reference\n')
    (OUT / 'selected-read-ids.txt').write_text('\n'.join(emitted) + '\n')
    shutil.copyfile(cache / 'ena-run-metadata.tsv', OUT / 'ena-run-metadata.tsv')

    provenance = {
        'dataset': 'yeast', 'readSource': 'biological sequencing',
        'runAccession': RUN, 'experimentAccession': 'SRX696259',
        'bioSample': 'SAMN03020231', 'bioProject': 'PRJNA260311',
        'sample': {'species': 'Saccharomyces cerevisiae', 'strain': 'BY4741', 'nuclearPloidy': 'Haploid', 'description': 'S288C-derivative laboratory strain', 'submitter': 'Stanford University'},
        'library': {'strategy': 'WGS', 'source': 'GENOMIC', 'layout': 'PAIRED', 'instrument': 'Illumina HiSeq 2000', 'preparation': 'Nextera tagmentation'},
        'primaryMetadataSources': ['https://www.ncbi.nlm.nih.gov/sra/SRX696259%5Baccn%5D', 'https://www.ncbi.nlm.nih.gov/biosample/SAMN03020231', ENA_URL],
        'archiveFiles': [
            {'url': FASTQ_URLS[i], 'fullFileMD5FromENA': md5, 'fullFileBytesFromENA': size, 'downloadedByteRange': [0, PREFIX_BYTES - 1], 'prefixSHA256': sha256(prefix_files[i])}
            for i, (md5, size) in enumerate([('9b670852a7572a02d6cf53050f7791dd', 1040094631), ('effe1a157ceb2d734fda79ea163b61d2', 1051570250)])
        ],
        'reference': {'assembly': 'SacCer_Apr2011 / sacCer3', 'sourceStrain': 'S288C', 'wholeAssemblyURL': REF_URL, 'archiveSHA256': sha256(cache / 'chromFa.tar.gz'), 'selectionReferenceContigs': len(references), 'selectionReferenceBases': sum(map(len, references.values())), 'displayContig': 'yeast_chrM', 'originalContig': 'chrM', 'length': length, 'sequenceSHA256': hashlib.sha256(references['chrM'].encode()).hexdigest(), 'coordinateMapping': 'yeast_chrM positions equal UCSC sacCer3 chrM positions; only the FASTA identifier is renamed.'},
        'selection': {'aligner': 'minimap2', 'version': version, 'command': 'minimap2 -ax sr --secondary=no -t 2 -o candidates.full.sam sacCer3-full.fa candidates_R1.fastq candidates_R2.fastq', 'candidatePairs': PAIR_COUNT, 'candidateRule': 'First 800000 complete paired FASTQ records from the archived mate files, in original order.', 'pairRule': 'Retain both original mates if either has a primary mapped alignment to chrM against all 17 sacCer3 chromosomes. No MAPQ or variant filter.', 'mitochondrialPairsBeforeCap': before_cap, 'maxPairs': 10000, 'capRule': 'If necessary select the 10000 smallest SHA256(read ID) values, then retain original FASTQ order.', 'selectedPairs': len(emitted), 'sequenceNamesAndQualities': 'All four lines of each selected archived FASTQ record are copied verbatim. No trimming, renaming, reverse complementation, quality editing, introduced variants or simulation.'},
        'validation': {'mateIdentifiersMatch': True, 'selectedRawRecordsCopiedVerbatim': True, 'readLengths': dict(sorted(lengths.items())), 'totalReadBases': total_bases, 'primaryMitochondrialReads': primary_mt_reads, 'meanAlignedDepth': round(statistics.mean(depth), 4), 'medianAlignedDepth': statistics.median(depth), 'fractionReferenceCovered': round(sum(d > 0 for d in depth) / length, 6), 'fractionReferenceAtLeast10x': round(sum(d >= 10 for d in depth) / length, 6), 'primaryMtMAPQHistogram': dict(sorted(mapq.items()))},
        'truth': None,
        'limitations': ['There is no validated variant truth set; caller agreement is not accuracy.', 'The first-run prefix is not a random whole-run sample.', 'Read selection depends on primary minimap2 alignment to the full assembly and can exclude divergent or unmapped mitochondrial fragments.', 'The browser reference contains only chrM. Some retained mates may be unmapped or map elsewhere in the full assembly; nuclear competition is absent when students remap.', 'Mitochondrial ploidy 1 is a calling-model choice; mixed mitochondrial alleles are not ruled out by the sample\'s haploid nuclear annotation.', 'The circular reference is represented linearly, so origin-spanning reads can align poorly.'],
        'rebuild': 'python build/prepare_real_yeast.py --minimap2 /path/to/minimap2-2.22',
        'outputSHA256': {name: sha256(OUT / name) for name in ['reference.fa', 'reads_R1.fastq', 'reads_R2.fastq', 'selected-read-ids.txt', 'regions.bed']}
    }
    (OUT / 'provenance-yeast.json').write_text(json.dumps(provenance, indent=2) + '\n')
    record = {
        'id': 'yeast', 'name': 'Yeast BY4741 mitochondrion', 'species': 'Saccharomyces cerevisiae',
        'assembly': 'SacCer_Apr2011 / sacCer3 (S288C reference)',
        'description': 'Authentic paired Illumina WGS reads from BY4741, enriched for mitochondrial read pairs using the complete yeast genome.',
        'readSource': 'biological', 'sample': 'BY4741', 'accession': RUN, 'ploidy': 1, 'circular': True,
        'reference': 'data/yeast/reference.fa', 'read1': 'data/yeast/reads_R1.fastq', 'read2': 'data/yeast/reads_R2.fastq',
        'truth': None, 'truthCount': None, 'regionsBed': 'data/yeast/regions.bed', 'lowCoverageBed': None,
        'pairs': len(emitted), 'readLength': next(iter(lengths)) if len(lengths) == 1 else None,
        'coverage': round(statistics.mean(depth), 2), 'nominalCoverage': None,
        'bowtie2Index': 'data/yeast/reference',
        'bowtie2Files': [f'data/yeast/reference.{suffix}.bt2' for suffix in ['1', '2', '3', '4', 'rev.1', 'rev.2']],
        'provenanceFile': 'data/yeast/provenance-yeast.json',
        'provenance': {'reference': 'Full real sacCer3 S288C mitochondrial sequence; original coordinates retained.', 'reads': 'Real BY4741 paired WGS reads from SRR1569870, copied verbatim from ENA; no simulated reads.', 'referenceSources': [REF_URL], 'readSources': FASTQ_URLS, 'selection': provenance['selection']['pairRule'], 'limitations': provenance['limitations']},
        'regions': [{'contig': 'yeast_chrM', 'length': length, 'sourceContig': 'chrM', 'start': 1, 'end': length, 'coordinateSystem': '1-based inclusive; identical to source chromosome coordinates.'}]
    }
    (OUT / 'manifest-record.json').write_text(json.dumps(record, indent=2) + '\n')
    print(json.dumps({'pairs': len(emitted), 'meanDepth': provenance['validation']['meanAlignedDepth'], 'coverageFraction': provenance['validation']['fractionReferenceCovered'], 'readLengths': dict(lengths), 'truth': None}, indent=2))


if __name__ == '__main__':
    main()
