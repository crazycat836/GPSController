"""Tests for services.connection_state.

Verifies the state machine, transition semantics, metadata caching,
subscriber notification, and the WS observer's translation contract.

Uses ``asyncio.run`` directly inside sync pytest functions so the test
suite doesn't depend on pytest-asyncio.
"""

from __future__ import annotations

import asyncio
import sys
from collections.abc import Iterator
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

# Make backend/ importable regardless of where pytest is invoked from.
_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))


@pytest.fixture(autouse=True)
def _reset_state() -> Iterator[None]:
    """Clear the connection_state singleton + the disconnect dedup map
    between tests so prior transitions don't bleed across cases."""
    from services import connection_state, disconnect_dedup
    connection_state.reset_for_tests()
    disconnect_dedup.reset_for_tests()
    yield
    connection_state.reset_for_tests()
    disconnect_dedup.reset_for_tests()


# ─── Pure state-machine tests (no DM, no WS) ──────────────────────────

def test_initial_state_is_disconnected():
    from services.connection_state import store, DeviceState
    assert store.get("any-udid") == DeviceState.DISCONNECTED


def test_transition_to_connected_returns_true():
    from services.connection_state import store, DeviceState

    async def _run() -> bool:
        return await store.transition("u1", DeviceState.CONNECTED, cause="user")

    changed = asyncio.run(_run())
    assert changed is True
    assert store.get("u1") == DeviceState.CONNECTED


def test_duplicate_transition_returns_false():
    """Same-state transition is a no-op."""
    from services.connection_state import store, DeviceState

    async def _run() -> bool:
        await store.transition("u1", DeviceState.CONNECTED, cause="user")
        return await store.transition("u1", DeviceState.CONNECTED, cause="user")

    assert asyncio.run(_run()) is False


def test_transition_rebroadcasts_on_connection_type_change():
    """A USB→Network connection_type flip on a device that STAYS connected
    must re-notify subscribers so the renderer repaints the pill.

    This is the WiFi-tunnel-start-while-plugged-in case: the device was
    auto-connected over USB, then the tunnel moves it to Network without
    ever passing through DISCONNECTED. A plain same-state transition used
    to swallow this, leaving the SSoT (and the /api/device/list merge)
    stuck on stale ``USB`` metadata."""
    from services.connection_state import store, DeviceState, StateTransition

    seen: list[StateTransition] = []

    async def _capture(event: StateTransition) -> None:
        seen.append(event)

    async def _run() -> bool:
        store.subscribe(_capture)
        await store.transition(
            "u1", DeviceState.CONNECTED, cause="auto_usb",
            metadata={"name": "P", "ios_version": "26.5", "connection_type": "USB"},
        )
        return await store.transition(
            "u1", DeviceState.CONNECTED, cause="wifi_tunnel",
            metadata={"name": "P", "ios_version": "26.5", "connection_type": "Network"},
        )

    changed = asyncio.run(_run())
    assert changed is True
    assert len(seen) == 2
    assert seen[1].from_state == DeviceState.CONNECTED
    assert seen[1].to_state == DeviceState.CONNECTED
    assert seen[1].metadata["connection_type"] == "Network"
    assert store.metadata_for("u1")["connection_type"] == "Network"


def test_transition_noop_on_identical_metadata():
    """Re-asserting CONNECTED with byte-identical metadata stays a no-op —
    protects the usbmux-watchdog poll loop from broadcasting every tick."""
    from services.connection_state import store, DeviceState

    async def _run() -> tuple[bool, bool]:
        md = {"name": "P", "ios_version": "26.5", "connection_type": "Network"}
        first = await store.transition("u1", DeviceState.CONNECTED, cause="x", metadata=md)
        second = await store.transition("u1", DeviceState.CONNECTED, cause="x", metadata=dict(md))
        return first, second

    first, second = asyncio.run(_run())
    assert first is True
    assert second is False


