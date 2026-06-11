#!/usr/bin/env python3
"""Backend layering lint. Exits 0 when clean, 1 on any violation.

THE RULE (decided in the 4B.5 structural review)
================================================

General dependency arrow, top to bottom::

    api/  ->  core/  ->  services/

  * ``api/`` may import anything below it.
  * ``core/`` may import ``services/`` (downward) but never ``api/``.
  * ``services/`` may import neither ``api/`` nor ``core/``.

CONNECTION-ORCHESTRATION GROUP (documented exception)
-----------------------------------------------------
Connection/tunnel orchestration is a runtime group that sits *beside*
the stack rather than inside it: long-running loops and coordinators
wired up by ``main.py``'s lifespan (or fire-and-forget from the WS
endpoint) that legitimately touch both ``core/`` engines and
``services/`` state. Members:

  * ``services/wifi_tunnel_service.py`` — owns the ``TunnelRunner``
    singleton, so it is the ONE services/ module allowed to import
    ``core/`` (``core.wifi_tunnel``).
  * ``core/tunnel_liveness.py``, ``core/wifi_keepalive.py`` — runtime
    loops; receive ``app_state`` from the lifespan, keep a lazy
    ``context.ctx`` fallback for tests that monkeypatch it.
  * ``services/device_watchdog.py`` — runtime loop; takes ``app_state``
    as a parameter (no ctx).
  * ``services/device_health.py`` — fire-and-forget probes scheduled
    from ``api/websocket.py`` with only a UDID list, so it reads
    ``context.ctx`` directly.

``context.ctx`` (the AppState singleton) is composition-root plumbing:
only ``main.py`` (writes it), ``api/_deps.py``/``state.py`` (read it at
the boundary), and the orchestration members listed above may import it.
Everything else must take ``AppState``/``DeviceManager`` as parameters.

Run by hand or wire into a pre-commit hook. To extend the orchestration
group, add the file here AND document the layering in its module
docstring.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
BACKEND = REPO_ROOT / "backend"

# from api.<...> / import api.<...> / from api import ... — module-top or
# lazy inside a function body, both count. ``[ \t]*`` (not ``\s*``) so the
# anchor can't swallow a preceding blank line and skew the line number.
_API_IMPORT = re.compile(
    r"^[ \t]*(?:from[ \t]+api[.\s]|import[ \t]+api[.\s])", re.MULTILINE,
)

# from core.<...> / import core.<...> / from core import ...
_CORE_IMPORT = re.compile(
    r"^[ \t]*(?:from[ \t]+core[.\s]|import[ \t]+core[.\s])", re.MULTILINE,
)

# from context import ... / import context — careful not to match contextlib.
_CONTEXT_IMPORT = re.compile(
    r"^[ \t]*(?:from[ \t]+context[ \t]+import[ \t]|import[ \t]+context(?![\w.]))",
    re.MULTILINE,
)

# services/ modules allowed to import core/ (orchestration group; see
# module docstrings).
CORE_IMPORT_ALLOWLIST = {
    BACKEND / "services" / "wifi_tunnel_service.py",
}

# Modules allowed to import the context singleton (composition root,
# boundary deps, orchestration group).
CONTEXT_IMPORT_ALLOWLIST = {
    BACKEND / "main.py",
    BACKEND / "state.py",
    BACKEND / "api" / "_deps.py",
    BACKEND / "core" / "tunnel_liveness.py",
    BACKEND / "core" / "wifi_keepalive.py",
    BACKEND / "services" / "wifi_tunnel_service.py",
    BACKEND / "services" / "device_health.py",
}


def _matches(path: Path, pattern: re.Pattern[str]) -> list[tuple[int, str]]:
    """Return (line_number, line_text) tuples for each matching import."""
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    out: list[tuple[int, str]] = []
    for m in pattern.finditer(text):
        line_no = text.count("\n", 0, m.start()) + 1
        out.append((line_no, lines[line_no - 1].rstrip()))
    return out


def _scan(roots: list[Path], pattern: re.Pattern[str],
          allow: set[Path] = frozenset()) -> list[tuple[Path, int, str]]:
    bad: list[tuple[Path, int, str]] = []
    for root in roots:
        if not root.is_dir():
            continue
        for path in sorted(root.rglob("*.py")):
            if "tests" in path.parts or path in allow:
                continue
            for line_no, line in _matches(path, pattern):
                bad.append((path, line_no, line))
    return bad


def main() -> int:
    failures: list[tuple[str, list[tuple[Path, int, str]], str]] = []

    # (a) api/ must never be imported from below the HTTP surface.
    failures.append((
        "api/ imports inside core/ or services/",
        _scan([BACKEND / "core", BACKEND / "services"], _API_IMPORT),
        "Move the symbol down into services/ (or extract a service module"
        " that owns it) so the arrow stays api -> core -> services.",
    ))

    # (b) services/ must not import core/ (inversion), orchestration
    # group excepted.
    failures.append((
        "core/ imports inside services/ (outside the orchestration group)",
        _scan([BACKEND / "services"], _CORE_IMPORT, allow=CORE_IMPORT_ALLOWLIST),
        "services/ sits below core/. Either move the shared piece into"
        " services/, or — if this is genuinely a runtime orchestrator —"
        " add it to CORE_IMPORT_ALLOWLIST and document the layering in"
        " its module docstring.",
    ))

    # (c) context.ctx is composition-root plumbing — allowlist only.
    failures.append((
        "context (ctx singleton) imports outside the allowlist",
        _scan([BACKEND], _CONTEXT_IMPORT, allow=CONTEXT_IMPORT_ALLOWLIST),
        "Pass AppState / DeviceManager in as parameters instead of"
        " reaching for the ctx singleton. If this module truly belongs"
        " to the connection-orchestration group, add it to"
        " CONTEXT_IMPORT_ALLOWLIST and document why in its docstring.",
    ))

    ok = True
    for title, bad, hint in failures:
        if not bad:
            continue
        ok = False
        print(f"layer check: FAIL — {title}")
        for path, line_no, line in bad:
            print(f"  {path.relative_to(REPO_ROOT)}:{line_no}: {line}")
        print(f"  hint: {hint}")
        print()

    if ok:
        print(
            "layer check: OK (api -> core -> services holds; ctx and"
            " core-import allowlists respected)"
        )
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
