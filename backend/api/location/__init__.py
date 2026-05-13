"""/api/location/* router aggregate.

Sub-routers each handle one concern (modes / lifecycle / cooldown /
settings / info). This module wires them up under the shared
``/api/location`` prefix so ``main.py`` can keep its single
``from api.location import router`` import.
"""

from __future__ import annotations

from fastapi import APIRouter

from api.location.cooldown import router as cooldown_router
from api.location.info import router as info_router
from api.location.lifecycle import router as lifecycle_router
from api.location.modes import router as modes_router
from api.location.settings import router as settings_router

router = APIRouter(prefix="/api/location", tags=["location"])

router.include_router(modes_router)
router.include_router(lifecycle_router)
router.include_router(cooldown_router)
router.include_router(settings_router)
router.include_router(info_router)

__all__ = ["router"]
