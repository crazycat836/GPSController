"""Multi-stop navigator -- sequential navigation through multiple waypoints."""

from __future__ import annotations

import asyncio
import logging
import random

from models.schemas import Coordinate, MovementMode, SimulationState
from config import resolve_speed_profile, DEFAULT_PAUSE_ENABLED, DEFAULT_PAUSE_MIN, DEFAULT_PAUSE_MAX
from utils.geo import haversine_m

logger = logging.getLogger(__name__)


class MultiStopNavigator:
    """Navigate through a series of waypoints with optional pauses at each stop."""

    def __init__(self, engine):
        self.engine = engine

    async def start(
        self,
        waypoints: list[Coordinate],
        mode: MovementMode,
        stop_duration: float = 0,
        loop: bool = False,
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
        """Navigate through *waypoints* one leg at a time.

        Parameters
        ----------
        waypoints
            Ordered list of stops to visit.
        mode
            Movement speed profile.
        stop_duration
            Seconds to pause at each intermediate stop (0 = no pause).
        loop
            If True, loop back to the start after reaching the last
            waypoint and repeat indefinitely.
        lap_count
            When ``loop=True`` and this is positive, stop after the given
            number of completed laps. ``None`` / ``0`` = unlimited (the
            pre-existing behaviour). Ignored when ``loop=False``.
        """
        engine = self.engine

        if len(waypoints) < 2:
            raise ValueError("At least 2 waypoints are required for multi-stop")

        if engine.current_position is None:
            raise RuntimeError(
                "Cannot start multi-stop: no current position. Teleport first."
            )

        profile_name = mode.value
        osrm_profile = "foot" if mode in (MovementMode.WALKING, MovementMode.RUNNING) else "car"

        def _pick_profile() -> dict:
            # Honor mid-flight apply_speed across legs / laps; otherwise
            # re-pick from the original args (so range mode varies).
            if engine._speed_was_applied and engine._active_speed_profile is not None:
                return dict(engine._active_speed_profile)
            return resolve_speed_profile(
                profile_name, speed_kmh, speed_min_kmh, speed_max_kmh,
            )

        engine.state = SimulationState.MULTI_STOP
        engine.total_segments = len(waypoints) - 1
        engine.segment_index = 0
        engine.lap_count = 0
        engine.distance_traveled = 0.0

        # Pre-calculate full route path for display
        all_wp_tuples = [(wp.lat, wp.lng) for wp in waypoints]
        full_total_distance = 0.0
        try:
            full_route = await engine.route_service.get_multi_route(
                all_wp_tuples, profile=osrm_profile,
                force_straight=straight_line,
            )
            full_total_distance = float(full_route.get("distance") or 0.0)
            await engine._emit("route_path", {
                "coords": [{"lat": pt[0], "lng": pt[1]} for pt in full_route["coords"]],
            })
        except Exception:
            logger.warning("Failed to pre-calculate full multi-stop route for display")

        await engine._emit("state_change", {
            "state": engine.state.value,
            "waypoints": [{"lat": wp.lat, "lng": wp.lng} for wp in waypoints],
            "stop_duration": stop_duration,
            "loop": loop,
        })

        logger.info(
            "Multi-stop started: %d waypoints, stop=%ds, loop=%s [%s]",
            len(waypoints), stop_duration, loop, profile_name,
        )

        # Ensure we start from the first waypoint's location
        # If we're not near the first waypoint, navigate there first
        first = waypoints[0]
        start_pos = engine.current_position
        start_dist = self._quick_distance(start_pos, first)
        if start_dist > 50:  # more than 50m away, route to the first waypoint
            route_data = await engine.route_service.get_route(
                start_pos.lat, start_pos.lng,
                first.lat, first.lng,
                profile=osrm_profile,
                force_straight=straight_line,
            )
            coords = [Coordinate(lat=pt[0], lng=pt[1]) for pt in route_data["coords"]]
            if len(coords) >= 2:
                await engine._move_along_route(coords, _pick_profile())
                if engine._stop_event.is_set():
                    return

        # Track the named user waypoints so highlight events refer to them
        # (otherwise OSRM densification would emit indices over road points).
        engine._user_waypoints = list(waypoints)
        engine._user_waypoint_next = 1  # we already start at waypoints[0]

        completed_distance = 0.0
        running = True
        while running and not engine._stop_event.is_set():
            # On each loop pass (only > 1 if loop=True) restart the highlight
            # at waypoint[1] so the UI re-highlights from the top.
            if loop and engine._user_waypoint_next >= len(waypoints):
                engine._user_waypoint_next = 1
                completed_distance = 0.0
            for i in range(len(waypoints) - 1):
                if engine._stop_event.is_set():
                    break

                engine.segment_index = i
                wp_a = waypoints[i]
                wp_b = waypoints[i + 1]

                logger.debug(
                    "Multi-stop leg %d/%d: (%.6f,%.6f) -> (%.6f,%.6f)",
                    i + 1, len(waypoints) - 1,
                    wp_a.lat, wp_a.lng, wp_b.lat, wp_b.lng,
                )

                # Get route for this leg
                route_data = await engine.route_service.get_route(
                    wp_a.lat, wp_a.lng,
                    wp_b.lat, wp_b.lng,
                    profile=osrm_profile,
                    force_straight=straight_line,
                )

                coords = [Coordinate(lat=pt[0], lng=pt[1]) for pt in route_data["coords"]]
                leg_distance = float(route_data.get("distance") or 0.0)
                engine.distance_remaining = leg_distance

                if full_total_distance > 0:
                    future_legs = max(full_total_distance - completed_distance - leg_distance, 0.0)
                else:
                    future_legs = 0.0
                engine._route_offset_remaining = future_legs

                if len(coords) >= 2:
                    await engine._move_along_route(coords, _pick_profile())

                completed_distance += leg_distance
                engine._route_offset_remaining = 0.0

                if engine._stop_event.is_set():
                    break

                # Arrived at a stop
                await engine._emit("stop_reached", {
                    "index": i + 1,
                    "total": len(waypoints),
                    "lat": wp_b.lat,
                    "lng": wp_b.lng,
                })

                # Pause at the stop. Precedence: explicit stop_duration > per-mode
                # random range (when pause_enabled). Last stop only pauses when looping.
                is_last = i == len(waypoints) - 2
                if stop_duration and stop_duration > 0:
                    this_pause = float(stop_duration)
                elif pause_enabled:
                    lo, hi = sorted((float(pause_min), float(pause_max)))
                    if lo < 0:
                        lo = 0.0
                    this_pause = random.uniform(lo, hi) if hi > 0 else 0.0
                else:
                    this_pause = 0.0
                should_pause = this_pause > 0 and (not is_last or loop)

                if should_pause:
                    logger.info("Multi-stop: pausing %.1fs at stop %d", this_pause, i + 1)
                    await engine._emit("pause_countdown", {
                        "duration_seconds": this_pause,
                        "source": "multi_stop",
                    })
                    try:
                        await asyncio.wait_for(
                            engine._stop_event.wait(),
                            timeout=this_pause,
                        )
                        break
                    except asyncio.TimeoutError:
                        pass
                    await engine._emit("pause_countdown_end", {"source": "multi_stop"})

            if not loop or engine._stop_event.is_set():
                running = False
            else:
                engine.lap_count += 1
                # Mirror route_loop: 0 / None = unlimited; positive = cap.
                limit = lap_count if (lap_count is not None and lap_count > 0) else None
                await engine._emit(
                    "lap_complete",
                    {"lap": engine.lap_count, "total": limit},
                )
                logger.info(
                    "Multi-stop lap %d%s complete",
                    engine.lap_count,
                    f"/{limit}" if limit else "",
                )
                if limit is not None and engine.lap_count >= limit:
                    logger.info(
                        "Multi-stop reached configured lap count %d, stopping",
                        limit,
                    )
                    running = False

        engine._route_offset_remaining = 0.0
        if engine.state == SimulationState.MULTI_STOP:
            engine.state = SimulationState.IDLE
            await engine._emit("multi_stop_complete", {
                "laps": engine.lap_count,
            })
            await engine._emit("state_change", {"state": engine.state.value})

        logger.info("Multi-stop finished after %d laps", engine.lap_count)

    @staticmethod
    def _quick_distance(a: Coordinate, b: Coordinate) -> float:
        """Distance in meters between two coordinates."""
        return haversine_m(a.lat, a.lng, b.lat, b.lng)
