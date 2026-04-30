import asyncio
import json
import logging
import os
import secrets
import time
from contextlib import asynccontextmanager
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import TYPE_CHECKING

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from config import API_HOST, API_PORT, SETTINGS_FILE, TOKEN_FILE, DEFAULT_LOCATION, MAX_DEVICES
from core.device_manager import DeviceManager
from services.cooldown import CooldownTimer
from services.bookmarks import BookmarkManager
from services.coord_format import CoordinateFormatter
from version import __version__

if TYPE_CHECKING:
    from core.simulation_engine import SimulationEngine

# Migrate legacy ~/.locwarp → ~/.gpscontroller if needed
_old_data_dir = Path.home() / ".locwarp"
_new_data_dir = Path.home() / ".gpscontroller"
if _old_data_dir.exists() and not _new_data_dir.exists():
    try:
        _old_data_dir.rename(_new_data_dir)
    except OSError:
        pass  # cross-device or permission issue — ignore, will create fresh

# Configure logging — colored console + rotating file in ~/.gpscontroller/logs/
_log_fmt = "%(asctime)s [%(name)s] %(levelname)s: %(message)s"
_log_datefmt = "%Y-%m-%d %H:%M:%S"
_log_dir = _new_data_dir / "logs"


class _ColorFormatter(logging.Formatter):
    """Adds ANSI color to the level name for terminal output."""

    _COLORS = {
        logging.DEBUG: "\033[36m",     # cyan
        logging.INFO: "\033[32m",      # green
        logging.WARNING: "\033[33m",   # yellow
        logging.ERROR: "\033[31m",     # red
        logging.CRITICAL: "\033[1;31m",  # bold red
    }
    _RESET = "\033[0m"

    def format(self, record: logging.LogRecord) -> str:
        color = self._COLORS.get(record.levelno, "")
        record.levelname = f"{color}{record.levelname}{self._RESET}"
        return super().format(record)


_console_handler = logging.StreamHandler()
_console_handler.setFormatter(_ColorFormatter(_log_fmt, datefmt=_log_datefmt))

try:
    _log_dir.mkdir(parents=True, exist_ok=True)
    _file_handler = RotatingFileHandler(
        _log_dir / "backend.log",
        maxBytes=2 * 1024 * 1024,  # 2 MB
        backupCount=3,
        encoding="utf-8",
    )
    _file_handler.setFormatter(logging.Formatter(_log_fmt, datefmt=_log_datefmt))
    _file_handler.setLevel(logging.INFO)
    _handlers: list[logging.Handler] = [_console_handler, _file_handler]
except Exception:
    _handlers: list[logging.Handler] = [_console_handler]
logging.basicConfig(level=logging.INFO, handlers=_handlers, force=True)
logger = logging.getLogger("gpscontroller")

# ── Filter out noisy OPTIONS preflight requests from access log ──
class _OptionsFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        return '"OPTIONS ' not in msg

logging.getLogger("uvicorn.access").addFilter(_OptionsFilter())


# Session auth token. Generated once per backend process (see lifespan)
# and required on every /api/* request via X-GPS-Token header; WebSocket
# auth frame validates against the same value. Set to "" when running
# with GPSCONTROLLER_DEV_NOAUTH=1 for local dev convenience.
API_TOKEN: str = ""


def _is_auth_disabled() -> bool:
    return os.environ.get("GPSCONTROLLER_DEV_NOAUTH") == "1"


# Paths that don't require the token. Docs + health check stay open so
# the Electron shell can `GET /docs` to decide the backend is up.
_AUTH_EXEMPT_PATHS = frozenset({
    "/",
    "/docs",
    "/openapi.json",
    "/redoc",
    "/docs/oauth2-redirect",
})


