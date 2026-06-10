"""Shared helpers for the /api/location/* routers — HTTP translation only.

The connection-lifecycle policy (lazy engine rebuild, hard reset,
retry-once-after-full-reconnect) lives in :mod:`services.engine_recovery`;
this module translates its domain errors into HTTP responses
(``NoDeviceError`` → 400 ``no_device``, ``DeviceLostError`` → 503
``device_lost`` with cleanup + broadcast) and hosts the background-task
spawner that survives asyncio's weak-ref GC. These primitives are shared
by every sub-router (modes, lifecycle, cooldown, settings, info) so they
live in one place.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Awaitable, Callable

from fastapi import HTTPException

from api._deps import get_app_state
from api._errors import ErrorCode, http_err
from services import connection_state, engine_recovery
from services.engine_recovery import NoDeviceError
from services.location_service import (
    DeviceLostCause,
    DeviceLostError,
    unwrap_device_lost,
)

logger = logging.getLogger("gpscontroller")

# Thin re-exports — the recovery ladder moved to services.engine_recovery;
# these aliases keep historical import/patch sites working.
_resolve_target_udid = engine_recovery.resolve_target_udid
_get_or_rebuild_engine = engine_recovery.get_or_rebuild_engine
_force_reconnect = engine_recovery.force_reconnect


async def get_engine(udid: str | None = None):
    """Return the active SimulationEngine for *udid* (or the primary one if
    unspecified), lazily rebuilding when the slot is empty. Translates the
    service-level :class:`NoDeviceError` into ``400 no_device``."""
    try:
        return await engine_recovery.acquire_engine(get_app_state(), udid)
    except NoDeviceError as exc:
        raise http_err(400, ErrorCode.NO_DEVICE, str(exc))


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
    app_state = get_app_state()
    dm = app_state.device_manager
    lost_udids = dm.connected_udids
    for udid in lost_udids:
        # disconnect_device drops the transport (swallows transport
        # errors, since on a device-lost path every close step is
        # expected to fail) and broadcasts device_disconnected via the
        # connection_state WS observer. Routed through dedup so a
        # parallel watchdog emit doesn't double-toast. ``cause`` is the
        # DeviceLostCause string ("usb_removed", "wifi_dropped", …) so
        # the renderer can localize the toast.
        await connection_state.disconnect_device(dm, udid, cause=cause.value)
        # Only remove this udid's engine; the legacy `= None` setter clears
        # every engine (bad for dual mode). terminate_engine cancels any
        # in-flight task, pops the registry slot, and rotates _primary_udid.
        try:
            await app_state.terminate_engine(udid)
        except Exception:
            logger.exception("device_lost cleanup: terminate_engine failed for %s", udid)

    return http_err(
        503, ErrorCode.DEVICE_LOST,
        _DEVICE_LOST_MESSAGE.get(cause, _DEVICE_LOST_MESSAGE[DeviceLostCause.UNKNOWN]),
        cause=cause.value,
    )


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
    """Run ``op(engine)`` with the retry-once-after-full-reconnect policy
    from :func:`services.engine_recovery.exec_with_retry`; a final
    DeviceLostError funnels into :func:`handle_device_lost` (cleanup +
    broadcast + 503) via :func:`guard`."""
    return await guard(
        engine_recovery.exec_with_retry(get_app_state(), udid_arg, engine, label, op)
    )


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
