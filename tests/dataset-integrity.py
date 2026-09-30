#!/usr/bin/env python3
"""Measure and validate the datasets declared in data/manifest.json.

Run from any directory:
    python tests/dataset-integrity.py
    python tests/dataset-integrity.py tests/dataset-integrity-results.json

The optional output path receives the same JSON printed to stdout. A failed
check exits with status 1. No expected read counts or variant truth are assumed.
The source check examines declared metadata; it does not authenticate provenance.
Only Python's standard library is required.
"""

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import gzip
import hashlib
from itertools import zip_longest
import json
from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[1]
DNA = frozenset("ACGTURYSWKMBDHVNacgturyswkmbdhvn.")
SIMULATED = re.compile(r"simulat|synthetic|in[\s_-]*silico", re.IGNORECASE)


class InvalidData(ValueError):
    """A concrete integrity check failed."""


def require(condition, message):
    if not condition:
        raise InvalidData(message)


def data_path(value):
    require(isinstance(value, str) and value.strip(), "file path is missing")
    path = (ROOT / value).resolve()
    require(path.is_relative_to(ROOT), f"path is outside the project: {value}")
    require(path.is_file(), f"file does not exist: {value}")
    require(path.stat().st_size > 0, f"file is empty: {value}")
    return path


def fingerprint(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return {
        "path": path.relative_to(ROOT).as_posix(),
        "bytes": path.stat().st_size,
        "sha256": digest.hexdigest(),
    }


@contextmanager
def nucleotide_text(path):
    with path.open("rb") as handle:
        compressed = handle.read(2) == b"\x1f\x8b"
    opener = gzip.open if compressed else open
    with opener(path, "rt", encoding="ascii", newline=None) as handle:
        yield handle


def reference_summary(path):
    contigs = []
    seen = set()
    current = None
    with nucleotide_text(path) as handle:
        for line_number, line in enumerate(handle, 1):
            line = line.rstrip("\r\n")
            if not line:
                continue
            if line.startswith(">"):
                fields = line[1:].split()
                require(fields, f"FASTA line {line_number}: empty identifier")
                identifier = fields[0]
                require(identifier not in seen, f"duplicate FASTA identifier: {identifier}")
                if current is not None:
                    require(current["length"] > 0, f"empty FASTA sequence: {current['id']}")
                current = {"id": identifier, "length": 0}
                seen.add(identifier)
                contigs.append(current)
            else:
                require(current is not None, f"FASTA line {line_number}: sequence before header")
                require(set(line) <= DNA, f"FASTA line {line_number}: invalid nucleotide or whitespace")
                current["length"] += len(line)
    require(contigs, "FASTA has no sequences")
    require(current["length"] > 0, f"empty FASTA sequence: {current['id']}")
    return {**fingerprint(path), "contigs": contigs,
            "totalBases": sum(contig["length"] for contig in contigs)}


def read_identity(header):
    """Return the fragment name and any explicit /1,/2 or CASAVA mate flag."""
    fields = header.split()
    require(fields, "FASTQ header has no identifier")
    name = fields[0]
    suffix = re.search(r"/([12])$", name)
    mate = int(suffix.group(1)) if suffix else None
    if suffix:
        name = name[:-2]
    require(name, "FASTQ header has no fragment identifier")
    if len(fields) > 1:
        flag = re.match(r"^([12])(?::|$)", fields[1])
        if flag:
            flagged_mate = int(flag.group(1))
            require(mate is None or mate == flagged_mate,
                    f"conflicting suffix and whitespace mate flag in header: {header}")
            mate = flagged_mate
    return name, mate


def fastq_records(path):
    """Read standard or wrapped FASTQ, checking every sequence and quality."""
    with nucleotide_text(path) as handle:
        record = 0
        while True:
            header = handle.readline()
            if not header:
                return
            record += 1
            label = f"{path.name} record {record}"
            header = header.rstrip("\r\n")
            require(header.startswith("@"), f"{label}: expected @ header")
            identity = read_identity(header[1:])
            sequence = []
            while True:
                line = handle.readline()
                require(line, f"{label}: missing + separator")
                line = line.rstrip("\r\n")
                if line.startswith("+"):
                    if line[1:].strip():
                        repeated = read_identity(line[1:])
                        require(repeated == identity,
                                f"{label}: + identifier differs from @ identifier")
                    break
                require(line and set(line) <= DNA, f"{label}: invalid or empty nucleotide line")
                sequence.append(line)
            length = sum(map(len, sequence))
            require(length > 0, f"{label}: empty sequence")
            quality_length = 0
            while quality_length < length:
                line = handle.readline()
                require(line, f"{label}: truncated quality string")
                quality = line.rstrip("\r\n")
                require(quality and all(33 <= ord(char) <= 126 for char in quality),
                        f"{label}: quality contains non-printable characters or is empty")
                quality_length += len(quality)
            require(quality_length == length,
                    f"{label}: sequence length {length} != quality length {quality_length}")
            yield identity[0], identity[1], length


def new_read_summary(path):
    return {**fingerprint(path), "records": 0, "bases": 0,
            "minReadLength": None, "maxReadLength": None,
            "explicitMateFlags": 0}


def record_summary(summary, record):
    _, mate, length = record
    summary["records"] += 1
    summary["bases"] += length
    summary["minReadLength"] = min(summary["minReadLength"] or length, length)
    summary["maxReadLength"] = max(summary["maxReadLength"] or length, length)
    summary["explicitMateFlags"] += mate is not None


def reads_summary(read1, read2=None):
    result = {"read1": new_read_summary(read1)}
    if read2 is None:
        for record in fastq_records(read1):
            record_summary(result["read1"], record)
        require(result["read1"]["records"] > 0, "FASTQ contains no records")
        return {**result, "layout": "single-end"}
    result["read2"] = new_read_summary(read2)
    pairs = 0
    for pairs, (left, right) in enumerate(
            zip_longest(fastq_records(read1), fastq_records(read2)), 1):
        require(left is not None and right is not None,
                f"paired FASTQ record counts differ at pair {pairs}")
        require(left[0] == right[0],
                f"pair {pairs}: fragment names differ ({left[0]!r}, {right[0]!r})")
        require(left[1] in (None, 1), f"pair {pairs}: read1 is marked as mate {left[1]}")
        require(right[1] in (None, 2), f"pair {pairs}: read2 is marked as mate {right[1]}")
        record_summary(result["read1"], left)
        record_summary(result["read2"], right)
    require(pairs > 0, "paired FASTQ files contain no records")
    return {**result, "layout": "paired-end", "pairs": pairs,
            "pairNamesMatch": True}


def validate_dataset(dataset, allow_simulated):
    result = {"id": dataset.get("id"), "readSource": dataset.get("readSource"),
              "ok": True, "errors": []}

    def check(name, action):
        try:
            result[name] = action()
        except (InvalidData, OSError, UnicodeError, EOFError, ValueError) as error:
            result["ok"] = False
            result["errors"].append(f"{name}: {error}")

    def source_check():
        source = dataset.get("readSource")
        require(isinstance(source, str) and source.strip(), "readSource must be a nonempty string")
        require(allow_simulated or not SIMULATED.search(source),
                "simulated/synthetic readSource is rejected; real sequenced data is required")
        return {"declaredSourceAccepted": True,
                "simulatedSourcesAllowed": allow_simulated}

    check("sourceMetadata", source_check)
    check("reference", lambda: reference_summary(data_path(dataset.get("reference"))))
    check("reads", lambda: reads_summary(
        data_path(dataset.get("read1")),
        data_path(dataset["read2"]) if dataset.get("read2") else None))

    def index_check():
        files = dataset.get("bowtie2Files", [])
        require(isinstance(files, list), "bowtie2Files must be a list")
        require(all(isinstance(value, str) for value in files),
                "bowtie2Files entries must be strings")
        require(len(set(files)) == len(files), "bowtie2Files contains duplicate paths")
        summaries = []
        for value in files:
            path = data_path(value)
            # Index components have different binary layouts. Their complete
            # usability is checked by running Bowtie2 in the runtime tests;
            # here we check existence, nonempty contents and exact checksums.
            summaries.append(fingerprint(path))
        return summaries

    check("bowtie2Files", index_check)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("output", nargs="?", type=Path, help="optional JSON results file")
    parser.add_argument("--output", dest="output_option", type=Path,
                        help="alternative spelling for the JSON results file")
    parser.add_argument("--manifest", type=Path, default=ROOT / "data/manifest.json")
    parser.add_argument("--allow-simulated", action="store_true",
                        help="explicitly permit legacy simulated-source metadata")
    args = parser.parse_args()
    if args.output is not None and args.output_option is not None:
        parser.error("supply either positional output or --output, not both")
    report = {"ok": True, "checkedAt": datetime.now(timezone.utc).isoformat(),
              "manifest": str(args.manifest), "datasets": [], "errors": []}
    try:
        manifest_bytes = args.manifest.read_bytes()
        report["manifestSha256"] = hashlib.sha256(manifest_bytes).hexdigest()
        manifest = json.loads(manifest_bytes)
        require(isinstance(manifest, dict), "manifest root must be an object")
        datasets = manifest.get("datasets")
        require(isinstance(datasets, list) and datasets, "manifest must contain a nonempty datasets list")
        seen = set()
        for dataset in datasets:
            require(isinstance(dataset, dict), "each dataset must be an object")
            identifier = dataset.get("id")
            require(isinstance(identifier, str) and identifier.strip(), "each dataset must have a nonempty id")
            require(identifier not in seen, f"duplicate dataset id: {identifier}")
            seen.add(identifier)
            result = validate_dataset(dataset, args.allow_simulated)
            report["datasets"].append(result)
            report["ok"] = report["ok"] and result["ok"]
    except (InvalidData, OSError, UnicodeError, ValueError) as error:
        report["ok"] = False
        report["errors"].append(str(error))
    payload = json.dumps(report, indent=2, ensure_ascii=True) + "\n"
    output = args.output_option or args.output
    if output is not None:
        try:
            output.write_text(payload, encoding="utf-8")
        except OSError as error:
            print(f"Unable to write results: {error}", file=sys.stderr)
            return 1
    print(payload, end="")
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
