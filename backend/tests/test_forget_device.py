"""Tests for api.device.forget_device — the "移除配對" / unpair flow.

Regression guard for the iPad forget failure: for iOS 17+ devices
``conn.lockdown`` is a RemoteServiceDiscoveryService (no ``unpair()``);
the real USB LockdownClient lives in ``conn.usbmux_lockdown``. The old
code called ``conn.lockdown.unpair()`` → AttributeError, then tried to
delete ``/var/db/lockdown/<udid>.plist`` which macOS blocks even as root
(PermissionError) → HTTP 500 every time.

The fix must (1) unpair via the LockdownClient, and (2) treat a
successful device-side unpair as success even when the protected local
file can't be removed.
"""

from __future__ import annotations

import asyncio
import sys
from collections.abc import Iterator
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))


class _RSD:
    """RemoteServiceDiscoveryService double — deliberately has no unpair()."""


class _LockdownClient:
    def __init__(self) -> None:
        self.unpair_calls = 0

    async def unpair(self) -> None:
        self.unpair_calls += 1


class _Conn:
    def __init__(self, *, usbmux_lockdown=None) -> None:
        self.lockdown = _RSD()
        self.usbmux_lockdown = usbmux_lockdown


class _DM:
    def __init__(self, conn) -> None:
        self._conn = conn

    def get_connection(self, _udid):
        return self._conn


class _AppState:
    def __init__(self, dm) -> None:
        self.device_manager = dm
        self.terminate_calls: list[str] = []
        self.unblock_calls: list[str] = []

    async def terminate_engine(self, udid: str) -> None:
        self.terminate_calls.append(udid)

    def unblock_auto_reconnect(self, udid: str) -> None:
        self.unblock_calls.append(udid)


class _ProtectedPath:
    """Path double whose unlink() raises PermissionError, mimicking
    /var/db/lockdown on macOS (protected even for root)."""

    def __init__(self, path: str) -> None:
        self._path = path

    def __str__(self) -> str:
        return self._path

    def unlink(self) -> None:
        raise PermissionError(1, "Operation not permitted")


@pytest.fixture(autouse=True)
def _reset_ctx() -> Iterator[None]:
    from context import ctx
    from services import connection_state, disconnect_dedup
    connection_state.reset_for_tests()
    disconnect_dedup.reset_for_tests()
    saved = getattr(ctx, "app_state", None)
    yield
    ctx.app_state = saved
    connection_state.reset_for_tests()
    disconnect_dedup.reset_for_tests()


def _install(app_state) -> None:
    from context import ctx
    ctx.app_state = app_state


def test_forget_unpairs_via_usbmux_lockdown_and_succeeds_despite_protected_file():
    """iOS 17+ on USB: unpair must go through conn.usbmux_lockdown (the
    LockdownClient), and a PermissionError deleting /var/db/lockdown must
    NOT turn the whole forget into a 500."""
    from api import device

    lockdown = _LockdownClient()
    conn = _Conn(usbmux_lockdown=lockdown)
    app_state = _AppState(_DM(conn))
    _install(app_state)

    async def _run():
        with (
            patch.object(device, "connection_state") as cs,
            patch.object(device, "purge_stale_remote_pair_record"),
            # usbmuxd delete returns False so the success is proven to come
            # from the device-side unpair alone.
            patch.object(device, "delete_usbmux_pair_record", new=AsyncMock(return_value=False)),
            patch.object(
                device, "_pair_record_candidates",
                return_value=[_ProtectedPath("/var/db/lockdown/u-ipad.plist")],
            ),
        ):
            cs.disconnect_device = AsyncMock()
            return await device.forget_device("u-ipad")

    res = asyncio.run(_run())

    assert lockdown.unpair_calls == 1
    assert res["status"] == "forgotten"
    assert res["device_unpaired"] is True
    # The protected file is still reported as failed, but it's non-fatal.
    assert res["failed"]
    assert app_state.unblock_calls == ["u-ipad"]


def test_forget_falls_back_to_lockdown_when_no_usbmux_lockdown():
    """iOS 16 legacy: conn.lockdown IS the LockdownClient (has unpair)."""
    from api import device

    # Legacy: lockdown itself can unpair, no separate usbmux_lockdown.
    legacy = _LockdownClient()
    conn = _Conn(usbmux_lockdown=None)
    conn.lockdown = legacy
    app_state = _AppState(_DM(conn))
    _install(app_state)

    async def _run():
        with (
            patch.object(device, "connection_state") as cs,
            patch.object(device, "purge_stale_remote_pair_record"),
            patch.object(device, "delete_usbmux_pair_record", new=AsyncMock(return_value=False)),
            patch.object(device, "_pair_record_candidates", return_value=[]),
        ):
            cs.disconnect_device = AsyncMock()
            return await device.forget_device("u-legacy")

    res = asyncio.run(_run())
    assert legacy.unpair_calls == 1
    assert res["device_unpaired"] is True
    assert res["status"] == "forgotten"


def test_forget_500s_when_no_unpair_and_no_record_removable():
    """Pure WiFi-tunnel device (no usbmux_lockdown) whose only record is
    macOS-protected: nothing can be cleaned → genuine 500."""
    from fastapi import HTTPException
    from api import device

    conn = _Conn(usbmux_lockdown=None)  # conn.lockdown is RSD (no unpair)
    app_state = _AppState(_DM(conn))
    _install(app_state)

    async def _run():
        with (
            patch.object(device, "connection_state") as cs,
            patch.object(device, "purge_stale_remote_pair_record"),
            # Every authoritative path fails: no device-side unpair, usbmuxd
            # delete rejected, file unlink blocked → genuine 500.
            patch.object(device, "delete_usbmux_pair_record", new=AsyncMock(return_value=False)),
            patch.object(
                device, "_pair_record_candidates",
                return_value=[_ProtectedPath("/var/db/lockdown/u-wifi.plist")],
            ),
        ):
            cs.disconnect_device = AsyncMock()
            return await device.forget_device("u-wifi")

    with pytest.raises(HTTPException) as ei:
        asyncio.run(_run())
    assert ei.value.status_code == 500


def test_forget_succeeds_via_usbmuxd_when_device_disconnected_or_locked():
    """The intermittent-failure regression: the iPad is NOT connected (locked
    device breaks the connect/pair cycle), so there's no LockdownClient to
    unpair through and /var/db/lockdown is macOS-protected. usbmuxd
    DeletePairRecord must carry the forget to success without a 500."""
    from api import device

    app_state = _AppState(_DM(None))  # get_connection -> None (disconnected)
    _install(app_state)

    async def _run():
        with (
            patch.object(device, "connection_state") as cs,
            patch.object(device, "purge_stale_remote_pair_record"),
            patch.object(device, "delete_usbmux_pair_record", new=AsyncMock(return_value=True)),
            patch.object(
                device, "_pair_record_candidates",
                return_value=[_ProtectedPath("/var/db/lockdown/u-locked.plist")],
            ),
        ):
            cs.disconnect_device = AsyncMock()
            return await device.forget_device("u-locked")

    res = asyncio.run(_run())
    assert res["status"] == "forgotten"
    assert res["device_unpaired"] is False
    assert res["usbmux_record_deleted"] is True
    # disconnect_device must NOT be called when there was no live connection.
    assert app_state.unblock_calls == ["u-locked"]
