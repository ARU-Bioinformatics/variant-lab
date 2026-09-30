# Full Unix companion

The browser is not a complete Linux installation. Use this environment for arbitrary Bash scripts, Unix programs, BWA, FreeBayes, or larger inputs. The container is local; GitHub Pages cannot run this Dockerfile.

From the unzipped project root, with Docker installed:

```bash
docker build -t variant-lab -f native/Dockerfile .
docker run --rm -it -v "$PWD:/work" variant-lab
```

Inside the container:

```bash
bash native/run-pipeline.sh human bwa freebayes
bash native/run-pipeline.sh human bowtie2 bcftools-m
bash native/run-pipeline.sh yeast minimap2 exactSNP
```

The script accepts `human|yeast`, `bwa|minimap2|bowtie2`, and `bcftools-m|bcftools-c|freebayes|exactSNP`. Every combination consumes the same FASTQ/reference. It writes separate directories under `native-results/`. Inspect and edit the script to change parameters. Start with one variable at a time.

Select the matching dataset in the browser, import the generated VCFs with **Import local files**, then open **Compare**. Imported files stay local. You can also export browser BAM/VCF files in an experiment archive for analysis here. The archive retains browser paths under `workspace/home/student/`; adjust paths when replaying its command journal.

Versions: Ubuntu 24.04 is the base; `versions.sh` records exact installed package revisions alongside each native result. Native package versions differ from the pinned browser builds, so do not attribute all differences to the algorithm alone. For a rigorously repeatable native course release, save the built container's digest and versions file.

This Docker recipe and scripts are provided as a reproducible setup, but the container build is not validated in the browser-only testing environment. They require an internet connection to obtain Ubuntu packages. Shell syntax is validated separately.
