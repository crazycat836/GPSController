"""Photon forward-geocoding provider.

Photon (https://photon.komoot.io) is the default search backend: keyless,
OSM-backed, and built for typeahead — it tolerates typos and partial input
far better than Nominatim, which makes the search box feel responsive.

Only *forward* search lives here. Reverse geocoding (country-flag lookup)
stays on Nominatim in :mod:`services.geocoding`, so this module is a pure
add-on with no behavioural overlap.
"""

from __future__ import annotations

import logging

import httpx

from config import PHOTON_BASE_URL
from models.schemas import GeocodingResult
from services.http_client import (
    GEOCODING_HTTP_TIMEOUT,
    make_async_client_singleton,
    make_min_interval_gate,
)

logger = logging.getLogger(__name__)

_get_client, close_client = make_async_client_singleton(
    GEOCODING_HTTP_TIMEOUT,
    headers={"Accept": "application/json"},
)

# Photon's public instance asks callers to be fair. The frontend already
# debounces at 300ms, but a local loop / runaway caller could still hammer
# the host and risk a ban that hurts every user behind the NAT. Serialize
# outbound calls through a single-slot gate, mirroring the Nominatim guard
# (shared factory in http_client).
_PHOTON_MIN_INTERVAL_S = 0.30
_rate_limit = make_min_interval_gate(_PHOTON_MIN_INTERVAL_S)

# Photon only localizes names for this set; any other tag falls back to the
# default (local) name, which is the desired behaviour for e.g. zh queries.
_PHOTON_LANGS = frozenset({"de", "en", "fr"})


def _photon_lang(lang: str | None) -> str | None:
    """Map a UI language chain (e.g. ``"zh-Hant,zh-TW,zh,en"``) to a single
    tag Photon understands, or ``None`` to let it return local names."""
    if not lang:
        return None
    first = lang.split(",", 1)[0].split("-", 1)[0].lower()
    return first if first in _PHOTON_LANGS else None


# POI label assembly order: the most specific tier first, broadest last.
# Mirrors the intent of Nominatim's ``_PLACE_PRIORITY`` but for the flat
# Photon ``properties`` object.
def _display_name(props: dict) -> str:
    name = props.get("name")
    parts: list[str] = []
    if isinstance(name, str) and name.strip():
        parts.append(name.strip())

    street = props.get("street")
    housenumber = props.get("housenumber")
    if isinstance(street, str) and street.strip():
        line = street.strip()
        if isinstance(housenumber, str) and housenumber.strip():
            line = f"{line} {housenumber.strip()}"
        parts.append(line)

    for key in ("district", "city", "county", "state", "country"):
        v = props.get(key)
        if isinstance(v, str) and v.strip() and v.strip() not in parts:
            parts.append(v.strip())

    return ", ".join(parts)


async def search(query: str, limit: int = 5, lang: str | None = None) -> list[GeocodingResult]:
    """Forward geocode via Photon. Returns ``[]`` on any upstream failure so
    the caller keeps the existing "empty == unavailable" contract."""
    params: dict[str, object] = {"q": query, "limit": min(limit, 40)}
    photon_lang = _photon_lang(lang)
    if photon_lang:
        params["lang"] = photon_lang

    logger.debug("Photon search: %s", query)

    try:
        await _rate_limit()
        client = await _get_client()
        resp = await client.get(f"{PHOTON_BASE_URL}/api", params=params)
        resp.raise_for_status()
        data = resp.json()
    except (httpx.ConnectError, httpx.TimeoutException) as exc:
        logger.warning("Photon search unreachable (%s): %s", type(exc).__name__, exc)
        return []
    except httpx.HTTPStatusError as exc:
        logger.warning("Photon search HTTP %d: %s", exc.response.status_code, exc.response.text[:200])
        return []
    except httpx.HTTPError as exc:
        logger.warning("Photon search failed (%s): %s", type(exc).__name__, exc)
        return []

    features = data.get("features") if isinstance(data, dict) else None
    if not isinstance(features, list):
        return []

    results: list[GeocodingResult] = []
    for feat in features:
        try:
            geom = feat.get("geometry") or {}
            coords = geom.get("coordinates") or []
            props = feat.get("properties") or {}
            # GeoJSON order is [lon, lat].
            lon, lat = float(coords[0]), float(coords[1])
            display = _display_name(props)
            if not display:
                continue
            results.append(
                GeocodingResult(
                    display_name=display,
                    lat=lat,
                    lng=lon,
                    type=str(props.get("type") or props.get("osm_value") or ""),
                    country_code=str(props.get("countrycode") or "").lower(),
                    country=str(props.get("country") or ""),
                    place_name=str(props.get("name") or ""),
                )
            )
        except (KeyError, ValueError, IndexError, TypeError) as exc:
            logger.warning("Skipping malformed Photon feature: %s", exc)

    return results
