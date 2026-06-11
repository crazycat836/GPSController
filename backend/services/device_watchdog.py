"""USB device presence watchdog.

Polls usbmuxd every ~1 s and reconciles **disappearance only**:

  * **Disappearance** — a UDID present in DeviceManager that drops off the
    usbmux list for 3 consecutive polls is treated as a USB unplug. If a
    live WiFi tunnel is up the device is moved onto it (USB→WiFi fallback);
    otherwise its engine + transport are torn down and
    ``device_disconnected`` is broadcast.

There is deliberately **no appearance/auto-connect** path: plugging in a
USB device must NOT auto-pair (no "Trust This Computer" prompt) or
auto-connect. Pairing + connection happen only when the user explicitly
connects a device from the UI (``api/device.py`` connect route →
``DeviceManager.connect`` with ``autopair=True``). Listing a freshly
plugged device is handled by ``discover_devices`` (which uses
``autopair=False`` so it never pairs).

WiFi (Network) devices are skipped here — those are covered by
``services.wifi_tunnel_service`` + the tunnel-liveness probe.

Lifted out of ``main.py`` so the entrypoint stays focused on app
construction. The function takes ``app_state`` explicitly instead of
reaching for a module global, which keeps the watchdog independently
testable.

Layering: part of the **connection-orchestration group** (see
``tools/check_layers.py``) — a runtime loop that may depend on both
``core/`` and ``services/``. It deliberately does NOT import
``context.ctx``; ``app_state`` arrives as a parameter from the lifespan.
"""

from __future__ import annotations

import asyncio
import logging

from services import connection_state
from services.location_service import DeviceLostCause

logger = logging.getLogger("gpscontroller")


# Tuning — tight enough to feel snappy on unplug, slack enough to absorb
# usbmuxd re-enumeration hiccups.
_POLL_INTERVAL_S = 1.0
_MISS_THRESHOLD = 3


async def usbmux_presence_watchdog(app_state) -> None:
    """Run forever; each iteration polls usbmuxd and reconciles disappearance."""
    from pymobiledevice3.usbmux import list_devices

    miss_counts: dict[str, int] = {}

    while True:
        await asyncio.sleep(_POLL_INTERVAL_S)
        try:
            dm = app_state.device_manager
            # Snapshot under the lock via the public accessor. Only USB
            # connections can fall off the usbmux list on unplug, so the
            # USB-only snapshot is exactly the set to watch for disappearance.
            connected_usb = await dm.snapshot_usb_udids()

            try:
                raw = await list_devices()
            except Exception:
                logger.debug("usbmux list_devices failed in watchdog", exc_info=True)
                continue
            present_usb = {
                r.serial for r in raw
                if getattr(r, "connection_type", "USB") == "USB"
            }

            # --- Disappearance detection ---
            lost_now: list[str] = []
            for udid in connected_usb:
                if udid in present_usb:
                    miss_counts.pop(udid, None)
                else:
                    miss_counts[udid] = miss_counts.get(udid, 0) + 1
                    if miss_counts[udid] >= _MISS_THRESHOLD:
                        lost_now.append(udid)

            if not lost_now:
                continue

            logger.warning("usbmux watchdog: device(s) gone → %s", lost_now)
            from services.wifi_tunnel_service import reconnect_usb_over_wifi
            for udid in lost_now:
                miss_counts.pop(udid, None)
                # USB→WiFi fallback: if a live WiFi tunnel is up, move the
                # device onto it instead of fully disconnecting. No-op
                # (returns False) when no tunnel is running, so the plain
                # re-plug path below stays the default. This keeps an
                # *existing* session alive across a USB drop — it is not an
                # auto-connect of a freshly plugged device.
                try:
                    if await reconnect_usb_over_wifi(udid):
                        logger.info("usbmux watchdog: %s fell back to WiFi tunnel", udid)
                        continue
                except Exception:
                    logger.exception("watchdog: WiFi fallback raised for %s", udid)
                # Stop & dispose the engine *before* tearing down the
                # transport. Otherwise the background simulation task keeps
                # emitting position_update / navigation_complete events
                # against a dead device.
                try:
                    await app_state.terminate_engine(udid)
                except Exception:
                    logger.exception("watchdog: terminate_engine failed for %s", udid)
                # Single call: drops the transport AND broadcasts
                # device_disconnected via the connection_state WS observer
                # (which routes through dedup so a near-simultaneous
                # tunnel-liveness emit doesn't double-toast).
                await connection_state.disconnect_device(
                    dm, udid, cause=DeviceLostCause.USB_REMOVED.value,
                )
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("usbmux watchdog iteration crashed; continuing")
