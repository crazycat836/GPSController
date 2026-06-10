"""Tests for the WiFi keep-alive loop.

The loop re-asserts an idle engine's current virtual location when the
keep-alive flag is on, skips engines that are actively moving, and no-ops
entirely while the flag is off. Network / device access is mocked; the
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


def _make_engine(state, pos):
    """A fake SimulationEngine exposing the two attributes + the one method
    the keep-alive loop touches."""
    return SimpleNamespace(state=state, current_position=pos, teleport=AsyncMock())


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
    with patch.object(wifi_keepalive, "KEEPALIVE_INTERVAL_S", 0.01), \
         patch("context.ctx", SimpleNamespace(app_state=app_state)):
        task = asyncio.create_task(wifi_keepalive.wifi_keepalive_loop(stop))
        await asyncio.sleep(0.05)  # allow a few ticks
        stop.set()
        await asyncio.wait_for(task, timeout=1.0)


def test_keepalive_reasserts_idle_engine_with_position():
    from models.schemas import Coordinate, SimulationState

    engine = _make_engine(SimulationState.IDLE, Coordinate(lat=25.0, lng=121.5))
    asyncio.run(_run_one_tick(True, {"udid-1": engine}))

    engine.teleport.assert_awaited_with(25.0, 121.5)


def test_keepalive_skips_when_disabled():
    from models.schemas import Coordinate, SimulationState

    engine = _make_engine(SimulationState.IDLE, Coordinate(lat=25.0, lng=121.5))
    asyncio.run(_run_one_tick(False, {"udid-1": engine}))

    engine.teleport.assert_not_called()


def test_keepalive_skips_non_idle_engine():
    from models.schemas import Coordinate, SimulationState

    engine = _make_engine(SimulationState.NAVIGATING, Coordinate(lat=25.0, lng=121.5))
    asyncio.run(_run_one_tick(True, {"udid-1": engine}))

    engine.teleport.assert_not_called()


def test_keepalive_skips_engine_without_position():
    from models.schemas import SimulationState

    engine = _make_engine(SimulationState.IDLE, None)
    asyncio.run(_run_one_tick(True, {"udid-1": engine}))

    engine.teleport.assert_not_called()


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
