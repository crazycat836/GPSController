"""Route looper -- infinitely loop through a closed route."""

from __future__ import annotations

import logging

from models.schemas import Coordinate, MovementMode, SimulationState, osrm_profile_for
from config import (
    DEFAULT_PAUSE_ENABLED,
    DEFAULT_PAUSE_MAX,
    DEFAULT_PAUSE_MIN,
)
from core.handler_common import (
    emit_route_path,
    finish_mode,
    pause_with_countdown,
    random_pause_seconds,
    route_coords,
)
from core.lap_limit import record_lap_and_check_limit

logger = logging.getLogger(__name__)


class RouteLooper:
    """Creates a closed route through waypoints and loops it indefinitely."""

    def __init__(self, engine):
        self.engine = engine

    async def start_loop(
        self,
        waypoints: list[Coordinate],
        mode: MovementMode,
        *,
        speed_kmh: float | None = None,
        speed_min_kmh: float | None = None,
        speed_max_kmh: float | None = None,
        pause_enabled: bool = DEFAULT_PAUSE_ENABLED,
        pause_min: float = DEFAULT_PAUSE_MIN,
        pause_max: float = DEFAULT_PAUSE_MAX,
        straight_line: bool = False,
        lap_count: int | None = None,
    ) -> None:
        """Build a multi-waypoint route that forms a closed loop, then
        traverse it repeatedly until stopped.

        Parameters
        ----------
        waypoints
            Ordered waypoints forming the loop. The route will be closed
            by appending the first waypoint at the end.
        mode
            Movement mode determining speed profile.
        lap_count
            When positive, stop automatically after that many completed
            laps. ``None`` / ``0`` means "loop forever until the user
            calls stop".
        """
        engine = self.engine

        if len(waypoints) < 2:
            raise ValueError("At least 2 waypoints are required for a loop")

        profile_name = mode.value
        osrm_profile = osrm_profile_for(mode)

        # Close the loop: append the first waypoint at the end
        closed_waypoints = list(waypoints) + [waypoints[0]]

        # Build OSRM route through all waypoints
        wp_tuples = [(wp.lat, wp.lng) for wp in closed_waypoints]
        route_data = await engine.route_service.get_multi_route(
            wp_tuples, profile=osrm_profile,
            force_straight=straight_line,
        )

        coords = route_coords(route_data)

        if len(coords) < 2:
            raise ValueError("OSRM returned an empty route for the loop")

        engine.state = SimulationState.LOOPING
        engine.lap_count = 0
        engine.total_segments = len(coords) - 1
        engine.segment_index = 0

        await emit_route_path(engine, coords)
        await engine._emit("state_change", {
            "state": engine.state.value,
            "waypoints": [{"lat": wp.lat, "lng": wp.lng} for wp in waypoints],
        })

        logger.info("Starting route loop with %d waypoints [%s]", len(waypoints), profile_name)

        # Loop until stopped
        while not engine._stop_event.is_set():
            engine.distance_traveled = 0.0
            engine.distance_remaining = route_data["distance"]
            engine.segment_index = 0

            # Tell _move_along_route which user-facing waypoints to track for
            # waypoint_progress emission (we close the loop on the road but
            # the UI only shows the named waypoints the user entered).
            engine._user_waypoints = list(waypoints)
            # Restart highlight from waypoint[1] each lap so UI re-pulses.
            engine._user_waypoint_next = 1 if len(waypoints) > 1 else 0

            # If the user has applied a speed mid-flight, honor it on
            # subsequent laps; otherwise re-pick speed each lap so a range
            # produces realistic per-lap variation.
            speed_profile = engine.pick_speed_profile(
                profile_name, speed_kmh, speed_min_kmh, speed_max_kmh,
            )
            await engine._move_along_route(coords, speed_profile)

            # Check if we were stopped during the route
            if engine._stop_event.is_set():
                break

            if await record_lap_and_check_limit(engine, lap_count, kind="Loop", logger=logger):
                break

            # Optional random pause between laps
            if pause_enabled:
                lap_pause = random_pause_seconds(pause_min, pause_max)
                if lap_pause > 0:
                    logger.info("Loop: pausing %.1fs before next lap", lap_pause)
                    if await pause_with_countdown(engine, lap_pause, "loop"):
                        break

        # Loop end has no <mode>_complete event — state_change only.
        await finish_mode(engine, (SimulationState.LOOPING,))

        logger.info("Route loop stopped after %d laps", engine.lap_count)
