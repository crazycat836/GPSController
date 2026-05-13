"""User-settings endpoints — coord format, initial map position, last device position."""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, Field

from api._errors import ErrorCode, http_err
from api.location._helpers import get_coord_formatter
from context import ctx
from models.schemas import CoordFormatRequest
from utils.geo import validate_coords

router = APIRouter()


@router.get("/settings/coord-format", tags=["settings"])
async def get_coord_format():
    fmt = get_coord_formatter()
    return {"format": fmt.format.value}


@router.put("/settings/coord-format", tags=["settings"])
async def set_coord_format(req: CoordFormatRequest):
    fmt = get_coord_formatter()
    fmt.format = req.format
    return {"format": fmt.format.value}


class _InitialPosRequest(BaseModel):
    lat: float | None = Field(default=None, ge=-90.0, le=90.0)
    lng: float | None = Field(default=None, ge=-180.0, le=180.0)


@router.get("/settings/initial-position", tags=["settings"])
async def get_initial_position():
    app_state = ctx.app_state
    pos = app_state.get_initial_map_position()
    return {"position": pos}


@router.put("/settings/initial-position", tags=["settings"])
async def set_initial_position(req: _InitialPosRequest):
    """Pass `{lat: null, lng: null}` (or omit) to clear the custom initial
    map center and fall back to the default on next launch."""
    app_state = ctx.app_state
    if req.lat is None or req.lng is None:
        new_pos: dict | None = None
    else:
        if not validate_coords(req.lat, req.lng):
            raise http_err(400, ErrorCode.INVALID_COORD, "lat must be in [-90, 90], lng in [-180, 180]")
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
    return {"position": app_state.get_last_position()}
