"""Shared helpers for the /api/location/* routers.

Engine resolution (with lazy rebuild + hard reset), device-lost cleanup,
retry-on-DeviceLost wrappers, and a background-task spawner that survives
asyncio's weak-ref GC. These primitives are shared by every sub-router
(modes, lifecycle, cooldown, settings, info) so they live in one place.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Awaitable, Callable

from fastapi import HTTPException

from api._errors import ErrorCode, http_err
from context import ctx
from services.disconnect_dedup import emit_device_disconnected
from services.location_service import (
    DeviceLostCause,
    DeviceLostError,
    unwrap_device_lost,
)

logger = logging.getLogger("gpscontroller")

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
    connected = dm.connected_udids
    target_udid = requested_udid or (connected[0] if connected else None)
    if target_udid is not None:
        return target_udid

    for attempt in range(_DISCOVER_RETRY_ATTEMPTS):
        try:
            discovered = await dm.discover_devices()
            if discovered:
                if attempt > 0:
                    logger.info("discover_devices returned device on attempt %d", attempt + 1)
                return discovered[0].udid
        except Exception:
            logger.exception("discover_devices failed during lazy rebuild (attempt %d)", attempt + 1)
        await asyncio.sleep(_DISCOVER_RETRY_DELAY_S)

    raise http_err(400, ErrorCode.NO_DEVICE, "No iOS device connected; connect via USB first")


async def _get_or_rebuild_engine(app_state, target_udid: str):
    """First-attempt rebuild on top of an *existing* device connection.

    When the udid is only discovered (not yet in `connected_udids`),
    `create_engine_for_device` would raise "Device not connected" — log
    noise without value. Skip directly to the hard-reset path in that
    case. Otherwise attempt the lightweight rebuild and let the caller
    fall through to hard reset on failure.
    """
    if target_udid not in app_state.device_manager.connected_udids:
        logger.info(
            "simulation_engine missing for %s and device not connected; "
            "skipping attempt 1, going straight to hard reset",
            target_udid,
        )
        return None

    logger.info("simulation_engine missing; attempt 1 (rebuild) for %s", target_udid)
    try:
        await app_state.create_engine_for_device(target_udid)
        if app_state.simulation_engine is not None:
            logger.info("Engine rebuild succeeded on attempt 1")
            return app_state.simulation_engine
    except Exception:
        logger.exception("Engine rebuild (attempt 1) failed for %s", target_udid)
    return None


async def _force_reconnect(app_state, dm, target_udid: str):
    """Hard reset: disconnect → reconnect → rebuild. Last-resort recovery
    for the iOS 17+ "RSD tunnel alive but DVT channel stale" case.

    Returns the rebuilt engine on success or None if reconnect/rebuild fails.
    """
    logger.info("attempt 2 (hard reset) for %s", target_udid)
    try:
        try:
            await dm.disconnect(target_udid)
        except Exception:
            logger.warning("disconnect during hard reset failed; proceeding", exc_info=True)
        await dm.connect(target_udid)
        await app_state.create_engine_for_device(target_udid)
        if app_state.simulation_engine is not None:
            logger.info("Engine rebuild succeeded on attempt 2")
            return app_state.simulation_engine
    except Exception:
        logger.exception("Engine rebuild (attempt 2, hard reset) failed for %s", target_udid)
    return None


async def get_engine(udid: str | None = None):
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

    raise http_err(
        400,
        ErrorCode.NO_DEVICE,
        "Device connection invalid; try re-plugging USB or restarting GPSController (see ~/.gpscontroller/logs/backend.log)",
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


async def handle_device_lost(exc: DeviceLostError) -> HTTPException:
    """Disconnect the stale device, drop its engine, broadcast
    ``device_disconnected`` (with cause), and return a 503 ready to
    raise. All callers either catch ``DeviceLostError`` directly or
    extract a nested one via ``unwrap_device_lost`` before calling.
    """
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
        await emit_device_disconnected({
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
            "code": ErrorCode.DEVICE_LOST.value,
            "cause": cause.value,
            "message": _DEVICE_LOST_MESSAGE.get(cause, _DEVICE_LOST_MESSAGE[DeviceLostCause.UNKNOWN]),
        },
    )


def get_cooldown_timer():
    return ctx.app_state.cooldown_timer


def get_coord_formatter():
    return ctx.app_state.coord_formatter


async def guard(coro: Awaitable[Any]) -> Any:
    """Run an awaitable and translate DeviceLostError into the same
    broadcast + HTTP 503 flow `teleport` uses. Use on any route whose
    engine call can touch the device (location_service.set/clear),
    i.e. stop/restore/pause/resume/joystick/apply-speed."""
    try:
        return await coro
    except HTTPException:
        raise
    except DeviceLostError as exc:
        raise (await handle_device_lost(exc))
    except Exception as exc:
        nested = unwrap_device_lost(exc)
        if nested is not None:
            raise (await handle_device_lost(nested))
        raise


async def exec_with_retry(
    udid_arg: str | None,
    engine,
    label: str,
    op: Callable[[Any], Awaitable[Any]],
) -> Any:
    """Run ``op(engine)``. On DeviceLostError (or a wrapped one), do one
    full force-reconnect cycle and retry the op exactly once. A final
    failure funnels into :func:`handle_device_lost`. Gives the device one
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
        raise (await handle_device_lost(first_lost))

    logger.warning(
        "%s failed (DeviceLost: %s); retrying once after full reconnect",
        label, first_lost,
    )
    rebuilt = await _force_reconnect(app_state, dm, target_udid)
    if rebuilt is None:
        raise (await handle_device_lost(first_lost))

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
        raise (await handle_device_lost(exc))
    except Exception as exc:
        nested = unwrap_device_lost(exc)
        if nested is not None:
            raise (await handle_device_lost(nested))
        raise


# Module-level background task set to keep strong references to fire-and-forget
# tasks. Without this, asyncio only keeps weak refs and Python can GC a task
# mid-execution (documented asyncio footgun). Tasks self-remove on completion.
_bg_tasks: set[asyncio.Task] = set()


def spawn(coro: Awaitable[Any]) -> asyncio.Task:
    task = asyncio.create_task(coro)
    _bg_tasks.add(task)

    def _on_done(t: asyncio.Task) -> None:
        _bg_tasks.discard(t)
        exc = t.exception()
        if exc is None:
            return
        # DeviceLostError is often re-raised wrapped — trigger the same
        # cleanup teleport already does so the frontend gets
        # device_disconnected instead of a silently-dead engine.
        nested = unwrap_device_lost(exc)
        if nested is not None:
            cleanup = asyncio.create_task(handle_device_lost(nested))
            _bg_tasks.add(cleanup)
            cleanup.add_done_callback(lambda t: _bg_tasks.discard(t))
            return
        logger.exception("background task crashed: %s", exc, exc_info=exc)

    task.add_done_callback(_on_done)
    return task
