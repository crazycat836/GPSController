"""Flower mode: circle geometry and handler sequencing.

Device access is faked with a recording LocationService. Most sequencing
tests replace ``engine._move_along_route`` with a recorder that jumps to
the last coordinate, so they exercise the handler's ordering without
wall-clock movement; one test runs the real movement loop end to end.
"""

from __future__ import annotations

import asyncio
import math
import sys
from pathlib import Path

import pytest

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from core.flower import circle_path, circle_points, path_length_m  # noqa: E402
from models.schemas import (  # noqa: E402
    Coordinate,
    FlowerRequest,
    MovementMode,
    SimulationState,
)
from services.route_service import RouteUnavailableError  # noqa: E402
from utils.geo import haversine_m  # noqa: E402

CENTER = Coordinate(lat=25.0330, lng=121.5654)
# 1 % tolerance on distances — the equirectangular offset is approximate.
DIST_TOL = 0.01


def _dist(a: Coordinate, b: Coordinate) -> float:
    return haversine_m(a.lat, a.lng, b.lat, b.lng)


# ── Geometry ─────────────────────────────────────────────────────────────

@pytest.mark.parametrize("radius_m", [5.0, 20.0, 100.0])
@pytest.mark.parametrize("segments", [6, 12, 24])
def test_circle_points_count_and_radius(radius_m, segments):
    pts = circle_points(CENTER, radius_m, segments)
    assert len(pts) == segments
    for p in pts:
        assert _dist(CENTER, p) == pytest.approx(radius_m, rel=DIST_TOL)


def test_circle_points_are_evenly_spaced():
    pts = circle_points(CENTER, 20.0, 12)
    chords = [_dist(pts[i], pts[(i + 1) % 12]) for i in range(12)]
    expected = 2 * 20.0 * math.sin(math.pi / 12)
    for c in chords:
        assert c == pytest.approx(expected, rel=DIST_TOL)


def test_circle_points_at_high_latitude_keep_radius():
    north = Coordinate(lat=69.6, lng=18.9)
    for p in circle_points(north, 30.0, 12):
        assert _dist(north, p) == pytest.approx(30.0, rel=DIST_TOL)


def test_circle_path_full_lap_starts_and_ends_at_centre():
    path = circle_path(CENTER, 20.0, 12, 1.0)
    assert path[0] == CENTER
    assert path[-1] == CENTER
    # centre + 13 vertices (back to the first) + centre
    assert len(path) == 12 + 3
    assert path[1] == path[13]
    for p in path[1:-1]:
        assert _dist(CENTER, p) == pytest.approx(20.0, rel=DIST_TOL)


def test_circle_path_half_lap_on_vertex():
    path = circle_path(CENTER, 20.0, 12, 0.5)
    # centre + vertices 0..6 + centre
    assert len(path) == 7 + 2
    # Ends diametrically opposite the start vertex.
    assert _dist(path[1], path[-2]) == pytest.approx(40.0, rel=DIST_TOL)


def test_circle_path_half_lap_between_vertices_ends_on_exact_angle():
    # 7 segments: half a lap (π) falls between vertex 3 and vertex 4.
    path = circle_path(CENTER, 20.0, 7, 0.5)
    assert len(path) == 4 + 1 + 2  # vertices 0..3, exact end point, centres
    assert _dist(CENTER, path[-2]) == pytest.approx(20.0, rel=DIST_TOL)
    assert _dist(path[1], path[-2]) == pytest.approx(40.0, rel=DIST_TOL)


@pytest.mark.parametrize("laps", [0.5, 1.0, 2.5, 10.0])
def test_circle_path_length_matches_laps(laps):
    radius, segments = 20.0, 24
    length = path_length_m(circle_path(CENTER, radius, segments, laps))
    polygon_lap = segments * 2 * radius * math.sin(math.pi / segments)
    assert length == pytest.approx(2 * radius + laps * polygon_lap, rel=DIST_TOL)


