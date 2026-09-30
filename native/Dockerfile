# Full Unix companion. Ubuntu 24.04 package revisions are recorded by versions.sh.
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash coreutils gawk grep sed findutils less gzip bzip2 xz-utils unzip zip \
    curl ca-certificates python3 python3-pip make gcc g++ \
    bwa bowtie2 minimap2 samtools bcftools freebayes bedtools fastp seqtk subread \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /work
CMD ["bash"]
