import re

from fastapi import APIRouter, HTTPException, Query

from api._errors import ErrorCode
from models.schemas import GeocodingResult
from services.geocoding import GeocodingService

router = APIRouter(prefix="/api/geocode", tags=["geocode"])

geocoding_service = GeocodingService()

# Allow a comma-separated list of BCP-47-ish language tags
# (e.g. `en`, `en-US`, `zh-Hant,zh-TW,zh,en`). The frontend sends a
# preference chain so Nominatim's Accept-Language lookup can fall back
# across locales. Character class is deliberately tight — only letters,
# digits, `-`, and `,` — so the value can't smuggle CR/LF or `;` into
# the Accept-Language header.
_LANG_RE = re.compile(
    r"^[A-Za-z]{1,8}(?:-[A-Za-z0-9]{1,8})*"
    r"(?:,[A-Za-z]{1,8}(?:-[A-Za-z0-9]{1,8})*)*$"
)


@router.get("/search", response_model=list[GeocodingResult])
async def search_address(
    q: str = Query(min_length=1, max_length=200),
    limit: int = Query(default=5, ge=1, le=40),
):
    return await geocoding_service.search(q, limit)


@router.get("/reverse", response_model=GeocodingResult | None)
async def reverse_geocode(
    lat: float = Query(ge=-90.0, le=90.0),
    lng: float = Query(ge=-180.0, le=180.0),
    lang: str | None = Query(default=None, max_length=64),
):
    if lang is not None and not _LANG_RE.fullmatch(lang):
        raise HTTPException(status_code=400, detail={"code": ErrorCode.INVALID_LANG.value, "message": "Invalid language tag"})
    return await geocoding_service.reverse(lat, lng, lang)
