"""Forward / reverse geocoding proxy in front of Nominatim.

**Failure semantics.** Both endpoints map every upstream failure
(DNS miss, timeout, 5xx, rate-limit, malformed payload) to a
*successful* response with empty data:

  - ``GET /api/geocode/search``  → ``[]``  on any upstream failure
  - ``GET /api/geocode/reverse`` → ``null`` on any upstream failure

The 4xx responses surface only request-validation faults (e.g.
``invalid_lang``). The frontend can therefore treat an empty
result as "geocoder unavailable, fall back to coordinate display"
without parsing error envelopes.
"""

from __future__ import annotations

import logging
import re

from fastapi import APIRouter, Header, Query

from api._errors import ErrorCode, http_err
from models.schemas import GeocodingResult, Latitude, Longitude
from services.geocoding import GeocodingService

logger = logging.getLogger(__name__)

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

# Google API keys are ASCII alphanumerics plus `-`/`_`. Validating at the
# boundary (like `lang`) stops a stray newline / control char or copy-paste
# junk from being forwarded verbatim into the outbound X-Goog-Api-Key header.
_GOOGLE_KEY_RE = re.compile(r"^[A-Za-z0-9_\-]{1,256}$")


@router.get("/search", response_model=list[GeocodingResult])
async def search_address(
    q: str = Query(min_length=1, max_length=200),
    limit: int = Query(default=5, ge=1, le=40),
    lang: str | None = Query(default=None, max_length=64),
    # Forward-search provider the renderer picked in Settings. Unknown / absent
    # values fall through to the service's legacy heuristic (Google if a key is
    # present, else Photon), so older clients keep working unchanged.
    provider: str | None = Query(default=None),
    # User-supplied Google Places key (optional). Required only when the
    # provider is "google". Read from a header rather than the query string so
    # it never lands in access logs.
    google_key: str | None = Header(default=None, alias="X-Google-Key"),
):
    if lang is not None and not _LANG_RE.fullmatch(lang):
        raise http_err(400, ErrorCode.INVALID_LANG, "Invalid language tag")
    # Only the three known providers are honored; anything else (typo, stale
    # client) becomes None so the service applies its legacy default. Log the
    # coercion so a misspelled provider name is visible rather than silently
    # returning wrong-provider results.
    if provider not in ("nominatim", "photon", "google"):
        if provider is not None:
            logger.warning("Unknown geocode provider %r; using legacy default", provider)
        provider = None
    # Validate the key at the boundary. A malformed key is treated as absent
    # (the service degrades "google" to Photon) rather than a 400, preserving
    # the documented "empty == unavailable" contract instead of surfacing a
    # hard error for a mistyped key.
    if google_key is not None:
        google_key = google_key.strip()
        if not _GOOGLE_KEY_RE.fullmatch(google_key):
            google_key = None
    return await geocoding_service.search(
        q, limit, lang=lang, google_key=google_key, provider=provider
    )


@router.get("/reverse", response_model=GeocodingResult | None)
async def reverse_geocode(
    lat: Latitude,
    lng: Longitude,
    lang: str | None = Query(default=None, max_length=64),
):
    if lang is not None and not _LANG_RE.fullmatch(lang):
        raise http_err(400, ErrorCode.INVALID_LANG, "Invalid language tag")
    return await geocoding_service.reverse(lat, lng, lang)
