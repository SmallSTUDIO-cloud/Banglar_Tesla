#!/usr/bin/env python3
"""Convert a dotnet test log into a readable GitHub Actions annotation.

The hosted log archive is not always reachable from our tooling, so failing
assertions are surfaced as annotations, which are available through the
Actions API. Usage: ci-test-annotate.py <logfile>
"""

import pathlib
import sys
import urllib.parse

CONTEXT_LINES = 18
MAX_CHARS = 6000


def main() -> int:
    path = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/domain-tests.log")
    lines = path.read_text(errors="replace").splitlines()
    blocks = []
    for index, line in enumerate(lines):
        if line.lstrip().startswith("Failed "):
            blocks.append("\n".join(lines[index:index + CONTEXT_LINES]).rstrip())
    body = "\n---\n".join(blocks) or "\n".join(lines[-30:])
    print("::error title=Domain test failures::" + urllib.parse.quote(body[:MAX_CHARS], safe=""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
