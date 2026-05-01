import logging
import re
import urllib.parse
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel, Field

from config import ROUTES_FILE
from models.schemas import RoutePlanRequest, SavedRoute, Coordinate
from services.route_service import RouteService
from services.gpx_service import GpxService
from services.saved_routes import SavedRoutesStore

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/route", tags=["route"])

route_service = RouteService()
gpx_service = GpxService()

# Reject GPX uploads larger than this before loading into memory. 10 MiB
# holds a long multi-day trace at 1 Hz; anything larger is either an
# accidental directory export or a DoS payload.
_MAX_GPX_BYTES = 10 * 1024 * 1024


# Single store instance for the process. The class owns the dict + lock +
# persist cycle so the route handlers stay thin.
_store = SavedRoutesStore(ROUTES_FILE)


@router.post("/plan")
async def plan_route(req: RoutePlanRequest):
    result = await route_service.get_route(req.start.lat, req.start.lng, req.end.lat, req.end.lng, req.profile)
    return result


@router.get("/saved", response_model=list[SavedRoute])
async def list_saved():
    return _store.list()


@router.post("/saved", response_model=SavedRoute)
async def save_route(route: SavedRoute):
    return await _store.add(route)


@router.delete("/saved/{route_id}")
async def delete_saved(route_id: str):
    if not await _store.delete(route_id):
        raise HTTPException(status_code=404, detail="Route not found")
    return {"status": "deleted"}


class _RouteRenameRequest(BaseModel):
    name: str = Field(max_length=512)


@router.patch("/saved/{route_id}")
async def rename_saved(route_id: str, req: _RouteRenameRequest):
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail={"code": "invalid_name", "message": "Route name must not be empty"})
    route = await _store.rename(route_id, name)
    if route is None:
        raise HTTPException(status_code=404, detail="Route not found")
    return route


@router.get("/saved/export")
async def export_all_saved_routes():
    """Export every saved route as a single JSON bundle."""
    payload = {"routes": [r.model_dump(mode="json") for r in _store.list()]}
    from fastapi.responses import Response
    import json as _json
    body = _json.dumps(payload, ensure_ascii=False, indent=2)
    return Response(content=body, media_type="application/json",
                    headers={"Content-Disposition": 'attachment; filename="gpscontroller-routes.json"'})


class _RouteImportBody(BaseModel):
    routes: list[SavedRoute] = Field(max_length=1000)


@router.post("/saved/import")
async def import_all_saved_routes(body: _RouteImportBody):
    """Merge imported routes into saved. Imports get fresh ids so they never collide."""
    imported = await _store.import_all(body.routes)
    return {"imported": imported}


@router.post("/gpx/import")
async def import_gpx(file: UploadFile = File(...)):
    # Reject oversized uploads before `await file.read()` loads the whole
    # body into memory. `file.size` is populated when the client sent a
    # Content-Length; fall back to a bounded-chunk read otherwise.
    if file.size is not None and file.size > _MAX_GPX_BYTES:
        raise HTTPException(
            status_code=413,
            detail={"code": "gpx_too_large", "message": f"GPX exceeds {_MAX_GPX_BYTES // (1024 * 1024)} MiB limit"},
        )
    content = await file.read(_MAX_GPX_BYTES + 1)
    if len(content) > _MAX_GPX_BYTES:
        raise HTTPException(
            status_code=413,
            detail={"code": "gpx_too_large", "message": f"GPX exceeds {_MAX_GPX_BYTES // (1024 * 1024)} MiB limit"},
        )
    # Most GPX exporters write UTF-8, but real-world devices ship UTF-16
    # and latin-1 too. Try the common encodings before giving up so the
    # user gets a structured 400 they can act on instead of an opaque 500
    # from an uncaught UnicodeDecodeError.
    text: str | None = None
    for encoding in ("utf-8", "utf-16", "latin-1"):
        try:
            text = content.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "gpx_decode_failed",
                "message": "GPX file is not valid UTF-8, UTF-16, or latin-1",
            },
        )
    coords = gpx_service.parse_gpx(text)
    # Strip the .gpx extension from the filename so the rename input
    # doesn't show "myroute.gpx" — the format suffix is irrelevant to the
    # in-app route name.
    raw_name = file.filename or "Imported GPX"
    base_name = raw_name.rsplit(".", 1)[0] if raw_name.lower().endswith(".gpx") else raw_name
    route = SavedRoute(
        id=str(uuid.uuid4()),
        name=base_name or "Imported GPX",
        waypoints=coords,
        profile="walking",
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    # _store.add() reassigns a fresh id + created_at and persists.
    saved = await _store.add(route)
    return {"status": "imported", "id": saved.id, "points": len(coords)}


def _ascii_safe_filename(name: str) -> str:
    """Reduce a route name to a strict ASCII filename fallback.

    HTTP headers are encoded latin-1 by ASGI servers, so raw non-ASCII
    in the ``filename="..."`` parameter blows up with UnicodeEncodeError
    and returns a 500. This strips to a safe ASCII subset for the legacy
    parameter; modern clients read the ``filename*=UTF-8''`` form below.
    """
    safe = re.sub(r"[^A-Za-z0-9_.\-]+", "_", name).strip("_.")
    return safe or "route"


@router.get("/gpx/export/{route_id}")
async def export_gpx(route_id: str):
    route = _store.get(route_id)
    if route is None:
        raise HTTPException(status_code=404, detail="Route not found")
    points = [{"lat": c.lat, "lng": c.lng} for c in route.waypoints]
    gpx_xml = gpx_service.generate_gpx(points, name=route.name)
    # RFC 5987 / RFC 6266: emit both a plain ASCII `filename` for legacy
    # clients and `filename*=UTF-8''<percent-encoded>` so modern browsers
    # save routes with Chinese / emoji / etc. names intact. Previously the
    # raw `filename="{name}.gpx"` triggered a 500 whenever the route name
    # contained non-ASCII because ASGI refuses to encode it as latin-1.
    ascii_name = _ascii_safe_filename(route.name) + ".gpx"
    utf8_encoded = urllib.parse.quote(route.name + ".gpx", safe="")
    disposition = (
        f'attachment; filename="{ascii_name}"; '
        f"filename*=UTF-8''{utf8_encoded}"
    )
    from fastapi.responses import Response
    return Response(
        content=gpx_xml,
        media_type="application/gpx+xml",
        headers={"Content-Disposition": disposition},
    )
