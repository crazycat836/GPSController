"""Simulation engine -- central orchestrator for all movement modes."""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from models.schemas import (
    Coordinate,
    JoystickInput,
    MovementMode,
    SimulationState,
    SimulationStatus,
)
from services.location_service import DeviceLostError, LocationService
from services.route_service import RouteService
from config import SPEED_PROFILES, SpeedProfile, DEFAULT_PAUSE_ENABLED, DEFAULT_PAUSE_MIN, DEFAULT_PAUSE_MAX

from core.teleport import TeleportHandler
from core.navigator import Navigator
from core.route_loop import RouteLooper
from core.joystick import JoystickHandler
from core.multi_stop import MultiStopNavigator
from core.random_walk import RandomWalkHandler
from core.restore import RestoreHandler

logger = logging.getLogger(__name__)


# Waypoint-pass detection thresholds (WP_HARD_HIT_M / WP_NEAR_M /
# WP_RECEDE_M) live in core.movement_loop alongside the only function
# that uses them.


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


# ── ETA Tracker ──────────────────────────────────────────────────────────

class EtaTracker:
    """Tracks progress and estimates time of arrival for route-based movement."""

    def __init__(self) -> None:
        self.total_distance: float = 0.0
        self.traveled: float = 0.0
        self.speed_mps: float = 0.0
        self.start_time: float = 0.0

    def start(self, total_distance: float, speed_mps: float) -> None:
        """Initialise the tracker at the beginning of a route."""
        self.total_distance = total_distance
        self.traveled = 0.0
        self.speed_mps = max(speed_mps, 0.001)  # avoid division by zero
        self.start_time = time.monotonic()

    def update(self, traveled: float) -> None:
        """Update the distance traveled so far."""
        self.traveled = traveled

    @property
    def progress(self) -> float:
        """Return completion as a fraction 0.0 .. 1.0."""
        if self.total_distance <= 0:
            return 1.0
        return min(self.traveled / self.total_distance, 1.0)

    @property
    def eta_seconds(self) -> float:
        """Estimated seconds remaining."""
        remaining = self.distance_remaining
        if self.speed_mps <= 0:
            return 0.0
        return remaining / self.speed_mps

    @property
    def eta_arrival(self) -> str:
        """ISO-8601 estimated arrival time."""
        secs = self.eta_seconds
        if secs <= 0:
            return ""
        arrival = datetime.now(timezone.utc) + timedelta(seconds=secs)
        return arrival.isoformat(timespec="seconds")

    @property
    def distance_remaining(self) -> float:
        """Meters still to travel."""
        return max(self.total_distance - self.traveled, 0.0)


# ── Simulation Engine ───────────────────────────────────────────────────

