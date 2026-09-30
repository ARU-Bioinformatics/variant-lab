# Real NA12878 exome reads

These are **genuine biological sequencing reads**, not a simulation. The sample is NA12878 and the run is **SRR098401**, the same public exome run identified in the supplied original practical. The source BAM's sole read group identifies sample NA12878, run SRR098401, library Solexa-51024, study SRP004078, sequencing centre BI and Illumina technology.

The practical contains 3,519 complete pairs of 76-base reads extracted from two chromosome 10 regions. Read identifiers and all recorded read bases are preserved, with `/1` or `/2` added to identify the mate. Reverse-strand BAM records are restored to their original read orientation. No variants, reads, sequencing errors or quality scores were generated. The two reference sequences are genuine UCSC hg19 sequence.

| Local reference contig | GRCh37/hg19 source interval, 1-based inclusive | Length |
| --- | --- | --- |
| `human_CYP2C19` | chr10:96,530,001–96,560,000 | 30,000 bp |
| `human_CYP2C9` | chr10:96,699,001–96,725,000 | 26,000 bp |

FASTQ was reconstructed from a public, processed alignment file. **The qualities are the real BAM-stored, recalibrated Phred qualities**, not a byte-identical copy of the originally deposited raw FASTQ. The source header records BWA alignment, GATK 1.2-29 indel realignment and base-quality recalibration, SAMtools BAQ calculation, and Picard duplicate marking. The retrieved records have no `OQ` original-quality tags. This preparation reverses read orientation where necessary, but does not undo source processing, recalculate quality scores, or apply the stored BAQ tag.

## Sources and extraction

- [1000 Genomes / IGSR sample record](https://www.internationalgenome.org/data-portal/sample/NA12878)
- [Run SRR098401 at ENA](https://www.ebi.ac.uk/ena/browser/view/SRR098401)
- [Public indexed BAM, S3 mirror](https://1000genomes.s3.amazonaws.com/phase3/data/NA12878/exome_alignment/NA12878.mapped.ILLUMINA.bwa.CEU.exome.20121211.bam)
- [Same source at EMBL-EBI](https://ftp.1000genomes.ebi.ac.uk/vol1/ftp/phase3/data/NA12878/exome_alignment/NA12878.mapped.ILLUMINA.bwa.CEU.exome.20121211.bam)
- Reference sequence URLs, sequence hashes, extraction counts and software versions: [provenance-human.json](provenance-human.json).
- Original alignment header and processing history: [source_header.sam](source_header.sam).

The 17.28 GB source BAM was queried through its BAI index using HTTP byte ranges; the full BAM was not downloaded. The exact regions above returned 7,073 primary paired records with read group SRR098401. Both mates were available for 3,519 fragments. Thirty-five incomplete pairs were excluded. No downsampling or filtering on variant allele, MAPQ, base quality, proper pairing, duplicate status or QC status was applied. There were no hard-clipped or missing-quality pairs in the complete-pair set. Among the retained records, 660 were marked duplicates and 82 were unmapped mates; their sequences remain in the FASTQ. BAM flags are not carried by FASTQ, so duplicate flags must be recalculated after a new alignment if required.

The small `source_records.bam` file preserves the actual retrieved records before mate selection, with original genome coordinates and source header. It is evidence and an input to the preparation script, not the result of a student's new alignment. Reads are exported in deterministic query-name order, with matched mate order in both FASTQs. `SHA256SUMS` records the distributed file hashes.

## Interpretation and limits

This is exome capture data: depth varies substantially and intronic sequence can have little or no coverage. The reported 9.55× figure is simply total read bases divided by the 56 kb reference span; it is not an estimate of depth over captured exons. At source positions chr10:96,541,616 and chr10:96,702,047 the source alignment contains substantial observed support for two alleles. Investigate whether your newly run pipelines recover the same evidence. Those observations are not a validated truth set.

There is **no supplied truth VCF or high-confidence truth mask**. Agreement between callers measures agreement, not accuracy. `regions.bed` only describes the supplied reference spans and must not be interpreted as a benchmark mask.

Read selection depends on the original full-genome BWA alignment and requires both mates to be present in the retrieved regions. It excludes cross-region partners and can favour reads recognised by the original aligner. The small teaching reference also omits genomic competing mapping sites. These choices keep the practical compact, but mean its results cannot rank whole-genome aligners or clinical pipelines.

Human BAM/VCF coordinates produced in this practical are relative to the local reference slices. Add 96,530,000 to a position on `human_CYP2C19`, or 96,699,000 on `human_CYP2C9`, to recover its source chromosome 10 coordinate. Both slices are portions of gene regions, not full genes. No drug-response or disease interpretation is part of this dataset.

## Rebuild

Install Python and `pysam==0.23.3`. From the project directory:

```sh
python3 build/prepare_real_human.py
```

The default reconstructs FASTQ from the included biological source BAM and checks the bundled reference sequences against recorded hashes. To repeat the original public-data extraction, add `--fetch`; this needs network access and the source BAM/BAI to remain available. To regenerate matching browser Bowtie2 indexes, use the official native Bowtie2 2.4.2 build executable:

```sh
python3 build/prepare_real_human.py --fetch \
  --bowtie2-build /path/to/bowtie2-2.4.2/bowtie2-build
```

The builder uses `--ftabchars 8` and writes a `data/human-manifest.json` object for merging into the application's shared manifest. It never creates simulated data or a fabricated truth set.
