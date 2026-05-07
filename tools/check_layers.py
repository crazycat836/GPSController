#!/usr/bin/env python3
"""Fail if anything under backend/core/ or backend/services/ imports
from backend/api/.

Architectural intent (matches main.py layout):

    api/  ->  core/  ->  services/

The dependency arrow only goes one way. ``core/`` and ``services/`` are
the layers below the HTTP surface; reaching back into ``api/`` from
either is what made ``backend/core/tunnel_liveness.py:40`` need a
late-binding workaround comment in the first place.

Run by hand or wire into a pre-commit hook. CI integration lands with
the testing phase. Exits 0 when clean, 1 when any violation is found.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

# from api.<...>  /  import api.<...>  /  from api import ...
# Match either at module-top or inside a function body (lazy import) — both count.
_VIOLATION = re.compile(r"^\s*(?:from\s+api[.\s]|import\s+api[.\s])", re.MULTILINE)

REPO_ROOT = Path(__file__).resolve().parent.parent
SCAN_DIRS = [REPO_ROOT / "backend" / "core", REPO_ROOT / "backend" / "services"]


def violations_in(path: Path) -> list[tuple[int, str]]:
    """Return (line_number, line_text) tuples for each violating import."""
    text = path.read_text(encoding="utf-8")
    out: list[tuple[int, str]] = []
    for m in _VIOLATION.finditer(text):
        line_no = text.count("\n", 0, m.start()) + 1
        line = text.splitlines()[line_no - 1]
        out.append((line_no, line.rstrip()))
    return out


def main() -> int:
    bad: list[tuple[Path, int, str]] = []
    for root in SCAN_DIRS:
        if not root.is_dir():
            continue
        for path in sorted(root.rglob("*.py")):
            for line_no, line in violations_in(path):
                bad.append((path, line_no, line))

    if not bad:
        print("layer check: OK (no api/ imports inside core/ or services/)")
        return 0

    print("layer check: FAIL — api/ imports found inside core/ or services/")
    for path, line_no, line in bad:
        rel = path.relative_to(REPO_ROOT)
        print(f"  {rel}:{line_no}: {line}")
    print()
    print("Move the symbol down into services/ (or extract a service module")
    print("that owns it) so the dependency arrow stays api -> core -> services.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
