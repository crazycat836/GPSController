"""Google Places (New) Text Search forward-geocoding provider.

Opt-in only: used when the renderer forwards a user-supplied API key. The
key is never persisted server-side — it arrives per request and is handed
straight to Google. A single Text Search call returns coordinates inline
(unlike Autocomplete, which needs a second Place Details call), so it drops
cleanly into the existing "search string -> list with coords" UX.

Pricing / quota are the user's responsibility (it's their key and billing
account). We therefore do NOT impose an artificial rate gate here — Google
enforces its own quota and returns 429 if exceeded.
"""

from __future__ import annotations

import logging

import httpx

from config import GOOGLE_PLACES_BASE_URL
from models.schemas import GeocodingResult
from services.http_client import GEOCODING_HTTP_TIMEOUT, make_async_client_singleton

logger = logging.getLogger(__name__)

# Field mask keeps the response (and billing SKU) lean: only what the search
# box renders + the coordinates we teleport to.
_FIELD_MASK = (
    "places.displayName,places.formattedAddress,"
    "places.location,places.types"
)

_get_client, close_client = make_async_client_singleton(
    GEOCODING_HTTP_TIMEOUT,
    headers={"Content-Type": "application/json"},
)


def _language_code(lang: str | None) -> str | None:
    """Pick the first tag from a UI language chain for Google's
    ``languageCode`` (BCP-47). ``"zh-Hant,zh-TW,zh,en"`` -> ``"zh-Hant"``."""
    if not lang:
        return None
    first = lang.split(",", 1)[0].strip()
    return first or None


def _display_name(place: dict) -> str:
    name = ((place.get("displayName") or {}).get("text") or "").strip()
    address = (place.get("formattedAddress") or "").strip()
    if name and address and name != address:
        return f"{name}, {address}"
    return name or address


async def search(
    query: str,
    api_key: str,
    limit: int = 5,
    lang: str | None = None,
) -> list[GeocodingResult]:
    """Forward geocode via Google Places Text Search (New).

    Returns ``[]`` on any failure (including an invalid / unauthorized key)
    so the endpoint keeps the "empty == unavailable" contract. Auth failures
    are logged at WARNING with the upstream body so a misconfigured key is
    diagnosable from the backend log.
    """
    headers = {
        "X-Goog-Api-Key": api_key,
        "X-Goog-FieldMask": _FIELD_MASK,
    }
    body: dict[str, object] = {"textQuery": query, "maxResultCount": min(limit, 20)}
    language_code = _language_code(lang)
    if language_code:
        body["languageCode"] = language_code

    logger.debug("Google Places search: %s", query)

    try:
        client = await _get_client()
        resp = await client.post(
            f"{GOOGLE_PLACES_BASE_URL}/places:searchText",
            headers=headers,
            json=body,
        )
        resp.raise_for_status()
        data = resp.json()
    except (httpx.ConnectError, httpx.TimeoutException) as exc:
        logger.warning("Google Places unreachable (%s): %s", type(exc).__name__, exc)
        return []
    except httpx.HTTPStatusError as exc:
        # 400/403 here almost always means a bad key, missing billing, or the
        # Places API not enabled — log the body so it's diagnosable.
        logger.warning(
            "Google Places HTTP %d: %s",
            exc.response.status_code,
            exc.response.text[:300],
        )
        return []
    except httpx.HTTPError as exc:
        logger.warning("Google Places failed (%s): %s", type(exc).__name__, exc)
        return []

    places = data.get("places") if isinstance(data, dict) else None
    if not isinstance(places, list):
        # Empty result set is a valid, non-error response (no `places` key).
        return []

    results: list[GeocodingResult] = []
    for place in places:
        try:
            loc = place.get("location") or {}
            lat = float(loc["latitude"])
            lng = float(loc["longitude"])
            display = _display_name(place)
            if not display:
                continue
            types = place.get("types") or []
            results.append(
                GeocodingResult(
                    display_name=display,
                    lat=lat,
                    lng=lng,
                    type=str(types[0]) if types else "",
                    place_name=((place.get("displayName") or {}).get("text") or "").strip(),
                )
            )
        except (KeyError, ValueError, TypeError) as exc:
            logger.warning("Skipping malformed Google place: %s", exc)

    return results
