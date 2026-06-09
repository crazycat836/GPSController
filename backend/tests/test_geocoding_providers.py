"""Tests for the forward-geocoding providers and dispatch.

Covers: Photon / Google response mapping (display-name assembly, lang
selection), the parsing path with a mocked HTTP client, and the
provider dispatch in ``GeocodingService.search`` (Google when a key is
present, Photon otherwise).

Network is fully mocked so the suite runs offline. Follows the project
convention of ``asyncio.run`` inside sync pytest functions rather than
depending on pytest-asyncio.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))


# ── Photon: pure helpers ─────────────────────────────────────────────

def test_photon_display_name_assembles_specific_to_broad():
    from services.geocoding_photon import _display_name

    props = {
        "name": "Taipei 101",
        "street": "Xinyi Road",
        "housenumber": "7",
        "city": "Taipei",
        "state": "Taiwan",
        "country": "Taiwan",
    }
    # name first, then "street housenumber", then city/state/country with the
    # duplicate "Taiwan" (state == country) collapsed to a single entry.
    assert _display_name(props) == "Taipei 101, Xinyi Road 7, Taipei, Taiwan"


def test_photon_display_name_empty_when_no_usable_fields():
    from services.geocoding_photon import _display_name

    assert _display_name({}) == ""


def test_photon_lang_maps_zh_chain_to_none():
    from services.geocoding_photon import _photon_lang

    # Photon only localizes de/en/fr; a zh chain should yield None so it
    # returns local-script names rather than a wrong fallback.
    assert _photon_lang("zh-Hant,zh-TW,zh,en") is None
    assert _photon_lang("en") == "en"
    assert _photon_lang("fr-FR") == "fr"
    assert _photon_lang(None) is None


def test_photon_search_parses_features():
    from services import geocoding_photon

    payload = {
        "features": [
            {
                "geometry": {"coordinates": [121.5645, 25.0339], "type": "Point"},
                "properties": {"name": "Taipei 101", "type": "attraction", "countrycode": "TW", "country": "Taiwan"},
            },
            # Malformed (no coordinates) — must be skipped, not raise.
            {"geometry": {}, "properties": {"name": "broken"}},
        ]
    }
    resp = MagicMock()
    resp.json.return_value = payload
    resp.raise_for_status.return_value = None
    client = MagicMock()
    client.get = AsyncMock(return_value=resp)

    with patch.object(geocoding_photon, "_get_client", AsyncMock(return_value=client)), \
         patch.object(geocoding_photon, "_rate_limit", AsyncMock()):
        out = asyncio.run(geocoding_photon.search("Taipei 101", limit=5))

    assert len(out) == 1
    assert out[0].display_name == "Taipei 101, Taiwan"
    assert out[0].lat == 25.0339
    assert out[0].lng == 121.5645
    assert out[0].country_code == "tw"


def test_photon_search_returns_empty_on_http_error():
    import httpx

    from services import geocoding_photon

    client = MagicMock()
    client.get = AsyncMock(side_effect=httpx.ConnectError("boom"))

    with patch.object(geocoding_photon, "_get_client", AsyncMock(return_value=client)), \
         patch.object(geocoding_photon, "_rate_limit", AsyncMock()):
        out = asyncio.run(geocoding_photon.search("x"))

    assert out == []


# ── Google: pure helpers + parsing ───────────────────────────────────

def test_google_display_name_joins_name_and_address():
    from services.geocoding_google import _display_name

    place = {
        "displayName": {"text": "Din Tai Fung"},
        "formattedAddress": "No. 194, Sec. 2, Xinyi Rd, Taipei",
    }
    assert _display_name(place) == "Din Tai Fung, No. 194, Sec. 2, Xinyi Rd, Taipei"


def test_google_display_name_dedupes_when_name_equals_address():
    from services.geocoding_google import _display_name

    place = {"displayName": {"text": "Taipei"}, "formattedAddress": "Taipei"}
    assert _display_name(place) == "Taipei"


def test_google_language_code_takes_first_tag():
    from services.geocoding_google import _language_code

    assert _language_code("zh-Hant,zh-TW,zh,en") == "zh-Hant"
    assert _language_code("en") == "en"
    assert _language_code(None) is None


def test_google_search_parses_places():
    from services import geocoding_google

    payload = {
        "places": [
            {
                "displayName": {"text": "Din Tai Fung"},
                "formattedAddress": "Xinyi Rd, Taipei",
                "location": {"latitude": 25.033, "longitude": 121.563},
                "types": ["restaurant"],
            }
        ]
    }
    resp = MagicMock()
    resp.json.return_value = payload
    resp.raise_for_status.return_value = None
    client = MagicMock()
    client.post = AsyncMock(return_value=resp)

    with patch.object(geocoding_google, "_get_client", AsyncMock(return_value=client)):
        out = asyncio.run(geocoding_google.search("din tai fung", "KEY", limit=5))

    assert len(out) == 1
    assert out[0].display_name == "Din Tai Fung, Xinyi Rd, Taipei"
    assert out[0].lat == 25.033
    assert out[0].type == "restaurant"
    # The API key must be sent in the Goog header, never the body/query.
    _, kwargs = client.post.call_args
    assert kwargs["headers"]["X-Goog-Api-Key"] == "KEY"


# ── Dispatch in GeocodingService.search ──────────────────────────────

def test_search_dispatches_to_google_when_key_present():
    from services.geocoding import GeocodingService

    svc = GeocodingService()
    with patch("services.geocoding.geocoding_google.search", AsyncMock(return_value=["g"])) as g, \
         patch("services.geocoding.geocoding_photon.search", AsyncMock(return_value=["p"])) as p:
        out = asyncio.run(svc.search("q", limit=3, lang="en", google_key="KEY"))

    assert out == ["g"]
    g.assert_awaited_once_with("q", "KEY", limit=3, lang="en")
    p.assert_not_called()


def test_search_dispatches_to_photon_without_key():
    from services.geocoding import GeocodingService

    svc = GeocodingService()
    with patch("services.geocoding.geocoding_google.search", AsyncMock(return_value=["g"])) as g, \
         patch("services.geocoding.geocoding_photon.search", AsyncMock(return_value=["p"])) as p:
        out = asyncio.run(svc.search("q", limit=3, lang="en", google_key=None))

    assert out == ["p"]
    p.assert_awaited_once_with("q", limit=3, lang="en")
    g.assert_not_called()


# ── Explicit provider selection (Nominatim / Photon / Google) ─────────

def test_search_explicit_provider_photon_ignores_present_key():
    """Provider 'photon' must win even if a Google key is saved, so an
    explicit Photon choice isn't overridden by the legacy key heuristic."""
    from services.geocoding import GeocodingService

    svc = GeocodingService()
    with patch("services.geocoding.geocoding_google.search", AsyncMock(return_value=["g"])) as g, \
         patch("services.geocoding.geocoding_photon.search", AsyncMock(return_value=["p"])) as p:
        out = asyncio.run(svc.search("q", limit=3, lang="en", google_key="KEY", provider="photon"))

    assert out == ["p"]
    g.assert_not_called()


