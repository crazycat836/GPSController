"""Tests for services.route_optimizer.

Covers: anchored first waypoint, nearest-neighbor ordering correctness on
a synthetic matrix, OSRM/haversine fallback selection, and total-time
arithmetic. OSRM is mocked so tests run offline.

Uses ``asyncio.run`` directly inside sync pytest functions so the test
suite doesn't depend on pytest-asyncio.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))


def test_total_seconds_sums_pairs():
    """``_total_seconds`` adds the matrix entry for every consecutive pair
    in ``order``. Single-element orders return 0."""
    from services.route_optimizer import _total_seconds

    matrix = [
        [0.0, 10.0, 20.0],
        [10.0, 0.0, 15.0],
        [20.0, 15.0, 0.0],
    ]
    assert _total_seconds(matrix, [0]) == 0.0
    assert _total_seconds(matrix, [0, 1]) == 10.0
    assert _total_seconds(matrix, [0, 1, 2]) == 25.0
    assert _total_seconds(matrix, [0, 2, 1]) == 35.0


def test_nearest_neighbor_anchors_first_index():
    """``_nearest_neighbor_order`` always starts at index 0 — matches the
    "I'm parked at A, optimise B/C/D" mental model."""
    from services.route_optimizer import _nearest_neighbor_order

    # Even with a far-cheaper alternative starting point, index 0 is fixed.
    matrix = [
        [0.0, 100.0, 100.0, 100.0],
        [100.0, 0.0, 1.0, 1.0],
        [100.0, 1.0, 0.0, 1.0],
        [100.0, 1.0, 1.0, 0.0],
    ]
    order = _nearest_neighbor_order(matrix)
    assert order[0] == 0


def test_nearest_neighbor_picks_closest_next():
    """Greedy pick chooses the lowest-cost unvisited neighbor on each step."""
    from services.route_optimizer import _nearest_neighbor_order

    # 0 → 2 (cost 1) → 3 (cost 1) → 1 (cost 5).
    matrix = [
        [0.0, 4.0, 1.0, 9.0],
        [4.0, 0.0, 3.0, 5.0],
        [1.0, 3.0, 0.0, 1.0],
        [9.0, 5.0, 1.0, 0.0],
    ]
    order = _nearest_neighbor_order(matrix)
    assert order == [0, 2, 3, 1]


def test_nearest_neighbor_single_element():
    """A 1-element matrix returns [0] without traversing."""
    from services.route_optimizer import _nearest_neighbor_order

    order = _nearest_neighbor_order([[0.0]])
    assert order == [0]


def test_nearest_neighbor_anchor_first_false_not_supported():
    """anchor_first=False is documented as not yet implemented; should raise."""
    from services.route_optimizer import _nearest_neighbor_order

    with pytest.raises(NotImplementedError):
        _nearest_neighbor_order([[0.0, 1.0], [1.0, 0.0]], anchor_first=False)


def test_haversine_seconds_zero_for_identical_points():
    """Identical (lat, lng) → 0 metres → 0 seconds, regardless of speed."""
    from services.route_optimizer import _haversine_seconds

    secs = _haversine_seconds((37.7749, -122.4194), (37.7749, -122.4194), speed_mps=1.4)
    assert secs == 0.0


def test_haversine_seconds_known_distance():
    """Approximately 111 km per degree of latitude at the equator. A 1°
    south-to-north hop at 10 m/s should take ~11_132 s (within 5%)."""
    from services.route_optimizer import _haversine_seconds

    secs = _haversine_seconds((0.0, 0.0), (1.0, 0.0), speed_mps=10.0)
    expected = 111_320.0 / 10.0
    assert abs(secs - expected) / expected < 0.05


def test_optimize_order_rejects_fewer_than_two_waypoints():
    """Single or empty input raises ValueError — no permutation to compute."""
    from services.route_optimizer import optimize_order

    async def _run():
        with pytest.raises(ValueError):
            await optimize_order([], profile="walking")
        with pytest.raises(ValueError):
            await optimize_order([(0.0, 0.0)], profile="walking")

    asyncio.run(_run())


def test_optimize_order_rejects_unknown_profile():
    """Profiles outside the _PROFILE_MAP table raise ValueError."""
    from services.route_optimizer import optimize_order

    async def _run():
        with pytest.raises(ValueError):
            await optimize_order([(0.0, 0.0), (1.0, 1.0)], profile="teleport")

    asyncio.run(_run())


def test_optimize_order_with_two_waypoints_returns_identity():
    """Two waypoints: only one valid order (anchored start + the other)."""
    from services.route_optimizer import optimize_order

    waypoints = [(0.0, 0.0), (1.0, 1.0)]

    async def _run():
        with patch("services.route_optimizer._osrm_table", new_callable=AsyncMock) as mock_osrm:
            mock_osrm.return_value = [[0.0, 100.0], [100.0, 0.0]]
            return await optimize_order(waypoints, profile="walking")

    order, total = asyncio.run(_run())
    assert order == [0, 1]
    assert total == 100.0


def test_optimize_order_uses_haversine_when_osrm_fails():
    """If OSRM returns None (network down / 5xx), the haversine fall-back
    is used and an order is still returned anchored on index 0."""
    from services.route_optimizer import optimize_order

    # Far point first (index 1, 5° away), nearer second (index 2, 1° away).
    waypoints = [(0.0, 0.0), (0.0, 5.0), (0.0, 1.0)]

    async def _run():
        with patch("services.route_optimizer._osrm_table", new_callable=AsyncMock) as mock_osrm:
            mock_osrm.return_value = None
            return await optimize_order(waypoints, profile="walking")

    order, total = asyncio.run(_run())
    assert order[0] == 0
    assert order[1] == 2
    assert order[2] == 1
    assert total > 0


def test_optimize_order_prefers_osrm_when_available():
    """When OSRM responds, the resulting order matches the OSRM matrix —
    not what haversine would have produced."""
    from services.route_optimizer import optimize_order

    waypoints = [(0.0, 0.0), (0.0, 5.0), (0.0, 1.0)]
    # OSRM says index 1 is cheaper from 0 (50) than index 2 (200);
    # haversine alone would pick index 2 (geographically closer).
    osrm_matrix = [
        [0.0, 50.0, 200.0],
        [50.0, 0.0, 30.0],
        [200.0, 30.0, 0.0],
    ]

    async def _run():
        with patch("services.route_optimizer._osrm_table", new_callable=AsyncMock) as mock_osrm:
            mock_osrm.return_value = osrm_matrix
            return await optimize_order(waypoints, profile="walking")

    order, total = asyncio.run(_run())
    assert order == [0, 1, 2]
    assert total == 80.0  # 50 (0→1) + 30 (1→2)
