"""Regression tests for ``spawn()``'s crash reporting.

Movement endpoints (navigate / loop / multistop / randomwalk) answer
``{"status": "started"}`` and fire-and-forget the engine task via
``api.location._helpers.spawn``. A non-DeviceLost crash used to be
logged only — the UI saw the engine's bare ``state_change: idle`` with
no reason. The done-callback now broadcasts a ``device_error`` WS event
(stage ``simulation:<mode>``) so the renderer can toast the failure.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from unittest.mock import AsyncMock

# Make `backend/` importable when pytest runs from the repo root.
_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

import api.location._helpers as helpers  # noqa: E402
from services.location_service import DeviceLostCause, DeviceLostError  # noqa: E402


async def _drain_followups() -> None:
    """Let the done-callback's follow-up task (broadcast / cleanup) run."""
    for _ in range(10):
        await asyncio.sleep(0)


def test_crashed_movement_task_broadcasts_device_error(monkeypatch):
    bcast = AsyncMock()
    monkeypatch.setattr(helpers, "broadcast", bcast)

    async def scenario():
        async def boom():
            raise RuntimeError("engine blew up")

        task = helpers.spawn(boom(), label="navigate", udid="udid-1")
        await asyncio.gather(task, return_exceptions=True)
        await _drain_followups()

    asyncio.run(scenario())

    bcast.assert_awaited_once_with("device_error", {
        "udid": "udid-1",
        "stage": "simulation:navigate",
        "error": "engine blew up",
    })


def test_crash_without_label_or_udid_still_broadcasts(monkeypatch):
    bcast = AsyncMock()
    monkeypatch.setattr(helpers, "broadcast", bcast)

    async def scenario():
        async def boom():
            raise ValueError("bad waypoint")

        task = helpers.spawn(boom())
        await asyncio.gather(task, return_exceptions=True)
        await _drain_followups()

    asyncio.run(scenario())

    bcast.assert_awaited_once_with("device_error", {
        "udid": "",
        "stage": "simulation:movement",
        "error": "bad waypoint",
    })


def test_device_lost_crash_routes_to_cleanup_not_device_error(monkeypatch):
    """DeviceLostError keeps its dedicated path: handle_device_lost
    (disconnect + ``device_disconnected`` broadcast), NOT device_error."""
    bcast = AsyncMock()
    cleanup = AsyncMock()
    monkeypatch.setattr(helpers, "broadcast", bcast)
    monkeypatch.setattr(helpers, "handle_device_lost", cleanup)

    async def scenario():
        async def lost():
            raise DeviceLostError("gone", cause=DeviceLostCause.USB_REMOVED)

        task = helpers.spawn(lost(), label="loop", udid="udid-1")
        await asyncio.gather(task, return_exceptions=True)
        await _drain_followups()

    asyncio.run(scenario())

    assert cleanup.await_count == 1
    bcast.assert_not_awaited()


def test_successful_task_broadcasts_nothing(monkeypatch):
    bcast = AsyncMock()
    monkeypatch.setattr(helpers, "broadcast", bcast)

    async def scenario():
        async def fine():
            return "ok"

        await helpers.spawn(fine(), label="navigate", udid="udid-1")
        await _drain_followups()

    asyncio.run(scenario())

    bcast.assert_not_awaited()


def test_cancelled_task_broadcasts_nothing(monkeypatch):
    """terminate_engine cancels in-flight movement tasks — cancellation is
    an orderly teardown, not a crash, so no device_error should fire (and
    the done-callback must not blow up calling ``t.exception()``)."""
    bcast = AsyncMock()
    monkeypatch.setattr(helpers, "broadcast", bcast)

    async def scenario():
        async def forever():
            await asyncio.sleep(3600)

        task = helpers.spawn(forever(), label="loop", udid="udid-1")
        await asyncio.sleep(0)
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        await _drain_followups()

    asyncio.run(scenario())

    bcast.assert_not_awaited()
