"""Waypoint-order optimisation for multi-stop / loop runs.

Given N waypoints and a movement profile, compute a permutation that
minimises total travel time. The first waypoint is anchored — it
matches the user's mental model of "I'm at A, optimise the visit order
for B/C/D" and avoids the case where the solver picks a different
starting point than what the user has the iPhone parked at.

Duration matrix source preference:

  1. OSRM ``/table`` with the requested profile (car / bike / foot)
     — gives road-network durations that match the eventual run.
  2. Haversine fall-back when OSRM is unreachable for the region.
     The straight-line distances still produce a sensible order for
     most inputs; the run itself can still go via OSRM at execution
     time even if optimisation fell back.

Solver: nearest-neighbor greedy. Empirically within ~25% of optimal on
the n ≤ 10 case typical of GPSController multi-stop sessions; exact
TSP would buy a few percent at best while complicating the code.
"""

from __future__ import annotations

import logging
import math

import httpx

from config import OSRM_BASE_URL
from services.http_client import make_async_client_singleton

logger = logging.getLogger(__name__)

_TIMEOUT = httpx.Timeout(8.0, connect=3.0)

_get_client, close_client = make_async_client_singleton(_TIMEOUT)


# Mirrors services.route_service._PROFILE_MAP but kept local so a profile
# change in one path doesn't accidentally retune the other.
_PROFILE_MAP: dict[str, str] = {
    "walking": "foot",
    "cycling": "bike",
    "driving": "car",
    # Pass-through for callers that already speak OSRM's slug.
    "foot": "foot",
    "bike": "bike",
    "car": "car",
}


# Earth radius in metres used by the haversine fall-back.
_EARTH_R_M = 6_371_000.0


def _haversine_seconds(
    a: tuple[float, float],
    b: tuple[float, float],
    speed_mps: float,
) -> float:
    """Great-circle distance from ``a`` to ``b`` divided by *speed_mps*.

    Used when the OSRM ``/table`` call fails — we still want an
    *order*, even if the durations themselves are off.
    """
    lat1, lng1 = math.radians(a[0]), math.radians(a[1])
    lat2, lng2 = math.radians(b[0]), math.radians(b[1])
    dlat = lat2 - lat1
    dlng = lng2 - lng1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
    dist_m = 2 * _EARTH_R_M * math.asin(math.sqrt(h))
    return dist_m / max(speed_mps, 0.1)


# Speed assumption for the haversine fall-back, by profile. Rough
# averages; precision doesn't matter — we only use them to *order*
# the duration matrix, not to predict ETAs.
_FALLBACK_SPEED_MPS: dict[str, float] = {
    "walking": 1.3,  # ~4.7 km/h
    "foot":    1.3,
    "cycling": 4.2,  # ~15 km/h
    "bike":    4.2,
    "driving": 11.1,  # ~40 km/h, urban-ish
    "car":     11.1,
}


async def _osrm_table(
    points: list[tuple[float, float]],
    osrm_profile: str,
) -> list[list[float]] | None:
    """Fetch the NxN duration matrix from OSRM. Returns None on any
    upstream failure so the caller can fall back to haversine."""
    # OSRM coordinate pairs are lon,lat (not lat,lon).
    coords_str = ";".join(f"{lng},{lat}" for lat, lng in points)
    url = f"{OSRM_BASE_URL}/table/v1/{osrm_profile}/{coords_str}?annotations=duration"

    try:
        client = await _get_client()
        resp = await client.get(url)
        resp.raise_for_status()
        data = resp.json()
        if data.get("code") != "Ok":
            logger.warning("OSRM /table non-Ok: %s", data.get("message"))
            return None
        durations = data.get("durations")
        if not isinstance(durations, list) or not durations:
            return None
        return durations
    except (httpx.HTTPError, httpx.TimeoutException) as exc:
        logger.warning("OSRM /table failed (%s): %s", type(exc).__name__, exc)
        return None


def _nearest_neighbor_order(
    matrix: list[list[float]],
    *,
    anchor_first: bool = True,
) -> list[int]:
    """Greedy nearest-neighbor tour starting at index 0.

    When ``anchor_first`` is True (the only supported mode today), index
    0 is fixed and the rest of the indices are visited in nearest-next
    order. ``None`` / missing rows raise — the caller is expected to
    have validated the matrix shape.
    """
    n = len(matrix)
    if n <= 1:
        return list(range(n))
    if not anchor_first:
        raise NotImplementedError("anchor_first=False not yet supported")

    visited: set[int] = {0}
    order: list[int] = [0]
    current = 0
    while len(order) < n:
        best_j = -1
        best_d = math.inf
        row = matrix[current]
        for j in range(n):
            if j in visited:
                continue
            d = row[j]
            if d < best_d:
                best_d = d
                best_j = j
        if best_j < 0:
            # All remaining nodes were unreachable from current — append
            # them in their original order so we still return a complete
            # permutation. Practically this only fires when the matrix
            # contains infinities (unconnected islands).
            for j in range(n):
                if j not in visited:
                    order.append(j)
                    visited.add(j)
            break
        order.append(best_j)
        visited.add(best_j)
        current = best_j
    return order


def _total_seconds(matrix: list[list[float]], order: list[int]) -> float:
    """Sum the leg durations for *order* against *matrix*."""
    total = 0.0
    for i in range(len(order) - 1):
        leg = matrix[order[i]][order[i + 1]]
        if math.isfinite(leg):
            total += leg
    return total


async def optimize_order(
    waypoints: list[tuple[float, float]],
    profile: str,
    *,
    anchor_first: bool = True,
) -> tuple[list[int], float]:
    """Return ``(order, total_seconds)`` where *order* is a permutation
    of ``range(len(waypoints))`` and *total_seconds* is the heuristic's
    estimated travel time using whichever matrix succeeded.

    Raises ``ValueError`` on unknown profile or fewer than 2 waypoints.
    """
    if len(waypoints) < 2:
        raise ValueError("At least two waypoints are required to optimise order")
    osrm_profile = _PROFILE_MAP.get(profile)
    if osrm_profile is None:
        raise ValueError(f"Unknown profile: {profile!r}")

    matrix = await _osrm_table(waypoints, osrm_profile)
    if matrix is None:
        # Fall back to haversine — same matrix shape, derived locally so
        # the optimiser still produces a deterministic order.
        speed = _FALLBACK_SPEED_MPS.get(profile, _FALLBACK_SPEED_MPS["walking"])
        n = len(waypoints)
        matrix = [
            [
                0.0 if i == j else _haversine_seconds(waypoints[i], waypoints[j], speed)
                for j in range(n)
            ]
            for i in range(n)
        ]

    order = _nearest_neighbor_order(matrix, anchor_first=anchor_first)
    return order, _total_seconds(matrix, order)
