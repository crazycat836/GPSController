import asyncio
import logging
import traceback

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from api._errors import http_err
from api.websocket import broadcast
from config import resolve_speed_profile
from services.location_service import (
    DeviceLostCause,
    DeviceLostError,
    unwrap_device_lost,
)
from context import ctx
from utils.geo import validate_coords

from models.schemas import (
    MovementMode,
    TeleportRequest,
    NavigateRequest,
    LoopRequest,
    MultiStopRequest,
    RandomWalkRequest,
    JoystickStartRequest,
    SimulationStatus,
    Coordinate,
    CooldownSettings,
    CooldownStatus,
    CoordFormatRequest,
    CoordinateFormat,
)

logger = logging.getLogger("gpscontroller")

router = APIRouter(prefix="/api/location", tags=["location"])


# Number of times to poll discover_devices when no UDID is known yet —
# covers the brief window after `usbmuxd` learns a freshly-plugged iPhone.
_DISCOVER_RETRY_ATTEMPTS = 10
_DISCOVER_RETRY_DELAY_S = 1.0


async def _resolve_target_udid(app_state, dm, requested_udid: str | None) -> str:
    """Pick the UDID to operate on, polling discover_devices if needed.

    Preference order: explicit *requested_udid* → first already-connected
    device → first discovered device (with retries). Raises an HTTPException
    with code ``no_device`` when nothing is reachable.
    """
    _log = logging.getLogger("gpscontroller")

    connected = dm.connected_udids
    target_udid = requested_udid or (connected[0] if connected else None)
    if target_udid is not None:
        return target_udid

    for attempt in range(_DISCOVER_RETRY_ATTEMPTS):
        try:
            discovered = await dm.discover_devices()
            if discovered:
                if attempt > 0:
                    _log.info("discover_devices returned device on attempt %d", attempt + 1)
                return discovered[0].udid
        except Exception:
            _log.exception("discover_devices failed during lazy rebuild (attempt %d)", attempt + 1)
        await asyncio.sleep(_DISCOVER_RETRY_DELAY_S)

    raise HTTPException(
        status_code=400,
        detail={"code": "no_device", "message": "No iOS device connected; connect via USB first"},
    )


async def _get_or_rebuild_engine(app_state, target_udid: str):
    """First-attempt rebuild on top of the existing connection.

    Returns the rebuilt engine on success, or None if the rebuild raised
    so the caller can fall through to a hard reset.
    """
    _log = logging.getLogger("gpscontroller")
    _log.info("simulation_engine missing; attempt 1 (rebuild) for %s", target_udid)
    try:
        await app_state.create_engine_for_device(target_udid)
        if app_state.simulation_engine is not None:
            _log.info("Engine rebuild succeeded on attempt 1")
            return app_state.simulation_engine
    except Exception:
        _log.exception("Engine rebuild (attempt 1) failed for %s", target_udid)
    return None


async def _force_reconnect(app_state, dm, target_udid: str):
    """Hard reset: disconnect → reconnect → rebuild. Last-resort recovery
    for the iOS 17+ "RSD tunnel alive but DVT channel stale" case.

    Returns the rebuilt engine on success or None if reconnect/rebuild fails.
    """
    _log = logging.getLogger("gpscontroller")
    _log.info("attempt 2 (hard reset) for %s", target_udid)
    try:
        try:
            await dm.disconnect(target_udid)
        except Exception:
            _log.warning("disconnect during hard reset failed; proceeding", exc_info=True)
        await dm.connect(target_udid)
        await app_state.create_engine_for_device(target_udid)
        if app_state.simulation_engine is not None:
            _log.info("Engine rebuild succeeded on attempt 2")
            return app_state.simulation_engine
    except Exception:
        _log.exception("Engine rebuild (attempt 2, hard reset) failed for %s", target_udid)
    return None


async def _engine(udid: str | None = None):
    """Return the active SimulationEngine for *udid* (or the primary one if
    unspecified), lazily rebuilding when the slot is empty."""
    app_state = ctx.app_state
    if udid is not None:
        eng = app_state.get_engine(udid)
        if eng is not None:
            return eng
    if udid is None and app_state.simulation_engine is not None:
        return app_state.simulation_engine

    dm = app_state.device_manager
    target_udid = await _resolve_target_udid(app_state, dm, udid)

    engine = await _get_or_rebuild_engine(app_state, target_udid)
    if engine is not None:
        return engine
    engine = await _force_reconnect(app_state, dm, target_udid)
    if engine is not None:
        return engine

    raise HTTPException(
        status_code=400,
        detail={
            "code": "no_device",
            "message": "Device connection invalid; try re-plugging USB or restarting GPSController (see ~/.gpscontroller/logs/backend.log)",
        },
    )


