#!/usr/bin/env python3
"""Extract genuine NA12878/SRR098401 exome pairs; never simulate read data.

Requires pysam==0.23.3. Default rebuilds FASTQs from bundled source_records.bam
and validates bundled reference sequence checksums. --fetch repeats bounded
indexed HTTP queries to the public 1000 Genomes BAM and UCSC sequence API.
Does not edit the shared manifest: writes data/human-manifest.json to merge.
"""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import urllib.request

import pysam

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "human"
BAM_URL = "https://1000genomes.s3.amazonaws.com/phase3/data/NA12878/exome_alignment/NA12878.mapped.ILLUMINA.bwa.CEU.exome.20121211.bam"
EBI_URL = "https://ftp.1000genomes.ebi.ac.uk/vol1/ftp/phase3/data/NA12878/exome_alignment/NA12878.mapped.ILLUMINA.bwa.CEU.exome.20121211.bam"
READ_GROUP = "SRR098401"
# Zero-based, half-open source intervals. Output FASTA/VCF positions are local.
REGIONS = [
    ("human_CYP2C19", "10", 96530000, 96560000),
    ("human_CYP2C9", "10", 96699000, 96725000),
]


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def fetch_sources():
    with tempfile.TemporaryDirectory() as temporary:
        index = Path(temporary) / "source.bam.bai"
        index.write_bytes(urllib.request.urlopen(BAM_URL + ".bai", timeout=90).read())
        with pysam.AlignmentFile(BAM_URL, "rb", index_filename=str(index)) as source:
            records = {}
            for _, chrom, start, end in REGIONS:
                for read in source.fetch(chrom, start, end):
                    if read.is_secondary or read.is_supplementary or not read.is_paired:
                        continue
                    if not read.has_tag("RG") or read.get_tag("RG") != READ_GROUP:
                        continue
                    records[(read.query_name, 1 if read.is_read1 else 2)] = read
            with pysam.AlignmentFile(str(OUT / "source_records.bam"), "wb", header=source.header) as sink:
                for read in records.values():
                    sink.write(read)
            (OUT / "source_header.sam").write_text(str(source.header))
    refs = []
    for name, chrom, start, end in REGIONS:
        url = f"https://api.genome.ucsc.edu/getData/sequence?genome=hg19;chrom=chr{chrom};start={start};end={end}"
        obj = json.load(urllib.request.urlopen(url, timeout=60))
        seq = obj["dna"].upper()
        assert len(seq) == end - start and set(seq) <= set("ACGTN")
        refs.append(dict(contig=name, sourceContig=f"chr{chrom}", start=start + 1,
                         end=end, sourceUrl=url, sequence=seq))
    with (OUT / "reference.fa").open("w") as handle:
        for item in refs:
            handle.write(">" + item["contig"] + "\n")
            for i in range(0, len(item["sequence"]), 60):
                handle.write(item["sequence"][i:i + 60] + "\n")
    return refs


