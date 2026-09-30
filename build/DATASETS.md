# Rebuilding the biological teaching subsets

The two input datasets are real biological sequencing reads. See [data/DATASETS.md](../data/DATASETS.md) for source accessions, coordinate systems, extraction criteria and limitations.

- `prepare_real_human.py`: recover NA12878/SRR098401 FASTQs from the bundled real source BAM; `--fetch` repeats indexed extraction from the public source. Requires `pysam==0.23.3`. Use `--bowtie2-build` when regenerating reference indexes.
- `prepare_real_yeast.py`: recover BY4741/SRR1569870 records from verified archived FASTQ prefixes and select mitochondrial pairs using the full yeast reference with native minimap2 2.22.

Each script documents its arguments and emits a dataset manifest record. After changing extraction parameters, update the corresponding entry in `data/manifest.json`, refresh checksums and run the integrity/runtime checks. Neither script simulates reads or creates a truth VCF.
