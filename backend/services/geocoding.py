"""Nominatim forward / reverse geocoding service."""

from __future__ import annotations

import asyncio
import logging

import httpx

from config import NOMINATIM_BASE_URL, NOMINATIM_USER_AGENT
from models.schemas import GeocodingResult

logger = logging.getLogger(__name__)

_TIMEOUT = httpx.Timeout(10.0, connect=5.0)

# Lifespan-scoped HTTP client. Reusing the connection pool across calls
# avoids paying TCP+TLS handshake on every search / reverse during a
# 10 Hz navigation. Closed on FastAPI shutdown via close_client().
_client: httpx.AsyncClient | None = None
_client_lock = asyncio.Lock()


async def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        async with _client_lock:
            if _client is None:
                _client = httpx.AsyncClient(timeout=_TIMEOUT)
    return _client


async def close_client() -> None:
    """Release the shared HTTP client. Called from the FastAPI lifespan."""
    global _client
    if _client is not None:
        try:
            await _client.aclose()
        finally:
            _client = None


# Nominatim's usage policy (https://operations.osmfoundation.org/policies/nominatim/)
# requires no more than 1 request per second. A frontend bug or local
# attacker could otherwise hammer this proxy and trigger an IP ban that
# affects every user behind the NAT. Serialize all outbound calls
# through a single-slot gate with a ≥1s spacing.
_NOMINATIM_MIN_INTERVAL_S = 1.05  # tiny safety margin
_rate_lock = asyncio.Lock()
_last_request_at: float = 0.0


async def _nominatim_rate_limit() -> None:
    """Block until at least :data:`_NOMINATIM_MIN_INTERVAL_S` has passed
    since the previous call. Serializes search + reverse together."""
    global _last_request_at
    async with _rate_lock:
        loop = asyncio.get_event_loop()
        now = loop.time()
        wait = _NOMINATIM_MIN_INTERVAL_S - (now - _last_request_at)
        if wait > 0:
            await asyncio.sleep(wait)
        _last_request_at = loop.time()


