"""/api/device/wifi/* router aggregate.

Sub-routers each handle one concern (scan / pair / lifecycle). This
module wires them up under the shared ``/api/device`` prefix so
``main.py`` can use a single ``from api.tunnel import router`` import.
"""

from __future__ import annotations

from fastapi import APIRouter

from api.tunnel.lifecycle import router as lifecycle_router
from api.tunnel.pair import router as pair_router
from api.tunnel.scan import router as scan_router

router = APIRouter(prefix="/api/device", tags=["device"])

router.include_router(scan_router)
router.include_router(pair_router)
router.include_router(lifecycle_router)

__all__ = ["router"]
