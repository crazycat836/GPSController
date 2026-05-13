"""Status + debug endpoints under /api/location."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from api.location._helpers import get_cooldown_timer, get_engine
from context import ctx
from models.schemas import SimulationStatus

router = APIRouter()


@router.get("/debug")
async def debug_info():
    """Debug endpoint to check engine and location service state.

    Token-protected like every other endpoint, but additionally gated
    behind the dev-mode flag so production builds don't expose engine
    internals to a leaked token. Set ``GPSCONTROLLER_DEV_NOAUTH=1`` to
    enable.
    """
    import main as _main
    if not _main._is_auth_disabled():
        # In production builds the route exists but returns 404 — same
        # response a typo would produce, so the surface area is invisible
        # to anyone scanning with a leaked token.
        raise HTTPException(status_code=404)

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
        "location_service_active": loc_svc.active_state if loc_svc else None,
    }


@router.get("/status", response_model=SimulationStatus)
async def get_status(udid: str | None = None):
    engine = await get_engine(udid)
    status = engine.get_status()
    cooldown = get_cooldown_timer()
    cs = cooldown.get_status()
    status.cooldown_remaining = cs["remaining_seconds"]
    return status
