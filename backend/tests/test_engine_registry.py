"""Characterization tests for AppState's engine-registry concurrency protocol.

Pins the CURRENT behavior of ``state.AppState`` (no production changes):

  * ``create_engine_for_device`` — first device claims the primary slot,
    later devices become secondaries; re-creating for an existing udid
    stops the displaced engine *under the registry lock*.
  * ``terminate_engine`` — stops the engine, removes it from the registry,
    and promotes the next udid to primary when the primary was removed.
  * Concurrent create + terminate for the same udid never leaves a
    displaced engine whose ``stop()`` was skipped.
  * ``terminate_engine`` cancels the in-flight ``dual-sync-{udid}`` task
    before touching the registry.
  * Dual-device auto-sync (``_sync_new_device_to_primary``) — when a
    secondary connects while the primary engine holds a snapshot, the
    secondary is teleported to the primary's current position and the
    snapshot-matching engine call (e.g. ``start_loop`` with lap_count /
    pause fields) is replayed on it.

Following the repo convention (see test_websocket_initial_state.py) these
are sync tests driving coroutines via ``asyncio.run``. AppState is built
via ``__new__`` with only the attributes the registry methods touch — no
DeviceManager / settings I/O / BookmarkManager. ``SimulationEngine``
construction is monkeypatched at its module seam
(``core.simulation_engine.SimulationEngine``), which the late import in
``create_engine_for_device`` resolves at call time.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))


# ─── Fakes / harness ─────────────────────────────────────────────────


def _make_fake_engine_class():
    """A fresh fake-SimulationEngine class per test.

    Records every constructed instance plus each movement-method call so
    tests can assert exactly what AppState drove. ``stop()`` yields once
    to the loop so concurrent create/terminate orderings interleave the
    way the real (awaiting) engine would.
    """

    class FakeEngine:
        instances: list["FakeEngine"] = []
        # When set, teleport blocks on this event — used to hold a
        # dual-sync task in flight so cancellation can be observed.
        teleport_gate: asyncio.Event | None = None

        def __init__(self, loc_service, event_callback):
            self.loc_service = loc_service
            self.event_callback = event_callback
            self.stop_calls = 0
            self.calls: list[tuple[str, dict]] = []
            self.snapshot = None
            self.current_position = None
            FakeEngine.instances.append(self)

        async def stop(self):
            self.stop_calls += 1
            await asyncio.sleep(0)

        async def teleport(self, lat, lng):
            if FakeEngine.teleport_gate is not None:
                await FakeEngine.teleport_gate.wait()
            self.calls.append(("teleport", {"lat": lat, "lng": lng}))

        async def navigate(self, destination, movement_mode, **kwargs):
            self.calls.append(
                ("navigate", {"destination": destination, "movement_mode": movement_mode, **kwargs})
            )

        async def start_loop(self, waypoints, movement_mode, **kwargs):
            self.calls.append(
                ("start_loop", {"waypoints": waypoints, "movement_mode": movement_mode, **kwargs})
            )

        async def multi_stop(self, waypoints, movement_mode, **kwargs):
            self.calls.append(
                ("multi_stop", {"waypoints": waypoints, "movement_mode": movement_mode, **kwargs})
            )

        async def random_walk(self, center, radius_m, movement_mode, **kwargs):
            self.calls.append(
                ("random_walk", {"center": center, "radius_m": radius_m,
                                 "movement_mode": movement_mode, **kwargs})
            )

    return FakeEngine


def _make_state():
    """AppState via __new__ with only the registry-protocol attributes.

    Mirrors the _StubAppState approach in test_websocket_initial_state.py:
    the real __init__ pulls in settings I/O / BookmarkManager / the WS
    broadcaster, none of which the registry methods need.
    """
    from state import AppState

    state = AppState.__new__(AppState)
    state.simulation_engines = {}
    state._primary_udid = None
    state._sync_tasks = set()
    state._engine_lock = asyncio.Lock()
    state.device_manager = SimpleNamespace(
        get_location_service=AsyncMock(return_value=MagicMock(name="loc_service")),
    )
    return state


@pytest.fixture()
def fake_engine_cls(monkeypatch):
    """Patch SimulationEngine at the seam create_engine_for_device imports."""
    import core.simulation_engine as se_mod

    cls = _make_fake_engine_class()
    monkeypatch.setattr(se_mod, "SimulationEngine", cls)
    return cls


async def _drain_sync_tasks(state) -> None:
    """Await every in-flight dual-sync task so assertions are deterministic."""
    while state._sync_tasks:
        await asyncio.gather(*list(state._sync_tasks), return_exceptions=True)


# ─── (a) Primary-slot rules + promotion on terminate ─────────────────


def test_first_device_becomes_primary_second_does_not_hijack(fake_engine_cls):
    """First connect claims the primary slot; a later connect stays secondary."""

    async def _run():
        state = _make_state()
        await state.create_engine_for_device("udid-A")
        await state.create_engine_for_device("udid-B")
        await _drain_sync_tasks(state)
        return state

    state = asyncio.run(_run())
    assert state._primary_udid == "udid-A"
    assert set(state.simulation_engines) == {"udid-A", "udid-B"}
    # Legacy accessor resolves to the primary's engine.
    assert state.simulation_engine is state.simulation_engines["udid-A"]


def test_terminate_primary_promotes_next_udid(fake_engine_cls):
    """Terminating the primary stops its engine and promotes the next udid."""

    async def _run():
        state = _make_state()
        await state.create_engine_for_device("udid-A")
        await state.create_engine_for_device("udid-B")
        await _drain_sync_tasks(state)
        engine_a = state.simulation_engines["udid-A"]
        await state.terminate_engine("udid-A")
        return state, engine_a

    state, engine_a = asyncio.run(_run())
    assert engine_a.stop_calls == 1
    assert "udid-A" not in state.simulation_engines
    assert state._primary_udid == "udid-B"
    assert state.simulation_engine is state.simulation_engines["udid-B"]


def test_terminate_secondary_keeps_primary(fake_engine_cls):
    """Terminating a secondary must not move the primary slot."""

    async def _run():
        state = _make_state()
        await state.create_engine_for_device("udid-A")
        await state.create_engine_for_device("udid-B")
        await _drain_sync_tasks(state)
        await state.terminate_engine("udid-B")
        return state

    state = asyncio.run(_run())
    assert state._primary_udid == "udid-A"
    assert set(state.simulation_engines) == {"udid-A"}


def test_terminate_last_engine_leaves_primary_none(fake_engine_cls):
    """Removing the only engine resets the primary slot to None."""

    async def _run():
        state = _make_state()
        await state.create_engine_for_device("udid-A")
        await state.terminate_engine("udid-A")
        return state

    state = asyncio.run(_run())
    assert state.simulation_engines == {}
    assert state._primary_udid is None
    assert state.simulation_engine is None


def test_terminate_unknown_udid_is_a_noop(fake_engine_cls):
    """Unknown udid: no error, registry and primary untouched."""

    async def _run():
        state = _make_state()
        await state.create_engine_for_device("udid-A")
        await state.terminate_engine("udid-ghost")
        return state

    state = asyncio.run(_run())
    assert set(state.simulation_engines) == {"udid-A"}
    assert state._primary_udid == "udid-A"
    assert state.simulation_engines["udid-A"].stop_calls == 0


# ─── (b) Concurrent create + terminate never skips a stop() ──────────


def test_recreate_for_same_udid_stops_displaced_engine_under_lock(fake_engine_cls):
    """Re-creating an engine for an existing udid stops the old one inline."""

    async def _run():
        state = _make_state()
        await state.create_engine_for_device("udid-A")
        first = state.simulation_engines["udid-A"]
        await state.create_engine_for_device("udid-A")
        return state, first

    state, first = asyncio.run(_run())
    assert first.stop_calls == 1
    second = state.simulation_engines["udid-A"]
    assert second is not first
    assert second.stop_calls == 0
    assert state._primary_udid == "udid-A"


def test_concurrent_create_and_terminate_never_skips_stop(fake_engine_cls):
    """gather(create, terminate) for the same udid: every engine that is no
    longer the live registry entry had stop() awaited, and the surviving
    entry (if any) was never stopped. Pins the inlined stop-under-lock in
    create_engine_for_device + the lock-serialised terminate path."""

    async def _run():
        state = _make_state()
        await state.create_engine_for_device("udid-A")
        await asyncio.gather(
            state.create_engine_for_device("udid-A"),
            state.terminate_engine("udid-A"),
        )
        return state

    state = asyncio.run(_run())
    survivor = state.simulation_engines.get("udid-A")
    for engine in fake_engine_cls.instances:
        if engine is survivor:
            assert engine.stop_calls == 0, "live engine must not have been stopped"
        else:
            assert engine.stop_calls >= 1, "displaced engine's stop() was skipped"
    # Primary slot stays consistent with the registry contents.
    if survivor is None:
        assert state._primary_udid is None
    else:
        assert state._primary_udid == "udid-A"


def test_terminate_cancels_inflight_dual_sync_task(fake_engine_cls):
    """terminate_engine(udid) cancels the dual-sync-{udid} task before
    stopping the engine, so a half-run sync can't resurrect movement."""
    from core.simulation_engine import SimulationSnapshot
    from models.schemas import Coordinate

    async def _run():
        state = _make_state()
        await state.create_engine_for_device("udid-A")
        primary = state.simulation_engines["udid-A"]
        primary.snapshot = SimulationSnapshot(
            mode="loop",
            movement_mode="walking",
            waypoints=[{"lat": 25.0, "lng": 121.5}],
        )
        primary.current_position = Coordinate(lat=25.0, lng=121.5)

        # Hold the secondary's teleport so the sync task stays in flight.
        fake_engine_cls.teleport_gate = asyncio.Event()
        await state.create_engine_for_device("udid-B")
        await asyncio.sleep(0)  # let the dual-sync task enter teleport()

        sync_tasks = [t for t in state._sync_tasks if t.get_name() == "dual-sync-udid-B"]
        assert len(sync_tasks) == 1
        sync_task = sync_tasks[0]

        engine_b = state.simulation_engines["udid-B"]
        await state.terminate_engine("udid-B")
        await asyncio.sleep(0)  # let cancellation propagate
        return state, sync_task, engine_b

    state, sync_task, engine_b = asyncio.run(_run())
    assert sync_task.cancelled()
    assert engine_b.stop_calls == 1
    assert "udid-B" not in state.simulation_engines
    # Cancelled mid-teleport: the loop replay never reached the engine.
    assert engine_b.calls == []


