#!/usr/bin/env bash
set -euo pipefail
# Run from the project root: bash native/run-pipeline.sh human minimap2 bcftools-m
DATASET=${1:?Use: run-pipeline.sh human|yeast bwa|minimap2|bowtie2 bcftools-m|bcftools-c|freebayes|exactSNP}
ALIGNER=${2:?Choose aligner}
CALLER=${3:?Choose caller}
case "$DATASET" in human) PLOIDY=2;; yeast) PLOIDY=1;; *) echo "Unknown bundled dataset" >&2; exit 2;; esac
DATA_DIR="data/$DATASET"
RESULT_DIR="native-results/$DATASET/$ALIGNER-$CALLER"
mkdir -p "$RESULT_DIR"
REF="$DATA_DIR/reference.fa"
R1="$DATA_DIR/reads_R1.fastq"
R2="$DATA_DIR/reads_R2.fastq"
samtools faidx "$REF"
case "$ALIGNER" in
  bwa) bwa index "$REF"; bwa mem "$REF" "$R1" "$R2" > "$RESULT_DIR/aligned.sam";;
  minimap2) minimap2 -ax sr "$REF" "$R1" "$R2" > "$RESULT_DIR/aligned.sam";;
  bowtie2) bowtie2-build "$REF" "$RESULT_DIR/reference"; bowtie2 -x "$RESULT_DIR/reference" -1 "$R1" -2 "$R2" -S "$RESULT_DIR/aligned.sam";;
  *) echo "Unknown aligner" >&2; exit 2;;
esac
samtools sort -o "$RESULT_DIR/aligned.bam" "$RESULT_DIR/aligned.sam"
samtools index "$RESULT_DIR/aligned.bam"
samtools flagstat "$RESULT_DIR/aligned.bam" > "$RESULT_DIR/flagstat.txt"
case "$CALLER" in
 bcftools-m|bcftools-c)
    MODEL=${CALLER#bcftools-}
    CALL_PLOIDY=()
    if [[ "$PLOIDY" == 1 ]]; then CALL_PLOIDY=(--ploidy 1); fi
    bcftools mpileup -q 20 -Q 20 -a FORMAT/AD,FORMAT/DP -f "$REF" -Ou "$RESULT_DIR/aligned.bam" | bcftools call "-$MODEL" -v "${CALL_PLOIDY[@]}" -Ov -o "$RESULT_DIR/calls.vcf";;
 freebayes) freebayes -f "$REF" -p "$PLOIDY" -m 20 -q 20 "$RESULT_DIR/aligned.bam" > "$RESULT_DIR/calls.vcf";;
 exactSNP) exactSNP -b -i "$RESULT_DIR/aligned.bam" -g "$REF" -o "$RESULT_DIR/calls.vcf";;
 *) echo "Unknown caller" >&2; exit 2;;
esac
bcftools norm -f "$REF" -m -any "$RESULT_DIR/calls.vcf" -Ov -o "$RESULT_DIR/normalized.vcf"
bash native/versions.sh > "$RESULT_DIR/versions.txt" 2>&1
printf 'Import %s into the browser comparison workspace.\n' "$RESULT_DIR/normalized.vcf"
