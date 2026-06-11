"""Regression tests for the DvtProvider leak behind asyncio's
"Task was destroyed but it is pending!" (dtx-reader / DTXChannelReader).

``DvtLocationService._reconnect()`` swaps ``self._dvt`` to a freshly built
provider, but ``device_manager``'s ``conn.dvt_provider`` keeps pointing at
the OLD one. Disconnect then closed only the stale reference, so the live
DTXConnection's reader tasks were never cancelled and surfaced as GC noise
mid-simulation. The location service is the SSoT for the current provider,
so teardown must go through ``DvtLocationService.aclose()``.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))


class _FakeDvtProvider:
    def __init__(self) -> None:
        self.closed = False

    async def __aexit__(self, *_args) -> None:
        self.closed = True


def _make_service(provider):
    from services.location_service import DvtLocationService
    return DvtLocationService(provider, lockdown=object(), udid="UDID-TEST")


def test_aclose_closes_the_current_provider_after_a_reconnect_swap():
    original = _FakeDvtProvider()
    service = _make_service(original)

    swapped = _FakeDvtProvider()
    service._dvt = swapped  # what _reconnect() does on success

    asyncio.run(service.aclose())

    assert swapped.closed is True
    assert original.closed is False  # _reconnect already closed it earlier


def test_aclose_swallows_provider_close_errors():
    class _ExplodingProvider:
        async def __aexit__(self, *_args) -> None:
            raise ConnectionResetError("socket already gone")

    service = _make_service(_ExplodingProvider())
    asyncio.run(service.aclose())  # must not raise


def test_legacy_location_service_has_noop_aclose():
    from services.location_service import LegacyLocationService

    service = LegacyLocationService(object())
    asyncio.run(service.aclose())  # base-class default must exist and no-op


def test_close_connection_closes_the_swapped_provider():
    """Disconnect must close whatever provider the location service holds
    NOW — not just the conn.dvt_provider snapshot from connect time."""
    from core.device_manager import DeviceManager, _ActiveConnection

    original = _FakeDvtProvider()
    service = _make_service(original)
    swapped = _FakeDvtProvider()
    service._dvt = swapped

    conn = _ActiveConnection(
        udid="UDID-TEST",
        lockdown=object(),
        ios_version="27.0",
        dvt_provider=original,
        location_service=service,
    )

    dm = DeviceManager()
    asyncio.run(dm._close_connection("UDID-TEST", conn))

    assert swapped.closed is True
    assert original.closed is True  # conn.dvt_provider step still runs
