"""Tests for services.disconnect_dedup.

Verifies the dedup window suppresses rapid duplicate emits, distinguishes
different causes, and respects the soft cap on retained entries.

Uses ``asyncio.run`` directly inside sync pytest functions so the test
suite doesn't depend on pytest-asyncio.
"""

from __future__ import annotations

import asyncio
import sys
from collections.abc import Iterator
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

# Make backend/ importable regardless of where pytest is invoked from.
_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))


@pytest.fixture(autouse=True)
def _reset_dedup() -> Iterator[None]:
    """Clear the dedup state between tests so synthetic emits don't
    cross-contaminate. The module exposes reset_for_tests() for exactly
    this use case."""
    from services.disconnect_dedup import reset_for_tests
    reset_for_tests()
    yield
    reset_for_tests()


def test_first_emit_passes_through():
    """A fresh emit always reaches the broadcaster."""
    from services import disconnect_dedup

    async def _run():
        with patch.object(disconnect_dedup, "broadcast", new_callable=AsyncMock) as mock_bcast:
            await disconnect_dedup.emit_device_disconnected({
                "udids": ["udid-A"],
                "cause": "usb_removed",
            })
            mock_bcast.assert_awaited_once_with("device_disconnected", {
                "udids": ["udid-A"],
                "cause": "usb_removed",
            })

    asyncio.run(_run())


def test_duplicate_within_window_dropped():
    """Same (udids, cause) within 2s is silently dropped."""
    from services import disconnect_dedup

    async def _run():
        with patch.object(disconnect_dedup, "broadcast", new_callable=AsyncMock) as mock_bcast:
            payload = {"udids": ["udid-A"], "cause": "usb_removed"}
            await disconnect_dedup.emit_device_disconnected(payload)
            await disconnect_dedup.emit_device_disconnected(payload)
            assert mock_bcast.await_count == 1

    asyncio.run(_run())


def test_different_cause_passes_through():
    """A different `cause` value is informationally distinct and forwarded."""
    from services import disconnect_dedup

    async def _run():
        with patch.object(disconnect_dedup, "broadcast", new_callable=AsyncMock) as mock_bcast:
            await disconnect_dedup.emit_device_disconnected({
                "udids": ["udid-A"],
                "cause": "usb_removed",
            })
            await disconnect_dedup.emit_device_disconnected({
                "udids": ["udid-A"],
                "cause": "wifi_dropped",
            })
            assert mock_bcast.await_count == 2

    asyncio.run(_run())


def test_udid_order_normalised():
    """Different udid orderings hash to the same key — dedup still applies."""
    from services import disconnect_dedup

    async def _run():
        with patch.object(disconnect_dedup, "broadcast", new_callable=AsyncMock) as mock_bcast:
            await disconnect_dedup.emit_device_disconnected({
                "udids": ["udid-B", "udid-A"],
                "cause": "wifi_dropped",
            })
            await disconnect_dedup.emit_device_disconnected({
                "udids": ["udid-A", "udid-B"],
                "cause": "wifi_dropped",
            })
            assert mock_bcast.await_count == 1

    asyncio.run(_run())


def test_single_udid_field_normalised():
    """Payloads with `udid` (singular) hash equivalently to `udids` lists
    of length 1 — emit sites differ but the logical event is the same."""
    from services import disconnect_dedup

    async def _run():
        with patch.object(disconnect_dedup, "broadcast", new_callable=AsyncMock) as mock_bcast:
            await disconnect_dedup.emit_device_disconnected({"udid": "udid-A", "cause": "phone_locked"})
            await disconnect_dedup.emit_device_disconnected({"udids": ["udid-A"], "cause": "phone_locked"})
            assert mock_bcast.await_count == 1

    asyncio.run(_run())


def test_after_window_emit_passes_through(monkeypatch):
    """Once the 2s window has elapsed, the same key should pass through again."""
    from services import disconnect_dedup

    fake_time = [0.0]

    def _fake_monotonic() -> float:
        return fake_time[0]

    monkeypatch.setattr(disconnect_dedup.time, "monotonic", _fake_monotonic)

    async def _run():
        with patch.object(disconnect_dedup, "broadcast", new_callable=AsyncMock) as mock_bcast:
            payload = {"udids": ["udid-A"], "cause": "ddi_not_mounted"}
            await disconnect_dedup.emit_device_disconnected(payload)
            fake_time[0] = 1.0
            await disconnect_dedup.emit_device_disconnected(payload)
            fake_time[0] = 2.1
            await disconnect_dedup.emit_device_disconnected(payload)
            assert mock_bcast.await_count == 2

    asyncio.run(_run())


def test_cap_evicts_oldest(monkeypatch):
    """When the recent-emit map exceeds the soft cap, oldest entries are
    evicted on the next emit. Keeps memory bounded for a long-running
    process with many unique (udids, cause) combinations."""
    from services import disconnect_dedup

    monkeypatch.setattr(disconnect_dedup, "_MAX_ENTRIES", 3)

    fake_time = [0.0]
    monkeypatch.setattr(disconnect_dedup.time, "monotonic", lambda: fake_time[0])

    async def _run():
        with patch.object(disconnect_dedup, "broadcast", new_callable=AsyncMock):
            for i in range(4):
                fake_time[0] = float(i) * 0.5
                await disconnect_dedup.emit_device_disconnected({
                    "udids": ["udid-A"],
                    "cause": f"cause_{i}",
                })

    asyncio.run(_run())
    keys = set(disconnect_dedup._recent.keys())
    assert (("udid-A",), "cause_0") not in keys
    assert (("udid-A",), "cause_3") in keys
