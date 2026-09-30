# Biological sequencing datasets

Both datasets contain actual experimental sequencing reads. No read sequences, errors or variants have been simulated or introduced. The former synthetic teaching datasets and their truth files have been replaced.

| Dataset | Sample / run | Reads | Bundled reference | Starting caller model |
|---|---|---|---|---|
| Human exome | NA12878, SRR098401 | 3,519 complete pairs, 76 bp per mate | hg19/GRCh37 CYP2C19 30 kb + CYP2C9 26 kb slices | Diploid; bcftools default |
| Yeast mitochondrial | BY4741, SRR1569870 | 9,785 complete pairs, 101 bp per mate | Entire sacCer3 S288C mitochondrial sequence, 85,779 bp | Haploid; `--ploidy 1` |

## Human: the same exome run as the previous practical

The public [SRR098401 archive record](https://www.ncbi.nlm.nih.gov/sra/SRR098401) identifies paired Illumina HiSeq 2000 whole-exome sequencing of Coriell GM12878 by the Broad Institute. The public 1000 Genomes phase3 exome BAM identifies sample NA12878 and read group SRR098401, matching the earlier practical's run.

Reads were retrieved with indexed byte-range queries from:

`https://1000genomes.s3.amazonaws.com/phase3/data/NA12878/exome_alignment/NA12878.mapped.ILLUMINA.bwa.CEU.exome.20121211.bam`

Primary paired records overlapping two chromosome-10 intervals were retained; only complete, non-hard-clipped pairs were exported. There was no MAPQ, base-quality, duplicate, proper-pair, or variant-allele filter. No random downsampling was performed. Thirty-five incomplete pairs were excluded. Retained source records include 660 duplicate-marked reads and 82 unmapped mates. FASTQ does not carry the original BAM duplicate flags.

**Quality provenance:** read sequences are recovered in original read orientation, and quality scores are the values stored in the source BAM. Its header records upstream GATK base-quality recalibration and no inspected retained record has an original-quality `OQ` tag. These are genuine biological reads, but the FASTQs are not claimed to be byte-identical to the original unprocessed sequencing FASTQs.

The 7,038 exported read sequences, qualities and mate identifiers were individually checked against the source BAM. The selected source records and header are bundled for inspection and an offline rebuild. These source alignments are not substituted for outputs produced by the browser tools.

| Local contig | hg19 source interval (1-based inclusive) | Coordinate conversion |
|---|---|---|
| `human_CYP2C19` | chr10:96,530,001–96,560,000 | genomic position = local position + 96,530,000 |
| `human_CYP2C9` | chr10:96,699,001–96,725,000 | genomic position = local position + 96,699,000 |

The mean number of read bases divided by the entire reference span is 9.55×. This is not a measured per-base coverage statistic: the biological exome capture produces high coverage at some targets and very low coverage elsewhere. The native Bowtie2 validation and browser tool results are measurements for particular parameters, not a truth set.

Details: [human/DATASET.md](human/DATASET.md), [human/provenance-human.json](human/provenance-human.json), [human/source_header.sam](human/source_header.sam).

## Yeast: genuine mitochondrial reads from a genomic library

[SRX696259](https://www.ncbi.nlm.nih.gov/sra/SRX696259%5Baccn%5D), run SRR1569870, is paired Illumina HiSeq 2000 genomic sequencing of BY4741 submitted by Stanford University. [BioSample SAMN03020231](https://www.ncbi.nlm.nih.gov/biosample/SAMN03020231) identifies a haploid S288C-derived laboratory strain.

The first 800,000 complete read pairs were recovered from verified 64 MiB prefixes of each archived ENA gzip file. This is a deterministic prefix, **not a random sample of the complete run**. Each prefix has a recorded SHA-256 digest; the full-file checksums supplied by ENA are retained as archive metadata, not falsely represented as checksums verified by downloading the full files.

The candidate reads were aligned with minimap2 2.22 against **all 17 sacCer3 nuclear and mitochondrial contigs**. Both original mates were retained when either had a primary mitochondrial alignment. No MAPQ or variant filter was applied. All four lines of each selected FASTQ record were copied verbatim: names, sequences, separators and qualities are preserved.

The resulting 9,785 pairs give a mean primary mitochondrial aligned depth of 22.36× in the full-reference selection alignment. About 95.16% of the mitochondrial reference has at least one aligned read, and 50.60% has at least 10× depth. These are measured coverage values from the selection pipeline; browser reruns can differ.

The browser reference renames source `chrM` to `yeast_chrM` without changing its sequence or position numbering. BY4741 is the sequenced strain; S288C is the reference strain. Nuclear haploidy does not demonstrate mitochondrial homoplasmy, and mitochondrial copy number is not ploidy. The initial haploid caller setting is a model to investigate, not a validated biological conclusion.

Details: [yeast/provenance-yeast.json](yeast/provenance-yeast.json), [yeast/ena-run-metadata.tsv](yeast/ena-run-metadata.tsv), [yeast/selected-read-ids.txt](yeast/selected-read-ids.txt).

## How to interpret comparisons

No independently validated truth VCF or high-confidence region mask is bundled. The interface reports shared/unique alleles, genotype agreement and related descriptive comparisons; it does not report precision, sensitivity or synthetic-truth recovery. Agreement can reflect shared errors. Inspect the read evidence and record uncertainty.

Selection is influenced by the source alignment method: original BWA mappings for human and minimap2 mappings for yeast. Unmapped or highly divergent fragments may be excluded. The reduced browser references omit competing genomic sites, so mapping quality cannot be interpreted as if the full genome had been aligned. Some retained mates can fail to map to the small reference. Yeast's circular origin is represented linearly.

`regions.bed` files describe the reference coordinate extents. They are not validated callability or benchmark masks. All supplied Bowtie2 small indexes match the exact reference FASTAs and were built with Bowtie2 2.4.2.

## Rebuild and audit

Normal use requires no downloads beyond the packaged static site. The offline human rebuild uses `build/prepare_real_human.py` and the bundled source BAM; `--fetch` repeats public indexed extraction. It requires Python and `pysam==0.23.3`; `--bowtie2-build` accepts a Bowtie2 2.4.2 index-builder path.

The yeast rebuild uses `build/prepare_real_yeast.py --minimap2 /path/to/minimap2-2.22`. It retrieves the verified source prefixes/reference, repeats whole-genome selection and checks output hashes. Its working downloads stay in the selected cache/work directory outside this site's data. Read the script's `--help` for paths and requirements.

`SHA256SUMS` records packaged data-file checksums. The per-dataset provenance files record source URLs, accessions, selection rules, reference sequences and limitations. Small artificial fixtures remain in software unit tests to test known edge cases; they are not the practical's input data.