class SimulationEngine:
    """Central controller that orchestrates all movement modes.

    Manages state transitions, task lifecycle, pause/resume, and provides
    a unified status object for the UI.

    Parameters
    ----------
    location_service
        A ``LocationService`` instance (DVT or legacy) for the target device.
    event_callback
        Optional async callable ``(event_type: str, data: dict) -> None``
        used to push realtime events over WebSocket.
    """

    def __init__(
        self,
        location_service: LocationService,
        event_callback: Callable[[str, dict[str, Any]], Awaitable[None]] | None = None,
    ) -> None:
        self.location_service = location_service
        self.state: SimulationState = SimulationState.IDLE
        self.current_position: Coordinate | None = None
        self.event_callback = event_callback

        # Most recent long-running action. Populated by navigate/start_loop/
        # multi_stop/random_walk at the moment each begins, cleared when the
        # engine returns to IDLE. AppState reads this to replay the same
        # action on a newly-connected secondary device.
        self.snapshot: SimulationSnapshot | None = None

        # Task management
        self._active_task: asyncio.Task | None = None
        self._paused_from: SimulationState | None = None
        self._pause_event = asyncio.Event()
        self._pause_event.set()  # set = running, clear = paused
        self._stop_event = asyncio.Event()
        # Serialises apply_speed against itself so concurrent /apply-speed
        # requests can't interleave the read-modify-write of
        # `_pending_speed_profile` / `_speed_was_applied`. After acquire,
        # apply_speed re-reads `state` and `_active_route_coords` because
        # _move_along_route's finalize block (movement_loop.py:289-290)
        # may have cleared them while we were queued behind another caller.
        self._apply_speed_lock = asyncio.Lock()

        # Sub-handlers
        self.route_service = RouteService()
        self.eta_tracker = EtaTracker()
        self._teleport_handler = TeleportHandler(self)
        self._navigator = Navigator(self)
        self._looper = RouteLooper(self)
        self._joystick = JoystickHandler(self)
        self._multi_stop = MultiStopNavigator(self)
        self._random_walk = RandomWalkHandler(self)
        self._restore_handler = RestoreHandler(self)

        # Status tracking
        self.distance_traveled: float = 0.0
        self.distance_remaining: float = 0.0
        self.lap_count: int = 0
        self.segment_index: int = 0
        self.total_segments: int = 0
        self._current_speed_mps: float = 0.0
        # Hot-swap speed support (see apply_speed + _move_along_route).
        self._active_route_coords: list[Coordinate] = []
        self._active_speed_profile: "SpeedProfile | None" = None
        self._pending_speed_profile: "SpeedProfile | None" = None
        # User-facing waypoints used for waypoint_progress emission.
        # Set by route_loop / multi_stop / navigator before each call to
        # _move_along_route, so highlight events refer to the named
        # waypoints rather than OSRM-densified polyline points.
        self._user_waypoints: list[Coordinate] = []
        self._user_waypoint_next: int = 0
        # Set by apply_speed so route_loop / multi_stop know to reuse the
        # applied profile on the next lap instead of re-resolving from the
        # original request (which would revert speed every lap).
        self._speed_was_applied: bool = False
        # Extra meters to add to every emitted distance_remaining / ETA while
        # _move_along_route is running. Multi-stop sets this to the sum of
        # future legs' distances so the UI shows total-trip ETA, not just
        # current-leg ETA. Reset to 0 outside multi-stop.
        self._route_offset_remaining: float = 0.0

    # ── Public API ───────────────────────────────────────────

    async def teleport(self, lat: float, lng: float) -> Coordinate:
        """Instantly move to a coordinate."""
        return await self._teleport_handler.teleport(lat, lng)

    async def _run_handler(self, coro, label: str) -> None:
        """Run a simulation handler coroutine with uniform cleanup.
        Any exception or cancellation forces the engine back to IDLE and
        notifies the frontend, preventing UI desync after a crash / drop.
        DeviceLostError is re-raised (after cleanup) so api.location._spawn()
        can translate it into a device_disconnected broadcast — otherwise
        the frontend never learns the tunnel died."""
        self._active_task = asyncio.create_task(coro)
        device_lost: DeviceLostError | None = None
        try:
            await self._active_task
        except asyncio.CancelledError:
            logger.info("%s cancelled", label)
        except DeviceLostError as exc:
            logger.warning("%s aborted: device lost (%s)", label, exc)
            device_lost = exc
        except Exception as exc:
            logger.exception("%s failed unexpectedly", label)
            # Walk the cause chain — DeviceLostError is often re-raised
            # wrapped (e.g. from pymobiledevice3 timeouts).
            cause: BaseException | None = exc
            while cause is not None:
                if isinstance(cause, DeviceLostError):
                    device_lost = cause
                    break
                cause = cause.__cause__
        finally:
            self._active_task = None
            # Force state back to IDLE if a handler crashed / was cancelled
            # mid-flight so the UI doesn't stay stuck showing "navigating".
            if self.state not in (SimulationState.IDLE, SimulationState.DISCONNECTED):
                self.state = SimulationState.IDLE
                try:
                    await self._emit("state_change", {"state": self.state.value})
                except Exception:
                    logger.exception("Failed to emit idle state_change after %s", label)
        if device_lost is not None:
            raise device_lost

    async def navigate(
        self, dest: Coordinate, mode: MovementMode,
        speed_kmh: float | None = None,
        speed_min_kmh: float | None = None,
        speed_max_kmh: float | None = None,
        straight_line: bool = False,
    ) -> None:
        """Navigate from current position to *dest*."""
        await self._ensure_stopped()
        self._stop_event.clear()
        self._pause_event.set()
        self.snapshot = SimulationSnapshot(
            mode="navigate",
            movement_mode=mode.value,
            speed_kmh=speed_kmh,
            speed_min_kmh=speed_min_kmh,
            speed_max_kmh=speed_max_kmh,
            destination={"lat": dest.lat, "lng": dest.lng},
            straight_line=straight_line,
        )
        try:
            await self._run_handler(
                self._navigator.navigate_to(
                    dest, mode, speed_kmh=speed_kmh,
                    speed_min_kmh=speed_min_kmh, speed_max_kmh=speed_max_kmh,
                    straight_line=straight_line,
                ),
                "Navigate",
            )
        finally:
            if self.state == SimulationState.IDLE:
                self.snapshot = None

    async def start_loop(
        self,
        waypoints: list[Coordinate],
        mode: MovementMode,
        speed_kmh: float | None = None,
        speed_min_kmh: float | None = None,
        speed_max_kmh: float | None = None,
        pause_enabled: bool = DEFAULT_PAUSE_ENABLED,
        pause_min: float = DEFAULT_PAUSE_MIN,
        pause_max: float = DEFAULT_PAUSE_MAX,
        straight_line: bool = False,
        lap_count: int | None = None,
    ) -> None:
        """Start looping through a closed route."""
        await self._ensure_stopped()
        self._stop_event.clear()
        self._pause_event.set()
        self.snapshot = SimulationSnapshot(
            mode="loop",
            movement_mode=mode.value,
            speed_kmh=speed_kmh,
            speed_min_kmh=speed_min_kmh,
            speed_max_kmh=speed_max_kmh,
            waypoints=[{"lat": w.lat, "lng": w.lng} for w in waypoints],
            pause_enabled=pause_enabled,
            pause_min=pause_min,
            pause_max=pause_max,
            straight_line=straight_line,
            lap_count=lap_count,
        )
        try:
            await self._run_handler(
                self._looper.start_loop(
                    waypoints, mode, speed_kmh=speed_kmh,
                    speed_min_kmh=speed_min_kmh, speed_max_kmh=speed_max_kmh,
                    pause_enabled=pause_enabled, pause_min=pause_min, pause_max=pause_max,
                    straight_line=straight_line,
                    lap_count=lap_count,
                ),
                "Loop",
            )
        finally:
            if self.state == SimulationState.IDLE:
                self.snapshot = None

    async def joystick_start(self, mode: MovementMode) -> None:
        """Activate joystick mode."""
        await self._joystick.start(mode)

    def joystick_move(self, joystick_input: JoystickInput) -> None:
        """Update the joystick direction/intensity (non-blocking)."""
        self._joystick.update_input(joystick_input)

    async def joystick_stop(self) -> None:
        """Deactivate joystick mode."""
        await self._joystick.stop()
        if self.state == SimulationState.JOYSTICK:
            self.state = SimulationState.IDLE
            await self._emit("state_change", {"state": self.state.value})

    async def multi_stop(
        self,
        waypoints: list[Coordinate],
        mode: MovementMode,
        stop_duration: float = 0,
        loop: bool = False,
        speed_kmh: float | None = None,
        speed_min_kmh: float | None = None,
        speed_max_kmh: float | None = None,
        pause_enabled: bool = DEFAULT_PAUSE_ENABLED,
        pause_min: float = DEFAULT_PAUSE_MIN,
        pause_max: float = DEFAULT_PAUSE_MAX,
        straight_line: bool = False,
        lap_count: int | None = None,
    ) -> None:
        """Navigate through waypoints with optional stops."""
        await self._ensure_stopped()
        self._stop_event.clear()
        self._pause_event.set()
        self.snapshot = SimulationSnapshot(
            mode="multi_stop",
            movement_mode=mode.value,
            speed_kmh=speed_kmh,
            speed_min_kmh=speed_min_kmh,
            speed_max_kmh=speed_max_kmh,
            waypoints=[{"lat": w.lat, "lng": w.lng} for w in waypoints],
            stop_duration=stop_duration,
            loop_multistop=loop,
            pause_enabled=pause_enabled,
            pause_min=pause_min,
            pause_max=pause_max,
            straight_line=straight_line,
            lap_count=lap_count,
        )
        try:
            await self._run_handler(
                self._multi_stop.start(
                    waypoints, mode, stop_duration, loop, speed_kmh=speed_kmh,
                    speed_min_kmh=speed_min_kmh, speed_max_kmh=speed_max_kmh,
                    pause_enabled=pause_enabled, pause_min=pause_min, pause_max=pause_max,
                    straight_line=straight_line,
                    lap_count=lap_count,
                ),
                "Multi-stop",
            )
        finally:
            if self.state == SimulationState.IDLE:
                self.snapshot = None

    async def random_walk(
        self,
        center: Coordinate,
        radius_m: float,
        mode: MovementMode,
        speed_kmh: float | None = None,
        speed_min_kmh: float | None = None,
        speed_max_kmh: float | None = None,
        pause_enabled: bool = DEFAULT_PAUSE_ENABLED,
        pause_min: float = DEFAULT_PAUSE_MIN,
        pause_max: float = DEFAULT_PAUSE_MAX,
        seed: int | None = None,
        straight_line: bool = False,
    ) -> None:
        """Begin a random walk within a radius."""
        await self._ensure_stopped()
        self._stop_event.clear()
        self._pause_event.set()
        # Always have a seed so a secondary device joining mid-walk can
        # replay the same destination sequence. Unseeded callers get a
        # time-based seed that's captured in the snapshot.
        if seed is None:
            seed = int(time.time() * 1000) & 0x7FFFFFFF
        self.snapshot = SimulationSnapshot(
            mode="random_walk",
            movement_mode=mode.value,
            speed_kmh=speed_kmh,
            speed_min_kmh=speed_min_kmh,
            speed_max_kmh=speed_max_kmh,
            center={"lat": center.lat, "lng": center.lng},
            radius_m=radius_m,
            seed=seed,
            pause_enabled=pause_enabled,
            pause_min=pause_min,
            pause_max=pause_max,
            straight_line=straight_line,
        )
        try:
            await self._run_handler(
                self._random_walk.start(
                    center, radius_m, mode,
                    speed_kmh=speed_kmh,
                    speed_min_kmh=speed_min_kmh, speed_max_kmh=speed_max_kmh,
                    pause_enabled=pause_enabled, pause_min=pause_min, pause_max=pause_max,
                    seed=seed,
                    straight_line=straight_line,
                ),
                "Random walk",
            )
        finally:
            if self.state == SimulationState.IDLE:
                self.snapshot = None

    async def pause(self) -> None:
        """Pause the active movement.

        Clears the pause event so the movement loop blocks until resumed.
        """
        if self.state == SimulationState.PAUSED:
            return
        if self.state == SimulationState.IDLE:
            return

        self._paused_from = self.state
        self.state = SimulationState.PAUSED
        self._pause_event.clear()

        await self._emit("state_change", {
            "state": self.state.value,
            "paused_from": self._paused_from.value if self._paused_from else None,
        })
        logger.info("Simulation paused (was %s)", self._paused_from)

    async def resume(self) -> None:
        """Resume a paused movement."""
        if self.state != SimulationState.PAUSED:
            return

        prev = self._paused_from or SimulationState.IDLE
        self.state = prev
        self._paused_from = None
        self._pause_event.set()

        await self._emit("state_change", {"state": self.state.value})
        logger.info("Simulation resumed to %s", self.state.value)

    async def restore(self) -> None:
        """Stop everything and clear the simulated location."""
        await self._restore_handler.restore()

    async def stop(self) -> None:
        """Stop the current movement gracefully.

        Sets the stop event so the movement loop exits, then waits for
        the active task to finish.
        """
        self._stop_event.set()
        self._pause_event.set()  # unblock if paused

        # Stop joystick if active
        if self._joystick.is_active:
            await self._joystick.stop()

        # Cancel and await the active task
        if self._active_task is not None and not self._active_task.done():
            self._active_task.cancel()
            try:
                await self._active_task
            except asyncio.CancelledError:
                pass
            self._active_task = None

        if self.state not in (SimulationState.IDLE, SimulationState.DISCONNECTED):
            self.state = SimulationState.IDLE
            await self._emit("state_change", {"state": self.state.value})

        self._paused_from = None
        # Invalidate the replay snapshot — stop() is a user-intent terminator,
        # and a late-joining secondary shouldn't resurrect the dead action.
        self.snapshot = None
        logger.info("Simulation stopped")

    def get_status(self) -> SimulationStatus:
        """Build a snapshot of the current simulation status."""
        return SimulationStatus(
            state=self.state,
            current_position=self.current_position,
            progress=self.eta_tracker.progress,
            speed_mps=self._current_speed_mps,
            eta_seconds=self.eta_tracker.eta_seconds,
            eta_arrival=self.eta_tracker.eta_arrival,
            distance_remaining=self.eta_tracker.distance_remaining,
            distance_traveled=self.distance_traveled,
            lap_count=self.lap_count,
            segment_index=self.segment_index,
            total_segments=self.total_segments,
            is_paused=self.state == SimulationState.PAUSED,
        )

    # ── Internal helpers ─────────────────────────────────────

    async def _emit(self, event_type: str, data: dict) -> None:
        """Send an event to the WebSocket callback, if one is registered."""
        if self.event_callback is not None:
            try:
                await self.event_callback(event_type, data)
            except Exception:
                logger.exception("Event callback error for '%s'", event_type)

    async def _set_position(self, lat: float, lng: float) -> None:
        """Push a coordinate to the device and update internal state."""
        await self.location_service.set(lat, lng)
        self.current_position = Coordinate(lat=lat, lng=lng)

    async def apply_speed(
        self,
        speed_profile: "SpeedProfile",
    ) -> bool:
        """Hot-swap the active speed profile. Works in two modes:

        * Route-based handlers (navigate / loop / multi-stop / random-walk):
          queue the profile; the running ``_move_along_route`` loop notices
          and re-interpolates the remaining coords from the current position.
        * Joystick mode: swap the joystick handler's own speed_profile so
          the next tick computes distance with the new value.

        Returns True if the change was queued/applied, False if nothing is
        running to apply it to.

        Held under ``_apply_speed_lock`` so concurrent /apply-speed
        requests are serialised. State is re-read after acquire because
        the engine may have stopped (or _move_along_route may have
        finalised, clearing _active_route_coords) while this caller was
        queued.
        """
        async with self._apply_speed_lock:
            if self.state in (SimulationState.IDLE, SimulationState.DISCONNECTED):
                return False
            # Joystick uses its own independent speed profile attribute.
            if self.state == SimulationState.JOYSTICK and self._joystick.is_active:
                self._joystick.speed_profile = dict(speed_profile)
                self._speed_was_applied = True
                return True
            if not self._active_route_coords:
                return False
            self._pending_speed_profile = dict(speed_profile)
            self._speed_was_applied = True
            return True

    async def _move_along_route(
        self,
        coords: list[Coordinate],
        speed_profile: "SpeedProfile",
    ) -> None:
        """Core movement loop shared by navigate, loop, multi-stop, and
        random walk modes.

        Thin delegate to :func:`core.movement_loop.move_along_route`; the
        algorithm itself lives in that module so the engine class stays
        focused on lifecycle / public-API concerns. The local import
        avoids a circular ``core.movement_loop`` ↔ ``core.simulation_engine``
        import at module load.
        """
        from core.movement_loop import move_along_route
        await move_along_route(self, coords, speed_profile)

    async def _ensure_stopped(self) -> None:
        """Make sure no movement is active before starting a new one."""
        if self.state not in (SimulationState.IDLE, SimulationState.DISCONNECTED):
            await self.stop()
        self._stop_event.clear()
        # Fresh session — let the next handler resolve speed from its own
        # request, not from a stale apply_speed from a previous session.
        self._speed_was_applied = False
        self._active_speed_profile = None
