"""Tests for the OSRM route service.

Covers: the ``continue_straight=false`` query flag (without it the demo
server returns ``NoRoute`` for any multi-via route containing a
double-back waypoint), and the no-silent-straight-line policy — when
OSRM cannot produce a road route the service retries (transport
errors), falls back to per-leg requests (multi-via rejections), and
finally raises :class:`RouteUnavailableError` instead of degrading to a
straight line. Straight lines are served only for the user's explicit
``force_straight`` toggle. The region-down cache only engages on
transport-level failures.

Network is fully mocked so the suite runs offline. Follows the project
convention of ``asyncio.run`` inside sync pytest functions rather than
depending on pytest-asyncio.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
import pytest

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from services.route_service import RouteUnavailableError  # noqa: E402


def _ok_payload(coords: list[list[float]]) -> dict:
    """OSRM success payload; *coords* are [lng, lat] pairs."""
    return {
        "code": "Ok",
        "routes": [
            {
                "geometry": {"coordinates": coords},
                "legs": [{"duration": 10.0}],
                "duration": 10.0,
                "distance": 100.0,
            }
        ],
    }

_REJECT_PAYLOAD = {"code": "NoRoute", "message": "No route found"}

_TWO_WP = [(25.0, 121.5), (25.01, 121.51)]
_THREE_WP = [(25.0, 121.5), (25.01, 121.51), (25.02, 121.52)]


def _response(status_code: int, payload: dict) -> httpx.Response:
    return httpx.Response(
        status_code,
        json=payload,
        request=httpx.Request("GET", "https://osrm.test/route/v1/foot/x"),
    )


def _service_with_client(client: AsyncMock):
    """Build a RouteService plus a patch routing its HTTP calls to *client*.

    Retry delay is zeroed so transport-retry tests don't sleep.
    """
    from services.route_service import RouteService

    service = RouteService()
    service._RETRY_DELAY_S = 0.0
    return service, patch(
        "services.route_service._get_client",
        AsyncMock(return_value=client),
    )


# ── Request shape ────────────────────────────────────────────────────

def test_fetch_route_url_includes_continue_straight_false():
    client = AsyncMock()
    client.get = AsyncMock(
        return_value=_response(200, _ok_payload([[121.5, 25.0], [121.51, 25.01]]))
    )
    service, client_patch = _service_with_client(client)

    with client_patch:
        result = asyncio.run(service.get_multi_route(_TWO_WP))

    url = client.get.call_args.args[0]
    assert "continue_straight=false" in url
    assert result["coords"] == [[25.0, 121.5], [25.01, 121.51]]


def test_force_straight_skips_osrm_entirely():
    client = AsyncMock()
    service, client_patch = _service_with_client(client)

    with client_patch:
        result = asyncio.run(service.get_multi_route(_TWO_WP, force_straight=True))

    assert result["fallback"] is True
    client.get.assert_not_called()


# ── Rejections (OSRM reachable, request refused) ─────────────────────

def test_two_point_rejection_raises_without_marking_region_down():

    client = AsyncMock()
    client.get = AsyncMock(return_value=_response(400, _REJECT_PAYLOAD))
    service, client_patch = _service_with_client(client)

    with client_patch:
        with pytest.raises(RouteUnavailableError):
            asyncio.run(service.get_multi_route(_TWO_WP))
        with pytest.raises(RouteUnavailableError):
            asyncio.run(service.get_multi_route(_TWO_WP))

    # The region must not be poisoned: both requests reach OSRM.
    assert client.get.call_count == 2


def test_multi_via_rejection_falls_back_to_per_leg_and_stitches():
    client = AsyncMock()
    client.get = AsyncMock(side_effect=[
        _response(400, _REJECT_PAYLOAD),  # full 3-point request refused
        _response(200, _ok_payload([[121.5, 25.0], [121.51, 25.01]])),   # leg 1
        _response(200, _ok_payload([[121.51, 25.01], [121.52, 25.02]])),  # leg 2
    ])
    service, client_patch = _service_with_client(client)

    with client_patch:
        result = asyncio.run(service.get_multi_route(_THREE_WP))

    assert client.get.call_count == 3
    # Joint point deduplicated when stitching legs.
    assert result["coords"] == [[25.0, 121.5], [25.01, 121.51], [25.02, 121.52]]
    assert result["duration"] == 20.0
    assert result["distance"] == 200.0
    assert result["leg_durations"] == [10.0, 10.0]


def test_per_leg_rejection_raises_and_names_the_leg():

    client = AsyncMock()
    client.get = AsyncMock(side_effect=[
        _response(400, _REJECT_PAYLOAD),  # full request refused
        _response(200, _ok_payload([[121.5, 25.0], [121.51, 25.01]])),  # leg 1 ok
        _response(400, _REJECT_PAYLOAD),  # leg 2 refused
    ])
    service, client_patch = _service_with_client(client)

    with client_patch:
        with pytest.raises(RouteUnavailableError, match="leg 2"):
            asyncio.run(service.get_multi_route(_THREE_WP))


def test_logical_error_in_200_body_counts_as_rejection():

    client = AsyncMock()
    client.get = AsyncMock(
        return_value=_response(200, {"code": "NoSegment", "message": "..."})
    )
    service, client_patch = _service_with_client(client)

    with client_patch:
        with pytest.raises(RouteUnavailableError):
            asyncio.run(service.get_multi_route(_TWO_WP))


# ── Transport failures (OSRM unreachable) ────────────────────────────

def test_transport_error_retries_then_marks_region_down():

    client = AsyncMock()
    client.get = AsyncMock(side_effect=httpx.ConnectError("boom"))
    service, client_patch = _service_with_client(client)

    with client_patch:
        with pytest.raises(RouteUnavailableError):
            asyncio.run(service.get_multi_route(_TWO_WP))
        first_count = client.get.call_count
        with pytest.raises(RouteUnavailableError):
            asyncio.run(service.get_multi_route(_TWO_WP))

    # One retry on the first call (2 attempts); the second call hits the
    # region-down cache and never reaches HTTP.
    assert first_count == 2
    assert client.get.call_count == first_count


def test_server_5xx_treated_as_unreachable_not_per_leg():

    client = AsyncMock()
    client.get = AsyncMock(return_value=_response(500, {}))
    service, client_patch = _service_with_client(client)

    with client_patch:
        with pytest.raises(RouteUnavailableError):
            asyncio.run(service.get_multi_route(_THREE_WP))

    # Retried once, but never fanned out into 2 per-leg requests.
    assert client.get.call_count == 2


# ── Recovery ─────────────────────────────────────────────────────────

def test_success_after_rejection_recovers():
    client = AsyncMock()
    client.get = AsyncMock(side_effect=[
        _response(400, _REJECT_PAYLOAD),
        _response(200, _ok_payload([[121.5, 25.0], [121.51, 25.01]])),
    ])
    service, client_patch = _service_with_client(client)


    with client_patch:
        with pytest.raises(RouteUnavailableError):
            asyncio.run(service.get_multi_route(_TWO_WP))
        result = asyncio.run(service.get_multi_route(_TWO_WP))

    assert result["coords"] == [[25.0, 121.5], [25.01, 121.51]]