def test_search_explicit_provider_nominatim():
    from services.geocoding import GeocodingService

    svc = GeocodingService()
    with patch.object(GeocodingService, "_nominatim_search", AsyncMock(return_value=["n"])) as n, \
         patch("services.geocoding.geocoding_photon.search", AsyncMock(return_value=["p"])) as p:
        out = asyncio.run(svc.search("q", limit=4, lang="zh", provider="nominatim"))

    assert out == ["n"]
    n.assert_awaited_once_with("q", limit=4, lang="zh")
    p.assert_not_called()


def test_search_google_without_key_degrades_to_photon():
    """Choosing Google but saving no key must still return results via
    Photon rather than silently failing."""
    from services.geocoding import GeocodingService

    svc = GeocodingService()
    with patch("services.geocoding.geocoding_google.search", AsyncMock(return_value=["g"])) as g, \
         patch("services.geocoding.geocoding_photon.search", AsyncMock(return_value=["p"])) as p:
        out = asyncio.run(svc.search("q", limit=3, provider="google", google_key=None))

    assert out == ["p"]
    g.assert_not_called()


def test_nominatim_search_parses_list_payload():
    from services.geocoding import GeocodingService

    payload = [
        {
            "lat": "25.0339", "lon": "121.5645",
            "display_name": "Taipei 101, Xinyi, Taipei, Taiwan",
            "type": "attraction", "importance": 0.7,
            "name": "Taipei 101",
            "address": {"country_code": "tw", "country": "Taiwan"},
        },
        "not-a-dict",  # must be skipped, not raise
    ]
    resp = MagicMock()
    resp.json.return_value = payload
    resp.raise_for_status.return_value = None
    client = MagicMock()
    client.get = AsyncMock(return_value=resp)

    svc = GeocodingService()
    with patch("services.geocoding._get_client", AsyncMock(return_value=client)), \
         patch("services.geocoding._nominatim_rate_limit", AsyncMock()):
        out = asyncio.run(svc._nominatim_search("Taipei 101", limit=5))

    assert len(out) == 1
    assert out[0].lat == 25.0339
    assert out[0].lng == 121.5645
    assert out[0].country_code == "tw"
    assert out[0].place_name == "Taipei 101"
