# Third-party software and source provenance

This practical bundles independently licensed programs. The MIT licence on the Biowasm build framework does **not** relicense Bowtie2, GNU utilities or Subread. Preserve each component's notices and licence when copying or distributing its files.

## Newly bundled command-line programs

| Program | Version | Upstream licence | Included licence | Source |
| --- | --- | --- | --- | --- |
| Bowtie2 `bowtie2-align-s` | 2.4.2 | GPL version 3 or later | [Bowtie2 LICENSE](assets/vendor/biowasm/bowtie2/2.4.2/LICENSE) | [Upstream release](https://github.com/BenLangmead/bowtie2/tree/v2.4.2) |
| GNU coreutils: `cat`, `head`, `tail`, `wc`, `sort`, `uniq`, `cut`, `tr`, `tee`, `comm`, `join`, `paste`, `seq` | 8.32 | GPL version 3 or later | [Coreutils LICENSE](assets/vendor/biowasm/coreutils/8.32/LICENSE) | [Release source](https://ftp.gnu.org/gnu/coreutils/coreutils-8.32.tar.xz) |
| GNU Awk (`gawk`, exposed as `awk`) | 5.1.0 | GPL version 3 or later | [Gawk LICENSE](assets/vendor/biowasm/gawk/5.1.0/LICENSE) | [Release source](https://ftp.gnu.org/gnu/gawk/gawk-5.1.0.tar.xz) |
| GNU grep | 3.7 | GPL version 3 or later | [Grep LICENSE](assets/vendor/biowasm/grep/3.7/LICENSE) | [Release source](https://ftp.gnu.org/gnu/grep/grep-3.7.tar.xz) |
| GNU sed | 4.8 | GPL version 3 or later | [Sed LICENSE](assets/vendor/biowasm/sed/4.8/LICENSE) | [Release source](https://ftp.gnu.org/gnu/sed/sed-4.8.tar.xz) |
| minimap2 | 2.22 | MIT | [Minimap2 LICENSE](assets/vendor/biowasm/minimap2/2.22/LICENSE) | [Upstream release](https://github.com/lh3/minimap2/tree/v2.22) |
| exactSNP / Subread | 2.0.1 | GPL version 3 or later | [Subread LICENSE](assets/vendor/exactsnp/LICENSE) | [Port, source archive and build notes](assets/vendor/exactsnp/NOTICE.md) |

The copyright statements for Bowtie2, the GNU programs and their included dependencies remain in their source releases. Minimap2's included MIT notice identifies the Dana-Farber Cancer Institute and Broad Institute. The full GPL version 3 text is also available at [assets/vendor/licenses/GPL-3.0.txt](assets/vendor/licenses/GPL-3.0.txt). A general licence label in this table does not replace the notices in individual upstream source files.

## Browser builds, modifications and reproducible retrieval

The six Biowasm packages above came from `https://biowasm.com/cdn/v3/NAME/VERSION/`. Each component directory contains its `NOTICE.txt` and `SHA256SUMS`. The `.wasm` and associated `.data` files were downloaded as compiled browser programs. The local JavaScript loader modification records Emscripten's exit status in `Module.__exitStatus`; it is described in the component notices. The practical's own shell, worker adapters and interface are separate project source files.

[source-archives.json](assets/vendor/licenses/source-archives.json) records the exact release-source URLs, sizes and SHA-256 values verified on 30 September 2026. It is a retrieval manifest; it does not embed those six source archives. GitHub-generated source archives are pinned to upstream version tags and verified against their recorded bytes. Check the hash after downloading; investigate a mismatch rather than silently substituting a newer release.

The Biowasm recipe snapshot is pinned at commit [`97bb23225892ba5cc59ba0deac8b212b957db66a`](https://github.com/biowasm/biowasm/tree/97bb23225892ba5cc59ba0deac8b212b957db66a). A small local [source snapshot](assets/vendor/licenses/biowasm-build/) includes the framework licence, build configuration, helper scripts and relevant port patches/compile scripts. Its files and checksums are listed in [biowasm-build-manifest.json](assets/vendor/licenses/biowasm-build-manifest.json).

This is a verified, pinned recipe snapshot for inspection and rebuilding. The original CDN compilation commit was not provided with the downloaded binaries, so it is **not** a claim that rebuilding this snapshot produces identical binary bytes. The snapshot's `Dockerfile-dev` pins Emscripten 2.0.25. Its `biowasm.json` records each package version and upstream checkout, and its `CONTRIBUTING.md` documents invoking `bin/compile.py --tools NAME --versions VERSION`. Upstream repositories and submodules are recorded in `.gitmodules`; the local snapshot omits the large upstream source trees, which are available through the source manifest and repositories.

For a full source checkout, use the pinned repository and initialise the relevant submodules; retain the port patches, build scripts and local loader changes with the upstream program source. GPL terms for object-code distribution and Corresponding Source are in section 6 of the included licence. The source retrieval manifest is not a written source offer and is not a substitute for any source-delivery obligations of a particular distribution. exactSNP's corresponding modified source and build script are already bundled in its `source.tar.gz`.

## Software inherited from the supplied practical

The original package supplied SAMtools 1.17, BCFtools 1.10, HTSlib utilities 1.17, Biowasm's base module 1.0.0 and Aioli. Their original [licence and attribution notice](assets/vendor/biowasm/LICENSE.txt) is retained. SAMtools/BCFtools are MIT/Expat; HTSlib includes MIT/Expat and BSD-licensed code. The Biowasm/Aioli framework is MIT. These inherited files have their own provenance; the newly recorded recipe pin above does not establish their original build provenance.

Dataset sources and the distinction between real reference sequence and simulated reads are documented separately in [data/DATASETS.md](data/DATASETS.md).
