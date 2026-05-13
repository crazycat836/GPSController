"""Cooldown endpoints — server-mirrored timer status, settings, dismiss."""

from __future__ import annotations

from fastapi import APIRouter

from api.location._helpers import get_cooldown_timer
from models.schemas import CooldownSettings, CooldownStatus

router = APIRouter()


@router.get("/cooldown/status", response_model=CooldownStatus, tags=["cooldown"])
async def cooldown_status():
    cd = get_cooldown_timer()
    s = cd.get_status()
    return CooldownStatus(**s)


@router.put("/cooldown/settings", tags=["cooldown"])
async def cooldown_settings(req: CooldownSettings):
    cd = get_cooldown_timer()
    cd.enabled = req.enabled
    if not req.enabled:
        await cd.dismiss()
    await cd.notify()
    return {"enabled": cd.enabled}


@router.post("/cooldown/dismiss", tags=["cooldown"])
async def cooldown_dismiss():
    cd = get_cooldown_timer()
    await cd.dismiss()
    await cd.notify()
    return {"status": "dismissed"}