def test_ws_observer_fires_device_connected_on_transport_switch():
    """USB→Network flip emits a fresh ``device_connected`` carrying the new
    connection_type, so the frontend upserts the pill to WiFi (no toast)."""
    from services import connection_state
    from services.connection_state import store, DeviceState

    async def _run() -> None:
        connection_state.install_ws_observer()
        await store.transition(
            "u1", DeviceState.CONNECTED, cause="auto_usb",
            metadata={"name": "P", "ios_version": "26.5", "connection_type": "USB"},
        )
        with patch("services.connection_state.broadcast", new=AsyncMock()) as mock_bcast:
            await store.transition(
                "u1", DeviceState.CONNECTED, cause="wifi_tunnel",
                metadata={"name": "P", "ios_version": "26.5", "connection_type": "Network"},
            )
            mock_bcast.assert_awaited_once_with("device_connected", {
                "udid": "u1",
                "name": "P",
                "ios_version": "26.5",
                "connection_type": "Network",
            })

    asyncio.run(_run())


def test_announce_connected_sets_network_metadata_and_broadcasts():
    """announce_connected records an already-established (WiFi-tunnel)
    connection in the SSoT and broadcasts device_connected — without
    calling dm.connect (the transport is already up)."""
    from services import connection_state
    from services.connection_state import store, DeviceState

    async def _run() -> None:
        connection_state.install_ws_observer()
        # Device is already CONNECTED over USB (auto-connect).
        await store.transition(
            "u1", DeviceState.CONNECTED, cause="auto_usb",
            metadata={"name": "iPhone", "ios_version": "26.5", "connection_type": "USB"},
        )
        with patch("services.connection_state.broadcast", new=AsyncMock()) as mock_bcast:
            await connection_state.announce_connected(
                "u1", name="iPhone", ios_version="26.5",
                connection_type="Network", cause="wifi_tunnel",
            )
            mock_bcast.assert_awaited_once_with("device_connected", {
                "udid": "u1",
                "name": "iPhone",
                "ios_version": "26.5",
                "connection_type": "Network",
            })
        assert store.get("u1") == DeviceState.CONNECTED
        assert store.metadata_for("u1")["connection_type"] == "Network"

    asyncio.run(_run())


def test_metadata_preserved_across_degraded_round_trip():
    """CONNECTED → DEGRADED → CONNECTED keeps the original name/version."""
    from services import connection_state
    from services.connection_state import store, DeviceState

    async def _run() -> dict:
        await store.transition(
            "u1", DeviceState.CONNECTED, cause="user",
            metadata={"name": "Test iPhone", "ios_version": "26.5", "connection_type": "Network"},
        )
        await connection_state.mark_degraded("u1", cause="dvt_channel_dropped")
        await connection_state.mark_recovered("u1")
        return store.metadata_for("u1")

    md = asyncio.run(_run())
    assert md["name"] == "Test iPhone"
    assert md["ios_version"] == "26.5"
    assert md["connection_type"] == "Network"


def test_metadata_dropped_on_disconnect():
    """Disconnecting clears the cache so a re-connect doesn't inherit
    stale identity info."""
    from services.connection_state import store, DeviceState

    async def _run() -> dict:
        await store.transition(
            "u1", DeviceState.CONNECTED, cause="user",
            metadata={"name": "Old iPhone"},
        )
        await store.transition("u1", DeviceState.DISCONNECTED, cause="user")
        return store.metadata_for("u1")

    assert asyncio.run(_run()) == {}


def test_mark_degraded_noop_when_disconnected():
    """Can't degrade a device that's already off — silently ignored."""
    from services import connection_state
    from services.connection_state import store, DeviceState

    async def _run() -> DeviceState:
        await connection_state.mark_degraded("u1", cause="dvt_channel_dropped")
        return store.get("u1")

    assert asyncio.run(_run()) == DeviceState.DISCONNECTED


def test_mark_recovered_noop_when_not_degraded():
    """Recovering a CONNECTED (not DEGRADED) device is a no-op."""
    from services import connection_state
    from services.connection_state import store, DeviceState

    async def _run() -> DeviceState:
        await store.transition("u1", DeviceState.CONNECTED, cause="user")
        await connection_state.mark_recovered("u1")
        return store.get("u1")

    assert asyncio.run(_run()) == DeviceState.CONNECTED


