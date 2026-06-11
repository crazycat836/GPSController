"""Tests for api.tunnel.lifecycle._do_tunnel_start error mapping.

Regression guard: pymobiledevice3 raises ``ConnectionTerminatedError``
when the device answers the RemotePairing pair-verify with an ERROR TLV
(stale/revoked pair record, or connecting via the USB-NCM link-local
interface). That used to surface as the generic ``tunnel_spawn_failed``,
which told the user nothing actionable. It must map to the dedicated
``tunnel_pair_rejected`` code so the UI can point at re-pairing / wrong
network instead of "could not start process".
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))


class _FakeTunnelRunner:
    def __init__(self, start_exc: BaseException) -> None:
        self.lock = asyncio.Lock()
        self.task = None
        self.info = None
        self.generation = 0
        self.start = AsyncMock(side_effect=start_exc)

    def is_running(self) -> bool:
        return False


def _run_start_with(exc: BaseException) -> HTTPException:
    from api.tunnel import lifecycle

    runner = _FakeTunnelRunner(exc)
    req = lifecycle.WifiTunnelStartRequest(
        ip="192.168.10.9", port=49152, udid="00008140-TEST",
    )

    async def _run():
        with patch.object(lifecycle, "get_tunnel_runner", return_value=runner):
            await lifecycle._do_tunnel_start(req)

    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(_run())
    return excinfo.value


def test_pair_verify_rejection_maps_to_tunnel_pair_rejected():
    from pymobiledevice3.exceptions import ConnectionTerminatedError

    err = _run_start_with(ConnectionTerminatedError())
    assert err.detail["code"] == "tunnel_pair_rejected"


def test_other_spawn_failures_keep_tunnel_spawn_failed():
    err = _run_start_with(RuntimeError("boom"))
    assert err.detail["code"] == "tunnel_spawn_failed"


def test_timeout_keeps_tunnel_timeout():
    err = _run_start_with(asyncio.TimeoutError())
    assert err.detail["code"] == "tunnel_timeout"


class _FakeDeviceManager:
    def __init__(self, network_udids: list[str]) -> None:
        self._network_udids = network_udids
        self.connected_count = len(network_udids)

    def udids_by_connection_type(self, kind: str) -> list[str]:
        return list(self._network_udids) if kind == "Network" else []


def test_start_and_connect_short_circuits_when_device_already_on_wifi():
    """A device that usbmux WiFi-sync already connected (Network transport,
    own CoreDevice tunnel) does not need the manual RemotePairing tunnel —
    starting one anyway just races a second tunnel against the live one
    (or times out against a sleeping phone). The route must report
    'already_connected' without touching the tunnel runner."""
    from api.tunnel import lifecycle

    dm = _FakeDeviceManager(["UDID-A"])
    req = lifecycle.WifiTunnelStartRequest(ip="192.168.2.238", port=49152)

    async def _run():
        with (
            patch.object(lifecycle, "get_device_manager", return_value=dm),
            patch.object(
                lifecycle.connection_state.store,
                "metadata_for",
                return_value={"name": "Gary", "ios_version": "27.0"},
            ),
            patch.object(
                lifecycle, "_do_tunnel_start",
                new=AsyncMock(side_effect=AssertionError("tunnel must not start")),
            ),
        ):
            return await lifecycle.wifi_tunnel_start_and_connect(req)

    res = asyncio.run(_run())
    assert res["status"] == "already_connected"
    assert res["udid"] == "UDID-A"
    assert res["name"] == "Gary"
    assert res["connection_type"] == "Network"


def test_start_and_connect_proceeds_for_a_different_udid():
    """An explicit udid that is NOT the WiFi-connected device must still go
    through the normal tunnel start (multi-device case)."""
    from api.tunnel import lifecycle

    dm = _FakeDeviceManager(["UDID-A"])
    req = lifecycle.WifiTunnelStartRequest(
        ip="192.168.2.50", port=49152, udid="UDID-B",
    )

    async def _run():
        with (
            patch.object(lifecycle, "get_device_manager", return_value=dm),
            patch.object(
                lifecycle, "_do_tunnel_start",
                new=AsyncMock(return_value={"status": "started"}),
            ),
        ):
            return await lifecycle.wifi_tunnel_start_and_connect(req)

    # Reaching the RSD-missing check proves the short-circuit was skipped.
    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(_run())
    assert excinfo.value.detail["code"] == "tunnel_no_rsd"
