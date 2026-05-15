"""Tests for api.device.list_devices — the merged usbmux + store view.

The endpoint must surface every device the renderer should see:

  * USB-visible entries (connected or merely plugged in) → from
    ``DeviceManager.discover_devices``.
  * Store-tracked entries that usbmux can't enumerate (typically WiFi
    tunnel) → replayed from ``connection_state.store`` so a REST scan
    doesn't return a misleading empty list and clobber the WS-derived
    UI state.

A minimal AppState stub is patched into ``context.ctx`` and a
hand-rolled ``DeviceManager`` double drives discover_devices return
values per test. Talking directly to the route handler (rather than
through TestClient) keeps the test fast and dependency-free — the
project's other tests use the same pattern.
"""

from __future__ import annotations

import asyncio
import sys
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))


class _StubDeviceManager:
    """``discover_devices`` returns whatever the test seeded.

    Real DeviceManager would open lockdown clients per UDID; we don't
    care about that path here — the handler only sees the returned
    DeviceInfo list and a set of UDIDs.
    """

    def __init__(self) -> None:
        self.discovered: list[Any] = []

    async def discover_devices(self) -> list[Any]:
        return list(self.discovered)


class _StubAppState:
    def __init__(self) -> None:
        self.device_manager = _StubDeviceManager()


@pytest.fixture(autouse=True)
def _reset_ctx_and_state() -> Iterator[_StubAppState]:
    from context import ctx
    from services import connection_state, disconnect_dedup

    connection_state.reset_for_tests()
    disconnect_dedup.reset_for_tests()
    original = getattr(ctx, "app_state", None)
    stub = _StubAppState()
    ctx.app_state = stub
    try:
        yield stub
    finally:
        connection_state.reset_for_tests()
        disconnect_dedup.reset_for_tests()
        if original is not None:
            ctx.app_state = original


def _info(
    udid: str,
    *,
    name: str = "Test iPhone",
    ios: str = "26.5",
    conn_type: str = "USB",
    connected: bool = True,
) -> Any:
    from models.schemas import DeviceInfo
    return DeviceInfo(
        udid=udid,
        name=name,
        ios_version=ios,
        connection_type=conn_type,
        is_connected=connected,
    )


# ─── Pure pass-through path ──────────────────────────────────────────

def test_empty_store_returns_only_discovered(_reset_ctx_and_state):
    """Backward compat: no store entries → list matches discover output."""
    from api.device import list_devices

    _reset_ctx_and_state.device_manager.discovered = [
        _info("udid-USB-1"),
        _info("udid-USB-2", connected=False),
    ]

    result = asyncio.run(list_devices())
    assert [d.udid for d in result] == ["udid-USB-1", "udid-USB-2"]


def test_no_devices_anywhere_returns_empty_list(_reset_ctx_and_state):
    from api.device import list_devices

    result = asyncio.run(list_devices())
    assert result == []


# ─── Merge path — the actual bug fix ─────────────────────────────────

def test_wifi_tunnel_device_in_store_added_when_absent_from_usbmux(
    _reset_ctx_and_state,
):
    """The reported bug: usbmux returns [] for a WiFi-tunnel device, but
    the store knows it's live. The endpoint must surface it."""
    from api.device import list_devices
    from services.connection_state import store, DeviceState

    async def _run() -> list[Any]:
        await store.transition(
            "udid-WIFI", DeviceState.CONNECTED, cause="user",
            metadata={
                "name": "Tunneled iPhone",
                "ios_version": "26.4",
                "connection_type": "Network",
            },
        )
        return await list_devices()

    result = asyncio.run(_run())
    assert len(result) == 1
    d = result[0]
    assert d.udid == "udid-WIFI"
    assert d.name == "Tunneled iPhone"
    assert d.ios_version == "26.4"
    assert d.connection_type == "Network"
    assert d.is_connected is True


def test_degraded_device_in_store_also_surfaced(_reset_ctx_and_state):
    """DEGRADED == "tunnel re-handshaking" — still live for UI purposes."""
    from api.device import list_devices
    from services import connection_state
    from services.connection_state import store, DeviceState

    async def _run() -> list[Any]:
        await store.transition(
            "udid-WIFI", DeviceState.CONNECTED, cause="user",
            metadata={"name": "A", "ios_version": "26.5", "connection_type": "Network"},
        )
        await connection_state.mark_degraded("udid-WIFI", cause="dvt_dropped")
        return await list_devices()

    result = asyncio.run(_run())
    assert [d.udid for d in result] == ["udid-WIFI"]


def test_disconnected_store_entries_not_surfaced(_reset_ctx_and_state):
    """A UDID that bounced through DISCONNECTED must not pop back up here."""
    from api.device import list_devices
    from services.connection_state import store, DeviceState

    async def _run() -> list[Any]:
        await store.transition(
            "udid-X", DeviceState.CONNECTED, cause="user",
            metadata={"name": "X", "ios_version": "26.5", "connection_type": "USB"},
        )
        await store.transition("udid-X", DeviceState.DISCONNECTED, cause="user")
        return await list_devices()

    assert asyncio.run(_run()) == []


def test_usbmux_entries_take_precedence_over_store_duplicates(
    _reset_ctx_and_state,
):
    """When the same UDID appears in both sources, keep the usbmux one —
    its data is freshly resolved (developer-mode state, ios_version) and
    can't be replayed from store cache. Store extras only fill the gap."""
    from api.device import list_devices
    from services.connection_state import store, DeviceState

    _reset_ctx_and_state.device_manager.discovered = [
        _info("udid-A", name="Fresh from usbmux", ios="26.5"),
    ]

    async def _run() -> list[Any]:
        await store.transition(
            "udid-A", DeviceState.CONNECTED, cause="user",
            metadata={
                "name": "Stale from store",
                "ios_version": "17.0",
                "connection_type": "USB",
            },
        )
        return await list_devices()

    result = asyncio.run(_run())
    assert len(result) == 1
    assert result[0].name == "Fresh from usbmux"
    assert result[0].ios_version == "26.5"


def test_mixed_usb_and_wifi_merged_in_order(_reset_ctx_and_state):
    """USB entries come first (discover order preserved), then store extras."""
    from api.device import list_devices
    from services.connection_state import store, DeviceState

    _reset_ctx_and_state.device_manager.discovered = [
        _info("udid-USB", name="USB Phone"),
    ]

    async def _run() -> list[Any]:
        await store.transition(
            "udid-WIFI", DeviceState.CONNECTED, cause="user",
            metadata={
                "name": "WiFi Phone",
                "ios_version": "26.5",
                "connection_type": "Network",
            },
        )
        return await list_devices()

    result = asyncio.run(_run())
    udids = [d.udid for d in result]
    assert udids == ["udid-USB", "udid-WIFI"]
    # Each entry keeps the connection_type from its own source.
    by_udid = {d.udid: d for d in result}
    assert by_udid["udid-USB"].connection_type == "USB"
    assert by_udid["udid-WIFI"].connection_type == "Network"
