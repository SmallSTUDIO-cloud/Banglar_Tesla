#!/usr/bin/env python3
"""Summarise a dotnet test log as GitHub Actions annotations.

The hosted log archive is not reachable from all tooling, so the authoritative
counts are republished as annotations, which are readable through the Actions
API. Usage: ci-test-annotate.py <logfile> [exit-status]

Emits:
  * a notice with passed/failed/total counts (always, when the log is readable);
  * an error annotation with assertion context (only when the run failed).
"""

import pathlib
import re
import sys
import urllib.parse

CONTEXT_LINES = 18
MAX_CHARS = 6000
RESULT_LINE = re.compile(r"^\s*(Passed|Failed)\s+\S")


def main() -> int:
    path = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/domain-tests.log")
    try:
        status = int(sys.argv[2]) if len(sys.argv) > 2 else 0
    except ValueError:
        status = 1
    lines = path.read_text(errors="replace").splitlines()

    # Per-test result lines are the reliable counts; the dotnet summary line has
    # changed format between SDK versions, so use it only when it is present.
    passed = [line for line in lines if RESULT_LINE.match(line) and line.strip().startswith("Passed")]
    failed = [line for line in lines if RESULT_LINE.match(line) and line.strip().startswith("Failed")]
    official = [line.strip() for line in lines if line.strip().startswith(("Passed!", "Failed!"))]
    summary = f"passed={len(passed)} failed={len(failed)} total={len(passed) + len(failed)}"
    if official:
        summary += f" | {official[-1]}"
    print("::notice title=Domain test counts::" + urllib.parse.quote(summary[:900], safe=""))

    if status == 0 and not failed:
        return 0

    blocks = []
    for index, line in enumerate(lines):
        if line.lstrip().startswith("Failed "):
            blocks.append("\n".join(lines[index:index + CONTEXT_LINES]).rstrip())
    body = "\n---\n".join(blocks) or "\n".join(lines[-30:])
    print("::error title=Domain test failures::" + urllib.parse.quote(body[:MAX_CHARS], safe=""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