# ─── (c) Dual-device snapshot replay ─────────────────────────────────


def test_secondary_connect_replays_loop_snapshot(fake_engine_cls):
    """Secondary connecting while the primary runs a loop: teleport to the
    primary's position, then start_loop with the snapshot's waypoints,
    lap_count and pause fields."""
    from core.simulation_engine import SimulationSnapshot
    from models.schemas import Coordinate, MovementMode

    async def _run():
        state = _make_state()
        await state.create_engine_for_device("udid-A")
        primary = state.simulation_engines["udid-A"]
        primary.snapshot = SimulationSnapshot(
            mode="loop",
            movement_mode="walking",
            speed_kmh=5.5,
            speed_min_kmh=4.0,
            speed_max_kmh=7.0,
            waypoints=[
                {"lat": 25.033, "lng": 121.5654},
                {"lat": 25.047, "lng": 121.5170},
            ],
            pause_enabled=True,
            pause_min=1.5,
            pause_max=4.5,
            straight_line=True,
            lap_count=3,
        )
        primary.current_position = Coordinate(lat=25.0400, lng=121.5400)

        await state.create_engine_for_device("udid-B")
        await _drain_sync_tasks(state)
        return state.simulation_engines["udid-B"]

    engine_b = asyncio.run(_run())
    assert [name for name, _ in engine_b.calls] == ["teleport", "start_loop"]

    teleport_args = engine_b.calls[0][1]
    assert teleport_args == {"lat": 25.0400, "lng": 121.5400}

    loop_args = engine_b.calls[1][1]
    assert loop_args["waypoints"] == [
        Coordinate(lat=25.033, lng=121.5654),
        Coordinate(lat=25.047, lng=121.5170),
    ]
    assert loop_args["movement_mode"] == MovementMode.WALKING
    assert loop_args["speed_kmh"] == 5.5
    assert loop_args["speed_min_kmh"] == 4.0
    assert loop_args["speed_max_kmh"] == 7.0
    assert loop_args["pause_enabled"] is True
    assert loop_args["pause_min"] == 1.5
    assert loop_args["pause_max"] == 4.5
    assert loop_args["straight_line"] is True
    assert loop_args["lap_count"] == 3


