"""Tests for api.websocket._send_initial_state.

The function is the new client's only on-connect read of the device list,
so it has to come from the unified ``services.connection_state`` store
instead of re-running ``discover_devices``. These tests pin that contract:

  * Snapshot lists every CONNECTED + DEGRADED device with the cached
    metadata payload the renderer expects.
  * DEGRADED devices also receive a follow-up ``tunnel_degraded`` frame
    so the renderer chip shows "reconnecting…" without waiting for the
    next transition.
  * ``DeviceManager.discover_devices`` is **not** invoked — that's the
    whole point of routing through the SSoT.

A minimal AppState stub (no DeviceManager, no engines, fixed cooldown
payload) is patched into ``context.ctx`` so the function only depends on
state we set up in each test.
"""

from __future__ import annotations

import asyncio
import json
import sys
from collections.abc import Iterator
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock

import pytest

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))


class _StubCooldown:
    def get_status(self) -> dict[str, Any]:
        return {"active": False, "remaining_sec": 0}


class _StubAppState:
    """Just enough of AppState for _send_initial_state to run.

    Real AppState pulls in BookmarkManager, settings I/O, the WS
    broadcaster — none of which the function actually touches. Keeping
    the stub tiny means a future AppState refactor can't accidentally
    break these tests.
    """

    def __init__(self) -> None:
        self.simulation_engines: dict[str, Any] = {}
        self.cooldown_timer = _StubCooldown()


@pytest.fixture(autouse=True)
def _reset_state_and_ctx() -> Iterator[None]:
    """Wipe connection_state + dedup + swap ctx.app_state for the stub."""
    from context import ctx
    from services import connection_state, disconnect_dedup

    connection_state.reset_for_tests()
    disconnect_dedup.reset_for_tests()
    original = getattr(ctx, "app_state", None)
    ctx.app_state = _StubAppState()
    try:
        yield
    finally:
        connection_state.reset_for_tests()
        disconnect_dedup.reset_for_tests()
        if original is not None:
            ctx.app_state = original


def _make_fake_ws() -> AsyncMock:
    """A WebSocket double that records every ``send_text`` call."""
    ws = AsyncMock()
    ws.send_text = AsyncMock()
    return ws


def _frames(ws: AsyncMock) -> list[dict[str, Any]]:
    """Parse every captured frame as JSON for easy assertions."""
    return [json.loads(c.args[0]) for c in ws.send_text.call_args_list]


def _by_type(frames: list[dict[str, Any]], type_: str) -> list[dict[str, Any]]:
    return [f for f in frames if f.get("type") == type_]


# ─── Empty-store path ────────────────────────────────────────────────

def test_empty_store_sends_empty_snapshot():
    """No devices known → device_snapshot.data.devices == []."""
    from api.websocket import _send_initial_state

    ws = _make_fake_ws()
    asyncio.run(_send_initial_state(ws))

    snaps = _by_type(_frames(ws), "device_snapshot")
    assert len(snaps) == 1
    assert snaps[0]["data"] == {"devices": []}


def test_empty_store_does_not_call_discover_devices():
    """SSoT principle: no usbmux round-trip just to build the snapshot."""
    from api.websocket import _send_initial_state
    from context import ctx

    discover = AsyncMock(return_value=[])
    # If the function ever reaches for a DeviceManager, blow up the test —
    # the whole point is that it shouldn't.
    ctx.app_state.device_manager = type("DM", (), {"discover_devices": discover})()

    ws = _make_fake_ws()
    asyncio.run(_send_initial_state(ws))

    discover.assert_not_called()


# ─── Populated-store path ────────────────────────────────────────────

