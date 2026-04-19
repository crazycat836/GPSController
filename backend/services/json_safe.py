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
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


def safe_load_json(path: Path) -> Any | None:
    """Load JSON from *path*.

    Returns the parsed payload, or ``None`` if the file is missing,
    unreadable, or contains invalid JSON. Only *corrupt JSON* triggers
    the ``<name>.bak-<timestamp>`` quarantine — read errors (permission
    denied, disk failure, etc.) are logged and pass through as ``None``
    without moving the file, so a recoverable filesystem hiccup doesn't
    get misfiled as data corruption.
    """
    if not path.exists():
        return None
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        logger.error("cannot read %s: %s: %s", path.name, type(exc).__name__, exc)
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        _backup_corrupt(path, reason=f"{type(exc).__name__}: {exc}")
        return None


def safe_write_json(path: Path, payload: Any, *, indent: int = 2) -> bool:
    """Write *payload* to *path* atomically.

    Serialises to a **per-call** unique ``.tmp`` sibling and then
    ``Path.replace``s it over the target, so a crash mid-write never
    leaves a truncated file behind. Returns ``True`` on success.

    The previous implementation reused a fixed ``<path>.tmp`` name.
    Under concurrent writers (two coroutines saving bookmarks + a
    bookmark add request, say) both would write to the same ``.tmp``
    file and race on ``replace`` — the last writer's bytes became the
    canonical file and the first writer's data was silently dropped.
    The unique temp name eliminates that window entirely: each writer
    has its own sibling; the final ``replace`` is atomic per POSIX /
    NTFS semantics, so the worst case is "most recent replace wins"
    rather than "data loss".
    """
    tmp_path: Path | None = None
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        body = json.dumps(payload, ensure_ascii=False, indent=indent)
        # `NamedTemporaryFile(delete=False)` gives us an exclusive-open
        # file in the target directory; the OS guarantees a unique
        # name. We write via the returned file handle and then
        # ``Path.replace`` it over the canonical target.
        fd = tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            prefix=path.name + ".",
            suffix=".tmp",
            dir=path.parent,
            delete=False,
        )
        tmp_path = Path(fd.name)
        try:
            fd.write(body)
            fd.flush()
            os.fsync(fd.fileno())
        finally:
            fd.close()
        tmp_path.replace(path)
        return True
    except Exception as exc:
        logger.error("failed to write %s: %s", path.name, exc)
        # Best-effort cleanup if we created a temp file but failed
        # before the rename.
        if tmp_path is not None:
            try:
                tmp_path.unlink(missing_ok=True)
            except Exception:
                pass
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