# Default user-facing message per cause. Frontend i18n keys off the
# `cause` field for localized copy; this English fallback ships with the
# raw HTTP response so curl / API clients still see something useful.
_DEVICE_LOST_MESSAGE: dict[DeviceLostCause, str] = {
    DeviceLostCause.UNKNOWN: "Device connection lost; please reconnect and try again",
    DeviceLostCause.USB_REMOVED: "USB cable disconnected; please reconnect USB",
    DeviceLostCause.WIFI_DROPPED: "WiFi tunnel lost; check that the iPhone is on the same WiFi network and try again",
    DeviceLostCause.PHONE_LOCKED: "iPhone is locked; unlock the device and try again",
    DeviceLostCause.DDI_NOT_MOUNTED: "Developer Disk Image is not mounted; reconnect the device or restart GPSController",
}


async def _handle_device_lost(exc: DeviceLostError) -> "HTTPException":
    """Disconnect the stale device, drop its engine, broadcast
    ``device_disconnected`` (with cause), and return a 503 ready to
    raise. All callers either catch ``DeviceLostError`` directly or
    extract a nested one via ``unwrap_device_lost`` before calling."""
    cause = exc.cause
    app_state = ctx.app_state
    dm = app_state.device_manager
    lost_udids = dm.connected_udids
    for udid in lost_udids:
        try:
            await dm.disconnect(udid)
            logger.info("device_lost cleanup: disconnected %s", udid)
        except Exception:
            logger.exception("device_lost cleanup: disconnect failed for %s", udid)
        # Only remove this udid's engine; the legacy `= None` setter clears
        # every engine (bad for dual mode). terminate_engine cancels any
        # in-flight task, pops the registry slot, and rotates _primary_udid.
        try:
            await app_state.terminate_engine(udid)
        except Exception:
            logger.exception("device_lost cleanup: terminate_engine failed for %s", udid)

    try:
        await broadcast("device_disconnected", {
            "udids": lost_udids,
            "reason": "device_lost",
            "cause": cause.value,
            "error": str(exc),
        })
    except Exception:
        logger.exception("Failed to broadcast device_disconnected")

    return HTTPException(
        status_code=503,
        detail={
            "code": "device_lost",
            "cause": cause.value,
            "message": _DEVICE_LOST_MESSAGE.get(cause, _DEVICE_LOST_MESSAGE[DeviceLostCause.UNKNOWN]),
        },
    )


def _cooldown():
    app_state = ctx.app_state
    return app_state.cooldown_timer


def _coord_fmt():
    app_state = ctx.app_state
    return app_state.coord_formatter


# ── Simulation modes ─────────────────────────────────────

class ApplySpeedRequest(BaseModel):
    mode: MovementMode = MovementMode.WALKING
    speed_kmh: float | None = None
    speed_min_kmh: float | None = None
    speed_max_kmh: float | None = None
    udid: str | None = None


@router.post("/apply-speed")
async def apply_speed(req: ApplySpeedRequest):
    """Hot-swap the active navigation's speed profile. The current
    _move_along_route loop re-interpolates from the current position
    with the new speed; already-completed progress is kept."""
    engine = await _engine(req.udid)
    profile = resolve_speed_profile(
        req.mode.value,
        speed_kmh=req.speed_kmh,
        speed_min_kmh=req.speed_min_kmh,
        speed_max_kmh=req.speed_max_kmh,
    )
    swapped = await engine.apply_speed(profile)
    if not swapped:
        raise HTTPException(
            status_code=400,
            detail={"code": "no_active_route",
                    "message": "No active route; cannot apply a new speed"},
        )
    return {"status": "applied", "speed_mps": profile["speed_mps"]}