def test_connected_device_appears_in_snapshot():
    """CONNECTED device → present in snapshot with cached metadata."""
    from api.websocket import _send_initial_state
    from services.connection_state import store, DeviceState

    async def _run() -> list[dict[str, Any]]:
        await store.transition(
            "udid-A", DeviceState.CONNECTED, cause="user",
            metadata={
                "name": "Test iPhone",
                "ios_version": "26.5",
                "connection_type": "USB",
            },
        )
        ws = _make_fake_ws()
        await _send_initial_state(ws)
        return _frames(ws)

    frames = asyncio.run(_run())
    snaps = _by_type(frames, "device_snapshot")
    assert len(snaps) == 1
    devices = snaps[0]["data"]["devices"]
    assert devices == [{
        "udid": "udid-A",
        "name": "Test iPhone",
        "ios_version": "26.5",
        "connection_type": "USB",
    }]
    # CONNECTED (not DEGRADED) → no extra tunnel_degraded.
    assert _by_type(frames, "tunnel_degraded") == []


def test_disconnected_device_excluded():
    """An explicitly DISCONNECTED entry must not leak into the list."""
    from api.websocket import _send_initial_state
    from services.connection_state import store, DeviceState

    async def _run() -> list[dict[str, Any]]:
        # First connect, then disconnect — leaves the store with a known
        # DISCONNECTED entry rather than just "unknown UDID".
        await store.transition(
            "udid-A", DeviceState.CONNECTED, cause="user",
            metadata={"name": "A", "ios_version": "26.5", "connection_type": "USB"},
        )
        await store.transition("udid-A", DeviceState.DISCONNECTED, cause="user")
        ws = _make_fake_ws()
        await _send_initial_state(ws)
        return _frames(ws)

    snaps = _by_type(asyncio.run(_run()), "device_snapshot")
    assert snaps[0]["data"] == {"devices": []}


def test_degraded_device_in_snapshot_and_emits_tunnel_degraded():
    """DEGRADED → still in the device list, plus a tunnel_degraded follow-up."""
    from api.websocket import _send_initial_state
    from services import connection_state
    from services.connection_state import store, DeviceState

    async def _run() -> list[dict[str, Any]]:
        await store.transition(
            "udid-A", DeviceState.CONNECTED, cause="user",
            metadata={"name": "A", "ios_version": "26.5", "connection_type": "Network"},
        )
        await connection_state.mark_degraded("udid-A", cause="dvt_channel_dropped")
        ws = _make_fake_ws()
        await _send_initial_state(ws)
        return _frames(ws)

    frames = asyncio.run(_run())
    snaps = _by_type(frames, "device_snapshot")
    assert len(snaps) == 1
    assert snaps[0]["data"]["devices"][0]["udid"] == "udid-A"
    # Metadata survives the DEGRADED flip (see test_connection_state).
    assert snaps[0]["data"]["devices"][0]["connection_type"] == "Network"

    degraded = _by_type(frames, "tunnel_degraded")
    assert len(degraded) == 1
    assert degraded[0]["data"]["udid"] == "udid-A"
    # Cause is a synthetic "snapshot" tag — store doesn't remember the
    # original cause, and the renderer only cares about the event firing.
    assert degraded[0]["data"]["reason"] == "snapshot"


def test_two_devices_one_connected_one_degraded():
    """Multi-device mode: each device represented exactly once."""
    from api.websocket import _send_initial_state
    from services import connection_state
    from services.connection_state import store, DeviceState

    async def _run() -> list[dict[str, Any]]:
        await store.transition(
            "udid-A", DeviceState.CONNECTED, cause="user",
            metadata={"name": "A", "ios_version": "26.5", "connection_type": "USB"},
        )
        await store.transition(
            "udid-B", DeviceState.CONNECTED, cause="user",
            metadata={"name": "B", "ios_version": "17.4", "connection_type": "USB"},
        )
        await connection_state.mark_degraded("udid-B", cause="dvt_channel_dropped")
        ws = _make_fake_ws()
        await _send_initial_state(ws)
        return _frames(ws)

    frames = asyncio.run(_run())
    udids = {d["udid"] for d in _by_type(frames, "device_snapshot")[0]["data"]["devices"]}
    assert udids == {"udid-A", "udid-B"}
    degraded_udids = [f["data"]["udid"] for f in _by_type(frames, "tunnel_degraded")]
    assert degraded_udids == ["udid-B"]
