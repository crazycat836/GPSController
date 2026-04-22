"""Single source of truth for the app version.

The frontend `package.json` is the canonical release artifact (per
CLAUDE.md release flow). Backend reads it at import time so the FastAPI
app, `/` endpoint, the start.py banner, and log lines all agree.

In a PyInstaller bundle the `frontend/` tree isn't present — the
packager copies the backend binary into `resources/backend/` of the
Electron distribution. We fall back to a baked-in value written by
`build.py` at package time (see `_BAKED_VERSION`), and ultimately to
"0.0.0" if neither is available.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

# Populated by build.py when producing a frozen (PyInstaller) build. Kept
# here so a packaged binary never has to locate `frontend/package.json`
# at runtime.
_BAKED_VERSION = ""


def _read_frontend_version() -> str | None:
    """Walk up from this file to find `frontend/package.json`. Returns
    the `version` string or None if the file can't be read."""
    here = Path(__file__).resolve()
    for ancestor in (here.parent, *here.parents):
        candidate = ancestor / "frontend" / "package.json"
        if candidate.is_file():
            try:
                payload = json.loads(candidate.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                return None
            version = payload.get("version")
            return str(version) if isinstance(version, str) else None
    return None


def _resolve_version() -> str:
    # PyInstaller frozen build: use the baked value.
    if getattr(sys, "frozen", False) and _BAKED_VERSION:
        return _BAKED_VERSION
    # Dev / sidecar run: read package.json.
    v = _read_frontend_version()
    if v:
        return v
    # Absolute fallback so logs/endpoints never crash on the lookup.
    return os.environ.get("GPSCONTROLLER_VERSION", _BAKED_VERSION or "0.0.0")


__version__ = _resolve_version()
