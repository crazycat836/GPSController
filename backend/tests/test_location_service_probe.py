"""Tests for the public ``LocationService.probe_channel_alive`` API.

``services.device_health`` (the WS on-connect health probe) used to
reach into ``DvtLocationService._ensure_instrument`` /
``_reconnect_lock`` via ``getattr(..., None)`` — a rename would have
silently disabled the probe. The logic now lives behind the public
``probe_channel_alive`` method; these tests pin its contract:

  * success → True
  * known channel-dead exception (ConnectionTerminatedError, OSError,
    timeout, …) → False
  * unknown exception → True (never false-positive into a UI flap)
  * the probe serializes against ``_reconnect_lock`` (a held lock plus
    a short timeout reads as dead, proving the lock is honoured)
  * the legacy service's base-class default always reports alive

Uses ``asyncio.run`` so we don't depend on pytest-asyncio, and a fake
instrument (AsyncMock) instead of a real iPhone.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

from pymobiledevice3.exceptions import ConnectionTerminatedError

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))


def _make_service(*, ensure_should_raise: Exception | None = None):
    """Real DvtLocationService with a fake instrument handshake.

    Returns ``(service, ensure_mock)``. The provider/lockdown args are
    MagicMocks — probe_channel_alive never touches them directly.
    """
    from services.location_service import DvtLocationService

    ensure_mock = AsyncMock()
    if ensure_should_raise is not None:
        ensure_mock.side_effect = ensure_should_raise
    service = DvtLocationService(MagicMock(), udid="udid-probe")
    service._ensure_instrument = ensure_mock  # type: ignore[method-assign]
    return service, ensure_mock


def test_probe_returns_true_when_instrument_connects():
    service, ensure_mock = _make_service()

    alive = asyncio.run(service.probe_channel_alive())

    assert alive is True
    ensure_mock.assert_awaited_once()


def test_probe_returns_false_on_connection_terminated():
    service, _ = _make_service(
        ensure_should_raise=ConnectionTerminatedError("channel dead"),
    )

    assert asyncio.run(service.probe_channel_alive()) is False


def test_probe_returns_false_on_socket_level_error():
    service, _ = _make_service(
        ensure_should_raise=BrokenPipeError("socket gone"),
    )

    assert asyncio.run(service.probe_channel_alive()) is False


def test_probe_returns_true_on_unknown_exception():
    """Unknown errors must not be reported as a dead channel —
    false positives flap the device pill for no reason."""
    service, _ = _make_service(ensure_should_raise=ValueError("unexpected"))

    assert asyncio.run(service.probe_channel_alive()) is True


def test_probe_times_out_as_dead(monkeypatch):
    """A wedged DVT handshake must read as dead within the probe
    timeout instead of pinning the caller forever."""
    from services import location_service

    monkeypatch.setattr(location_service, "_DVT_PROBE_TIMEOUT_S", 0.05)
    service, ensure_mock = _make_service()

    async def _hang():
        await asyncio.sleep(60)
    ensure_mock.side_effect = _hang

    assert asyncio.run(service.probe_channel_alive()) is False


def test_probe_waits_on_reconnect_lock(monkeypatch):
    """The probe must serialize with ``_reconnect`` via the reconnect
    lock — with the lock held, the probe can't run the handshake and
    times out instead of racing a concurrent reconnect."""
    from services import location_service

    monkeypatch.setattr(location_service, "_DVT_PROBE_TIMEOUT_S", 0.05)
    service, ensure_mock = _make_service()

    async def _run() -> bool:
        async with service._reconnect_lock:
            return await service.probe_channel_alive()

    assert asyncio.run(_run()) is False
    ensure_mock.assert_not_awaited()


def test_legacy_service_probe_reports_alive():
    """LegacyLocationService inherits the base default: no cheap probe
    exists for the pre-iOS-17 transport, so it must report alive."""
    from services.location_service import LegacyLocationService

    service = LegacyLocationService(MagicMock())

    assert asyncio.run(service.probe_channel_alive()) is True