def test_secondary_connect_replays_navigate_snapshot(fake_engine_cls):
    """Navigate snapshot: teleport then navigate(destination, mode, speeds)."""
    from core.simulation_engine import SimulationSnapshot
    from models.schemas import Coordinate, MovementMode

    async def _run():
        state = _make_state()
        await state.create_engine_for_device("udid-A")
        primary = state.simulation_engines["udid-A"]
        primary.snapshot = SimulationSnapshot(
            mode="navigate",
            movement_mode="driving",
            speed_kmh=42.0,
            destination={"lat": 24.99, "lng": 121.30},
            straight_line=False,
        )
        primary.current_position = Coordinate(lat=25.01, lng=121.46)

        await state.create_engine_for_device("udid-B")
        await _drain_sync_tasks(state)
        return state.simulation_engines["udid-B"]

    engine_b = asyncio.run(_run())
    assert [name for name, _ in engine_b.calls] == ["teleport", "navigate"]
    nav_args = engine_b.calls[1][1]
    assert nav_args["destination"] == Coordinate(lat=24.99, lng=121.30)
    assert nav_args["movement_mode"] == MovementMode.DRIVING
    assert nav_args["speed_kmh"] == 42.0
    assert nav_args["straight_line"] is False
    # Navigate replay does NOT forward lap_count / pause fields (4-way
    # dispatch passes them only for loop / multi_stop / random_walk).
    assert "lap_count" not in nav_args
    assert "pause_enabled" not in nav_args


