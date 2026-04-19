"""Shared lap-count cap helpers for Loop and Multi-Stop.

Both route-traversal handlers ran the same 6-line block after each lap:
bump the counter, emit ``lap_complete``, log, and break if we hit the
cap. Extracted so changes to the emit payload or logging format only
need to happen in one place.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from core.simulation_engine import SimulationEngine


async def record_lap_and_check_limit(
    engine: "SimulationEngine",
    lap_count: int | None,
    *,
    kind: str,
    logger: logging.Logger,
) -> bool:
    """Increment ``engine.lap_count``, broadcast progress, return True
    if the configured cap has been reached and the caller should break.

    ``kind`` is used in log messages only (e.g. ``"Loop"`` / ``"Multi-stop"``).
    ``lap_count`` mirrors the user-supplied target; treat <= 0 as
    unlimited so the field is safe against accidental zero inputs.
    """
    engine.lap_count += 1
    limit = lap_count if (lap_count is not None and lap_count > 0) else None
    await engine._emit("lap_complete", {"lap": engine.lap_count, "total": limit})
    logger.info(
        "%s lap %d%s complete",
        kind, engine.lap_count, f"/{limit}" if limit else "",
    )
    if limit is not None and engine.lap_count >= limit:
        logger.info("%s reached configured lap count %d, stopping", kind, limit)
        return True
    return False
