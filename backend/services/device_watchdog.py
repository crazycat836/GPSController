"""USB device presence watchdog.

Polls usbmuxd every ~1 s for both directions:

  * **Disappearance** — a UDID present in DeviceManager that drops off
    the usbmux list for 3 consecutive polls is treated as USB unplug:
    terminate the engine, disconnect the transport, broadcast
    ``device_disconnected``.
  * **Appearance** — a USB device showing up while we have no active
    connection triggers auto-connect + engine rebuild and broadcasts
    ``device_connected``. Failed attempts are throttled (min 5 s between
    retries per UDID) so we don't spam connect() while the device is
    still in the "Trust this computer?" dialog.

WiFi (Network) devices are skipped on both sides — those are covered by
``services.wifi_tunnel_service`` + the tunnel-liveness probe.

Lifted out of ``main.py`` so the entrypoint stays focused on app
construction. The function takes ``app_state`` explicitly instead of
reaching for a module global, which keeps the watchdog independently
testable.
"""

from __future__ import annotations

import asyncio
import logging
import time

from config import MAX_DEVICES
from services.location_service import DeviceLostCause
from services.disconnect_dedup import emit_device_disconnected
from services.ws_broadcaster import broadcast

logger = logging.getLogger("gpscontroller")


# Tuning — tight enough to feel snappy on unplug, slack enough to absorb
# usbmuxd re-enumeration hiccups.
_POLL_INTERVAL_S = 1.0
_MISS_THRESHOLD = 3
_RECONNECT_COOLDOWN_S = 5.0


async def usbmux_presence_watchdog(app_state) -> None:
    """Run forever; each iteration polls usbmuxd and reconciles state."""
    from pymobiledevice3.usbmux import list_devices

    miss_counts: dict[str, int] = {}
    last_reconnect_attempt: dict[str, float] = {}

    while True:
        await asyncio.sleep(_POLL_INTERVAL_S)
        try:
            dm = app_state.device_manager
            # Snapshot under the lock. Without this, a concurrent
            # connect()/disconnect() that mutates `_connections` from
            # another task can raise `dictionary changed size during
            # iteration` or hand us a use-after-free connection object.
            async with dm._lock:
                connected = {
                    udid for udid, conn in dm._connections.items()
                    if getattr(conn, "connection_type", "USB") == "USB"
                }

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
            for udid in connected:
                if udid in present_usb:
                    miss_counts.pop(udid, None)
                else:
                    miss_counts[udid] = miss_counts.get(udid, 0) + 1
                    if miss_counts[udid] >= _MISS_THRESHOLD:
                        lost_now.append(udid)

            if lost_now:
                logger.warning("usbmux watchdog: device(s) gone → %s", lost_now)
                for udid in lost_now:
                    miss_counts.pop(udid, None)
                    # Stop & dispose the engine *before* tearing down the
                    # transport. Otherwise the background simulation task
                    # keeps emitting position_update / navigation_complete
                    # events against a dead device.
                    try:
                        await app_state.terminate_engine(udid)
                    except Exception:
                        logger.exception("watchdog: terminate_engine failed for %s", udid)
                    try:
                        await dm.disconnect(udid)
                    except Exception:
                        logger.exception("watchdog: disconnect failed for %s", udid)
                try:
                    # Routed through emit_device_disconnected so a tunnel
                    # liveness probe that notices the same loss event ~12s
                    # later doesn't show a second toast for the same drop.
                    await emit_device_disconnected({
                        "udids": lost_now,
                        "reason": "usb_unplugged",
                        "cause": DeviceLostCause.USB_REMOVED.value,
                    })
                except Exception:
                    logger.exception("watchdog: broadcast (disconnected) failed")
                continue  # skip appearance logic this tick

            # --- Appearance (auto-connect up to MAX_DEVICES, group mode) ---
            # Auto-connect any USB device not yet connected, up to the dual-
            # device cap (config.MAX_DEVICES). The user environment is assumed
            # to only ever have their own iPhones plugged in.
            new_udids = present_usb - connected
            if not new_udids or len(connected) >= MAX_DEVICES:
                continue

            now = time.monotonic()
            for udid in new_udids:
                if dm.connected_count >= MAX_DEVICES:
                    break
                # User explicitly disconnected this UDID — respect that
                # until they click Connect, the frontend boots fresh, or
                # the backend restarts.
                if app_state.is_auto_reconnect_blocked(udid):
                    continue
                last = last_reconnect_attempt.get(udid, 0.0)
                if now - last < _RECONNECT_COOLDOWN_S:
                    continue
                last_reconnect_attempt[udid] = now
                logger.info("usbmux watchdog: new USB device %s detected, auto-connecting", udid)
                try:
                    await dm.connect(udid)
                    # Skip engine creation if one already exists (e.g. lifespan already built it)
                    if udid in app_state.simulation_engines:
                        logger.debug("watchdog: engine already exists for %s, skipping", udid)
                        last_reconnect_attempt.pop(udid, None)
                        continue
                    await app_state.create_engine_for_device(udid)
                    # Broadcast device_connected so the frontend chip row updates.
                    try:
                        devs = await dm.discover_devices()
                        info = next((d for d in devs if d.udid == udid), None)
                        await broadcast("device_connected", {
                            "udid": udid,
                            "name": info.name if info else "",
                            "ios_version": info.ios_version if info else "",
                            "connection_type": info.connection_type if info else "USB",
                        })
                    except Exception:
                        logger.exception("watchdog: broadcast (connected) failed")
                    logger.info("Auto-connect succeeded for %s", udid)
                    last_reconnect_attempt.pop(udid, None)
                except Exception:
                    logger.warning(
                        "Auto-connect for %s failed (will retry in %.0fs): likely Trust pending",
                        udid, _RECONNECT_COOLDOWN_S, exc_info=True,
                    )
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("usbmux watchdog iteration crashed; continuing")
