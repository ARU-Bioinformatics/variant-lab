# Variant calling practical

A variant-calling practical for GitHub Pages or another static website. Students can align human and yeast sequencing reads, call variants, and compare the results from different tools and settings. The terminal and Galaxy forms use the same files. The layout and colours follow the original genomic variant practicals.

## Start locally

```bash
cd variant-lab
python3 serve.py 8000
```

Open `http://localhost:8000`. Do not double-click `index.html`: the browser needs HTTP to load WebAssembly and data. All runtime assets and datasets are included; no external CDN is required during the practical. First runs load the selected WASM modules lazily. Outputs are kept in memory in the current tab.

## GitHub Pages

Create a repository, place **the contents** of this folder at the repository root (`index.html`, `assets/`, `data/`, `.nojekyll`, etc.), then enable Pages from the desired branch and root folder. All asset paths are relative, so repository subpaths work. There is no npm build or backend. No deployment has been performed for you.

The uncompressed project is approximately 30 MB. A desktop/laptop browser is recommended for analysis; layouts also adapt to smaller screens. Use a recent browser with WebAssembly, Web Workers, Blob and Fetch support. Runtime tools are single-threaded and do not need cross-origin isolation headers.

## Features

- Inspect, edit, filter and combine FASTQ, FASTA, SAM, BAM and VCF files.
- Select **minimap2 or Bowtie2** and run either on either dataset.
- Feed any resulting BAM to **bcftools** or **exactSNP**. Within bcftools, compare the **multiallelic** and **consensus** calling algorithms.
- Use terminal commands, Galaxy-style forms, or both, with one shared filesystem.
- Change parameters and save each result under a different name.
- Normalise and compare call sets: shared and unique alleles, Jaccard overlap, SNP and indel counts, and genotype agreement for matching samples. Agreement is not an accuracy measure.
- Import files or download individual files from the terminal file list. Download work saves an archive of inputs, outputs, notes, commands, timings and data sources.

The Example pipeline panel contains commands that students can edit. The Instructions tab suggests comparisons and explains the tools, data and limitations. All alignment and calling results are computed from the supplied files.

## Software and limitations

| Component | Version | Implementation and scope |
|---|---|---|
| minimap2 | 2.22 | Genuine Biowasm binary. `-ax sr` is the supplied short-read starting preset. Can index arbitrary small references. |
| Bowtie2 | 2.4.2 | Genuine `bowtie2-align-s`, exposed as `bowtie2`. Bundled compatible small indexes; `bowtie2-build` is not included in the browser. If changing reference sequence, build compatible indexes with Bowtie2 2.4.2 and import every index file. |
| samtools | 1.17 | Genuine Biowasm binary for sort/index/view/depth/mpileup/etc. |
| bcftools | 1.10 | Genuine Biowasm binary for likelihoods, both calling models, normalization, filtering and querying. The two models are not two independent caller programs. |
| exactSNP / Subread | 2.0.1 | Genuine older WASM port by Junli Li, pinned to a source commit; isolated worker, one thread. Independent SNP-focused caller; reports some simple CIGAR indels. No sample GT field. |
| awk, grep, sed | 5.1.0 / 3.7 / 4.8 | Genuine GNU WebAssembly tools operating on actual data. |
| Text utilities | coreutils 8.32 | cat, head, tail, wc, sort, uniq, cut, tr, tee, comm, join, paste, seq. |
| Shell and file UI | JavaScript | Quotes, simple globs, variables, pipes, `&&`, `||`, `;`, redirects, directory/file operations. `help` documents the exact supported surface. |
| Galaxy interface | JavaScript | Teaching interface invoking the same tools, not a Galaxy server or workflow scheduler. |

**The browser is not full Linux or full Bash.** It does not run arbitrary native executables, shell loops, process substitution, packages, network commands or background processes. Unimplemented syntax/commands fail visibly. Pipes are evaluated sequentially through real byte buffers; they preserve binary BAM/BCF but do not have Unix concurrent streaming or `SIGPIPE` semantics. The local Aioli patch exposes real file descriptors and exit status so errors are not mistaken for successful runs. **Bowtie2 can take many minutes on the full bundled reads in this older WASM build**; minimap2 is the faster starting route. Small paired FASTQ subsets work, but alter coverage and the evidence available for calling. This is a browser-build limitation, not evidence that native Bowtie2 is generally slow. Ctrl+C cannot interrupt every WASM call immediately; the terminal documents its stop behavior. Large files may exhaust browser memory.