class GeocodingService:
    """Async wrapper around the Nominatim geocoding API."""

    def _headers(self) -> dict[str, str]:
        return {
            "User-Agent": NOMINATIM_USER_AGENT,
            "Accept": "application/json",
        }

    # ------------------------------------------------------------------
    # Forward geocoding
    # ------------------------------------------------------------------

    async def search(self, query: str, limit: int = 5) -> list[GeocodingResult]:
        """Forward geocode: address or place name -> coordinates.

        Parameters
        ----------
        query:
            Free-form search string (e.g. ``"Taipei 101"``).
        limit:
            Maximum number of results (default 5, Nominatim max 40).

        Returns
        -------
        list[GeocodingResult]

        Network / upstream failures (DNS miss, timeout, 5xx, rate limit) are
        logged and surfaced as an empty list so the caller doesn't receive a
        500 for transient issues.
        """
        params = {
            "q": query,
            "format": "json",
            "limit": min(limit, 40),
        }

        logger.debug("Nominatim search: %s", query)

        try:
            await _nominatim_rate_limit()
            client = await _get_client()
            resp = await client.get(
                f"{NOMINATIM_BASE_URL}/search",
                params=params,
                headers=self._headers(),
            )
            resp.raise_for_status()
            data = resp.json()
        except (httpx.ConnectError, httpx.TimeoutException) as exc:
            logger.warning("Nominatim search unreachable (%s): %s", type(exc).__name__, exc)
            return []
        except httpx.HTTPStatusError as exc:
            logger.warning("Nominatim search HTTP %d: %s", exc.response.status_code, exc.response.text[:200])
            return []
        except httpx.HTTPError as exc:
            logger.warning("Nominatim search failed (%s): %s", type(exc).__name__, exc)
            return []

        results: list[GeocodingResult] = []
        for item in data:
            try:
                results.append(
                    GeocodingResult(
                        display_name=item.get("display_name", ""),
                        lat=float(item["lat"]),
                        lng=float(item["lon"]),
                        type=item.get("type", ""),
                        importance=float(item.get("importance", 0)),
                    )
                )
            except (KeyError, ValueError) as exc:
                logger.warning("Skipping malformed search result: %s", exc)

        return results

    # ------------------------------------------------------------------
    # Reverse geocoding
    # ------------------------------------------------------------------

    async def reverse(
        self, lat: float, lng: float, lang: str | None = None
    ) -> GeocodingResult | None:
        """Reverse geocode: coordinates -> address.

        Passing ``lang`` forwards an ``accept-language`` hint to Nominatim so
        ``address.country`` is returned in the requested language.

        Returns ``None`` when no result is found.
        """
        params: dict[str, object] = {
            "lat": lat,
            "lon": lng,
            "format": "json",
            "addressdetails": 1,
        }
        headers = self._headers()
        if lang:
            headers["Accept-Language"] = lang

        logger.debug("Nominatim reverse: %.6f, %.6f", lat, lng)

        # Network / upstream failures are logged and surfaced as None so the
        # frontend's reverse-geocode hook falls back to "no flag / no country"
        # instead of throwing away the whole status pair on a transient DNS
        # or timeout hiccup.
        try:
            await _nominatim_rate_limit()
            client = await _get_client()
            resp = await client.get(
                f"{NOMINATIM_BASE_URL}/reverse",
                params=params,
                headers=headers,
            )
            resp.raise_for_status()
            data = resp.json()
        except (httpx.ConnectError, httpx.TimeoutException) as exc:
            logger.warning("Nominatim reverse unreachable (%s): %s", type(exc).__name__, exc)
            return None
        except httpx.HTTPStatusError as exc:
            logger.warning("Nominatim reverse HTTP %d: %s", exc.response.status_code, exc.response.text[:200])
            return None
        except httpx.HTTPError as exc:
            logger.warning("Nominatim reverse failed (%s): %s", type(exc).__name__, exc)
            return None

        if "error" in data:
            logger.info("Nominatim reverse returned error: %s", data["error"])
            return None

        try:
            addr = data.get("address") or {}
            return GeocodingResult(
                display_name=data.get("display_name", ""),
                lat=float(data["lat"]),
                lng=float(data["lon"]),
                type=data.get("type", ""),
                importance=float(data.get("importance", 0)),
                country_code=(addr.get("country_code") or "").lower(),
                country=addr.get("country") or "",
                place_name=_pick_place_name(data, addr),
            )
        except (KeyError, ValueError) as exc:
            logger.warning("Failed to parse reverse result: %s", exc)
            return None


# POI > road > administrative order for label extraction. Picking the first
# non-empty field keeps bookmark names meaningful ("Taipei 101", "Xinyi Rd")
# instead of degenerate house numbers like "6號".
_PLACE_PRIORITY: tuple[str, ...] = (
    "amenity",
    "tourism",
    "shop",
    "historic",
    "leisure",
    "building",
    "attraction",
    "office",
    "neighbourhood",
    "suburb",
    "road",
    "pedestrian",
    "city_district",
    "city",
    "town",
    "village",
    "county",
    "state_district",
    "state",
)


def _pick_place_name(data: dict, addr: dict) -> str:
    """Extract the most specific non-trivial place label from a Nominatim
    reverse payload. Returns an empty string if no usable label exists."""
    # Nominatim's top-level `name` field (when present) is the canonical label
    # for POIs — prefer it over anything in the address tree.
    top_name = data.get("name")
    if isinstance(top_name, str) and top_name.strip():
        return top_name.strip()
    for key in _PLACE_PRIORITY:
        v = addr.get(key)
        if isinstance(v, str) and v.strip():
            return v.strip()
    # Last-resort fallback: a bare house number is more useful than nothing
    # but less useful than any hierarchy tier — included for completeness.
    hn = addr.get("house_number")
    if isinstance(hn, str) and hn.strip():
        road = addr.get("road")
        if isinstance(road, str) and road.strip():
            return f"{road.strip()} {hn.strip()}"
        return hn.strip()
    return ""
