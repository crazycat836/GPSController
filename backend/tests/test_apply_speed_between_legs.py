"""Changing speed while a multi-leg mode is between legs must stick.

Loop, multi-stop and random walk pause between legs / laps. During that
gap no leg is active, and ``apply_speed`` used to reject the change
("no active route"); a change that landed after a leg's last point was
also silently dropped. Both now carry into the next leg.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from config import make_speed_profile  # noqa: E402
from core.simulation_engine import SimulationEngine  # noqa: E402
from models.schemas import Coordinate, SimulationState  # noqa: E402


def _engine() -> SimulationEngine:
    return SimulationEngine(SimpleNamespace(set=AsyncMock(), clear=AsyncMock()))


@pytest.mark.parametrize("state", [
    SimulationState.LOOPING, SimulationState.MULTI_STOP, SimulationState.RANDOM_WALK,
])
def test_between_legs_change_is_used_by_the_next_leg(state):
    engine = _engine()
    engine.state = state  # waiting out a pause: no active leg
    fast = make_speed_profile(40.0)

    assert asyncio.run(engine.apply_speed(fast)) is True
    next_leg = engine.pick_speed_profile("walking", None, None, None)
    assert next_leg["speed_mps"] == pytest.approx(fast["speed_mps"])


def test_change_while_paused_between_legs_is_kept():
    engine = _engine()
    engine.state = SimulationState.PAUSED
    engine._paused_from = SimulationState.LOOPING
    fast = make_speed_profile(25.0)

    assert asyncio.run(engine.apply_speed(fast)) is True
    assert engine.pick_speed_profile("walking", None, None, None)["speed_mps"] == pytest.approx(fast["speed_mps"])


def test_single_leg_navigate_without_route_still_rejects():
    engine = _engine()
    engine.state = SimulationState.NAVIGATING
    assert asyncio.run(engine.apply_speed(make_speed_profile(25.0))) is False
    engine.state = SimulationState.IDLE
    assert asyncio.run(engine.apply_speed(make_speed_profile(25.0))) is False


def test_change_after_last_point_carries_into_next_leg(monkeypatch):
    """A pending change still queued when the leg finishes is promoted to
    the active profile rather than cleared."""
    from core import movement_loop

    engine = _engine()
    engine.state = SimulationState.LOOPING
    slow = make_speed_profile(5.0)
    fast = make_speed_profile(40.0)

    real_push = movement_loop._push_position_with_retry
    pushes = 0

    async def push(eng, lat, lng):
        nonlocal pushes
        pushes += 1
        ok = await real_push(eng, lat, lng)
        # Queue a change as the final point goes out — too late to re-plan.
        if pushes == 2:
            eng._pending_speed_profile = dict(fast)
            eng._speed_was_applied = True
        return ok

    monkeypatch.setattr(movement_loop, "_push_position_with_retry", push)

    async def scenario():
        # Two points a couple of metres apart → a two-point plan.
        coords = [Coordinate(lat=25.0, lng=121.5), Coordinate(lat=25.00001, lng=121.5)]
        monkeypatch.setattr(movement_loop.RouteInterpolator, "interpolate", staticmethod(
            lambda c, *_a, **_k: [
                {"lat": p.lat, "lng": p.lng, "timestamp_offset": 0.0, "seg_idx": 0} for p in c
            ],
        ))
        await engine._move_along_route(coords, slow)

    asyncio.run(scenario())
    assert engine._pending_speed_profile is None
    assert engine.pick_speed_profile("walking", None, None, None)["speed_mps"] == pytest.approx(fast["speed_mps"])
