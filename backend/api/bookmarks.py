import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from models.schemas import (
    Bookmark,
    BookmarkMoveRequest,
    BookmarkPlace,
    BookmarkTag,
    BookmarkTagRequest,
    ReorderRequest,
)
from services.geocoding import GeocodingService

router = APIRouter(prefix="/api/bookmarks", tags=["bookmarks"])

logger = logging.getLogger(__name__)
_geocoder = GeocodingService()


class BookmarkListResponse(BaseModel):
    """Combined payload for the bookmark list endpoint — places, tags, and
    bookmarks together so the frontend can hydrate state in a single call."""
    places: list[BookmarkPlace]
    tags: list[BookmarkTag]
    bookmarks: list[Bookmark]


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


async def _ensure_country(bookmark: Bookmark) -> tuple[str, str]:
    """Return ``(country_code, country)`` for *bookmark*, reverse-geocoding
    only when the client didn't already supply a country code."""
    if bookmark.country_code:
        return bookmark.country_code, bookmark.country
    return await _resolve_country(bookmark.lat, bookmark.lng)


# ── Bookmarks ─────────────────────────────────────────────

@router.get("", response_model=BookmarkListResponse)
async def list_bookmarks():
    bm = _bm()
    return {
        "places": [p.model_dump() for p in bm.list_places()],
        "tags": [t.model_dump() for t in bm.list_tags()],
        "bookmarks": [b.model_dump() for b in bm.list_bookmarks()],
    }


@router.post("", response_model=Bookmark)
async def create_bookmark(bookmark: Bookmark):
    bm = _bm()
    # Auto-fill the country flag metadata when the client didn't supply it.
    country_code, country = await _ensure_country(bookmark)
    return bm.create_bookmark(
        name=bookmark.name,
        lat=bookmark.lat,
        lng=bookmark.lng,
        address=bookmark.address,
        place_id=bookmark.place_id,
        tags=list(bookmark.tags),
        country_code=country_code,
        country=country,
    )


@router.put("/{bookmark_id}", response_model=Bookmark)
async def update_bookmark(bookmark_id: str, bookmark: Bookmark):
    bm = _bm()
    country_code, country = await _ensure_country(bookmark)
    updated = bm.update_bookmark(
        bookmark_id,
        name=bookmark.name,
        lat=bookmark.lat,
        lng=bookmark.lng,
        address=bookmark.address,
        place_id=bookmark.place_id,
        tags=list(bookmark.tags),
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
    count = bm.move_bookmarks(req.bookmark_ids, req.target_place_id)
    return {"moved": count}


@router.post("/tag")
async def tag_bookmarks(req: BookmarkTagRequest):
    bm = _bm()
    count = bm.tag_bookmarks(req.bookmark_ids, req.tag_ids_add, req.tag_ids_remove)
    return {"tagged": count}


@router.post("/backfill-flags")
async def backfill_flags():
    """Reverse-geocode and fill country_code/country for any bookmark that
    lacks them. Safe to re-run: already-populated entries are skipped."""
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


# ── Places ────────────────────────────────────────────────

@router.get("/places", response_model=list[BookmarkPlace])
async def list_places():
    return _bm().list_places()


@router.post("/places", response_model=BookmarkPlace)
async def create_place(place: BookmarkPlace):
    return _bm().create_place(name=place.name, color=place.color)


@router.put("/places/{place_id}", response_model=BookmarkPlace)
async def update_place(place_id: str, place: BookmarkPlace):
    updated = _bm().update_place(place_id, name=place.name, color=place.color)
    if not updated:
        raise HTTPException(status_code=404, detail="Place not found")
    return updated


@router.delete("/places/{place_id}")
async def delete_place(place_id: str):
    if place_id == "default":
        raise HTTPException(status_code=400, detail="Cannot delete default place")
    if not _bm().delete_place(place_id):
        raise HTTPException(status_code=404, detail="Place not found")
    return {"status": "deleted"}


@router.post("/places/reorder")
async def reorder_places(req: ReorderRequest):
    changed = _bm().reorder_places(req.ordered_ids)
    return {"reordered": changed}


# ── Tags ──────────────────────────────────────────────────

@router.get("/tags", response_model=list[BookmarkTag])
async def list_tags():
    return _bm().list_tags()


@router.post("/tags", response_model=BookmarkTag)
async def create_tag(tag: BookmarkTag):
    return _bm().create_tag(name=tag.name, color=tag.color)


@router.put("/tags/{tag_id}", response_model=BookmarkTag)
async def update_tag(tag_id: str, tag: BookmarkTag):
    updated = _bm().update_tag(tag_id, name=tag.name, color=tag.color)
    if not updated:
        raise HTTPException(status_code=404, detail="Tag not found")
    return updated


@router.delete("/tags/{tag_id}")
async def delete_tag(tag_id: str):
    if not _bm().delete_tag(tag_id):
        raise HTTPException(status_code=404, detail="Tag not found")
    return {"status": "deleted"}


@router.post("/tags/reorder")
async def reorder_tags(req: ReorderRequest):
    changed = _bm().reorder_tags(req.ordered_ids)
    return {"reordered": changed}


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
