import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from models.schemas import Bookmark, BookmarkCategory, BookmarkMoveRequest
from services.geocoding import GeocodingService

router = APIRouter(prefix="/api/bookmarks", tags=["bookmarks"])

logger = logging.getLogger(__name__)
_geocoder = GeocodingService()


def _bm():
    from main import app_state
    return app_state.bookmark_manager


async def _resolve_country(lat: float, lng: float) -> tuple[str, str]:
    """Best-effort reverse-geocode for flag display. Never raises — falls
    back to empty strings so bookmark creation is never blocked by a
    Nominatim outage."""
    try:
        res = await _geocoder.reverse(lat, lng)
    except Exception:
        logger.debug("Reverse geocode for bookmark lookup failed", exc_info=True)
        return "", ""
    if res is None:
        return "", ""
    return res.country_code or "", res.country or ""


# ── Bookmarks ─────────────────────────────────────────────

@router.get("", response_model=dict)
async def list_bookmarks():
    bm = _bm()
    return {
        "categories": [c.model_dump() for c in bm.list_categories()],
        "bookmarks": [b.model_dump() for b in bm.list_bookmarks()],
    }


@router.post("", response_model=Bookmark)
async def create_bookmark(bookmark: Bookmark):
    bm = _bm()
    # Auto-fill the country flag metadata when the client didn't supply it.
    # We run the reverse-geocode even if `address` was already provided so
    # the flag fields match the stored lat/lng rather than relying on stale
    # address strings.
    country_code = bookmark.country_code
    country = bookmark.country
    if not country_code:
        country_code, country = await _resolve_country(bookmark.lat, bookmark.lng)
    return bm.create_bookmark(
        name=bookmark.name,
        lat=bookmark.lat,
        lng=bookmark.lng,
        address=bookmark.address,
        category_id=bookmark.category_id,
        country_code=country_code,
        country=country,
    )


@router.put("/{bookmark_id}", response_model=Bookmark)
async def update_bookmark(bookmark_id: str, bookmark: Bookmark):
    bm = _bm()
    # Re-resolve the flag whenever lat/lng changed or no flag is on file.
    # Clients can still force-override by supplying country_code explicitly.
    country_code = bookmark.country_code
    country = bookmark.country
    if not country_code:
        country_code, country = await _resolve_country(bookmark.lat, bookmark.lng)
    updated = bm.update_bookmark(
        bookmark_id,
        name=bookmark.name,
        lat=bookmark.lat,
        lng=bookmark.lng,
        address=bookmark.address,
        category_id=bookmark.category_id,
        country_code=country_code,
        country=country,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Bookmark not found")
    return updated


@router.delete("/{bookmark_id}")
async def delete_bookmark(bookmark_id: str):
    bm = _bm()
    if not bm.delete_bookmark(bookmark_id):
        raise HTTPException(status_code=404, detail="Bookmark not found")
    return {"status": "deleted"}


class BatchDeleteRequest(BaseModel):
    ids: list[str]


@router.post("/batch-delete")
async def delete_bookmarks_batch(req: BatchDeleteRequest):
    """Delete many bookmarks in one request. Using POST /batch-delete (rather
    than DELETE with a body) sidesteps FastAPI/CORS + middleware quirks around
    body-bearing DELETE requests and keeps the endpoint trivially cacheable."""
    bm = _bm()
    removed = bm.delete_bookmarks(req.ids)
    return {"deleted": removed, "requested": len(req.ids)}


@router.post("/move")
async def move_bookmarks(req: BookmarkMoveRequest):
    bm = _bm()
    count = bm.move_bookmarks(req.bookmark_ids, req.target_category_id)
    return {"moved": count}


@router.post("/backfill-flags")
async def backfill_flags():
    """Reverse-geocode and fill country_code/country for any bookmark that
    lacks them. Safe to re-run: already-populated entries are skipped. The
    frontend can kick this off once on first load to enrich legacy records."""
    bm = _bm()
    filled = 0
    for b in bm.list_bookmarks():
        if b.country_code:
            continue
        cc, country = await _resolve_country(b.lat, b.lng)
        if cc:
            bm.update_bookmark(b.id, country_code=cc, country=country)
            filled += 1
    return {"filled": filled}


# ── Categories ────────────────────────────────────────────

@router.get("/categories", response_model=list[BookmarkCategory])
async def list_categories():
    bm = _bm()
    return bm.list_categories()


@router.post("/categories", response_model=BookmarkCategory)
async def create_category(cat: BookmarkCategory):
    bm = _bm()
    return bm.create_category(name=cat.name, color=cat.color)


@router.put("/categories/{cat_id}", response_model=BookmarkCategory)
async def update_category(cat_id: str, cat: BookmarkCategory):
    bm = _bm()
    updated = bm.update_category(cat_id, name=cat.name, color=cat.color)
    if not updated:
        raise HTTPException(status_code=404, detail="Category not found")
    return updated


@router.delete("/categories/{cat_id}")
async def delete_category(cat_id: str):
    bm = _bm()
    if cat_id == "default":
        raise HTTPException(status_code=400, detail="Cannot delete default category")
    if not bm.delete_category(cat_id):
        raise HTTPException(status_code=404, detail="Category not found")
    return {"status": "deleted"}


# ── Import / Export ───────────────────────────────────────

@router.get("/export")
async def export_bookmarks():
    bm = _bm()
    data = bm.export_json()
    return Response(content=data, media_type="application/json",
                    headers={"Content-Disposition": 'attachment; filename="bookmarks.json"'})


@router.post("/import")
async def import_bookmarks(data: dict):
    import json
    bm = _bm()
    count = bm.import_json(json.dumps(data))
    return {"imported": count}
