"""Flower mode -- walk a small circle around each waypoint in turn.

Pikmin Bloom plants flowers along the walked trail, so circling a spot
covers an area instead of a single line. For every spot the handler:

1. gets there (walks the routed leg, or teleports),
2. waits ``wait_before_s``,
3. walks from the centre out to the circle, around it ``laps`` times
   (a fractional lap stops part-way round), and back to the centre,
4. waits ``wait_after_s`` (plus an optional random pause).

The whole spot sequence repeats ``rounds`` times (``None`` = until the
user stops).
"""

from __future__ import annotations

import logging
import math
from typing import TYPE_CHECKING, Literal

from config import DEFAULT_PAUSE_MAX, DEFAULT_PAUSE_MIN
from core.handler_common import (
    emit_route_path,
    fetch_route_coords,
    finish_mode,
    pause_with_countdown,
    random_pause_seconds,
)
from core.lap_limit import record_lap_and_check_limit
from models.schemas import Coordinate, MovementMode, SimulationState, osrm_profile_for
from utils.geo import haversine_m

if TYPE_CHECKING:
    from core.simulation_engine import SimulationEngine
    from services.cooldown import CooldownTimer

logger = logging.getLogger(__name__)

TransferMode = Literal["walk", "teleport"]

# Metres per degree of latitude for the local equirectangular offset.
# Accurate to well under 1 % at the tens-of-metres radii this mode uses.
_METERS_PER_DEG_LAT = 111_320.0
# Keeps the longitude scale finite right at the poles.
_MIN_COS_LAT = 1e-6
# Closer than this to a spot counts as already there (no transfer leg).
_ARRIVED_THRESHOLD_M = 5.0
# Angular slack when deciding whether a partial lap ends on a vertex.
_ANGLE_EPS = 1e-9
_MIN_ROUTE_COORDS = 2
_PAUSE_SOURCE = "flower"


def offset_point(center: Coordinate, radius_m: float, angle_rad: float) -> Coordinate:
    """Point ``radius_m`` from ``center`` at ``angle_rad`` (0 = north,
    increasing clockwise through east)."""
    cos_lat = max(math.cos(math.radians(center.lat)), _MIN_COS_LAT)
    dlat = radius_m * math.cos(angle_rad) / _METERS_PER_DEG_LAT
    dlng = radius_m * math.sin(angle_rad) / (_METERS_PER_DEG_LAT * cos_lat)
    return Coordinate(lat=center.lat + dlat, lng=center.lng + dlng)


def circle_points(center: Coordinate, radius_m: float, segments: int) -> list[Coordinate]:
    """``segments`` evenly spaced vertices on the circle, starting north."""
    step = 2.0 * math.pi / segments
    return [offset_point(center, radius_m, k * step) for k in range(segments)]


def circle_path(
    center: Coordinate, radius_m: float, segments: int, laps: float,
) -> list[Coordinate]:
    """The walked path for one spot: centre → circle → ``laps`` times
    around → centre.

    ``laps`` may be fractional. The path follows the polygon vertices
    and, when the lap fraction doesn't land on a vertex, ends on the
    exact angle ``laps · 2π`` so half a lap really is half the circle.
    """
    step = 2.0 * math.pi / segments
    total_angle = laps * 2.0 * math.pi
    full_steps = int(math.floor(total_angle / step + _ANGLE_EPS))
    path = [center]
    path.extend(offset_point(center, radius_m, k * step) for k in range(full_steps + 1))
    if total_angle - full_steps * step > _ANGLE_EPS:
        path.append(offset_point(center, radius_m, total_angle))
    path.append(center)
    return path


def path_length_m(path: list[Coordinate]) -> float:
    """Sum of great-circle distances along ``path``."""
    return sum(
        haversine_m(a.lat, a.lng, b.lat, b.lng)
        for a, b in zip(path, path[1:])
    )


