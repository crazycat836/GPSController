"""User-settings endpoints — coord format, initial map position, last device position."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from api._deps import get_app_state, get_coord_formatter
from api._errors import ErrorCode, http_err
from models.schemas import CoordFormatRequest
from utils.geo import validate_coords

router = APIRouter()


def _settings_persist_error() -> HTTPException:
    """500 raised when a settings write to disk failed. The detailed
    cause (permissions / disk full / …) is logged by
    ``AppState.save_settings``; the wire only carries the stable code."""
    return http_err(
        500, ErrorCode.SETTINGS_PERSIST_FAILED,
        "Failed to persist settings; see ~/.gpscontroller/logs/backend.log",
    )


@router.get("/settings/coord-format", tags=["settings"])
async def get_coord_format():
    fmt = get_coord_formatter()
    return {"format": fmt.format.value}


@router.put("/settings/coord-format", tags=["settings"])
async def set_coord_format(req: CoordFormatRequest):
    fmt = get_coord_formatter()
    fmt.format = req.format
    # Persist immediately — without this the new format lives only in memory
    # and is lost on a non-graceful restart (it survived only when some other
    # setting happened to flush settings.json afterward). Mirrors
    # set_initial_position, which already persists on write. Offload the
    # blocking file write so the event loop isn't stalled by disk I/O.
    if not await asyncio.to_thread(get_app_state().save_settings):
        raise _settings_persist_error()
    return {"format": fmt.format.value}


class _InitialPosRequest(BaseModel):
    lat: float | None = Field(default=None, ge=-90.0, le=90.0)
    lng: float | None = Field(default=None, ge=-180.0, le=180.0)


@router.get("/settings/initial-position", tags=["settings"])
async def get_initial_position():
    app_state = get_app_state()
    pos = app_state.get_initial_map_position()
    return {"position": pos}


@router.put("/settings/initial-position", tags=["settings"])
async def set_initial_position(req: _InitialPosRequest):
    """Pass `{lat: null, lng: null}` (or omit) to clear the custom initial
    map center and fall back to the default on next launch."""
    app_state = get_app_state()
    if req.lat is None or req.lng is None:
        new_pos: dict | None = None
    else:
        if not validate_coords(req.lat, req.lng):
            raise http_err(400, ErrorCode.INVALID_COORD, "lat must be in [-90, 90], lng in [-180, 180]")
        new_pos = {"lat": float(req.lat), "lng": float(req.lng)}
    app_state.set_initial_position(new_pos)
    if not await asyncio.to_thread(app_state.save_settings):
        raise _settings_persist_error()
    return {"position": new_pos}


class _WifiKeepaliveRequest(BaseModel):
    enabled: bool


@router.get("/settings/wifi-keepalive", tags=["settings"])
async def get_wifi_keepalive():
    """Whether the WiFi-tunnel keep-alive loop is enabled (opt-in)."""
    return {"enabled": get_app_state().get_wifi_keepalive()}


@router.put("/settings/wifi-keepalive", tags=["settings"])
async def set_wifi_keepalive(req: _WifiKeepaliveRequest):
    """Enable/disable keep-alive. When on, idle virtual locations are
    re-asserted periodically so the tunnel survives the iPhone screen
    dimming. Persisted immediately so the choice survives a restart."""
    # set_wifi_keepalive persists synchronously; run it off the event loop.
    app_state = get_app_state()
    if not await asyncio.to_thread(app_state.set_wifi_keepalive, req.enabled):
        raise _settings_persist_error()
    return {"enabled": app_state.get_wifi_keepalive()}


@router.get("/last-device-position", tags=["settings"])
async def get_last_device_position():
    """Last position the device was at before the previous shutdown / crash.

    Used by the frontend on startup to pre-render the current-position pin
    instead of the empty "尚未取得目前位置" state. Returning this does NOT
    push the coordinate to the iPhone — the simulation engine stays idle
    until the user explicitly teleports / navigates (preserves the phone's
    real GPS on connect).
    """
    return {"position": get_app_state().get_last_position()}
