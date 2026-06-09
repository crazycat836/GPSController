"""Tests for api.tunnel.scan.wifi_tunnel_discover — mDNS parsing.

Regression guard: pymobiledevice3's ``ServiceInstance.addresses`` is a
``list[Address]`` (dataclass), not a list of strings. The discover route
used to treat each element as a string (``":" not in a``), which raised
``argument of type 'Address' is not iterable`` and silently killed every
mDNS discovery. These tests pin the correct ``.ip`` extraction.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))


def _make_instance(addresses):
    """Build a real pymobiledevice3 ServiceInstance with Address objects so
    the test exercises the exact types the route sees at runtime."""
    from pymobiledevice3.bonjour import ServiceInstance
    return ServiceInstance(
        instance="Johns-iPhone",
        host="Johns-iPhone.local",
        port=49152,
        addresses=addresses,
    )


def test_discover_extracts_ipv4_string_from_address_objects():
    """mDNS hit with mixed v4/v6 Address objects → a plain IPv4 string."""
    from pymobiledevice3.bonjour import Address
    from api.tunnel import scan

    inst = _make_instance([
        Address(ip="192.168.10.9", iface="en0"),
        Address(ip="fe80::1", iface="en0"),
    ])

    async def _run():
        with patch(
            "pymobiledevice3.bonjour.browse_remotepairing",
            new=AsyncMock(return_value=[inst]),
        ):
            return await scan.wifi_tunnel_discover()

    res = asyncio.run(_run())
    devices = res["devices"]
    assert len(devices) == 1
    d = devices[0]
    assert d["ip"] == "192.168.10.9"
    assert isinstance(d["ip"], str)
    assert d["port"] == 49152
    assert d["name"] == "Johns-iPhone"
    assert d["method"] == "mdns"


def test_discover_does_not_crash_and_skips_tcp_when_mdns_has_hits():
    """A successful mDNS browse must not raise (the Address bug) and must
    short-circuit the /24 TCP fallback."""
    from pymobiledevice3.bonjour import Address
    from api.tunnel import scan

    inst = _make_instance([Address(ip="10.0.0.42", iface="en0")])

    async def _run():
        with (
            patch(
                "pymobiledevice3.bonjour.browse_remotepairing",
                new=AsyncMock(return_value=[inst]),
            ),
            patch(
                "api.tunnel.scan.scan_subnet_for_port",
                new=AsyncMock(side_effect=AssertionError("TCP fallback should not run")),
            ),
        ):
            return await scan.wifi_tunnel_discover()

    res = asyncio.run(_run())
    assert res["devices"][0]["ip"] == "10.0.0.42"
