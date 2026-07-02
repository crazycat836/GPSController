"""Replayable snapshot of a running simulation (dual-device sync)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Literal

from config import DEFAULT_PAUSE_ENABLED, DEFAULT_PAUSE_MAX, DEFAULT_PAUSE_MIN
from models.schemas import Coordinate, MovementMode

if TYPE_CHECKING:
    from core.simulation_engine import SimulationEngine


SnapshotMode = Literal["navigate", "loop", "multi_stop", "random_walk"]


@dataclass
class SimulationSnapshot:
    """Replayable description of a running simulation.

    When a secondary device joins while the primary is already mid-action,
    AppState hands this structure to the secondary's engine so both phones
    end up following the same plan from the primary's current position.
    Teleport/joystick are not snapshotted — teleport is a single-shot and
    joystick is driven interactively from the frontend.
    """

    mode: SnapshotMode
    movement_mode: str  # MovementMode.value
    speed_kmh: float | None = None
    speed_min_kmh: float | None = None
    speed_max_kmh: float | None = None
    # navigate
    destination: dict | None = None  # {lat, lng}
    # loop / multi_stop
    waypoints: list[dict] = field(default_factory=list)  # list of {lat, lng}
    # multi_stop extras
    stop_duration: float = 0.0
    loop_multistop: bool = False
    # random_walk
    center: dict | None = None  # {lat, lng}
    radius_m: float | None = None
    seed: int | None = None
    # shared options
    pause_enabled: bool = DEFAULT_PAUSE_ENABLED
    pause_min: float = DEFAULT_PAUSE_MIN
    pause_max: float = DEFAULT_PAUSE_MAX
    straight_line: bool = False
    # Loop / MultiStop lap cap. Positive = stop after N laps; None =
    # unlimited (previous behaviour). Must survive a snapshot/restore
    # so a reconnecting follower device doesn't run the route forever.
    lap_count: int | None = None

    async def replay_on(self, engine: "SimulationEngine") -> None:
        """Start this snapshot's mode on *engine* with the captured options.

        Lives here so the replay kwargs sit next to the snapshot fields
        and the engine methods whose signatures they mirror — an engine
        signature change and its dual-device replay now evolve in one
        file instead of silently diverging across modules.

        The caller (core.dual_sync) is responsible for anchoring
        *engine* at the primary's current position first (teleport), and
        for validating ``movement_mode`` before spawning the replay task
        — ``MovementMode(...)`` here raises ``ValueError`` on an unknown
        value.

        Deliberate asymmetry: the navigate branch does NOT forward
        lap_count / pause fields — ``navigate()`` takes neither, and the
        replay has always passed them only for loop / multi_stop /
        random_walk.
        """
        mmode = MovementMode(self.movement_mode)
        if self.mode == "navigate" and self.destination:
            await engine.navigate(
                Coordinate(lat=self.destination["lat"], lng=self.destination["lng"]),
                mmode,
                speed_kmh=self.speed_kmh,
                speed_min_kmh=self.speed_min_kmh,
                speed_max_kmh=self.speed_max_kmh,
                straight_line=self.straight_line,
            )
        elif self.mode == "loop" and self.waypoints:
            wps = [Coordinate(lat=w["lat"], lng=w["lng"]) for w in self.waypoints]
            await engine.start_loop(
                wps, mmode,
                speed_kmh=self.speed_kmh,
                speed_min_kmh=self.speed_min_kmh,
                speed_max_kmh=self.speed_max_kmh,
                pause_enabled=self.pause_enabled,
                pause_min=self.pause_min,
                pause_max=self.pause_max,
                straight_line=self.straight_line,
                lap_count=self.lap_count,
            )
        elif self.mode == "multi_stop" and self.waypoints:
            wps = [Coordinate(lat=w["lat"], lng=w["lng"]) for w in self.waypoints]
            await engine.multi_stop(
                wps, mmode,
                stop_duration=self.stop_duration,
                loop=self.loop_multistop,
                speed_kmh=self.speed_kmh,
                speed_min_kmh=self.speed_min_kmh,
                speed_max_kmh=self.speed_max_kmh,
                pause_enabled=self.pause_enabled,
                pause_min=self.pause_min,
                pause_max=self.pause_max,
                straight_line=self.straight_line,
                lap_count=self.lap_count,
            )
        elif self.mode == "random_walk" and self.center and self.radius_m:
            await engine.random_walk(
                Coordinate(lat=self.center["lat"], lng=self.center["lng"]),
                self.radius_m, mmode,
                speed_kmh=self.speed_kmh,
                speed_min_kmh=self.speed_min_kmh,
                speed_max_kmh=self.speed_max_kmh,
                pause_enabled=self.pause_enabled,
                pause_min=self.pause_min,
                pause_max=self.pause_max,
                seed=self.seed,
                straight_line=self.straight_line,
            )
