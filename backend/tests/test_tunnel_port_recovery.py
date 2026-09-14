"""WiFi tunnel start recovers when RemotePairing moved to another port.

The saved / default port (49152) goes stale after the iPhone restarts.
Starting there fails; the start route now looks the real port up (mDNS,
then a scan of that one host) and retries, and reports the port that
worked so the UI can remember it.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

import api.tunnel.lifecycle as lifecycle  # noqa: E402
import services.wifi_discovery as wifi_discovery  # noqa: E402
from pymobiledevice3.exceptions import ConnectionTerminatedError  # noqa: E402


class _Runner:
    """Tunnel runner double: only ``good_port`` comes up."""

    def __init__(self, good_port: int | None, reject_port: int | None = None) -> None:
        self.good_port = good_port
        self.reject_port = reject_port
        self.tried: list[int] = []

    async def start(self, udid, ip, port, timeout=20.0):
        self.tried.append(port)
        if port == self.reject_port:
            raise ConnectionTerminatedError()
        if port != self.good_port:
            raise ConnectionRefusedError(61, "Connection refused")
        return {"rsd_address": "fd00::1", "rsd_port": 5000}


def _ports(monkeypatch, found: list[int]):
    seen = {}

    async def fake(ip, *, exclude=None):
        seen["ip"], seen["exclude"] = ip, exclude
        return found

    monkeypatch.setattr(lifecycle, "discover_remotepairing_ports", fake)
    return seen


def test_requested_port_works_without_discovery(monkeypatch):
    seen = _ports(monkeypatch, [50000])
    runner = _Runner(good_port=49152)

    info = asyncio.run(lifecycle._start_with_port_recovery(runner, "u", "192.168.1.5", 49152))

    assert info["port"] == 49152
    assert runner.tried == [49152]
    assert seen == {}


def test_stale_port_recovers_on_discovered_port(monkeypatch):
    seen = _ports(monkeypatch, [50001, 51234])
    runner = _Runner(good_port=51234)

    info = asyncio.run(lifecycle._start_with_port_recovery(runner, "u", "192.168.1.5", 49152))

    assert info == {"rsd_address": "fd00::1", "rsd_port": 5000, "port": 51234}
    assert runner.tried == [49152, 50001, 51234]
    assert seen == {"ip": "192.168.1.5", "exclude": {49152}}


def test_nothing_found_reraises_the_original_error(monkeypatch):
    _ports(monkeypatch, [])
    runner = _Runner(good_port=None)

    with pytest.raises(ConnectionRefusedError):
        asyncio.run(lifecycle._start_with_port_recovery(runner, "u", "192.168.1.5", 49152))


def test_pair_rejection_is_not_retried(monkeypatch):
    seen = _ports(monkeypatch, [50000])
    runner = _Runner(good_port=50000, reject_port=49152)

    with pytest.raises(ConnectionTerminatedError):
        asyncio.run(lifecycle._start_with_port_recovery(runner, "u", "192.168.1.5", 49152))
    assert runner.tried == [49152]
    assert seen == {}


def test_discovery_prefers_mdns_port_for_that_ip(monkeypatch):
    import pymobiledevice3.bonjour as bonjour

    async def browse(timeout=3.0):
        return [
            SimpleNamespace(port=58000, addresses=[SimpleNamespace(ip="192.168.1.9")]),
            SimpleNamespace(port=53000, addresses=[SimpleNamespace(ip="192.168.1.5")]),
        ]

    async def no_scan(*_a, **_k):
        raise AssertionError("TCP scan should not run when mDNS knows the port")

    monkeypatch.setattr(bonjour, "browse_remotepairing", browse)
    monkeypatch.setattr(wifi_discovery, "_tcp_probe", no_scan)

    assert asyncio.run(wifi_discovery.discover_remotepairing_ports("192.168.1.5", exclude={49152})) == [53000]


def test_discovery_scans_host_and_skips_lockdown_and_failed_port(monkeypatch):
    import pymobiledevice3.bonjour as bonjour

    async def browse(timeout=3.0):
        return []

    open_ports = {49152, 62078, 55555}

    async def probe(ip, port, timeout):
        return port in open_ports

    monkeypatch.setattr(bonjour, "browse_remotepairing", browse)
    monkeypatch.setattr(wifi_discovery, "_tcp_probe", probe)

    assert asyncio.run(wifi_discovery.discover_remotepairing_ports("192.168.1.5", exclude={49152})) == [55555]