def test_request_snaps_laps_to_half_steps_and_bounds():
    wp = [{"lat": 25.0, "lng": 121.5}]
    assert FlowerRequest(waypoints=wp, laps=1.3).laps == 1.5
    assert FlowerRequest(waypoints=wp, laps=1.2).laps == 1.0
    req = FlowerRequest(waypoints=wp)
    assert (req.radius_m, req.segments, req.laps, req.rounds) == (20.0, 12, 1.0, 1)
    assert (req.wait_before_s, req.wait_after_s, req.transfer) == (0.0, 0.0, "walk")
    assert FlowerRequest(waypoints=wp, rounds=None).rounds is None
    from pydantic import ValidationError
    for bad in ({"radius_m": 4}, {"radius_m": 101}, {"segments": 5}, {"segments": 25},
                {"laps": 0.4}, {"laps": 10.5}, {"rounds": 0}, {"rounds": 100},
                {"wait_before_s": 601}, {"transfer": "fly"}, {"waypoints": []}):
        with pytest.raises(ValidationError):
            FlowerRequest(**({"waypoints": wp} | bad))


# ── Handler sequencing ──────────────────────────────────────────────────

class FakeLocationService:
    def __init__(self) -> None:
        self.calls: list[tuple[float, float]] = []

    async def set(self, lat: float, lng: float) -> None:
        self.calls.append((lat, lng))


class EventRecorder:
    def __init__(self) -> None:
        self.events: list[tuple[str, dict]] = []

    async def __call__(self, event_type: str, data: dict) -> None:
        self.events.append((event_type, data))

    def types(self) -> list[str]:
        return [t for t, _ in self.events]

    def states(self) -> list[str]:
        return [d["state"] for t, d in self.events if t == "state_change"]


def _make_engine(record_moves: bool = True):
    from core.simulation_engine import SimulationEngine

    service = FakeLocationService()
    recorder = EventRecorder()
    engine = SimulationEngine(service, event_callback=recorder)
    moves: list[list[Coordinate]] = []
    if record_moves:
        async def fake_move(coords, speed_profile):
            moves.append(list(coords))
            recorder.events.append(("move", {"n": len(coords)}))
            last = coords[-1]
            await engine._set_position(last.lat, last.lng)

        engine._move_along_route = fake_move  # type: ignore[method-assign]
    return engine, service, recorder, moves


def _spots() -> list[Coordinate]:
    return [
        Coordinate(lat=25.0000, lng=121.5000),
        Coordinate(lat=25.0005, lng=121.5000),  # ~55 m north
    ]


def test_walk_transfer_sequence_per_spot():
    async def scenario():
        engine, _service, recorder, moves = _make_engine()
        engine.current_position = Coordinate(lat=24.9995, lng=121.5000)
        spots = _spots()

        await engine.flower(
            spots, MovementMode.WALKING,
            radius_m=10.0, segments=6, laps=1.0, rounds=1,
            wait_before_s=0.01, wait_after_s=0.01,
            transfer="walk", straight_line=True,
        )

        assert engine.state == SimulationState.IDLE
        assert recorder.states() == ["flower", "idle"]
        # transfer, circle for each spot
        assert len(moves) == 4
        for i, spot in enumerate(spots):
            transfer, circle = moves[2 * i], moves[2 * i + 1]
            assert transfer[-1].lat == pytest.approx(spot.lat)
            assert transfer[-1].lng == pytest.approx(spot.lng)
            assert circle == circle_path(spot, 10.0, 6, 1.0)

        # arrive → wait_before → circle → wait_after, per spot
        seq = [t for t in recorder.types()
               if t in ("move", "waypoint_progress", "pause_countdown")]
        assert seq == ["move", "waypoint_progress", "pause_countdown", "move", "pause_countdown"] * 2
        sources = {d["source"] for t, d in recorder.events if t == "pause_countdown"}
        assert sources == {"flower"}
        progress = [d for t, d in recorder.events if t == "waypoint_progress"]
        assert [p["current_index"] for p in progress] == [0, 1]
        assert all(p["total"] == 2 for p in progress)
        laps = [d for t, d in recorder.events if t == "lap_complete"]
        assert laps == [{"lap": 1, "total": 1}]
        assert engine.snapshot is None

    asyncio.run(scenario())


