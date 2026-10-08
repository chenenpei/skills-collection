#!/usr/bin/env python3
"""Validate evidence references and incremental claim retention in a research report."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


INDEX_ROW = re.compile(r"^\|\s*`?([A-Za-z][\w-]*)`?\s*\|\s*`([^`]+)`\s*\|")
EVIDENCE = re.compile(r"(?<![\w/])([A-Za-z][\w-]{1,40}):(\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)")
CLAIM_ROW = re.compile(r"^\|\s*(C\d+[\w-]*)\s*\|")
ABSOLUTE_PATH = re.compile(r"(?:/Users/|/private/|/var/folders/|file://|/tmp/)")


def errors_for_report(report_path: Path, repo_root: Path) -> tuple[list[str], set[str], str | None, bool, bool]:
    text = report_path.read_text(encoding="utf-8")
    errors: list[str] = []
    index: dict[str, Path] = {}
    in_index = False
    in_claims = False
    claims: set[str] = set()

    for line_number, line in enumerate(text.splitlines(), 1):
        if line.startswith("#"):
            in_index = line.strip() == "## 证据索引"
            in_claims = "Claim ledger" in line
        elif in_index:
            match = INDEX_ROW.match(line)
            if match:
                label, relative = match.groups()
                path = Path(relative)
                if path.is_absolute():
                    errors.append(f"{report_path}:{line_number}: evidence path is absolute: {relative}")
                index[label] = path
                if not (repo_root / path).is_file():
                    errors.append(f"{report_path}:{line_number}: evidence file does not exist: {relative}")
        elif in_claims:
            match = CLAIM_ROW.match(line)
            if match:
                claims.add(match.group(1))

    has_index = "## 证据索引" in text
    has_claim_ledger = "Claim ledger" in text
    if not has_index:
        errors.append(f"{report_path}: missing evidence index")

    # Warm-up reports are also onboarding documents. Keep the product map and
    # the concrete action/condition/result inventory present when a report
    # identifies itself as warm-up. This prevents readable summaries from
    # silently dropping business behavior.
    is_warmup = bool(re.search(r"研究模式\s*[:：].*(?:warm-up|接手)", text, re.IGNORECASE))
    if is_warmup:
        required_sections = {
            "用户和产品能看到什么": "user-visible product results",
            "页面与能力清单": "page/capability inventory",
            "主要操作与限制": "action/condition/result details",
        }
        for heading, label in required_sections.items():
            if heading not in text:
                errors.append(f"{report_path}: warm-up report missing {label} section: {heading}")
        if not re.search(r"```(?:mermaid|ascii)", text, re.IGNORECASE):
            errors.append(f"{report_path}: warm-up report missing Mermaid or ASCII call-chain diagram")
        if not re.search(r"动作.*条件.*可见结果", text, re.DOTALL):
            errors.append(f"{report_path}: warm-up report missing action -> condition -> visible-result inventory")

    for line_number, line in enumerate(text.splitlines(), 1):
        if ABSOLUTE_PATH.search(line):
            errors.append(f"{report_path}:{line_number}: absolute machine path")
        if "[TODO:" in line or "path/to/" in line or "old-commit" in line or "new-commit" in line:
            errors.append(f"{report_path}:{line_number}: unresolved placeholder")
        for label, ranges in EVIDENCE.findall(line):
            if label not in index:
                errors.append(f"{report_path}:{line_number}: citation uses unknown label {label}")
                continue
            source = repo_root / index[label]
            if not source.is_file():
                continue
            line_count = len(source.read_text(encoding="utf-8", errors="replace").splitlines())
            for item in ranges.split(","):
                bounds = item.split("-", 1)
                start = int(bounds[0])
                end = int(bounds[-1])
                if start < 1 or end < start or end > line_count:
                    errors.append(f"{report_path}:{line_number}: citation out of range: {label}:{item}")

    report_id = None
    match = re.search(r"报告身份\s*[:：]\s*`([^`]+)`", text)
    if match:
        report_id = match.group(1)
    return errors, claims, report_id, has_index, has_claim_ledger


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path)
    parser.add_argument("--repo-root", type=Path, required=True)
    parser.add_argument("--previous-report", type=Path)
    parser.add_argument("--previous-repo-root", type=Path)
    args = parser.parse_args()

    errors, claims, report_id, _, _ = errors_for_report(args.report, args.repo_root)
    if args.previous_report:
        previous_root = args.previous_repo_root or args.repo_root
        previous_errors, previous_claims, previous_id, previous_has_index, previous_has_ledger = errors_for_report(args.previous_report, previous_root)
        errors.extend(f"previous: {item}" for item in previous_errors)
        if not previous_has_index or not previous_has_ledger:
            errors.append("previous report must contain an evidence index and Claim ledger")
        if not report_id:
            errors.append("current incremental report is missing report_id")
        if not previous_id:
            errors.append("previous incremental report is missing report_id")
        if previous_id and report_id and previous_id != report_id:
            errors.append("incremental report_id changed for the same-scope update")
        missing = previous_claims - claims
        if missing:
            errors.append("incremental report dropped claim_id(s): " + ", ".join(sorted(missing)))

    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    print(f"valid: {args.report}")
    if report_id:
        print(f"report_id: {report_id}")
    print(f"claims: {len(claims)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