def _write_token_file(token: str) -> None:
    """Write the session token to ~/.gpscontroller/token, mode 0600."""
    TOKEN_FILE.write_text(token, encoding="utf-8")
    try:
        os.chmod(TOKEN_FILE, 0o600)
    except OSError:
        # Windows does not honour chmod in the POSIX sense; ACLs on
        # the user profile directory still prevent cross-user reads.
        pass


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
        from api.websocket import broadcast
        self.cooldown_timer = CooldownTimer(broadcast=broadcast)
        self.bookmark_manager = BookmarkManager()
        self.coord_formatter = CoordinateFormatter()
        self._last_position = None
        # User-chosen initial map center (persisted between launches). When
        # None, the frontend falls back to a hardcoded default.
        self._initial_map_position: dict | None = None
        # Throttle disk writes for high-frequency position_update events
        # (~10 Hz during navigation) — persist at most once every 2s.
        self._last_save_time: float = 0.0
        self._save_interval: float = 2.0
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

    @simulation_engine.setter
    def simulation_engine(self, value):
        """Legacy setter. Only `= None` (clear all) is meaningful."""
        if value is None:
            self.simulation_engines.clear()
            self._primary_udid = None
        else:
            # Best-effort: stash under a synthetic key if udid unknown
            self.simulation_engines["__legacy__"] = value
            self._primary_udid = "__legacy__"

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
        from api.websocket import broadcast

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
        from api.websocket import broadcast

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


app_state = AppState()
from context import ctx
ctx.app_state = app_state


# ── Lifespan ─────────────────────────────────────────────