class FlowerHandler:
    """Visits each waypoint and walks a circle around it."""

    def __init__(self, engine: "SimulationEngine") -> None:
        self.engine = engine

    async def start(
        self,
        waypoints: list[Coordinate],
        mode: MovementMode,
        *,
        radius_m: float,
        segments: int,
        laps: float,
        rounds: int | None,
        wait_before_s: float = 0.0,
        wait_after_s: float = 0.0,
        transfer: TransferMode = "walk",
        speed_kmh: float | None = None,
        speed_min_kmh: float | None = None,
        speed_max_kmh: float | None = None,
        pause_enabled: bool = False,
        pause_min: float = DEFAULT_PAUSE_MIN,
        pause_max: float = DEFAULT_PAUSE_MAX,
        straight_line: bool = False,
        cooldown: "CooldownTimer | None" = None,
    ) -> None:
        """Run flower mode until every round finishes or the user stops.

        ``cooldown`` is honoured only for teleport transfers: each hop
        first waits out an active cooldown, then starts a new one for the
        jump distance. Callers pass ``None`` where cooldown is bypassed
        (group mode).
        """
        engine = self.engine

        if not waypoints:
            raise ValueError("At least 1 waypoint is required for flower mode")
        if transfer == "walk" and engine.current_position is None:
            raise RuntimeError(
                "Cannot start flower mode: no current position. Teleport first."
            )

        profile_name = mode.value
        osrm_profile = osrm_profile_for(mode)
        total_spots = len(waypoints)

        def pick_profile() -> dict:
            return engine.pick_speed_profile(
                profile_name, speed_kmh, speed_min_kmh, speed_max_kmh,
            )

        engine.state = SimulationState.FLOWER
        engine.lap_count = 0
        engine.segment_index = 0
        engine.distance_traveled = 0.0
        engine._route_offset_remaining = 0.0
        # Named-waypoint highlighting is emitted explicitly on arrival;
        # the movement loop's pass detection would misfire on the circles.
        engine._user_waypoints = []
        engine._user_waypoint_next = 0

        await engine._emit("state_change", {
            "state": engine.state.value,
            "waypoints": [{"lat": wp.lat, "lng": wp.lng} for wp in waypoints],
        })

        logger.info(
            "Flower started: %d spots, r=%.0fm, seg=%d, laps=%.1f, rounds=%s, "
            "wait=%.0f/%.0fs, transfer=%s [%s]",
            total_spots, radius_m, segments, laps, rounds if rounds else "∞",
            wait_before_s, wait_after_s, transfer, profile_name,
        )

        while not engine._stop_event.is_set():
            stopped = False
            for idx, spot in enumerate(waypoints):
                engine.segment_index = idx
                if await self._visit_spot(
                    idx, spot, total_spots,
                    radius_m=radius_m, segments=segments, laps=laps,
                    wait_before_s=wait_before_s, wait_after_s=wait_after_s,
                    transfer=transfer, osrm_profile=osrm_profile,
                    straight_line=straight_line, pick_profile=pick_profile,
                    pause_enabled=pause_enabled, pause_min=pause_min,
                    pause_max=pause_max, cooldown=cooldown,
                ):
                    stopped = True
                    break
            if stopped or engine._stop_event.is_set():
                break
            if await record_lap_and_check_limit(
                engine, rounds, kind="Flower", logger=logger,
            ):
                break

        engine._route_offset_remaining = 0.0
        await finish_mode(engine, (SimulationState.FLOWER,))
        logger.info("Flower finished after %d rounds", engine.lap_count)

    async def _visit_spot(
        self,
        idx: int,
        spot: Coordinate,
        total_spots: int,
        *,
        radius_m: float,
        segments: int,
        laps: float,
        wait_before_s: float,
        wait_after_s: float,
        transfer: TransferMode,
        osrm_profile: str,
        straight_line: bool,
        pick_profile,
        pause_enabled: bool,
        pause_min: float,
        pause_max: float,
        cooldown: "CooldownTimer | None",
    ) -> bool:
        """Run the full per-spot sequence. Returns True when stopped."""
        engine = self.engine

        if transfer == "teleport":
            if await self._teleport_to(spot, cooldown):
                return True
        else:
            await self._walk_to(spot, osrm_profile, straight_line, pick_profile)
        if engine._stop_event.is_set():
            return True

        await engine._emit("waypoint_progress", {
            "current_index": idx,
            "next_index": min(idx + 1, total_spots - 1),
            "total": total_spots,
        })

        if wait_before_s > 0 and await pause_with_countdown(
            engine, wait_before_s, _PAUSE_SOURCE,
        ):
            return True

        path = circle_path(spot, radius_m, segments, laps)
        await emit_route_path(engine, path)
        await engine._move_along_route(path, pick_profile())
        if engine._stop_event.is_set():
            return True

        after = wait_after_s
        if pause_enabled:
            after += random_pause_seconds(pause_min, pause_max)
        if after > 0 and await pause_with_countdown(engine, after, _PAUSE_SOURCE):
            return True
        return False

    async def _walk_to(
        self,
        spot: Coordinate,
        osrm_profile: str,
        straight_line: bool,
        pick_profile,
    ) -> None:
        """Walk the routed leg from the current position to ``spot``.

        Route planning failures (``RouteUnavailableError``) propagate so
        the run aborts with a visible error instead of silently jumping.
        """
        engine = self.engine
        here = engine.current_position
        if here is None:
            raise RuntimeError("Cannot walk to the next flower spot: no current position")
        if haversine_m(here.lat, here.lng, spot.lat, spot.lng) <= _ARRIVED_THRESHOLD_M:
            return
        coords, _route_data = await fetch_route_coords(
            engine.route_service,
            here.lat, here.lng,
            spot.lat, spot.lng,
            profile=osrm_profile,
            straight=straight_line,
        )
        if len(coords) < _MIN_ROUTE_COORDS:
            return
        await emit_route_path(engine, coords)
        await engine._move_along_route(coords, pick_profile())

    async def _teleport_to(
        self, spot: Coordinate, cooldown: "CooldownTimer | None",
    ) -> bool:
        """Jump to ``spot``, respecting the cooldown. Returns True when stopped.

        Deliberately does not call ``engine.teleport()``: that stops the
        active task, which is this handler.
        """
        engine = self.engine
        # A jump is a single push, so it would bypass the movement loop's
        # pause check — honour a pause here instead.
        await engine._pause_event.wait()
        if engine._stop_event.is_set():
            return True
        here = engine.current_position
        if here is not None and haversine_m(
            here.lat, here.lng, spot.lat, spot.lng,
        ) <= _ARRIVED_THRESHOLD_M:
            return False

        if cooldown is not None and cooldown.enabled and cooldown.is_active:
            remaining = float(cooldown.remaining)
            if remaining > 0 and await pause_with_countdown(
                engine, remaining, _PAUSE_SOURCE,
            ):
                return True

        await engine._set_position(spot.lat, spot.lng)
        await engine._emit("teleport", {"lat": spot.lat, "lng": spot.lng})
        await engine._emit("position_update", {"lat": spot.lat, "lng": spot.lng})

        if cooldown is not None and cooldown.enabled and here is not None:
            await cooldown.start(here.lat, here.lng, spot.lat, spot.lng)
        return False