def test_secondary_connect_with_idle_primary_does_nothing(fake_engine_cls):
    """Primary idle (snapshot is None) → no teleport, no replay."""
    async def _run():
        state = _make_state()
        await state.create_engine_for_device("udid-A")
        # primary.snapshot stays None
        await state.create_engine_for_device("udid-B")
        await _drain_sync_tasks(state)
        return state.simulation_engines["udid-B"]

    engine_b = asyncio.run(_run())
    assert engine_b.calls == []


def test_secondary_connect_with_unknown_movement_mode_skips_replay(fake_engine_cls):
    """Snapshot carrying an unknown movement_mode is rejected up front —
    no teleport, no sync task spawned."""
    from core.simulation_engine import SimulationSnapshot
    from models.schemas import Coordinate

    async def _run():
        state = _make_state()
        await state.create_engine_for_device("udid-A")
        primary = state.simulation_engines["udid-A"]
        primary.snapshot = SimulationSnapshot(
            mode="loop",
            movement_mode="teleporting",  # not a MovementMode value
            waypoints=[{"lat": 25.0, "lng": 121.5}],
        )
        primary.current_position = Coordinate(lat=25.0, lng=121.5)

        await state.create_engine_for_device("udid-B")
        await _drain_sync_tasks(state)
        return state, state.simulation_engines["udid-B"]

    state, engine_b = asyncio.run(_run())
    assert engine_b.calls == []
    assert state._sync_tasks == set()
