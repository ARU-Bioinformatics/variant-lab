# exactSNP 2.0.1 browser build

The unmodified `exactSNP.js` and `exactSNP.wasm` files are vendored from Junli
Li's `pinbo/bwa-samtools-web` repository, pinned at commit
`57ea8152a53ac0ec43d1c6d32c00f5f06d2848d3`:

- https://github.com/pinbo/bwa-samtools-web/tree/57ea8152a53ac0ec43d1c6d32c00f5f06d2848d3/exactSNP/2.0.1
- Corresponding modified source and build recipe:
  https://github.com/pinbo/bwa-samtools-web/tree/57ea8152a53ac0ec43d1c6d32c00f5f06d2848d3/Tool_src/subread-2.0.1
  and `Tool_src/subread-compile.sh` in that commit.
- Upstream Subread: https://subread.sourceforge.net/
- exactSNP documentation: https://subread.sourceforge.net/exactSNP.html

Subread is distributed under the GNU General Public License, version 3 or
later. The upstream licence text is included as `LICENSE`. Corresponding
source and build script are bundled in `source.tar.gz` for redistribution.
The source's copyright notices identify the original authors.

The browser port modifies threading. This practical permits only `-T 1`:
requesting multiple threads could skip work in the original port. Outputs
are produced by the compiled program from the current input files, never
looked up from example results. The two new adapter files are separate from
the unmodified upstream binary and start a fresh worker for every invocation.

This exactSNP build reports records without a sample genotype column.
Its SNP QUAL is `min(40, -log10(p))`, not the Phred scale used by BCFtools.
It can also report simple CIGAR-supported indels, with constant QUAL 1.0.
Allele overlap can be compared with other callers; genotype concordance is
unavailable, and a shared numerical QUAL cutoff is inappropriate.
Inputs are materialized in memory and
the browser build is intended for the practical's small reference regions.

## VCF header completion

The native build omits contig definitions and some INFO declarations required
for reliable exchange with BCFtools. On import, the adapter inserts metadata
immediately before `#CHROM`, preserving the original header lines and every
native variant record unchanged. It adds:

- Missing `##contig` lines for every sequence in the exact FASTA provided to
  `-g`, including sequence lengths measured from that file.
- `MMsum` as an Integer and, when present, `CTRL_DP`, `CTRL_MM`, `CTRL_QV`, and
  `VS_QV` with types checked against the pinned `src/SNPCalling.c`.
- Declarations for any otherwise undeclared observed INFO or FILTER field.
  Unknown valued INFO fields are conservatively declared as strings; their
  scientific meaning is not inferred. Unknown bare INFO fields are flags.
- `##source=exactSNP-2.0.1`, a conspicuous `##variantLabQualityScale` line and
  a `##variantLabHeaderRepair` provenance note.

The terminal log lists inserted metadata. The adapter neither normalizes nor
filters native records, changes QUAL values, invents genotypes, nor changes
alleles. Normalization remains a separate, explicit BCFtools operation.

The native `-C DIR` argument selects the temporary-file directory, as stated
in native help. The adapter checks that DIR exists in the practical workspace
and creates the same directory in the disposable worker before execution.