# ─── Subscriber tests ─────────────────────────────────────────────────

def test_subscriber_receives_transition():
    """Subscribers see every state change with from/to states intact."""
    from services.connection_state import store, DeviceState, StateTransition

    seen: list[StateTransition] = []

    async def _capture(event: StateTransition) -> None:
        seen.append(event)

    async def _run() -> None:
        store.subscribe(_capture)
        await store.transition("u1", DeviceState.CONNECTED, cause="user")
        await store.transition("u1", DeviceState.DEGRADED, cause="dvt_channel_dropped")

    asyncio.run(_run())
    assert len(seen) == 2
    assert seen[0].from_state == DeviceState.DISCONNECTED
    assert seen[0].to_state == DeviceState.CONNECTED
    assert seen[1].from_state == DeviceState.CONNECTED
    assert seen[1].to_state == DeviceState.DEGRADED
    assert seen[1].cause == "dvt_channel_dropped"


def test_subscriber_exception_does_not_block_others():
    """One bad observer shouldn't poison the chain."""
    from services.connection_state import store, DeviceState

    async def _broken(_event) -> None:
        raise RuntimeError("subscriber boom")

    healthy_calls = 0

    async def _healthy(_event) -> None:
        nonlocal healthy_calls
        healthy_calls += 1

    async def _run() -> None:
        store.subscribe(_broken)
        store.subscribe(_healthy)
        await store.transition("u1", DeviceState.CONNECTED, cause="user")

    asyncio.run(_run())
    assert healthy_calls == 1


def test_subscribe_is_idempotent():
    """Re-subscribing the same callback shouldn't double-fire — matches
    the install_ws_observer() guarantee."""
    from services.connection_state import store, DeviceState

    calls = 0

    async def _sub(_event) -> None:
        nonlocal calls
        calls += 1

    async def _run() -> None:
        store.subscribe(_sub)
        store.subscribe(_sub)
        await store.transition("u1", DeviceState.CONNECTED, cause="user")

    asyncio.run(_run())
    assert calls == 1


# ─── WS observer translation tests ───────────────────────────────────

def test_ws_observer_fires_device_connected_on_fresh_connect():
    """DISCONNECTED → CONNECTED emits `device_connected` with metadata."""
    from services import connection_state
    from services.connection_state import store, DeviceState

    async def _run() -> None:
        connection_state.install_ws_observer()
        with patch("services.connection_state.broadcast", new=AsyncMock()) as mock_bcast:
            await store.transition(
                "u1", DeviceState.CONNECTED, cause="user",
                metadata={"name": "Phone", "ios_version": "26.5", "connection_type": "USB"},
            )
            mock_bcast.assert_awaited_once_with("device_connected", {
                "udid": "u1",
                "name": "Phone",
                "ios_version": "26.5",
                "connection_type": "USB",
            })

    asyncio.run(_run())


def test_ws_observer_fires_tunnel_degraded_on_degrade():
    """CONNECTED → DEGRADED emits `tunnel_degraded` with udid + cause."""
    from services import connection_state
    from services.connection_state import store, DeviceState

    async def _run() -> None:
        connection_state.install_ws_observer()
        await store.transition("u1", DeviceState.CONNECTED, cause="user")
        with patch("services.connection_state.broadcast", new=AsyncMock()) as mock_bcast:
            await connection_state.mark_degraded("u1", cause="dvt_channel_dropped")
            mock_bcast.assert_awaited_once_with("tunnel_degraded", {
                "udid": "u1",
                "reason": "dvt_channel_dropped",
            })

    asyncio.run(_run())


def test_ws_observer_fires_tunnel_recovered_on_recovery():
    """DEGRADED → CONNECTED emits `tunnel_recovered`, NOT a fresh
    `device_connected` — the renderer treats these as different events."""
    from services import connection_state
    from services.connection_state import store, DeviceState

    async def _run() -> None:
        connection_state.install_ws_observer()
        await store.transition("u1", DeviceState.CONNECTED, cause="user")
        await connection_state.mark_degraded("u1", cause="dvt_channel_dropped")
        with patch("services.connection_state.broadcast", new=AsyncMock()) as mock_bcast:
            await connection_state.mark_recovered("u1")
            mock_bcast.assert_awaited_once_with("tunnel_recovered", {"udid": "u1"})

    asyncio.run(_run())


