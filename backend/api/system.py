"""System utility endpoints — open files / folders for the user."""

from __future__ import annotations

import ctypes
import logging
import os
import subprocess
import sys
from pathlib import Path

from fastapi import APIRouter

from api._errors import ErrorCode, http_err

router = APIRouter(prefix="/api/system", tags=["system"])

logger = logging.getLogger(__name__)


def _open_native(path: Path) -> None:
    """Open a file or folder with the OS default application.

    On Windows, when the calling process owns the foreground, a freshly
    spawned Explorer window opens *behind* it (Windows foreground lock).
    Call AllowSetForegroundWindow(ASFW_ANY) so the new Explorer process
    can claim foreground itself, then launch via Explorer directly so the
    window genuinely comes to front instead of just blinking in the
    taskbar.
    """
    if sys.platform == "win32":
        try:
            ASFW_ANY = -1
            ctypes.windll.user32.AllowSetForegroundWindow(ASFW_ANY)
        except Exception:
            logger.debug("AllowSetForegroundWindow failed; explorer may open behind", exc_info=True)
        if path.is_dir():
            # explorer.exe with a folder path foregrounds the window reliably,
            # whereas os.startfile sometimes does not.
            subprocess.Popen(["explorer.exe", str(path)])
        else:
            os.startfile(str(path))  # type: ignore[attr-defined]
    elif sys.platform == "darwin":
        subprocess.Popen(["open", str(path)])
    else:
        subprocess.Popen(["xdg-open", str(path)])


@router.post("/open-log")
async def open_log():
    """Open backend.log in the OS default text editor (Notepad on Windows)
    so the user can copy it for bug reports. Falls back to opening the
    log folder if the file is missing."""
    log_dir = Path.home() / ".gpscontroller" / "logs"
    log_file = log_dir / "backend.log"
    target = log_file if log_file.exists() else log_dir
    if not target.exists():
        log_dir.mkdir(parents=True, exist_ok=True)
        target = log_dir
    try:
        _open_native(target)
    except Exception:
        # Log the underlying error server-side so support has the trace,
        # but never reflect raw exception text back to the client — paths
        # and platform-specific messages can leak filesystem layout.
        logger.exception("Failed to open log path %s", target)
        raise http_err(500, ErrorCode.OPEN_LOG_FAILED, "Could not open log file")
    return {"status": "opened", "path": str(target)}


@router.post("/open-log-folder")
async def open_log_folder():
    """Open the ~/.gpscontroller/logs folder in the file manager."""
    log_dir = Path.home() / ".gpscontroller" / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    try:
        _open_native(log_dir)
    except Exception:
        # Same rationale as open_log: keep the original exception out of
        # the HTTP body; the server log already has the full context.
        logger.exception("Failed to open log folder %s", log_dir)
        raise http_err(500, ErrorCode.OPEN_LOG_FAILED, "Could not open log folder")
    return {"status": "opened", "path": str(log_dir)}