def test_walk_transfer_skipped_when_already_at_spot():
    async def scenario():
        engine, _service, _recorder, moves = _make_engine()
        spot = _spots()[0]
        engine.current_position = spot

        await engine.flower(
            [spot], MovementMode.WALKING,
            radius_m=20.0, segments=12, laps=0.5, rounds=1,
            transfer="walk", straight_line=True,
        )

        assert moves == [circle_path(spot, 20.0, 12, 0.5)]

    asyncio.run(scenario())


def test_teleport_transfer_pushes_exact_spot_and_emits_teleport():
    async def scenario():
        engine, service, recorder, moves = _make_engine()
        engine.current_position = Coordinate(lat=24.99, lng=121.49)
        spots = _spots()

        await engine.flower(
            spots, MovementMode.WALKING,
            radius_m=10.0, segments=6, laps=1.0, rounds=1,
            transfer="teleport",
        )

        teleports = [d for t, d in recorder.events if t == "teleport"]
        assert teleports == [{"lat": s.lat, "lng": s.lng} for s in spots]
        assert (spots[0].lat, spots[0].lng) in service.calls
        # Only the circles are walked.
        assert moves == [circle_path(s, 10.0, 6, 1.0) for s in spots]

    asyncio.run(scenario())


def test_teleport_transfer_without_position_is_allowed():
    async def scenario():
        engine, _service, recorder, _moves = _make_engine()
        spot = _spots()[0]

        await engine.flower(
            [spot], MovementMode.WALKING,
            radius_m=10.0, segments=6, laps=1.0, rounds=1, transfer="teleport",
        )

        assert recorder.states() == ["flower", "idle"]
        assert engine.current_position is not None

    asyncio.run(scenario())


class FakeCooldown:
    def __init__(self, remaining: float) -> None:
        self.enabled = True
        self.is_active = remaining > 0
        self.remaining = remaining
        self.starts: list[tuple[float, float, float, float]] = []

    async def start(self, a_lat, a_lng, b_lat, b_lng) -> None:
        self.starts.append((a_lat, a_lng, b_lat, b_lng))


def test_teleport_hop_waits_out_active_cooldown_then_starts_one():
    async def scenario():
        engine, _service, recorder, _moves = _make_engine()
        engine.current_position = Coordinate(lat=24.99, lng=121.49)
        spot = _spots()[0]
        cooldown = FakeCooldown(remaining=0.01)

        await engine.flower(
            [spot], MovementMode.WALKING,
            radius_m=10.0, segments=6, laps=1.0, rounds=1,
            transfer="teleport", cooldown=cooldown,
        )

        types = recorder.types()
        assert types.index("pause_countdown") < types.index("teleport")
        assert cooldown.starts == [(24.99, 121.49, spot.lat, spot.lng)]

    asyncio.run(scenario())


def test_multiple_rounds_emit_lap_complete_and_repeat_spots():
    async def scenario():
        engine, _service, recorder, moves = _make_engine()
        engine.current_position = _spots()[0]

        await engine.flower(
            _spots(), MovementMode.WALKING,
            radius_m=10.0, segments=6, laps=1.0, rounds=3,
            transfer="teleport",
        )

        laps = [d for t, d in recorder.events if t == "lap_complete"]
        assert laps == [{"lap": i, "total": 3} for i in (1, 2, 3)]
        assert len(moves) == 6  # two circles per round
        assert engine.lap_count == 3

    asyncio.run(scenario())


def test_unlimited_rounds_run_until_stopped():
    async def scenario():
        engine, _service, recorder, _moves = _make_engine()
        engine.current_position = _spots()[0]

        task = asyncio.create_task(engine.flower(
            _spots(), MovementMode.WALKING,
            radius_m=10.0, segments=6, laps=1.0, rounds=None,
            wait_after_s=0.005, transfer="teleport",
        ))
        while engine.lap_count < 3:
            await asyncio.sleep(0.005)
        assert engine.state == SimulationState.FLOWER
        assert engine.snapshot is not None and engine.snapshot.mode == "flower"
        await engine.stop()
        await asyncio.wait_for(task, 2.0)

        assert engine.state == SimulationState.IDLE
        assert engine.snapshot is None
        assert all(d["total"] is None for t, d in recorder.events if t == "lap_complete")

    asyncio.run(scenario())