## Datasets

Both datasets contain public sequencing reads. No variants have been added.

- **Human:** a region-selected subset of NA12878 exome sequencing from **SRR098401**, the same run used by the earlier practical. Read pairs are reconstructed from the public 1000 Genomes exome BAM. Its stored quality scores have already undergone upstream recalibration; these FASTQs are not presented as byte-identical copies of the originally deposited raw FASTQ.
- **Yeast:** genuine paired genomic reads from *S. cerevisiae* BY4741, run **SRR1569870**, enriched for mitochondrial mappings after comparison against the complete sacCer3 nuclear and mitochondrial reference. Source accession, strain, read selection and byte-level provenance are recorded with the data.

See [dataset provenance](data/DATASETS.md), `data/manifest.json`, the per-dataset provenance records and the extraction scripts in `build/` for exact counts, reference coordinates, checksums, filters and source URLs. Human reference slices use local contig coordinates. Yeast mitochondrial copy number is not sample ploidy; the initial haploid caller setting is a modeling assumption, not proof of homoplasmy.

These are deliberately small teaching subsets. Read extraction guided by an existing alignment favours reads that mapped under that alignment method. Small reference slices omit competing mappings elsewhere in the genome. Mates can map outside the retained reference or remain unmapped. These restrictions are part of the discussion, not grounds for treating one small-reference pipeline as a biological truth standard.

## Comparing variants

Both selected callsets are split and left-aligned with `bcftools norm -f REFERENCE -m -any` before comparison. REF mismatches, incompatible declared references or contig lengths fail visibly. Matching compares `(CHROM, POS, REF, ALT)` alleles; it is **not haplotype-aware benchmarking**. A complex event and several nearby SNPs can still differ after normalization. Counts are derived from actual VCFs, not expected teaching outputs.

The same numerical quality score is not equivalent between callers. exactSNP's SNP QUAL is `min(40, -log10(p))`, not Phred; its simple indels receive QUAL=1. The adapter adds missing VCF header declarations from the actual reference and native source definitions, with explicit metadata and logging; records are unchanged. The comparison rejects a shared QUAL cutoff across incompatible exactSNP/bcftools scales. Prefilter each caller independently if needed. PASS-only excludes `.` (not filtered) records. This matters for unfiltered native callsets.

Genotype agreement uses matching sample names unless you explicitly map the two single-sample files using the checkbox. Phase is ignored; dosage and ploidy must agree. Missing genotypes and exactSNP's absent GT field are excluded, not called discordant. No independently validated benchmark is bundled, so the interface does not report sensitivity, precision or truth recovery. A matching benchmark VCF and high-confidence region mask would be needed for that evaluation. The bundled BED defines reference regions; it is not a callability mask.

## Teaching suggestions

1. Choose a question and state a prediction.
2. Hold the dataset, reference and evidence thresholds fixed while changing one algorithm.
3. Save outputs and exact commands under distinct names.
4. Compare normalized alleles, then inspect read evidence for one disagreement.
5. Change one threshold or ploidy assumption and explain the effect.
6. Submit the experiment export, a short argument supported by evidence, and limitations.

Possible investigations: alignment behavior in homologous human sequences; consensus versus multiallelic modeling; local-background SNP testing versus genotype likelihoods; low-coverage sensitivity; mitochondrial origin clipping; quality filters that change callset agreement and the supporting read evidence. Timings are browser/device measurements, not native performance rankings.

## Saving work

No reads or variants are uploaded. Tools, comparisons and file imports run locally in the tab. Notes and recent command history use localStorage. Result files are lost when the page closes or reloads. Use **Download work** first. The `.tar.gz` download contains the files, notes and command history, with metadata in `experiment.json` and `commands.txt`. It does not automatically restore a browser session. The app has no analytics or external annotation calls.

## Validation

