"""Tests for the connect-with-rollback contract.

Bug 2.6 regression guard: ``connection_state.connect_device`` (or
``announce_connected`` on the WiFi-tunnel path) flips the store to
CONNECTED and broadcasts ``device_connected`` *before* the simulation
engine is built. When ``create_engine_for_device`` then raised, the
route returned 500 CONNECT_FAILED but never rolled the store back, so
``/api/device/list`` kept advertising a connected device with no engine
behind it.

The fix routes engine creation through
``connection_state.create_engine_with_rollback`` — on failure it must:

  * terminate any half-built engine,
  * disconnect the transport + transition the store back to DISCONNECTED,
  * broadcast ``device_error`` so the renderer can surface the failure,
  * re-raise so each route's existing HTTP error surface (500
    CONNECT_FAILED) is unchanged.

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


class _Info:
    """DeviceInfo-shaped double returned by discover / tunnel connect."""

    def __init__(self, udid: str = "u1") -> None:
        self.udid = udid
        self.name = "Test iPhone"
        self.ios_version = "26.5"
        self.connection_type = "USB"


class _FakeDM:
    """DeviceManager double exposing what the connect paths touch."""

    def __init__(self, udid: str = "u1") -> None:
        self._udid = udid
        self.connect_calls: list[str] = []
        self.disconnect_calls: list[str] = []
        self.connected_count = 0

    def is_connected(self, _udid: str) -> bool:
        return False

    async def connect(self, udid: str) -> None:
        self.connect_calls.append(udid)

    async def disconnect(self, udid: str) -> None:
        self.disconnect_calls.append(udid)

    async def connect_wifi_tunnel(self, _address: str, _port: int) -> _Info:
        return _Info(self._udid)

    async def discover_devices(self) -> list[_Info]:
        return [_Info(self._udid)]


class _FakeAppState:
    """AppState double whose engine factory can be told to blow up."""

    def __init__(self, dm: _FakeDM, *, fail_engine: bool = True,
                 fail_terminate: bool = False) -> None:
        self.device_manager = dm
        self._fail_engine = fail_engine
        self._fail_terminate = fail_terminate
        self.create_calls: list[str] = []
        self.terminate_calls: list[str] = []

    async def create_engine_for_device(self, udid: str) -> None:
        self.create_calls.append(udid)
        if self._fail_engine:
            raise RuntimeError("simulated engine creation failure")

    async def terminate_engine(self, udid: str) -> None:
        self.terminate_calls.append(udid)
        if self._fail_terminate:
            raise RuntimeError("simulated terminate failure")


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


def _install(app_state: _FakeAppState) -> None:
    from context import ctx
    ctx.app_state = app_state


def _device_error_calls(mock_bcast: AsyncMock) -> list[dict]:
    return [
        call.args[1] for call in mock_bcast.await_args_list
        if call.args and call.args[0] == "device_error"
    ]


# ─── Path 1: POST /api/device/{udid}/connect ─────────────────────────

def test_usb_connect_engine_failure_rolls_back_store_and_broadcasts_error():
    """Engine-creation failure must not leave the store CONNECTED: the
    rollback terminates the engine, disconnects the transport, fires
    ``device_error``, and the route still answers 500 CONNECT_FAILED."""
    from fastapi import HTTPException
    from api import device
    from services.connection_state import store, DeviceState

    dm = _FakeDM("u1")
    app_state = _FakeAppState(dm, fail_engine=True)
    _install(app_state)

    async def _run() -> AsyncMock:
        with patch(
            "services.connection_state.broadcast", new=AsyncMock(),
        ) as mock_bcast:
            with pytest.raises(HTTPException) as ei:
                await device.connect_device("u1")
            assert ei.value.status_code == 500
            assert ei.value.detail["code"] == "connect_failed"
            return mock_bcast

    mock_bcast = asyncio.run(_run())

    assert store.get("u1") == DeviceState.DISCONNECTED
    assert app_state.terminate_calls == ["u1"]
    assert dm.disconnect_calls == ["u1"]
    errors = _device_error_calls(mock_bcast)
    assert len(errors) == 1
    assert errors[0]["udid"] == "u1"
    assert errors[0]["stage"] == "connect"


def test_usb_connect_success_path_unchanged():
    """When the engine builds fine, the route keeps its existing
    contract: 200-shaped dict, store CONNECTED, no device_error."""
    from api import device
    from services.connection_state import store, DeviceState

    dm = _FakeDM("u1")
    app_state = _FakeAppState(dm, fail_engine=False)
    _install(app_state)

    async def _run() -> tuple[dict, AsyncMock]:
        with patch(
            "services.connection_state.broadcast", new=AsyncMock(),
        ) as mock_bcast:
            result = await device.connect_device("u1")
            return result, mock_bcast

    result, mock_bcast = asyncio.run(_run())

    assert result == {"status": "connected", "udid": "u1"}
    assert store.get("u1") == DeviceState.CONNECTED
    assert app_state.create_calls == ["u1"]
    assert app_state.terminate_calls == []
    assert dm.disconnect_calls == []
    assert _device_error_calls(mock_bcast) == []


# ─── Path 2: WiFi tunnel connect (connect_device_over_tunnel) ────────

def test_tunnel_connect_engine_failure_rolls_back_store_and_reraises():
    """Same rollback contract on the shared tunnel-connect helper (used by
    /wifi/tunnel/start-and-connect): store must not stay CONNECTED,
    device_error fires, and the engine failure re-raises unchanged so the
    route's existing 500 CONNECT_FAILED mapping still applies."""
    from api.tunnel._helpers import connect_device_over_tunnel
    from services.connection_state import store, DeviceState

    dm = _FakeDM("u-wifi")
    app_state = _FakeAppState(dm, fail_engine=True)
    _install(app_state)

    async def _run() -> AsyncMock:
        with patch(
            "services.connection_state.broadcast", new=AsyncMock(),
        ) as mock_bcast:
            with pytest.raises(RuntimeError, match="simulated engine creation failure"):
                await connect_device_over_tunnel("127.0.0.1", 49152)
            return mock_bcast

    mock_bcast = asyncio.run(_run())

    assert store.get("u-wifi") == DeviceState.DISCONNECTED
    assert app_state.terminate_calls == ["u-wifi"]
    assert dm.disconnect_calls == ["u-wifi"]
    errors = _device_error_calls(mock_bcast)
    assert len(errors) == 1
    assert errors[0]["udid"] == "u-wifi"
    assert errors[0]["stage"] == "wifi_tunnel_connect"