@router.post("/teleport")
async def teleport(req: TeleportRequest):
    engine = await _engine(req.udid)
    cooldown = _cooldown()

    # Group mode (2+ engines): bypass cooldown entirely. The UI also locks the
    # toggle off, but the saved cooldown_enabled value is preserved so single-
    # device mode restores the user's preference automatically.
    _app_state = ctx.app_state
    dual_mode = len(_app_state.simulation_engines) >= 2

    # Enforce cooldown server-side: if enabled and currently active,
    # refuse the teleport so API clients cannot bypass the UI guard.
    if not dual_mode and cooldown.enabled and cooldown.is_active and cooldown.remaining > 0:
        raise HTTPException(
            status_code=429,
            detail={
                "code": "cooldown_active",
                "message": f"Cooldown active; wait {int(cooldown.remaining)} more seconds",
                "remaining_seconds": cooldown.remaining,
            },
        )

    old_pos = engine.current_position
    try:
        await _exec_with_retry(
            req.udid, engine, "teleport",
            lambda e: e.teleport(req.lat, req.lng),
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception("Teleport failed")
        raise http_err(500, "teleport_failed", "Teleport failed; see ~/.gpscontroller/logs/backend.log")

    # Start cooldown if enabled and there was a previous position.
    # Skipped in dual mode for the same reason the check above is skipped.
    if old_pos and cooldown.enabled and not dual_mode:
        await cooldown.start(old_pos.lat, old_pos.lng, req.lat, req.lng)

    return {"status": "ok", "lat": req.lat, "lng": req.lng}


async def _guard(coro):
    """Run an awaitable and translate DeviceLostError into the same
    broadcast + HTTP 503 flow `teleport` uses. Use on any route whose
    engine call can touch the device (location_service.set/clear),
    i.e. stop/restore/pause/resume/joystick/apply-speed."""
    try:
        return await coro
    except HTTPException:
        raise
    except DeviceLostError as exc:
        raise (await _handle_device_lost(exc))
    except Exception as exc:
        nested = unwrap_device_lost(exc)
        if nested is not None:
            raise (await _handle_device_lost(nested))
        raise


async def _exec_with_retry(udid_arg, engine, label: str, op):
    """Run ``op(engine)``. On DeviceLostError (or a wrapped one), do one
    full force-reconnect cycle and retry the op exactly once. A final
    failure funnels into ``_handle_device_lost``. Gives the device one
    more chance after a transient blip (screen-lock, WiFi roam) before
    surfacing a user-visible error. *udid_arg* (None = primary) is
    re-resolved on retry so the rebuilt engine is picked up correctly in
    dual-device mode.
    """
    try:
        return await op(engine)
    except HTTPException:
        raise
    except DeviceLostError as exc:
        first_lost = exc
    except Exception as exc:
        nested = unwrap_device_lost(exc)
        if nested is None:
            raise
        first_lost = nested

    app_state = ctx.app_state
    dm = app_state.device_manager
    try:
        target_udid = await _resolve_target_udid(app_state, dm, udid_arg)
    except HTTPException:
        # No device left to reconnect to — original DeviceLost is the truth.
        raise (await _handle_device_lost(first_lost))

    logger.warning(
        "%s failed (DeviceLost: %s); retrying once after full reconnect",
        label, first_lost,
    )
    rebuilt = await _force_reconnect(app_state, dm, target_udid)
    if rebuilt is None:
        raise (await _handle_device_lost(first_lost))

    # _force_reconnect returns the legacy primary accessor; in dual mode
    # the primary may not be target_udid's engine. Pin to the udid we
    # just rebuilt explicitly.
    target_engine = app_state.get_engine(target_udid) or rebuilt
    try:
        return await op(target_engine)
    except HTTPException:
        raise
    except DeviceLostError as exc:
        logger.warning("%s retry after full reconnect also failed", label)
        raise (await _handle_device_lost(exc))
    except Exception as exc:
        nested = unwrap_device_lost(exc)
        if nested is not None:
            raise (await _handle_device_lost(nested))
        raise


# Module-level background task set to keep strong references to fire-and-forget
# tasks. Without this, asyncio only keeps weak refs and Python can GC a task
# mid-execution (documented asyncio footgun). Tasks self-remove on completion.
_bg_tasks: set = set()


def _spawn(coro):
    task = asyncio.create_task(coro)
    _bg_tasks.add(task)

    def _on_done(t):
        _bg_tasks.discard(t)
        exc = t.exception()
        if exc is None:
            return
        # DeviceLostError is often re-raised wrapped — trigger the same
        # cleanup teleport already does so the frontend gets
        # device_disconnected instead of a silently-dead engine.
        nested = unwrap_device_lost(exc)
        if nested is not None:
            cleanup = asyncio.create_task(_handle_device_lost(nested))
            _bg_tasks.add(cleanup)
            cleanup.add_done_callback(lambda t: _bg_tasks.discard(t))
            return
        logging.getLogger("gpscontroller").exception(
            "background task crashed: %s", exc, exc_info=exc
        )

    task.add_done_callback(_on_done)
    return task


@router.post("/navigate")
async def navigate(req: NavigateRequest):
    engine = await _engine(req.udid)
    if engine.current_position is None:
        raise HTTPException(
            status_code=400,
            detail={"code": "no_position", "message": "No current position; teleport to a coordinate first"},
        )
    _spawn(engine.navigate(
        Coordinate(lat=req.lat, lng=req.lng), req.mode,
        speed_kmh=req.speed_kmh,
        speed_min_kmh=req.speed_min_kmh, speed_max_kmh=req.speed_max_kmh,
        straight_line=req.straight_line,
    ))
    return {"status": "started", "destination": {"lat": req.lat, "lng": req.lng}, "mode": req.mode}


@router.post("/loop")
async def loop(req: LoopRequest):
    engine = await _engine(req.udid)
    _spawn(engine.start_loop(
        req.waypoints, req.mode,
        speed_kmh=req.speed_kmh,
        speed_min_kmh=req.speed_min_kmh, speed_max_kmh=req.speed_max_kmh,
        pause_enabled=req.pause_enabled, pause_min=req.pause_min, pause_max=req.pause_max,
        straight_line=req.straight_line,
        lap_count=req.lap_count,
    ))
    return {"status": "started", "waypoints": len(req.waypoints), "mode": req.mode}


@router.post("/multistop")
async def multi_stop(req: MultiStopRequest):
    engine = await _engine(req.udid)
    _spawn(engine.multi_stop(
        req.waypoints, req.mode, req.stop_duration, req.loop,
        speed_kmh=req.speed_kmh,
        speed_min_kmh=req.speed_min_kmh, speed_max_kmh=req.speed_max_kmh,
        pause_enabled=req.pause_enabled, pause_min=req.pause_min, pause_max=req.pause_max,
        straight_line=req.straight_line,
        lap_count=req.lap_count,
    ))
    return {"status": "started", "stops": len(req.waypoints), "mode": req.mode}


@router.post("/randomwalk")
async def random_walk(req: RandomWalkRequest):
    engine = await _engine(req.udid)
    _spawn(engine.random_walk(
        req.center, req.radius_m, req.mode,
        speed_kmh=req.speed_kmh,
        speed_min_kmh=req.speed_min_kmh, speed_max_kmh=req.speed_max_kmh,
        pause_enabled=req.pause_enabled, pause_min=req.pause_min, pause_max=req.pause_max,
        seed=req.seed,
        straight_line=req.straight_line,
    ))
    return {"status": "started", "radius_m": req.radius_m, "mode": req.mode}


@router.post("/joystick/start")
async def joystick_start(req: JoystickStartRequest):
    engine = await _engine(req.udid)
    try:
        await _guard(engine.joystick_start(req.mode))
    except HTTPException:
        raise
    except Exception:
        logger.exception("joystick_start failed")
        raise http_err(500, "joystick_start_failed", "Joystick start failed; see ~/.gpscontroller/logs/backend.log")
    return {"status": "started", "mode": req.mode}


@router.post("/joystick/stop")
async def joystick_stop(udid: str | None = None):
    engine = await _engine(udid)
    await _guard(engine.joystick_stop())
    return {"status": "stopped"}


@router.post("/pause")
async def pause(udid: str | None = None):
    engine = await _engine(udid)
    await _guard(engine.pause())
    return {"status": "paused"}


@router.post("/resume")
async def resume(udid: str | None = None):
    engine = await _engine(udid)
    await _guard(engine.resume())
    return {"status": "resumed"}


@router.post("/restore")
async def restore(udid: str | None = None):
    engine = await _engine(udid)
    await _exec_with_retry(udid, engine, "restore", lambda e: e.restore())
    return {"status": "restored"}


@router.post("/stop")
async def stop_movement(udid: str | None = None):
    """Stop active movement without clearing the simulated location.
    Keeps the device at its last reported position instead of restoring
    real GPS. restore() is a separate endpoint for that."""
    engine = await _engine(udid)
    await _guard(engine.stop())
    return {"status": "stopped"}


@router.delete("/simulation")
async def stop_simulation(udid: str | None = None):
    """Legacy endpoint: stop + restore. Kept for backwards compatibility,
    prefer /stop (movement only) or /restore (clear location)."""
    engine = await _engine(udid)
    await _exec_with_retry(udid, engine, "restore", lambda e: e.restore())
    return {"status": "stopped"}


@router.get("/debug")
async def debug_info():
    """Debug endpoint to check engine and location service state."""
    app_state = ctx.app_state
    engine = app_state.simulation_engine
    if engine is None:
        return {"engine": None}
    loc_svc = engine.location_service
    return {
        "engine": type(engine).__name__,
        "state": engine.state.value if engine.state else None,
        "current_position": {"lat": engine.current_position.lat, "lng": engine.current_position.lng} if engine.current_position else None,
        "location_service": type(loc_svc).__name__ if loc_svc else None,
        "location_service_active": getattr(loc_svc, '_active', None),
    }


@router.get("/status", response_model=SimulationStatus)
async def get_status(udid: str | None = None):
    engine = await _engine(udid)
    status = engine.get_status()
    cooldown = _cooldown()
    cs = cooldown.get_status()
    status.cooldown_remaining = cs["remaining_seconds"]
    return status


# ── Cooldown ──────────────────────────────────────────────

@router.get("/cooldown/status", response_model=CooldownStatus, tags=["cooldown"])
async def cooldown_status():
    cd = _cooldown()
    s = cd.get_status()
    return CooldownStatus(**s)


@router.put("/cooldown/settings", tags=["cooldown"])
async def cooldown_settings(req: CooldownSettings):
    cd = _cooldown()
    cd.enabled = req.enabled
    if not req.enabled:
        await cd.dismiss()
    await cd._emit()
    return {"enabled": cd.enabled}


@router.post("/cooldown/dismiss", tags=["cooldown"])
async def cooldown_dismiss():
    cd = _cooldown()
    await cd.dismiss()
    await cd._emit()
    return {"status": "dismissed"}


# ── Coordinate format ────────────────────────────────────

@router.get("/settings/coord-format", tags=["settings"])
async def get_coord_format():
    fmt = _coord_fmt()
    return {"format": fmt.format.value}


@router.put("/settings/coord-format", tags=["settings"])
async def set_coord_format(req: CoordFormatRequest):
    fmt = _coord_fmt()
    fmt.format = req.format
    return {"format": fmt.format.value}


# --- Initial map position (persisted in settings.json) ---

class _InitialPosRequest(BaseModel):
    lat: float | None = Field(default=None, ge=-90.0, le=90.0)
    lng: float | None = Field(default=None, ge=-180.0, le=180.0)


@router.get("/settings/initial-position", tags=["settings"])
async def get_initial_position():
    app_state = ctx.app_state
    pos = app_state._initial_map_position
    return {"position": pos}  # {"position": null} or {"position": {"lat","lng"}}


@router.put("/settings/initial-position", tags=["settings"])
async def set_initial_position(req: _InitialPosRequest):
    """Pass `{lat: null, lng: null}` (or omit) to clear the custom initial
    map center and fall back to the default on next launch."""
    app_state = ctx.app_state
    if req.lat is None or req.lng is None:
        # Only clear the persisted center; preserve _last_position so the
        # frontend still gets the device's last-known coordinate on relaunch.
        new_pos: dict | None = None
    else:
        if not validate_coords(req.lat, req.lng):
            raise http_err(400, "invalid_coord", "lat must be in [-90, 90], lng in [-180, 180]")
        new_pos = {"lat": float(req.lat), "lng": float(req.lng)}
    app_state.set_initial_position(new_pos)
    app_state.save_settings()
    return {"position": new_pos}


@router.get("/last-device-position", tags=["settings"])
async def get_last_device_position():
    """Last position the device was at before the previous shutdown / crash.

    Used by the frontend on startup to pre-render the current-position pin
    instead of the empty "尚未取得目前位置" state. Returning this does NOT
    push the coordinate to the iPhone — the simulation engine stays idle
    until the user explicitly teleports / navigates (preserves the phone's
    real GPS on connect).
    """
    app_state = ctx.app_state
    return {"position": app_state._last_position}
