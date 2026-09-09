"""``ensure_personalized_ddi_mounted`` must tell the UI *why* the mount
failed when the iPhone's Developer Mode toggle is off.

A major iOS upgrade resets Developer Mode. pymobiledevice3 then raises
``DeveloperModeIsNotEnabledError`` from the mounter, and the generic
"mount DDI manually via Xcode" hint is misleading — the fix is a toggle
in Settings, not a manual mount. The failure broadcast therefore carries
a dedicated ``reason`` / ``hint_key`` pair the banner keys on.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

import core.ddi_mount as ddi_mount  # noqa: E402
import pymobiledevice3.services.mobile_image_mounter as mim  # noqa: E402
import services.ws_broadcaster as ws_broadcaster  # noqa: E402
from pymobiledevice3.exceptions import DeveloperModeIsNotEnabledError  # noqa: E402


class _NotMountedMounter:
    def __init__(self, lockdown=None):
        pass

    async def connect(self):
        return None

    async def is_image_mounted(self, image_type):
        return False

    async def close(self):
        return None


def _run(coro):
    return asyncio.run(coro)


def test_developer_mode_off_broadcasts_dedicated_hint(monkeypatch):
    monkeypatch.setattr(mim, "MobileImageMounterService", _NotMountedMounter)

    async def _raise(_lockdown):
        raise DeveloperModeIsNotEnabledError()

    monkeypatch.setattr(mim, "auto_mount_personalized", _raise)
    broadcast = AsyncMock()
    monkeypatch.setattr(ws_broadcaster, "broadcast", broadcast)

    conn = SimpleNamespace(udid="UDID-1", lockdown=object(), developer_mode_enabled=None)

    with pytest.raises(DeveloperModeIsNotEnabledError):
        _run(ddi_mount.ensure_personalized_ddi_mounted(conn, asyncio.Lock()))

    events = {call.args[0]: call.args[1] for call in broadcast.await_args_list}
    assert "ddi_mounting" in events
    assert "ddi_mounted" not in events
    missing = events["ddi_mount_missing"]
    assert missing["reason"] == ddi_mount.REASON_DEVELOPER_MODE_DISABLED
    assert missing["hint_key"] == ddi_mount.HINT_KEY_DEVELOPER_MODE
    assert missing["udid"] == "UDID-1"
    failed = events["ddi_mount_failed"]
    assert failed["reason"] == ddi_mount.REASON_DEVELOPER_MODE_DISABLED
    assert failed["hint_key"] == ddi_mount.HINT_KEY_DEVELOPER_MODE
    # /device/list reads this cache so the manage view can offer "reveal".
    assert conn.developer_mode_enabled is False


def test_other_mount_errors_keep_generic_hint(monkeypatch):
    monkeypatch.setattr(mim, "MobileImageMounterService", _NotMountedMounter)

    async def _raise(_lockdown):
        raise RuntimeError("boom")

    monkeypatch.setattr(mim, "auto_mount_personalized", _raise)
    broadcast = AsyncMock()
    monkeypatch.setattr(ws_broadcaster, "broadcast", broadcast)

    conn = SimpleNamespace(udid="UDID-2", lockdown=object(), developer_mode_enabled=None)

    with pytest.raises(RuntimeError):
        _run(ddi_mount.ensure_personalized_ddi_mounted(conn, asyncio.Lock()))

    events = {call.args[0]: call.args[1] for call in broadcast.await_args_list}
    assert events["ddi_mount_missing"]["hint_key"] == ddi_mount.HINT_KEY_DEFAULT
    assert events["ddi_mount_missing"]["reason"] == "RuntimeError: boom"
    assert conn.developer_mode_enabled is None
