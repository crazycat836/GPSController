"""Safe JSON persistence helpers shared by every ``~/.gpscontroller`` data file.

Two invariants both helpers enforce:

* **Never silently discard user data on a load failure.** The previous
  per-file pattern — ``try: read; except: return empty`` — meant any
  transient corruption or schema mismatch made the in-memory state go
  empty; the next ``_save()`` then overwrote the original file with that
  empty state, destroying the user's data for good. This module copies
  the corrupt file aside to ``<file>.bak-<UTC timestamp>`` before handing
  the caller ``None``, so the original bytes are always recoverable.
* **Every write is atomic.** We serialise to a sibling ``.tmp`` file and
  then ``Path.replace`` it over the target. A crash / power loss / OS
  kill in the middle of the write leaves the original file untouched
  instead of truncated.

Ported from upstream ``keezxc1223/locwarp`` v0.2.55.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


def safe_load_json(path: Path) -> Any | None:
    """Load JSON from *path*.

    Returns the parsed payload, or ``None`` if the file is missing or
    unreadable. Corrupt files are moved to ``<name>.bak-<timestamp>``
    before ``None`` is returned so the caller can safely re-initialise
    without data loss.
    """
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        _backup_corrupt(path, reason=f"{type(exc).__name__}: {exc}")
        return None


def safe_write_json(path: Path, payload: Any, *, indent: int = 2) -> bool:
    """Write *payload* to *path* atomically.

    Serialises to ``<path>.tmp`` first and then ``Path.replace``s the
    final name over the target, so a crash mid-write never leaves a
    truncated file behind. Returns ``True`` on success.
    """
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        body = json.dumps(payload, ensure_ascii=False, indent=indent)
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(body, encoding="utf-8")
        tmp.replace(path)
        return True
    except Exception as exc:
        logger.error("failed to write %s: %s", path.name, exc)
        return False


def _backup_corrupt(path: Path, *, reason: str) -> Path | None:
    """Move a corrupt file aside so a future write doesn't clobber it.

    Returns the backup path on success, or ``None`` if the rename itself
    failed (in which case the corrupt bytes stay in place — still the
    safer outcome than silently wiping them).
    """
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = path.with_suffix(f"{path.suffix}.bak-{timestamp}")
    try:
        path.replace(backup)
        logger.warning(
            "quarantined corrupt JSON %s -> %s (%s)",
            path.name, backup.name, reason,
        )
        return backup
    except Exception as exc:
        logger.error("failed to quarantine corrupt %s (%s): %s", path.name, reason, exc)
        return None
