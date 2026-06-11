"""Shared scaffolding for the movement-mode handlers.

Consolidates the blocks that were copy-pasted across navigator /
random_walk / multi_stop / route_loop:

* OSRM route fetch + ``Coordinate`` conversion
* ``route_path`` polyline emission
* end-of-run IDLE transition (``<mode>_complete`` + ``state_change``)
* stoppable pause-with-countdown between legs / laps

Behavior parity note: event payloads, ordering, and await positions are
characterized by ``tests/test_movement_loop.py`` and
``tests/test_simulation_engine.py`` — keep them byte-identical when editing.
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

from models.schemas import Coordinate, SimulationState

if TYPE_CHECKING:
    from core.simulation_engine import SimulationEngine
    from services.route_service import RouteService


def route_coords(route_data: dict) -> list[Coordinate]:
    """Convert an OSRM route payload's ``[lat, lng]`` pairs to Coordinates."""
    return [Coordinate(lat=pt[0], lng=pt[1]) for pt in route_data["coords"]]


async def fetch_route_coords(
    route_service: "RouteService",
    a_lat: float,
    a_lng: float,
    b_lat: float,
    b_lng: float,
    *,
    profile: str,
    straight: bool,
) -> tuple[list[Coordinate], dict]:
    """Fetch an OSRM route and convert its points to Coordinates.

    Returns ``(coords, route_data)`` so callers can also read the raw
    payload (distance etc.).
    """
    route_data = await route_service.get_route(
        a_lat, a_lng,
        b_lat, b_lng,
        profile=profile,
        force_straight=straight,
    )
    return route_coords(route_data), route_data


async def emit_route_path(
    engine: "SimulationEngine", coords: list[Coordinate],
) -> None:
    """Broadcast the polyline the map should draw for the active route."""
    await engine._emit("route_path", {
        "coords": [{"lat": c.lat, "lng": c.lng} for c in coords],
    })


async def finish_mode(
    engine: "SimulationEngine",
    expected_states: tuple[SimulationState, ...],
    complete_event: str | None = None,
    payload: dict | None = None,
) -> None:
    """End-of-run IDLE transition shared by all mode handlers.

    Only fires when the engine is still in one of *expected_states* (a
    stop / crash path may already have reset it). Emits the optional
    ``<mode>_complete`` event first, then ``state_change`` — that order
    is part of the WS contract.
    """
    if engine.state not in expected_states:
        return
    engine.state = SimulationState.IDLE
    if complete_event is not None:
        await engine._emit(complete_event, payload or {})
    await engine._emit("state_change", {"state": engine.state.value})


async def pause_with_countdown(
    engine: "SimulationEngine",
    duration_s: float,
    source: str,
) -> bool:
    """Stoppable pause between legs / laps with countdown events.

    Emits ``pause_countdown``, waits on the engine's stop event for up to
    *duration_s*, then emits ``pause_countdown_end``. Returns True if the
    user requested stop during the pause — the countdown-end event is then
    deliberately NOT emitted, matching the original inline blocks.
    """
    await engine._emit("pause_countdown", {
        "duration_seconds": duration_s,
        "source": source,
    })
    try:
        await asyncio.wait_for(
            engine._stop_event.wait(),
            timeout=duration_s,
        )
        return True
    except asyncio.TimeoutError:
        pass
    await engine._emit("pause_countdown_end", {"source": source})
    return False