def test_tunnel_connect_success_path_unchanged():
    """Happy tunnel path keeps the five-key response and CONNECTED state."""
    from api.tunnel._helpers import connect_device_over_tunnel
    from services.connection_state import store, DeviceState

    dm = _FakeDM("u-wifi")
    app_state = _FakeAppState(dm, fail_engine=False)
    _install(app_state)

    async def _run() -> dict:
        with patch("services.connection_state.broadcast", new=AsyncMock()):
            return await connect_device_over_tunnel("127.0.0.1", 49152)

    result = asyncio.run(_run())

    assert result == {
        "status": "connected",
        "udid": "u-wifi",
        "name": "Test iPhone",
        "ios_version": "26.5",
        "connection_type": "Network",
    }
    assert store.get("u-wifi") == DeviceState.CONNECTED
    assert app_state.terminate_calls == []


# ─── Rollback helper unit tests ───────────────────────────────────────

def test_rollback_steps_run_independently():
    """A terminate_engine failure must not skip the disconnect or the
    device_error broadcast — mirrors the _rollback_usb_fallback teardown
    discipline."""
    from services import connection_state
    from services.connection_state import store, DeviceState

    dm = _FakeDM("u1")
    app_state = _FakeAppState(dm, fail_engine=True, fail_terminate=True)
    _install(app_state)

    async def _run() -> AsyncMock:
        await store.transition("u1", DeviceState.CONNECTED, cause="user")
        with patch(
            "services.connection_state.broadcast", new=AsyncMock(),
        ) as mock_bcast:
            await connection_state.rollback_failed_connect(
                dm, app_state, "u1",
                cause="engine_create_failed",
                stage="connect",
                error="boom",
            )
            return mock_bcast

    mock_bcast = asyncio.run(_run())

    assert store.get("u1") == DeviceState.DISCONNECTED
    assert dm.disconnect_calls == ["u1"]
    errors = _device_error_calls(mock_bcast)
    assert errors == [{"udid": "u1", "stage": "connect", "error": "boom"}]


def test_create_engine_with_rollback_reraises_original_exception():
    """The helper re-raises the engine factory's exception unchanged so
    every route's existing except-clause / ErrorCode mapping still fires."""
    from services import connection_state
    from services.connection_state import store, DeviceState

    dm = _FakeDM("u1")
    app_state = _FakeAppState(dm, fail_engine=True)
    _install(app_state)

    async def _run() -> None:
        await store.transition("u1", DeviceState.CONNECTED, cause="user")
        with patch("services.connection_state.broadcast", new=AsyncMock()):
            with pytest.raises(RuntimeError, match="simulated engine creation failure"):
                await connection_state.create_engine_with_rollback(
                    dm, app_state, "u1",
                    cause="engine_create_failed",
                    stage="connect",
                    error="boom",
                )

    asyncio.run(_run())
    assert store.get("u1") == DeviceState.DISCONNECTED
