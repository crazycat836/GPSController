import asyncio
import logging
import os
import secrets
import time
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from api._envelope import (
    EnvelopeJSONResponse,
    http_exception_handler,
    unauthorized_response,
    validation_exception_handler,
)
from config import (
    API_HOST,
    API_PORT,
    TOKEN_FILE,
    MAX_DEVICES,
    ensure_data_dir,
)
from logging_config import setup_logging
from state import AppState
from version import __version__

# Migrate legacy ~/.locwarp → ~/.gpscontroller if needed
_old_data_dir = Path.home() / ".locwarp"
_new_data_dir = Path.home() / ".gpscontroller"
if _old_data_dir.exists() and not _new_data_dir.exists():
    try:
        _old_data_dir.rename(_new_data_dir)
    except OSError as exc:
        # cross-device or permission issue — ignore, will create fresh.
        # Log so a permissions bug doesn't silently lose persistent settings.
        logging.getLogger("gpscontroller").debug(
            "legacy data-dir rename failed (%s -> %s): %s",
            _old_data_dir, _new_data_dir, exc,
        )

# Logging setup (formatters, rotating file handler, uvicorn access filter)
# lives in `logging_config.py` so this entrypoint stays focused on app
# wiring. Returns the canonical "gpscontroller" logger.
logger = setup_logging(_new_data_dir / "logs")


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


app_state = AppState()
from context import ctx
ctx.app_state = app_state


# ── Lifespan ─────────────────────────────────────────────

@asynccontextmanager
async def lifespan(application: FastAPI):
    from services.ws_broadcaster import broadcast
    global API_TOKEN

    # ── Startup ──
    # Create ~/.gpscontroller before anything tries to write inside it
    # (TOKEN_FILE below, settings/bookmarks/routes via API). Deferred from
    # config.py module load so tests that import config don't hit disk.
    ensure_data_dir()

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

    from services.device_watchdog import usbmux_presence_watchdog
    watchdog_task = asyncio.create_task(usbmux_presence_watchdog(app_state))

    # WiFi tunnel liveness probe — TCP-pings the active tunnel's RSD endpoint
    # and tears down stale Network connections when it stops responding. The
    # existing _tunnel_watchdog only fires when the tunnel asyncio task
    # raises; this probe covers the silent-death case (iPhone leaves WiFi /
    # Mac wakes from sleep with a dead tunnel).
    from core.tunnel_liveness import tunnel_liveness_loop
    liveness_stop = asyncio.Event()
    liveness_task = asyncio.create_task(tunnel_liveness_loop(liveness_stop))

    yield

    # ── Shutdown ──
    # Signal cooperative-exit loops first, then fall back to cancel if
    # they don't unblock within the grace window.
    liveness_stop.set()
    try:
        await asyncio.wait_for(liveness_task, timeout=2.0)
    except (asyncio.TimeoutError, asyncio.CancelledError, Exception):
        liveness_task.cancel()
        try:
            await liveness_task
        except (asyncio.CancelledError, Exception):
            pass

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

    # Release the shared HTTP clients last so any in-flight request from
    # the engine teardown above completes before the pool is torn down.
    try:
        from services.geocoding import close_client as close_geocoding_client
        await close_geocoding_client()
    except Exception:
        logger.exception("shutdown: close_geocoding_client failed")
    try:
        from services.route_service import close_client as close_route_client
        await close_route_client()
    except Exception:
        logger.exception("shutdown: close_route_client failed")

    logger.info("GPSController shut down")


# ── FastAPI app ───────────────────────────────────────────

app = FastAPI(
    title="GPSController",
    version=__version__,
    description="iOS Virtual Location Simulator",
    lifespan=lifespan,
    # Every JSON response is auto-wrapped in {success, data, error, meta}
    # by EnvelopeJSONResponse. File-download endpoints that explicitly
    # return a Response(content=bytes, ...) bypass this so binary payloads
    # remain unwrapped.
    default_response_class=EnvelopeJSONResponse,
)

# Convert HTTPException + 422 RequestValidationError into the same
# error envelope shape so the frontend has a single failure shape to parse.
app.add_exception_handler(HTTPException, http_exception_handler)
app.add_exception_handler(RequestValidationError, validation_exception_handler)

app.add_middleware(
    CORSMiddleware,
    # Loopback-only API; legitimate callers are the Electron renderer
    # (app://. / file://) and the Vite dev server. A wildcard let any
    # browser tab on the user's machine issue requests through the
    # user-agent, which the bearer-token middleware can't catch on
    # pre-flight. Lock this down explicitly.
    allow_origins=[
        "app://.",
        "file://",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
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
            return unauthorized_response()
        return await call_next(request)


app.add_middleware(_TokenAuthMiddleware)

# Register routers
from api.device import router as device_router
from api.wifi_tunnel import router as wifi_tunnel_router
from api.location import router as location_router
from api.route import router as route_router
from api.geocode import router as geocode_router
from api.bookmarks import router as bookmarks_router
from api.websocket import router as ws_router
from api.system import router as system_router

app.include_router(device_router)
app.include_router(wifi_tunnel_router)
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
                "()": f"{__name__}._UvicornDefaultFormatter",
                "fmt": "%(asctime)s %(levelname)s %(name)s: %(message)s",
                "datefmt": "%Y-%m-%d %H:%M:%S",
                "use_colors": True,
            },
            "access": {
                "()": f"{__name__}._UvicornAccessFormatter",
                "fmt": "%(asctime)s %(levelname)s %(name)s: %(client_addr)s - \"%(request_line)s\" %(status_code)s",
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
