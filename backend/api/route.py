from __future__ import annotations

import json
import logging
import re
import urllib.parse
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, UploadFile, File

from api._errors import ErrorCode, http_err
from fastapi.responses import Response
from pydantic import BaseModel, Field

from config import ROUTES_FILE
from models.schemas import (
    Coordinate,
    RouteBatchDeleteRequest,
    RouteCategory,
    RouteMoveRequest,
    RoutePlanRequest,
    SavedRoute,
)
from services.route_service import RouteService
from services.gpx_service import GpxService
from services.saved_routes import ConflictPolicy, SavedRoutesStore

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/route", tags=["route"])

route_service = RouteService()
gpx_service = GpxService()

# Reject GPX uploads larger than this before loading into memory. 10 MiB
# holds a long multi-day trace at 1 Hz; anything larger is either an
# accidental directory export or a DoS payload.
_MAX_GPX_BYTES = 10 * 1024 * 1024

# Accepted Content-Type values for GPX uploads. Browsers and `curl -F`
# usually send "application/gpx+xml" or "application/xml"; some legacy
# clients emit "text/xml" and many browsers fall back to
# "application/octet-stream" when they can't infer a MIME from the
# extension. Anything outside this set is rejected before parsing.
_GPX_ALLOWED_CONTENT_TYPES = frozenset({
    "application/gpx+xml",
    "application/xml",
    "text/xml",
    "application/octet-stream",
})


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
async def save_route(
    route: SavedRoute,
    on_conflict: ConflictPolicy = "new",
):
    """Save a route. ``on_conflict`` controls what happens when a route
    with the same (case-insensitive) name already exists in the target
    category:

    * ``new`` (default, legacy behaviour) — always insert a fresh row
    * ``overwrite`` — replace the existing row in place; id, created_at,
      and sort_order are preserved so any UI references remain valid
    * ``reject`` — return 409 with the existing route so the UI can
      show its overwrite / save-as-new prompt

    Returns the freshly-saved (or overwritten) row directly to keep the
    legacy ``SavedRoute`` response contract.
    """
    result = await _store.add(route, on_conflict=on_conflict)
    if result is None:
        # on_conflict=reject + duplicate found. Surface the existing row
        # so the UI prompt can show "this name already exists, saved
        # YYYY-MM-DD — overwrite?" without a follow-up GET.
        existing = next(
            (r for r in _store.list()
             if r.category_id == route.category_id
             and r.name.strip().casefold() == route.name.strip().casefold()),
            None,
        )
        raise http_err(
            409,
            ErrorCode.ROUTE_NAME_CONFLICT,
            "A route with that name already exists in this category",
            existing_id=existing.id if existing else None,
            existing_created_at=existing.created_at if existing else None,
        )
    saved, _action = result
    return saved


@router.delete("/saved/{route_id}")
async def delete_saved(route_id: str):
    if not await _store.delete(route_id):
        raise http_err(404, ErrorCode.ROUTE_NOT_FOUND, "Route not found")
    return {"status": "deleted"}


class _RouteRenameRequest(BaseModel):
    name: str = Field(max_length=512)


@router.patch("/saved/{route_id}")
async def rename_saved(route_id: str, req: _RouteRenameRequest):
    name = req.name.strip()
    if not name:
        raise http_err(400, ErrorCode.INVALID_NAME, "Route name must not be empty")
    route = await _store.rename(route_id, name)
    if route is None:
        raise http_err(404, ErrorCode.ROUTE_NOT_FOUND, "Route not found")
    return route


