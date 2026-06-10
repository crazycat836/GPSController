"""Dual-device auto-sync — replay the primary's in-flight simulation
on a newly connected secondary engine.

Extracted from ``state.AppState`` so the engine-registry bookkeeping
(state.py) and the replay mechanics live apart. The mode-specific replay
kwargs themselves live on :meth:`SimulationSnapshot.replay_on`
(core.simulation_engine), next to the snapshot fields and the engine
signatures they mirror; this module owns the task lifecycle around them:

  - spawn the fire-and-forget ``dual-sync-{udid}`` task (connect flow
    must not block on OSRM route fetches)
  - reject unknown movement modes *before* any task spawns
  - keep strong task references + targeted / bulk cancellation
"""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING

from models.schemas import MovementMode

if TYPE_CHECKING:
    from core.simulation_engine import SimulationEngine, SimulationSnapshot
    from models.schemas import Coordinate

logger = logging.getLogger("gpscontroller")


async def _replay(
    snapshot: "SimulationSnapshot",
    *,
    new_engine: "SimulationEngine",
    start_pos: "Coordinate",
    new_udid: str,
    primary_udid: str,
) -> None:
    """Teleport-then-start sequence run inside the dual-sync task."""
    # Deferred to break the api↔main circular import (same seam as state.py).
    from services.ws_broadcaster import broadcast

    try:
        # Anchor the secondary to the primary's current coordinate
        # so OSRM routing / random-walk origin matches.
        await new_engine.teleport(start_pos.lat, start_pos.lng)
        try:
            await broadcast("dual_sync_start", {
                "udid": new_udid,
                "primary_udid": primary_udid,
                "mode": snapshot.mode,
            })
        except Exception:
            logger.debug(
                "dual_sync_start broadcast failed for %s",
                new_udid, exc_info=True,
            )
        await snapshot.replay_on(new_engine)
    except Exception:
        logger.exception(
            "Dual-device auto-sync failed for %s (snapshot mode=%s)",
            new_udid, snapshot.mode,
        )


class DualSyncCoordinator:
    """Owns the in-flight dual-device auto-sync tasks.

    Tasks are stored so the event loop keeps a strong reference — a bare
    ``create_task`` can be GC'd mid-run (documented asyncio footgun) —
    and so each can be cancelled when its target engine is terminated or
    the app shuts down, instead of outliving the device it mirrors.
    """

    def __init__(self) -> None:
        self._tasks: set[asyncio.Task] = set()

    def sync_to_primary(
        self,
        *,
        primary_udid: str,
        primary: "SimulationEngine",
        new_udid: str,
        new_engine: "SimulationEngine",
    ) -> None:
        """Replay *primary*'s in-flight simulation on *new_engine*.

        Spawned as fire-and-forget so the connect flow doesn't block on
        OSRM route fetches. The task always writes the primary's current
        position first so the newcomer starts from the same coordinate,
        then replays the snapshot-matching engine call. No-op (no task
        spawned) when the primary is idle, has no position yet, or the
        snapshot carries an unknown movement_mode.
        """
        snapshot = primary.snapshot
        if snapshot is None:
            # Primary is idle — nothing to mirror.
            return
        start_pos = primary.current_position
        if start_pos is None:
            return
        try:
            MovementMode(snapshot.movement_mode)
        except ValueError:
            logger.warning(
                "Cannot replay snapshot on %s: unknown movement_mode %r",
                new_udid, snapshot.movement_mode,
            )
            return

        sync_task = asyncio.create_task(
            _replay(
                snapshot,
                new_engine=new_engine,
                start_pos=start_pos,
                new_udid=new_udid,
                primary_udid=primary_udid,
            ),
            name=f"dual-sync-{new_udid}",
        )
        # Keep a strong ref (weak-ref GC footgun) + auto-remove on completion.
        self._tasks.add(sync_task)
        sync_task.add_done_callback(self._tasks.discard)

    def cancel_for(self, udid: str) -> None:
        """Cancel the in-flight dual-sync task targeting *udid*, if any.
        Tasks are named ``dual-sync-{udid}`` (see sync_to_primary)."""
        name = f"dual-sync-{udid}"
        for task in list(self._tasks):
            if task.get_name() == name and not task.done():
                task.cancel()

    async def cancel_all(self) -> None:
        """Cancel + drain every in-flight dual-device auto-sync task.

        Called from the lifespan shutdown so a mid-flight OSRM-backed
        sync can't keep running after the engines it targets are gone.
        """
        tasks = [t for t in self._tasks if not t.done()]
        for task in tasks:
            task.cancel()
        for task in tasks:
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
        self._tasks.clear()