- Dataset integrity: source archive/sample identification, paired FASTQ names/lengths/qualities, source and subset checksums, reference/index consistency, and documented read selection. See `data/DATASETS.md` and per-dataset provenance/validation files.
- Comparison tests: `node --test tests/compare.test.cjs`.
- Actual bundled WASM execution tests: `node tests/runtime.test.cjs`. A minimal Worker/browser API shim executes the real binaries; results are not mocked. The default test derives its inputs from the real-data manifest and covers both minimap2 pipelines, both bcftools models, and bounded Bowtie2 paired-read runs. Full paired Bowtie2 validation was not completed here because it is slow. See `tests/runtime-results.json` for measured outcomes; these are test conditions, not promised practical answers.
- Independent caller integration: `node tests/exactsnp.test.cjs` executes genuine exactSNP on a known 50% SNP, then normalizes its real VCF with bcftools. Metadata completion preserves native records; evidence is in `tests/exactsnp-results.json`.
- DOM integration: `cd tests && npm install && npm run test:ui` (Node 24). Covers initialization, tabs, shared output files, dataset switching, recipes, saved notes and experiment export; it does not render a browser layout.
- **Browser visual and cross-browser smoke testing remains necessary before classroom release.** The available headless browser exits at startup in this environment. A cloud browser cannot reach its local HTTP server. Computational testing is not a substitute for that UI check.

Before teaching: serve the site, run both aligners and both caller programs on each dataset, inspect the Galaxy job histories, compare VCFs, import a file, export an archive, and try the browsers/devices students will use. Use small independent experiments to establish your own expected discussion points.

## Project files

- `index.html`, `assets/css/lab.css`, `assets/js/lab.js`: standalone page layout, instructions, notes and download controls.
- `vfs.js`, `shell.js`, `terminal.js`, `tools-wasm.js`: real-file terminal/runtime adapted from the supplied practical.
- `galaxy-lab.js`: editable tool forms, command preview and job history.
- `compare.js`: VCF validation, overlap, genotype comparison and export.
- `exactsnp.js`, `assets/vendor/exactsnp/`: independent caller worker and licensed corresponding source.
- `data/`, `build/`: read extraction scripts, data sources, FASTQ and reference files, and prebuilt indexes.

## Credits and sources

Adapted from the user-supplied genomic variant practicals, whose teaching attribution includes Tim Hearn, Martin Symonds, Oliver Smart, the Babraham Bioinformatics group, Galaxy and Melbourne Bioinformatics. Existing adapted teaching content retains the original [CC BY-NC-SA 2.0 UK](https://creativecommons.org/licenses/by-nc-sa/2.0/uk/) attribution. Third-party programs retain their own licences; consult [THIRD_PARTY.md](THIRD_PARTY.md) and bundled licence/notice files before redistribution.

Primary technical references:

- [Biowasm catalogue](https://biowasm.com/cdn/v3) and [Aioli documentation](https://biowasm.com/documentation): browser builds, versions, filesystem and asset hosting.
- [minimap2](https://github.com/lh3/minimap2), [Bowtie2](https://bowtie-bio.sourceforge.net/bowtie2/index.shtml), [samtools/bcftools](https://www.htslib.org/).
- [Subread exactSNP](https://subread.sourceforge.net/exactSNP.html) and [Junli Li's WASM port](https://github.com/pinbo/bwa-samtools-web). See its pinned commit, corresponding source and GPL licence in `assets/vendor/exactsnp/NOTICE.md`.
- [GNU Coreutils](https://www.gnu.org/software/coreutils/), [gawk](https://www.gnu.org/software/gawk/), [grep](https://www.gnu.org/software/grep/), [sed](https://www.gnu.org/software/sed/).
- [NA12878 exome SRR098401](https://www.ncbi.nlm.nih.gov/sra/SRR098401) and [BY4741 experiment SRX696259](https://www.ncbi.nlm.nih.gov/sra/SRX696259%5Baccn%5D), run SRR1569870, for biological sequencing provenance.
- [UCSC Genome Browser API](https://api.genome.ucsc.edu/) for reference sequences; exact requests and sequence hashes are recorded in the dataset provenance.