@router.get("/saved/export")
async def export_all_saved_routes():
    """Export every saved route as a single JSON bundle."""
    payload = {"routes": [r.model_dump(mode="json") for r in _store.list()]}
    body = json.dumps(payload, ensure_ascii=False, indent=2)
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
    # Content-Type guard. Cheapest reject: do this before any read so a
    # bogus binary upload (a JPG renamed to .gpx, a malicious payload
    # mislabelled as some other type) never reaches gpxpy.
    content_type = (file.content_type or "").lower().split(";", 1)[0].strip()
    if content_type and content_type not in _GPX_ALLOWED_CONTENT_TYPES:
        raise http_err(400, ErrorCode.GPX_DECODE_FAILED, f"Unsupported content-type: {content_type!r}")

    # Filename extension guard. Defence-in-depth alongside the MIME
    # check — clients can spoof either, but spoofing both is rarer and
    # almost certainly intentional. Empty filename means "browser didn't
    # send one"; we accept and rely on MIME + content parsing.
    filename = (file.filename or "").lower()
    if filename and not filename.endswith(".gpx"):
        raise http_err(400, ErrorCode.GPX_DECODE_FAILED, "Filename must end in .gpx")

    # NOTE on XXE / billion-laughs: gpxpy uses xml.etree.ElementTree
    # internally, which is vulnerable to entity-expansion attacks in
    # principle. The hardened alternative is `defusedxml`, but it isn't
    # in requirements.txt and adding it just for this one endpoint isn't
    # justified for a single-user desktop app. The 10 MiB byte cap below
    # bounds the worst case — even a maliciously expanded payload can't
    # exceed that, and gpxpy's own parser short-circuits on
    # malformed XML before doing meaningful expansion. Revisit if this
    # endpoint is ever exposed to untrusted multi-tenant traffic.

    # Reject oversized uploads before `await file.read()` loads the whole
    # body into memory. `file.size` is populated when the client sent a
    # Content-Length; fall back to a bounded-chunk read otherwise.
    if file.size is not None and file.size > _MAX_GPX_BYTES:
        raise http_err(413, ErrorCode.GPX_TOO_LARGE, f"GPX exceeds {_MAX_GPX_BYTES // (1024 * 1024)} MiB limit")
    content = await file.read(_MAX_GPX_BYTES + 1)
    if len(content) > _MAX_GPX_BYTES:
        raise http_err(413, ErrorCode.GPX_TOO_LARGE, f"GPX exceeds {_MAX_GPX_BYTES // (1024 * 1024)} MiB limit")
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
        raise http_err(400, ErrorCode.GPX_DECODE_FAILED, "GPX file is not valid UTF-8, UTF-16, or latin-1")
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
    # GPX import always inserts (the user explicitly picked the file and
    # we just stripped the extension), so conflict policy is "new" — a
    # rare same-name match still ships as a fresh row rather than
    # surprising the user with an overwrite prompt mid-import.
    result = await _store.add(route, on_conflict="new")
    # on_conflict="new" never returns None, but mypy doesn't know.
    assert result is not None
    saved, _ = result
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
        raise http_err(404, ErrorCode.ROUTE_NOT_FOUND, "Route not found")
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
    return Response(
        content=gpx_xml,
        media_type="application/gpx+xml",
        headers={"Content-Disposition": disposition},
    )


# ── Categories ─────────────────────────────────────────────────────
# Mirrors the bookmark-places surface (see api/bookmarks.py) so the
# frontend's category-sidebar component can be shared once both modules
# settle on the same shape.


class _CategoryCreateRequest(BaseModel):
    name: str = Field(max_length=128)
    color: str = Field(default="#6c8cff", max_length=32)


class _CategoryUpdateRequest(BaseModel):
    name: str | None = Field(default=None, max_length=128)
    color: str | None = Field(default=None, max_length=32)


@router.get("/saved/categories", response_model=list[RouteCategory])
async def list_categories():
    return _store.list_categories()


@router.post("/saved/categories", response_model=RouteCategory)
async def create_category(req: _CategoryCreateRequest):
    name = req.name.strip()
    if not name:
        raise http_err(400, ErrorCode.INVALID_NAME, "Category name must not be empty")
    return await _store.create_category(name=name, color=req.color)


@router.put("/saved/categories/{category_id}", response_model=RouteCategory)
async def update_category(category_id: str, req: _CategoryUpdateRequest):
    name = req.name.strip() if req.name is not None else None
    if name is not None and not name:
        raise http_err(400, ErrorCode.INVALID_NAME, "Category name must not be empty")
    updated = await _store.update_category(category_id, name=name, color=req.color)
    if updated is None:
        raise http_err(404, ErrorCode.ROUTE_CATEGORY_NOT_FOUND, "Category not found")
    return updated


@router.delete("/saved/categories/{category_id}")
async def delete_category(category_id: str):
    # The preset "default" bucket is the fallback for orphaned routes after
    # any other category deletion — deleting it would leave routes pointing
    # at a non-existent category id, so the store refuses the request.
    ok = await _store.delete_category(category_id)
    if not ok:
        if category_id == "default":
            raise http_err(
                400,
                ErrorCode.ROUTE_CATEGORY_IMMUTABLE,
                "The default category cannot be deleted",
            )
        raise http_err(404, ErrorCode.ROUTE_CATEGORY_NOT_FOUND, "Category not found")
    return {"status": "deleted"}


# ── Batch operations ────────────────────────────────────────────────


@router.post("/saved/batch-delete")
async def batch_delete_routes(req: RouteBatchDeleteRequest):
    deleted = await _store.batch_delete(req.route_ids)
    return {"deleted": deleted}


@router.post("/saved/move")
async def move_routes_to_category(req: RouteMoveRequest):
    moved = await _store.move(req.route_ids, req.target_category_id)
    return {"moved": moved}


# ── Drag-reorder ────────────────────────────────────────────────────


class _RouteReorderRequest(BaseModel):
    ordered_ids: list[str]


@router.post("/saved/reorder")
async def reorder_routes(req: _RouteReorderRequest):
    """Persist a drag-reorder of route items within the current sort.
    Unknown ids are ignored — the frontend's optimistic update doesn't
    have to wait for the server to validate the id set before moving on."""
    changed = await _store.reorder_routes(req.ordered_ids)
    return {"reordered": changed}


@router.post("/saved/categories/reorder")
async def reorder_categories(req: _RouteReorderRequest):
    """Persist a drag-reorder of category items in the sidebar."""
    changed = await _store.reorder_categories(req.ordered_ids)
    return {"reordered": changed}