async def _usbmux_presence_watchdog():
    """Poll usbmuxd every 2 s for both directions:

    * **Disappearance** — a UDID present in DeviceManager._connections that
      drops off the usbmux list for 2 consecutive polls is treated as USB
      unplug: disconnect, clear simulation_engine, broadcast device_disconnected.
    * **Appearance** — a USB device showing up while we have no active
      connection triggers an auto-connect + engine rebuild, broadcasting
      device_reconnected when it succeeds. Failed attempts are throttled
      (min 5 s between retries per UDID) so we don't spam connect() while
      the device is still in the "Trust this computer?" dialog.

    WiFi (Network) devices are skipped on both sides — those are covered by
    the WiFi tunnel watchdog. Consecutive-miss debouncing protects against
    usbmuxd re-enumeration hiccups.
    """
    import asyncio
    import time
    from pymobiledevice3.usbmux import list_devices
    from api.websocket import broadcast

    miss_counts: dict[str, int] = {}
    miss_threshold = 3
    last_reconnect_attempt: dict[str, float] = {}
    reconnect_cooldown = 5.0  # seconds between retry attempts per UDID

    while True:
        await asyncio.sleep(1.0)
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
                    if miss_counts[udid] >= miss_threshold:
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
                    await broadcast("device_disconnected", {
                        "udids": lost_now,
                        "reason": "usb_unplugged",
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
                last = last_reconnect_attempt.get(udid, 0.0)
                if now - last < reconnect_cooldown:
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
                        udid, reconnect_cooldown, exc_info=True,
                    )
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("usbmux watchdog iteration crashed; continuing")


@asynccontextmanager
async def lifespan(application: FastAPI):
    import asyncio
    from api.websocket import broadcast
    global API_TOKEN

    # ── Startup ──
    if _is_auth_disabled():
        API_TOKEN = ""
        # Remove any stale token file so dev-mode frontends can't
        # accidentally pick up a value from a previous packaged run.
        try:
            TOKEN_FILE.unlink()
        except FileNotFoundError:
            pass
        except OSError:
            logger.exception("Failed to remove stale token file")
        logger.warning(
            "Auth DISABLED (GPSCONTROLLER_DEV_NOAUTH=1) — API reachable without X-GPS-Token",
        )
    else:
        API_TOKEN = secrets.token_urlsafe(32)
        try:
            _write_token_file(API_TOKEN)
            logger.info("Session token written to %s", TOKEN_FILE)
        except OSError:
            logger.exception("Failed to write token file; renderer will not be able to auth")

    logger.info("GPSController starting — scanning for devices…")
    try:
        devices = await app_state.device_manager.discover_devices()
        if devices:
            target = devices[0]
            logger.info("Found device %s (%s), auto-connecting…", target.name, target.udid)
            await app_state.device_manager.connect(target.udid)
            await app_state.create_engine_for_device(target.udid)
            logger.info("Auto-connected to %s", target.udid)
            try:
                await broadcast("device_connected", {
                    "udid": target.udid,
                    "name": target.name,
                    "ios_version": target.ios_version,
                    "connection_type": target.connection_type,
                })
            except Exception:
                logger.exception("Startup broadcast device_connected failed")
        else:
            logger.info("No iOS devices found on startup")
    except Exception:
        logger.exception("Auto-connect on startup failed (device may need manual connect)")

    watchdog_task = asyncio.create_task(_usbmux_presence_watchdog())

    yield

    # ── Shutdown ──
    watchdog_task.cancel()
    try:
        await watchdog_task
    except (asyncio.CancelledError, Exception):
        pass

    app_state.save_settings()
    # Stop all simulation engines before we drop transport. Otherwise
    # async tasks racing against `disconnect_all()` can log push failures
    # during shutdown.
    for udid in list(app_state.simulation_engines.keys()):
        try:
            await app_state.terminate_engine(udid)
        except Exception:
            logger.exception("shutdown: terminate_engine failed for %s", udid)
    await app_state.device_manager.disconnect_all()
    logger.info("GPSController shut down")


# ── FastAPI app ───────────────────────────────────────────

app = FastAPI(title="GPSController", version=__version__, description="iOS Virtual Location Simulator", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class _TokenAuthMiddleware(BaseHTTPMiddleware):
    """Gate every request by an `X-GPS-Token` header.

    Exempts a small set of health / docs paths so the Electron shell can
    probe the backend before it has read the token file. When
    GPSCONTROLLER_DEV_NOAUTH=1 is set, or a WebSocket upgrade is being
    negotiated (auth is then enforced via the first WS frame — see
    api/websocket.py), the middleware short-circuits and lets the request
    through.
    """

    async def dispatch(self, request: Request, call_next):
        if _is_auth_disabled():
            return await call_next(request)
        path = request.url.path
        if path in _AUTH_EXEMPT_PATHS:
            return await call_next(request)
        # WebSocket connects arrive as ASGI "websocket" scope; HTTP
        # middleware still sees them on the way up. Let ws paths through
        # so the router-level WebSocket handler can require the auth
        # frame itself.
        if request.scope.get("type") == "websocket":
            return await call_next(request)
        supplied = request.headers.get("x-gps-token", "")
        if not API_TOKEN or not secrets.compare_digest(supplied, API_TOKEN):
            from fastapi.responses import JSONResponse
            return JSONResponse(
                {"detail": {"code": "unauthorized", "message": "Missing or invalid X-GPS-Token"}},
                status_code=401,
            )
        return await call_next(request)


app.add_middleware(_TokenAuthMiddleware)

# Register routers
from api.device import router as device_router
from api.location import router as location_router
from api.route import router as route_router
from api.geocode import router as geocode_router
from api.bookmarks import router as bookmarks_router
from api.websocket import router as ws_router
from api.system import router as system_router

app.include_router(device_router)
app.include_router(location_router)
app.include_router(route_router)
app.include_router(geocode_router)
app.include_router(system_router)
app.include_router(bookmarks_router)
app.include_router(ws_router)


@app.get("/")
async def root():
    return {
        "name": "GPSController",
        "version": __version__,
        "status": "running",
        "initial_position": app_state.get_initial_position(),
    }



if __name__ == "__main__":
    # Custom log config: keep Uvicorn's colored output but unify the format
    _uvicorn_log_config = {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            "default": {
                "()": "uvicorn.logging.DefaultFormatter",
                "fmt": "%(asctime)s [uvicorn] %(levelprefix)s %(message)s",
                "datefmt": "%Y-%m-%d %H:%M:%S",
                "use_colors": True,
            },
            "access": {
                "()": "uvicorn.logging.AccessFormatter",
                "fmt": "%(asctime)s [uvicorn.access] %(levelprefix)s %(client_addr)s - \"%(request_line)s\" %(status_code)s",
                "datefmt": "%Y-%m-%d %H:%M:%S",
                "use_colors": True,
            },
        },
        "handlers": {
            "default": {
                "formatter": "default",
                "class": "logging.StreamHandler",
                "stream": "ext://sys.stderr",
            },
            "access": {
                "formatter": "access",
                "class": "logging.StreamHandler",
                "stream": "ext://sys.stdout",
            },
        },
        "loggers": {
            "uvicorn": {"handlers": ["default"], "level": "INFO", "propagate": False},
            "uvicorn.error": {"level": "INFO"},
            "uvicorn.access": {"handlers": ["access"], "level": "INFO", "propagate": False},
        },
    }
    uvicorn.run(
        "main:app",
        host=API_HOST,
        port=API_PORT,
        reload=False,
        log_config=_uvicorn_log_config,
    )
