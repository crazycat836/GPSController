"""Tests for services.device_watchdog.usbmux_presence_watchdog.

Behavior under test (post no-auto-connect change):
  * Plugging in a USB device must NOT auto-connect/auto-pair it — there is
    no appearance path anymore.
  * A connected USB device that drops off the usbmux list (unplug) is still
    disconnected (disappearance detection), via connection_state.

The watchdog is an infinite loop, so each test drives it with a tiny poll
interval, lets several iterations run, then cancels.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))


class _Raw:
    """usbmux raw device entry double (serial + connection_type)."""

    def __init__(self, serial: str, connection_type: str = "USB") -> None:
        self.serial = serial
        self.connection_type = connection_type


class _StubDM:
    def __init__(self, usb_connected: set[str]) -> None:
        self._usb = set(usb_connected)

    async def snapshot_usb_udids(self) -> set[str]:
        return set(self._usb)


class _StubAppState:
    def __init__(self, dm: _StubDM) -> None:
        self.device_manager = dm
        self.terminate_calls: list[str] = []

    async def terminate_engine(self, udid: str) -> None:
        self.terminate_calls.append(udid)


async def _run_iterations(app_state: _StubAppState, present: list[_Raw]):
    from services import device_watchdog

    with (
        patch.object(device_watchdog, "_POLL_INTERVAL_S", 0.001),
        patch("pymobiledevice3.usbmux.list_devices", new=AsyncMock(return_value=present)),
        patch("services.connection_state.connect_device", new=AsyncMock()) as conn_mock,
        patch("services.connection_state.disconnect_device", new=AsyncMock()) as disc_mock,
        patch(
            "services.wifi_tunnel_service.reconnect_usb_over_wifi",
            new=AsyncMock(return_value=False),
        ),
    ):
        task = asyncio.create_task(device_watchdog.usbmux_presence_watchdog(app_state))
        await asyncio.sleep(0.08)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        return conn_mock, disc_mock


def test_watchdog_does_not_autoconnect_a_newly_plugged_usb_device():
    """A USB device that appears must NOT be auto-connected — pairing and
    connection are user-initiated only."""
    dm = _StubDM(usb_connected=set())
    app_state = _StubAppState(dm)

    conn_mock, disc_mock = asyncio.run(_run_iterations(app_state, [_Raw("u-new", "USB")]))

    conn_mock.assert_not_awaited()
    disc_mock.assert_not_awaited()


def test_watchdog_disconnects_a_connected_device_on_usb_unplug():
    """A device we hold a USB connection to that vanishes from usbmux for
    >= the miss threshold is disconnected (disappearance detection stays)."""
    dm = _StubDM(usb_connected={"u-gone"})
    app_state = _StubAppState(dm)

    # Device is no longer present on usbmux → repeated misses → disconnect.
    conn_mock, disc_mock = asyncio.run(_run_iterations(app_state, []))

    conn_mock.assert_not_awaited()
    disc_mock.assert_awaited()
    assert disc_mock.await_args.args[1] == "u-gone"
    assert "u-gone" in app_state.terminate_calls