def test_stop_during_wait_ends_run():
    async def scenario():
        engine, _service, _recorder, moves = _make_engine()
        engine.current_position = _spots()[0]

        task = asyncio.create_task(engine.flower(
            _spots(), MovementMode.WALKING,
            radius_m=10.0, segments=6, laps=1.0, rounds=1,
            wait_before_s=30.0, transfer="teleport",
        ))
        while engine.state != SimulationState.FLOWER:
            await asyncio.sleep(0.005)
        await asyncio.sleep(0.02)
        await engine.stop()
        await asyncio.wait_for(task, 2.0)

        assert engine.state == SimulationState.IDLE
        assert moves == []  # stopped before the first circle

    asyncio.run(scenario())


def test_unroutable_walk_leg_aborts_and_reraises():
    async def scenario():
        engine, _service, recorder, moves = _make_engine()
        engine.current_position = Coordinate(lat=24.99, lng=121.49)

        async def boom(*args, **kwargs):
            raise RouteUnavailableError("no route")

        engine.route_service.get_route = boom  # type: ignore[method-assign]

        with pytest.raises(RouteUnavailableError):
            await engine.flower(
                _spots(), MovementMode.WALKING,
                radius_m=10.0, segments=6, laps=1.0, rounds=1, transfer="walk",
            )

        assert engine.state == SimulationState.IDLE
        assert recorder.states()[-1] == "idle"
        assert moves == []

    asyncio.run(scenario())


def test_walk_transfer_requires_position():
    async def scenario():
        engine, _service, _recorder, moves = _make_engine()
        # The handler refuses to start; the engine's crash guard logs it
        # and returns to idle (the API layer answers 400 before this).
        await engine.flower(
            _spots(), MovementMode.WALKING,
            radius_m=10.0, segments=6, laps=1.0, rounds=1, transfer="walk",
        )
        assert engine.state == SimulationState.IDLE
        assert moves == []

    asyncio.run(scenario())


def test_real_movement_walks_the_circle():
    async def scenario():
        engine, service, recorder, _moves = _make_engine(record_moves=False)
        spot = _spots()[0]
        engine.current_position = spot

        await engine.flower(
            [spot], MovementMode.WALKING,
            radius_m=5.0, segments=6, laps=0.5, rounds=1,
            transfer="walk", straight_line=True, speed_kmh=500.0,
        )

        assert recorder.states() == ["flower", "idle"]
        assert service.calls
        # Every pushed point stays inside the circle (plus GPS jitter).
        for lat, lng in service.calls:
            assert haversine_m(spot.lat, spot.lng, lat, lng) <= 5.0 + 3.0

    asyncio.run(scenario())


def test_snapshot_replays_flower_on_secondary_engine():
    from core.simulation_snapshot import SimulationSnapshot

    async def scenario():
        engine, _service, _recorder, moves = _make_engine()
        engine.current_position = _spots()[0]
        snap = SimulationSnapshot(
            mode="flower", movement_mode="walking",
            waypoints=[{"lat": s.lat, "lng": s.lng} for s in _spots()],
            radius_m=10.0, segments=6, laps=1.5, wait_before_s=0.0,
            wait_after_s=0.0, transfer="teleport", lap_count=1,
            pause_enabled=False,
        )

        await snap.replay_on(engine)

        assert moves == [circle_path(s, 10.0, 6, 1.5) for s in _spots()]

    asyncio.run(scenario())


def test_teleport_hop_waits_while_paused():
    async def scenario():
        engine, _service, recorder, _moves = _make_engine()
        engine.current_position = _spots()[0]

        def teleports() -> int:
            return sum(1 for t, _ in recorder.events if t == "teleport")

        task = asyncio.create_task(engine.flower(
            _spots(), MovementMode.WALKING,
            radius_m=10.0, segments=6, laps=1.0, rounds=1,
            wait_after_s=0.05, transfer="teleport",
        ))
        # Pause during the wait after spot 1 (already there, no jump).
        while not any(t == "pause_countdown" for t, _ in recorder.events):
            await asyncio.sleep(0.002)
        await engine.pause()
        await asyncio.sleep(0.15)  # wait elapses while paused
        assert teleports() == 0
        await engine.resume()
        await asyncio.wait_for(task, 2.0)

        assert teleports() == 1
        assert engine.state == SimulationState.IDLE

    asyncio.run(scenario())