def test_ws_observer_fires_device_disconnected_via_dedup():
    """Anything → DISCONNECTED routes through emit_device_disconnected
    so a near-simultaneous watchdog + liveness drop doesn't double-toast.

    The payload carries both ``reason`` AND ``cause`` (same value). The
    renderer's toast picker keys off ``payload.cause`` while the dedup
    map keys off ``cause``; surfacing it under both keys keeps every
    consumer happy without forcing them to fall back to ``unknown``.
    """
    from services import connection_state
    from services.connection_state import store, DeviceState

    async def _run() -> None:
        connection_state.install_ws_observer()
        await store.transition("u1", DeviceState.CONNECTED, cause="user")
        with patch(
            "services.connection_state.emit_device_disconnected",
            new=AsyncMock(),
        ) as mock_emit:
            await store.transition("u1", DeviceState.DISCONNECTED, cause="usb_removed")
            mock_emit.assert_awaited_once_with({
                "udid": "u1",
                "udids": ["u1"],
                "reason": "usb_removed",
                "cause": "usb_removed",
            })

    asyncio.run(_run())


# ─── Integration: connect_device / disconnect_device helpers ─────────

class _FakeDM:
    """Minimal DeviceManager test double exposing only what connect_device
    and disconnect_device need."""

    def __init__(self, *, fail_connect: bool = False, fail_disconnect: bool = False):
        self.connect_calls: list[str] = []
        self.disconnect_calls: list[str] = []
        self._fail_connect = fail_connect
        self._fail_disconnect = fail_disconnect

    async def connect(self, udid: str) -> None:
        self.connect_calls.append(udid)
        if self._fail_connect:
            raise RuntimeError("simulated connect failure")

    async def disconnect(self, udid: str) -> None:
        self.disconnect_calls.append(udid)
        if self._fail_disconnect:
            raise RuntimeError("simulated disconnect failure")

    async def discover_devices(self) -> list:
        class _Info:
            udid = "u1"
            name = "Test iPhone"
            ios_version = "26.5"
            connection_type = "Network"
        return [_Info()]


def test_connect_device_transitions_to_connected_with_metadata():
    """The high-level helper drives dm.connect, fetches metadata, and
    fires the transition in one shot."""
    from services import connection_state
    from services.connection_state import store, DeviceState

    dm = _FakeDM()

    async def _run() -> None:
        await connection_state.connect_device(dm, "u1", cause="user")

    asyncio.run(_run())
    assert dm.connect_calls == ["u1"]
    assert store.get("u1") == DeviceState.CONNECTED
    md = store.metadata_for("u1")
    assert md["name"] == "Test iPhone"
    assert md["connection_type"] == "Network"


def test_connect_device_skips_transition_on_dm_failure():
    """dm.connect raising should leave state at DISCONNECTED — matches
    the prior 'broadcast only on success' behavior."""
    from services import connection_state
    from services.connection_state import store, DeviceState

    dm = _FakeDM(fail_connect=True)

    async def _run() -> None:
        with pytest.raises(RuntimeError):
            await connection_state.connect_device(dm, "u1", cause="user")

    asyncio.run(_run())
    assert store.get("u1") == DeviceState.DISCONNECTED


def test_disconnect_device_transitions_even_when_dm_disconnect_fails():
    """Transport errors during disconnect are swallowed — on a device-
    lost path every close step is expected to fail. The state
    transition must still fire so the renderer sees the device leave."""
    from services import connection_state
    from services.connection_state import store, DeviceState

    dm = _FakeDM(fail_disconnect=True)

    async def _run() -> None:
        await store.transition("u1", DeviceState.CONNECTED, cause="user")
        await connection_state.disconnect_device(dm, "u1", cause="usb_removed")

    asyncio.run(_run())
    assert dm.disconnect_calls == ["u1"]
    assert store.get("u1") == DeviceState.DISCONNECTED
