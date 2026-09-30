#!/usr/bin/env bash
# Capture exact package versions because distribution patch revisions may change.
dpkg-query -W bash coreutils gawk grep sed findutils bwa bowtie2 minimap2 samtools bcftools freebayes bedtools fastp seqtk subread
