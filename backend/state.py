"""Process-wide application state.

Lifted out of ``main.py`` so the entrypoint can stay focused on
HTTP wiring. Owns:

  - The DeviceManager + per-udid SimulationEngine registry
  - Persistent settings (``last_position`` / ``initial_map_position`` /
    ``coord_format``) in ``~/.gpscontroller/settings.json``
  - The CooldownTimer / BookmarkManager / CoordinateFormatter singletons
  - Auto-reconnect blocklist (UDIDs the user explicitly disconnected;
    the usbmux watchdog skips them)
  - Dual-device auto-sync (``_sync_new_device_to_primary``): when a
    secondary device connects while the primary is mid-route, replay
    the primary's in-flight snapshot on the newcomer.

A single instance is constructed in ``main.py`` and parked on
``context.ctx`` so every router can reach it without an import cycle.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import TYPE_CHECKING

from config import DEFAULT_LOCATION, SETTINGS_FILE, STATE_SAVE_INTERVAL_SEC
from core.device_manager import DeviceManager
from services.bookmarks import BookmarkManager
from services.coord_format import CoordinateFormatter
from services.cooldown import CooldownTimer

if TYPE_CHECKING:
    from core.simulation_engine import SimulationEngine

logger = logging.getLogger("gpscontroller")


class AppState:
    """Central application state — shared across API endpoints."""

    def __init__(self):
        self.device_manager = DeviceManager()
        # Per-udid simulation engines (group mode, max 2). The legacy
        # `simulation_engine` attribute still returns the most-recently-
        # created engine for single-device call sites that have not yet
        # been refactored.
        self.simulation_engines: dict[str, "SimulationEngine"] = {}
        self._primary_udid: str | None = None
        # deferred to break api↔main circular import
        from services.ws_broadcaster import broadcast
        self.cooldown_timer = CooldownTimer(broadcast=broadcast)
        self.bookmark_manager = BookmarkManager()
        self.coord_formatter = CoordinateFormatter()
        self._last_position = None
        # User-chosen initial map center (persisted between launches). When
        # None, the frontend falls back to a hardcoded default.
        self._initial_map_position: dict | None = None
        # Throttle disk writes for high-frequency position_update events
        # (~10 Hz during navigation). Interval lives in config so the
        # rationale sits next to other tunables.
        self._last_save_time: float = 0.0
        self._save_interval: float = STATE_SAVE_INTERVAL_SEC
        # UDIDs the user explicitly disconnected. The usbmux watchdog
        # respects this set: a blocked UDID is NOT auto-reconnected even
        # if usbmuxd still reports it. Unblocked when (a) the user
        # clicks Connect, (b) the frontend boots and calls the reset
        # endpoint, or (c) the backend restarts (set is in-memory only).
        self._no_auto_reconnect: set[str] = set()
        self._load_settings()

    def _load_settings(self):
        if SETTINGS_FILE.exists():
            try:
                data = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
                pos = data.get("last_position")
                if pos:
                    self._last_position = pos
                fmt = data.get("coord_format")
                if fmt:
                    from models.schemas import CoordinateFormat
                    self.coord_formatter.format = CoordinateFormat(fmt)
                imp = data.get("initial_map_position")
                if isinstance(imp, dict) and "lat" in imp and "lng" in imp:
                    self._initial_map_position = {"lat": float(imp["lat"]), "lng": float(imp["lng"])}
            except (json.JSONDecodeError, OSError, ValueError, KeyError):
                logger.warning("Settings file malformed or unreadable; using defaults", exc_info=True)

    def save_settings(self):
        data = {
            "last_position": self._last_position,
            "coord_format": self.coord_formatter.format.value,
            "initial_map_position": self._initial_map_position,
        }
        try:
            SETTINGS_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")
        except Exception as e:
            logger.warning("Failed to save settings: %s", e)

    def get_initial_position(self) -> dict:
        if self._last_position:
            return self._last_position
        # Could try IP geolocation here; fallback to default
        return DEFAULT_LOCATION

    def update_last_position(self, lat: float, lng: float):
        self._last_position = {"lat": lat, "lng": lng}
        # Throttled persistence so the position survives a server crash /
        # restart. Without this, save_settings() only runs on graceful
        # shutdown and any teleport / navigation state is lost.
        now = time.monotonic()
        if now - self._last_save_time >= self._save_interval:
            self._last_save_time = now
            self.save_settings()

    def set_initial_position(self, position: dict | None) -> None:
        """Set the persisted initial map center ({"lat","lng"} or None)."""
        self._initial_map_position = position

    def get_initial_map_position(self) -> dict | None:
        """Return the user-pinned initial map center, or None if unset.

        Distinct from :py:meth:`get_initial_position`, which falls back
        to the last device coordinate / default. Frontend's
        ``GET /api/location/settings/initial-position`` exposes only the
        persisted setting so a cleared pin (None) round-trips as null.
        """
        return self._initial_map_position

    def get_last_position(self) -> dict | None:
        """Return the device's last-known coordinate ({"lat","lng"}), or
        None if nothing has been recorded yet.

        Used by ``GET /api/location/last-device-position`` so the
        frontend can pre-render the position pin on app launch.
        """
        return self._last_position

    def block_auto_reconnect(self, udid: str) -> None:
        """Mark *udid* as 'user-disconnected' — watchdog will skip it."""
        self._no_auto_reconnect.add(udid)

    def unblock_auto_reconnect(self, udid: str) -> None:
        """Allow auto-reconnect for *udid* again (e.g. user clicked Connect)."""
        self._no_auto_reconnect.discard(udid)

    def clear_auto_reconnect_blocks(self) -> None:
        """Reset the entire blocklist (called when the frontend boots)."""
        self._no_auto_reconnect.clear()

    def is_auto_reconnect_blocked(self, udid: str) -> bool:
        return udid in self._no_auto_reconnect

    def clear_position_settings(self) -> None:
        """Clear both the initial map center and the last-known device position."""
        self._initial_map_position = None
        self._last_position = None

    @property
    def simulation_engine(self):
        """Legacy accessor: the most-recently-created engine.
        Prefer get_engine(udid) in new code."""
        if self._primary_udid and self._primary_udid in self.simulation_engines:
            return self.simulation_engines[self._primary_udid]
        return None

    def get_engine(self, udid: str | None):
        """Return the engine for *udid*, or the primary engine if udid is None."""
        if udid is None:
            return self.simulation_engine
        return self.simulation_engines.get(udid)

    async def terminate_engine(self, udid: str, *, timeout: float = 2.0) -> None:
        """Stop and dispose of the simulation engine for *udid*.

        Guarantees that any in-flight Navigate / Loop / MultiStop /
        RandomWalk / Joystick task is cancelled before the engine is
        removed from the registry. Without this, a USB unplug during
        active simulation leaves the background task running — it keeps
        emitting ``position_update`` / ``navigation_complete`` events
        against a dead device until it eventually errors out.
        """
        engine = self.simulation_engines.get(udid)
        if engine is None:
            return
        try:
            await asyncio.wait_for(engine.stop(), timeout=timeout)
        except asyncio.TimeoutError:
            logger.warning(
                "Engine stop for %s exceeded %.1fs — forcing cleanup",
                udid, timeout,
            )
        except Exception:
            logger.exception("Engine stop for %s raised; forcing cleanup", udid)
        finally:
            self.simulation_engines.pop(udid, None)
            if self._primary_udid == udid:
                self._primary_udid = next(iter(self.simulation_engines), None)

    async def create_engine_for_device(self, udid: str):
        """Create a SimulationEngine for the connected device.

        The engine is left idle — no virtual location is pushed to the
        iPhone until the user explicitly triggers a teleport / navigate /
        bookmark / joystick action. This preserves the phone's real GPS
        reading on pure connect and avoids silently overwriting it with a
        stale saved position.

        Primary-device slot rule: the first connected device becomes
        primary. Subsequent connections are tracked as secondaries — they
        do not hijack the map-view focus.
        """
        from core.simulation_engine import SimulationEngine
        from services.ws_broadcaster import broadcast

        loc_service = await self.device_manager.get_location_service(udid)

        async def event_callback(event_type: str, data: dict):
            # Always tag emissions with udid so the frontend can route per-device.
            if isinstance(data, dict) and "udid" not in data:
                data = {**data, "udid": udid}
            await broadcast(event_type, data)
            if event_type == "position_update" and "lat" in data:
                self.update_last_position(data["lat"], data["lng"])

        engine = SimulationEngine(loc_service, event_callback)
        self.simulation_engines[udid] = engine
        # Only claim the primary slot when it's free — preserves first-
        # connected device on subsequent connections.
        became_primary = self._primary_udid is None
        if became_primary:
            self._primary_udid = udid

        logger.info(
            "Simulation engine created for device %s (primary=%s)",
            udid, became_primary,
        )

        # Dual-device auto-sync: if the primary is already running something,
        # mirror it on the newcomer so both phones end up following the same
        # plan without the user having to stop / restart.
        if not became_primary:
            await self._sync_new_device_to_primary(udid)

    async def _sync_new_device_to_primary(self, new_udid: str) -> None:
        """Replay the primary device's in-flight simulation on *new_udid*.

        Run as fire-and-forget so the connect flow doesn't block on OSRM
        route fetches. Always writes the primary's current position first so
        the newcomer starts from the same coordinate; then dispatches the
        snapshot-matching engine call on the new device's engine.
        """
        primary_udid = self._primary_udid
        if primary_udid is None or primary_udid == new_udid:
            return
        primary = self.simulation_engines.get(primary_udid)
        new_engine = self.simulation_engines.get(new_udid)
        if primary is None or new_engine is None:
            return
        snapshot = primary.snapshot
        if snapshot is None:
            # Primary is idle — nothing to mirror.
            return
        start_pos = primary.current_position
        if start_pos is None:
            return

        from models.schemas import Coordinate, MovementMode
        from services.ws_broadcaster import broadcast

        try:
            mmode = MovementMode(snapshot.movement_mode)
        except ValueError:
            logger.warning(
                "Cannot replay snapshot on %s: unknown movement_mode %r",
                new_udid, snapshot.movement_mode,
            )
            return

        async def _do_sync() -> None:
            try:
                # Anchor the secondary to the primary's current coordinate
                # so OSRM routing / random-walk origin matches.
                await new_engine.teleport(start_pos.lat, start_pos.lng)
                try:
                    await broadcast("dual_sync_start", {
                        "udid": new_udid,
                        "primary_udid": primary_udid,
                        "mode": snapshot.mode,
                    })
                except Exception:
                    logger.debug(
                        "dual_sync_start broadcast failed for %s",
                        new_udid, exc_info=True,
                    )

                if snapshot.mode == "navigate" and snapshot.destination:
                    await new_engine.navigate(
                        Coordinate(lat=snapshot.destination["lat"], lng=snapshot.destination["lng"]),
                        mmode,
                        speed_kmh=snapshot.speed_kmh,
                        speed_min_kmh=snapshot.speed_min_kmh,
                        speed_max_kmh=snapshot.speed_max_kmh,
                        straight_line=snapshot.straight_line,
                    )
                elif snapshot.mode == "loop" and snapshot.waypoints:
                    wps = [Coordinate(lat=w["lat"], lng=w["lng"]) for w in snapshot.waypoints]
                    await new_engine.start_loop(
                        wps, mmode,
                        speed_kmh=snapshot.speed_kmh,
                        speed_min_kmh=snapshot.speed_min_kmh,
                        speed_max_kmh=snapshot.speed_max_kmh,
                        pause_enabled=snapshot.pause_enabled,
                        pause_min=snapshot.pause_min,
                        pause_max=snapshot.pause_max,
                        straight_line=snapshot.straight_line,
                        lap_count=snapshot.lap_count,
                    )
                elif snapshot.mode == "multi_stop" and snapshot.waypoints:
                    wps = [Coordinate(lat=w["lat"], lng=w["lng"]) for w in snapshot.waypoints]
                    await new_engine.multi_stop(
                        wps, mmode,
                        stop_duration=snapshot.stop_duration,
                        loop=snapshot.loop_multistop,
                        speed_kmh=snapshot.speed_kmh,
                        speed_min_kmh=snapshot.speed_min_kmh,
                        speed_max_kmh=snapshot.speed_max_kmh,
                        pause_enabled=snapshot.pause_enabled,
                        pause_min=snapshot.pause_min,
                        pause_max=snapshot.pause_max,
                        straight_line=snapshot.straight_line,
                        lap_count=snapshot.lap_count,
                    )
                elif snapshot.mode == "random_walk" and snapshot.center and snapshot.radius_m:
                    await new_engine.random_walk(
                        Coordinate(lat=snapshot.center["lat"], lng=snapshot.center["lng"]),
                        snapshot.radius_m, mmode,
                        speed_kmh=snapshot.speed_kmh,
                        speed_min_kmh=snapshot.speed_min_kmh,
                        speed_max_kmh=snapshot.speed_max_kmh,
                        pause_enabled=snapshot.pause_enabled,
                        pause_min=snapshot.pause_min,
                        pause_max=snapshot.pause_max,
                        seed=snapshot.seed,
                        straight_line=snapshot.straight_line,
                    )
            except Exception:
                logger.exception(
                    "Dual-device auto-sync failed for %s (snapshot mode=%s)",
                    new_udid, snapshot.mode,
                )

        asyncio.create_task(_do_sync(), name=f"dual-sync-{new_udid}")
