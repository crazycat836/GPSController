"""Tests for the WiFi keep-alive loop.

The loop re-sends an engine's current virtual location when the keep-alive
flag is on and the device has heard nothing for a few seconds — idle,
paused, or waiting between legs — skips engines that are actively pushing,
and no-ops entirely while the flag is off. Network / device access is mocked; the
loop's ``context.ctx`` lookup is patched with a fake app state so nothing
touches a real device or settings file.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))


def _make_engine(state, pos, last_push_at=0.0):
    """A fake SimulationEngine exposing the attributes + the one method the
    keep-alive loop touches. ``last_push_at=0.0`` means long quiet."""
    return SimpleNamespace(
        state=state, current_position=pos, last_push_at=last_push_at,
        location_active=pos is not None,
        reassert_position=AsyncMock(return_value=True),
    )


async def _run_one_tick(keepalive_enabled, engines):
    """Drive ``wifi_keepalive_loop`` for a few ticks then stop it."""
    from core import wifi_keepalive

    app_state = SimpleNamespace(
        get_wifi_keepalive=lambda: keepalive_enabled,
        simulation_engines=engines,
    )
    stop = asyncio.Event()

    # Tiny interval so the loop ticks almost immediately; patch the context
    # so the loop reads our fake app state instead of the real singleton.
    with patch.object(wifi_keepalive, "KEEPALIVE_TICK_S", 0.01), \
         patch("context.ctx", SimpleNamespace(app_state=app_state)):
        task = asyncio.create_task(wifi_keepalive.wifi_keepalive_loop(stop))
        await asyncio.sleep(0.05)  # allow a few ticks
        stop.set()
        await asyncio.wait_for(task, timeout=1.0)


def test_keepalive_reasserts_idle_engine_with_position():
    from models.schemas import Coordinate, SimulationState

    engine = _make_engine(SimulationState.IDLE, Coordinate(lat=25.0, lng=121.5))
    asyncio.run(_run_one_tick(True, {"udid-1": engine}))

    engine.reassert_position.assert_awaited()


def test_keepalive_skips_when_disabled():
    from models.schemas import Coordinate, SimulationState

    engine = _make_engine(SimulationState.IDLE, Coordinate(lat=25.0, lng=121.5))
    asyncio.run(_run_one_tick(False, {"udid-1": engine}))

    engine.reassert_position.assert_not_called()


def test_keepalive_skips_engine_that_is_actively_pushing():
    import time
    from models.schemas import Coordinate, SimulationState

    engine = _make_engine(
        SimulationState.NAVIGATING, Coordinate(lat=25.0, lng=121.5),
        last_push_at=time.monotonic() + 60,  # always "just pushed"
    )
    asyncio.run(_run_one_tick(True, {"udid-1": engine}))

    engine.reassert_position.assert_not_called()


def test_keepalive_covers_pauses_and_waits_between_legs():
    """A paused run, or a loop sitting in its between-lap countdown, keeps
    its running state but goes quiet — the tunnel must still be fed."""
    from models.schemas import Coordinate, SimulationState

    paused = _make_engine(SimulationState.PAUSED, Coordinate(lat=25.0, lng=121.5))
    waiting = _make_engine(SimulationState.MULTI_STOP, Coordinate(lat=25.1, lng=121.6))
    gone = _make_engine(SimulationState.DISCONNECTED, Coordinate(lat=25.2, lng=121.7))
    asyncio.run(_run_one_tick(True, {"a": paused, "b": waiting, "c": gone}))

    paused.reassert_position.assert_awaited()
    waiting.reassert_position.assert_awaited()
    gone.reassert_position.assert_not_called()


def test_reassert_position_resends_without_changing_state():
    from core.simulation_engine import SimulationEngine
    from models.schemas import SimulationState

    service = SimpleNamespace(set=AsyncMock())
    engine = SimulationEngine(service)
    assert asyncio.run(engine.reassert_position()) is False  # nothing to send yet

    async def scenario():
        await engine._set_position(25.0, 121.5)
        first = engine.last_push_at
        engine.state = SimulationState.PAUSED
        await asyncio.sleep(0.01)
        assert await engine.reassert_position() is True
        return first

    first = asyncio.run(scenario())
    assert service.set.await_count == 2
    assert engine.state == SimulationState.PAUSED
    assert engine.last_push_at > first


def test_keepalive_skips_engine_without_position():
    from models.schemas import SimulationState

    engine = _make_engine(SimulationState.IDLE, None)
    asyncio.run(_run_one_tick(True, {"udid-1": engine}))

    engine.reassert_position.assert_not_called()


def test_keepalive_never_reimposes_location_after_restore():
    """After "restore real GPS" the engine keeps its last position for the
    UI, but the keep-alive must not push it back onto the phone."""
    from models.schemas import Coordinate, SimulationState

    engine = _make_engine(SimulationState.IDLE, Coordinate(lat=25.0, lng=121.5))
    engine.location_active = False
    asyncio.run(_run_one_tick(True, {"udid-1": engine}))

    engine.reassert_position.assert_not_called()


def test_restore_marks_location_inactive_and_reassert_refuses():
    from core.simulation_engine import SimulationEngine

    service = SimpleNamespace(set=AsyncMock(), clear=AsyncMock())
    engine = SimulationEngine(service)

    async def scenario():
        await engine._set_position(25.0, 121.5)
        assert engine.location_active is True
        await engine.restore()
        return await engine.reassert_position()

    assert asyncio.run(scenario()) is False
    assert engine.location_active is False
    assert engine.current_position is not None  # still shown in the UI
    assert service.set.await_count == 1


def test_appstate_keepalive_setting_roundtrips(tmp_path):
    """set/get_wifi_keepalive persists through a fresh AppState load, using
    an isolated settings file so the real user settings are untouched."""
    import config

    settings_file = tmp_path / "settings.json"
    routes_file = tmp_path / "routes.json"
    with patch.object(config, "SETTINGS_FILE", settings_file), \
         patch("state.SETTINGS_FILE", settings_file), \
         patch("state.ROUTES_FILE", routes_file):
        from state import AppState

        s1 = AppState()
        assert s1.get_wifi_keepalive() is False  # default off
        s1.set_wifi_keepalive(True)

        # A brand-new instance must read the persisted value back.
        s2 = AppState()
        assert s2.get_wifi_keepalive() is True