def load_refs():
    seqs = {}
    for line in (OUT / "reference.fa").read_text().splitlines():
        if line.startswith(">"):
            name = line[1:].split()[0]
            seqs[name] = ""
        else:
            seqs[name] += line.strip().upper()
    return [dict(contig=name, sourceContig=f"chr{chrom}", start=start + 1, end=end,
                 sourceUrl=f"https://api.genome.ucsc.edu/getData/sequence?genome=hg19;chrom=chr{chrom};start={start};end={end}",
                 sequence=seqs[name]) for name, chrom, start, end in REGIONS]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fetch", action="store_true", help="Repeat original indexed public-data retrieval")
    parser.add_argument("--bowtie2-build", help="Bowtie2 2.4.2 bowtie2-build executable")
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    refs = fetch_sources() if args.fetch else load_refs()
    provenance_path = OUT / "provenance-human.json"
    if provenance_path.exists():
        previous = json.loads(provenance_path.read_text())
        expected = {r["contig"]: r["sequenceSha256"] for r in previous["references"]}
        for r in refs:
            assert hashlib.sha256(r["sequence"].encode()).hexdigest() == expected[r["contig"]]
    pairs = defaultdict(dict)
    source_count = 0
    with pysam.AlignmentFile(str(OUT / "source_records.bam"), "rb") as source:
        read_groups = source.header.to_dict().get("RG", [])
        for read in source:
            if read.is_secondary or read.is_supplementary or not read.is_paired:
                continue
            if not read.has_tag("RG") or read.get_tag("RG") != READ_GROUP:
                continue
            source_count += 1
            mate = 1 if read.is_read1 else 2
            assert mate not in pairs[read.query_name], "Duplicate primary mate identity"
            pairs[read.query_name][mate] = read
    accepted = []
    excluded = Counter()
    source_flags = Counter()
    lengths = Counter()
    for name in sorted(pairs):
        mates = pairs[name]
        if set(mates) != {1, 2}:
            excluded["incomplete_pairs"] += 1
            continue
        if any(r.query_sequence is None or r.query_qualities is None for r in mates.values()):
            excluded["missing_sequence_or_quality_pairs"] += 1
            continue
        if any(any(op == 5 for op, size in (r.cigartuples or [])) for r in mates.values()):
            excluded["hard_clipped_pairs"] += 1
            continue
        accepted.append((name, mates))
        for read in mates.values():
            lengths[read.query_length] += 1
            for label, value in [("duplicateMarkedRecords", read.is_duplicate),
                                 ("unmappedMateRecords", read.is_unmapped),
                                 ("qcFailRecords", read.is_qcfail),
                                 ("recordsWithOQTag", read.has_tag("OQ"))]:
                source_flags[label] += bool(value)
    bases = 0
    with (OUT / "reads_R1.fastq").open("w") as r1, (OUT / "reads_R2.fastq").open("w") as r2:
        for name, mates in accepted:
            for mate, handle in [(1, r1), (2, r2)]:
                read = mates[mate]
                # Undo SAM's reverse-strand storage; retain all BAM-stored bases/qualities.
                seq = read.get_forward_sequence()
                qualities = read.get_forward_qualities()
                assert len(seq) == len(qualities)
                quality_string = "".join(chr(q + 33) for q in qualities)
                handle.write(f"@{name}/{mate}\n{seq}\n+\n{quality_string}\n")
                bases += len(seq)
    for obsolete in ["truth.vcf", "simulation.json", "low_coverage.bed"]:
        (OUT / obsolete).unlink(missing_ok=True)
    (OUT / "reference.fa.fai").unlink(missing_ok=True)
    pysam.faidx(str(OUT / "reference.fa"))
    (OUT / "regions.bed").write_text("".join(f"{r['contig']}\t0\t{len(r['sequence'])}\treference_slice_not_truthmask\n" for r in refs))
    if args.bowtie2_build:
        subprocess.run([args.bowtie2_build, "--ftabchars", "8", str(OUT / "reference.fa"), str(OUT / "reference")], check=True)
    references = [dict(contig=r["contig"], sourceContig=r["sourceContig"], start=r["start"],
                       end=r["end"], length=len(r["sequence"]), sourceUrl=r["sourceUrl"],
                       sequenceSha256=hashlib.sha256(r["sequence"].encode()).hexdigest()) for r in refs]
    total_length = sum(r["length"] for r in references)
    provenance = dict(
        schemaVersion=1, sample="NA12878", run="SRR098401", readGroup=READ_GROUP,
        study="SRP004078", readGroups=read_groups, biologicalData=True,
        sourceAlignment=dict(url=BAM_URL, mirror=EBI_URL, indexUrl=BAM_URL + ".bai",
                             bytes=17282007379, s3ETag="9aef4f518d297d80f04a48bd5e14cded-129",
                             assembly="NCBI37 / hs37d5", retrieval="Indexed HTTP byte-range queries; full BAM not downloaded"),
        references=references, retrievedOn="2026-09-30", extractedPrimaryRecords=source_count,
        pairedFragments=len(accepted), readLengthCounts=dict(lengths), exclusions=dict(excluded),
        retainedSourceFlags=dict(source_flags), referenceSpanMeanReadBases=round(bases / total_length, 2),
        qualityProvenance="BAM-stored Phred qualities, restored to read orientation. Source header records GATK 1.2-29 base-quality recalibration; no original-quality OQ tags present. Not byte-identical raw deposited FASTQ.",
        selection="Both primary mates must occur among records overlapping the two reference intervals. Exact RG SRR098401. No MAPQ, base-quality, duplicate, QC-fail, proper-pair or variant-allele filter. No random subsampling. Incomplete and hard-clipped pairs excluded; all actual exclusions counted.",
        limitations=["Selection depends on original full-genome BWA mappings and excludes pairs whose partner lies outside fetched intervals; this biases alignment comparisons.",
                     "Exome coverage is uneven. Mean read bases over reference span is not target-region depth or a measured per-base coverage statistic.",
                     "Small reference slices omit genomic competing mapping sites, altering mapping qualities.",
                     "Duplicates remain in FASTQ; source BAM duplicate flags are not transported in FASTQ.",
                     "No independently validated truth VCF or high-confidence mask is supplied. Call-set agreement is not accuracy."],
        software=dict(pythonRequirement="Python 3", pysam=pysam.__version__, bowtie2IndexVersion="2.4.2", bowtie2IndexOptions="--ftabchars 8"))
    (OUT / "provenance-human.json").write_text(json.dumps(provenance, indent=2) + "\n")
    file_checksums = {p.name: sha256(p) for p in sorted(OUT.iterdir()) if p.is_file() and p.name != "SHA256SUMS"}
    (OUT / "SHA256SUMS").write_text("".join(f"{value}  {name}\n" for name, value in file_checksums.items()))
    manifest = dict(
        id="human", name="NA12878 exome · CYP2C regions", species="Homo sapiens",
        sample="NA12878", assembly="GRCh37 / hg19 chr10 slices", readSource="real biological reads (SRR098401)",
        description="Genuine NA12878 exome read pairs from the same public run used in the original practical. Two CYP2C regions with observed heterozygosity and uneven exome coverage; BAM-recalibrated qualities.",
        reference="data/human/reference.fa", read1="data/human/reads_R1.fastq", read2="data/human/reads_R2.fastq",
        truth=None, truthCount=0, ploidy=2, circular=False, readLength=76, pairs=len(accepted),
        coverage=round(bases / total_length, 2), coverageMeaning="Read bases / reference span; exome depth is uneven",
        regionsBed="data/human/regions.bed", lowCoverageBed=None,
        bowtie2Index="data/human/reference",
        bowtie2Files=["data/human/" + p.name for p in sorted(OUT.glob("reference.*.bt2"))],
        provenance=dict(reference="Real hg19 reference slices retrieved from UCSC; local coordinates",
                        reads="Real NA12878/SRR098401 exome reads extracted from public 1000 Genomes phase3 BAM; BAM-stored recalibrated qualities",
                        sourceAlignment=BAM_URL, details="data/human/provenance-human.json", sourceReadGroup=READ_GROUP),
        regions=[dict(contig=r["contig"], length=r["length"], sourceContig=r["sourceContig"], start=r["start"], end=r["end"],
                      coordinateSystem="Source coordinates are 1-based inclusive; FASTA/BAM/VCF use local slice positions") for r in references])
    (ROOT / "data" / "human-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(dict(pairs=len(accepted), sourceRecords=source_count, exclusions=dict(excluded), retainedSourceFlags=dict(source_flags), readLengthCounts=dict(lengths))))


if __name__ == "__main__":
    main()
