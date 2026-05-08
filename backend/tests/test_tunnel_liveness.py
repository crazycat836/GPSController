"""Unit tests for the WiFi tunnel liveness probe.

Mocks ``_tcp_probe``, ``cleanup_wifi_connections``, ``tunnel``, and
``ctx.app_state.device_manager`` so the loop can run end-to-end without
pymobiledevice3 / a real iOS device.

Uses ``asyncio.run`` directly inside sync pytest functions so the test
suite doesn't pick up a hard dependency on pytest-asyncio (not currently
in requirements.txt).
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

# Make backend/ importable regardless of where pytest is invoked from.
BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from core import tunnel_liveness  # noqa: E402


def _make_fake_tunnel(*, running: bool = True, generation: int = 1,
                      info: dict | None = None):
    """Build a SimpleNamespace that quacks like ``TunnelRunner`` enough for
    the probe loop. Provides an asyncio.Lock so ``async with tunnel.lock``
    works, and the same fields the loop reads from ``info``."""
    return SimpleNamespace(
        lock=asyncio.Lock(),
        is_running=lambda: running,
        info=info if info is not None else {
            "rsd_address": "127.0.0.1",
            "rsd_port": 49152,
        },
        generation=generation,
        stop=AsyncMock(),
    )


def _patch_loop_deps(monkeypatch, *, tunnel, network_udids: list[str],
                     probe_results: list[bool]):
    """Wire all four late-imports the loop performs.

    *probe_results* drives _tcp_probe — index advances per call, repeats the
    last value once exhausted (so an "always-fail" test can pass `[False]`).
    Returns (cleanup_mock, probe_call_counter).
    """
    from context import ctx
    from services import wifi_tunnel_service as wt

    cleanup = AsyncMock(return_value=list(network_udids))
    monkeypatch.setattr(wt, "tunnel", tunnel, raising=True)
    monkeypatch.setattr(wt, "cleanup_wifi_connections", cleanup, raising=True)

    call_idx = {"n": 0}

    async def _probe(addr, port, timeout=2.0):
        i = min(call_idx["n"], len(probe_results) - 1)
        call_idx["n"] += 1
        return probe_results[i]
    monkeypatch.setattr(wt, "_tcp_probe", _probe, raising=True)

    dm = MagicMock()
    dm.udids_by_connection_type = MagicMock(return_value=list(network_udids))
    fake_app_state = SimpleNamespace(device_manager=dm)
    monkeypatch.setattr(ctx, "app_state", fake_app_state, raising=False)

    # Tighten the loop so tests run in milliseconds.
    monkeypatch.setattr(tunnel_liveness, "PROBE_INTERVAL_S", 0.02, raising=True)
    monkeypatch.setattr(tunnel_liveness, "PROBE_TIMEOUT_S", 0.05, raising=True)

    return cleanup, call_idx


async def _run_for(deadline_s: float, *, before_stop=None):
    """Spawn the loop, run for deadline_s (optionally invoking *before_stop*
    midway), then signal stop and await cleanup."""
    stop = asyncio.Event()
    task = asyncio.create_task(tunnel_liveness.tunnel_liveness_loop(stop))
    try:
        if before_stop is not None:
            await before_stop()
        await asyncio.sleep(deadline_s)
    finally:
        stop.set()
        await asyncio.wait_for(task, timeout=2.0)


def test_cleanup_after_threshold_misses(monkeypatch):
    """3 consecutive failed probes → cleanup called with the right reason
    and tunnel.stop() invoked."""
    tunnel = _make_fake_tunnel()
    cleanup, _ = _patch_loop_deps(
        monkeypatch, tunnel=tunnel, network_udids=["udid-A"],
        probe_results=[False],
    )

    asyncio.run(_run_for(0.4))

    assert cleanup.await_count >= 1, "expected at least one cleanup call"
    cleanup.assert_awaited_with(reason="tunnel_lost_liveness")
    assert tunnel.stop.await_count >= 1, "expected tunnel.stop() after cleanup"


def test_no_cleanup_when_probes_succeed(monkeypatch):
    """All probes succeed → no cleanup, no stop."""
    tunnel = _make_fake_tunnel()
    cleanup, _ = _patch_loop_deps(
        monkeypatch, tunnel=tunnel, network_udids=["udid-A"],
        probe_results=[True],
    )

    asyncio.run(_run_for(0.2))

    cleanup.assert_not_awaited()
    tunnel.stop.assert_not_awaited()


def test_no_cleanup_when_no_network_devices(monkeypatch):
    """Tunnel up but no Network-typed devices → loop skips probing entirely."""
    tunnel = _make_fake_tunnel()
    cleanup, call_idx = _patch_loop_deps(
        monkeypatch, tunnel=tunnel, network_udids=[],
        probe_results=[False],
    )

    asyncio.run(_run_for(0.2))

    cleanup.assert_not_awaited()
    tunnel.stop.assert_not_awaited()
    assert call_idx["n"] == 0, "loop should not call _tcp_probe with 0 consumers"


def test_no_cleanup_when_tunnel_not_running(monkeypatch):
    """Tunnel reports not running → loop short-circuits before probing."""
    tunnel = _make_fake_tunnel(running=False)
    cleanup, call_idx = _patch_loop_deps(
        monkeypatch, tunnel=tunnel, network_udids=["udid-A"],
        probe_results=[False],
    )

    asyncio.run(_run_for(0.2))

    cleanup.assert_not_awaited()
    tunnel.stop.assert_not_awaited()
    assert call_idx["n"] == 0


def test_miss_count_resets_on_recovery(monkeypatch):
    """A success in the middle of a fail streak resets miss_count, so a
    transient blip doesn't accumulate toward threshold."""
    tunnel = _make_fake_tunnel()
    # 2 fails → success → 2 fails → success: never 3 consecutive.
    cleanup, _ = _patch_loop_deps(
        monkeypatch, tunnel=tunnel, network_udids=["udid-A"],
        probe_results=[False, False, True, False, False, True],
    )

    asyncio.run(_run_for(0.25))

    cleanup.assert_not_awaited()
    tunnel.stop.assert_not_awaited()


def test_generation_change_aborts_cleanup(monkeypatch):
    """If tunnel.generation moves between probe-snapshot and the post-threshold
    re-check, the loop yields to the new tunnel and does NOT tear down.

    Bumps generation inside the probe function so the bump lands between the
    snapshot at the top of the iteration and the cleanup re-check at the
    bottom — the exact race window the generation guard exists to defend.
    """
    from context import ctx
    from services import wifi_tunnel_service as wt

    tunnel = _make_fake_tunnel(generation=7)
    cleanup = AsyncMock(return_value=["udid-A"])
    monkeypatch.setattr(wt, "tunnel", tunnel, raising=True)
    monkeypatch.setattr(wt, "cleanup_wifi_connections", cleanup, raising=True)

    call_count = {"n": 0}

    async def _probe(addr, port, timeout=2.0):
        call_count["n"] += 1
        # Iteration 3 (the one that trips the threshold) bumps generation
        # between snapshot and re-check — exactly the race window the
        # guard exists to cover. From iteration 4 onward we simulate
        # a healthy new tunnel by returning True, so subsequent misses
        # don't accumulate and trigger an unrelated cleanup.
        if call_count["n"] == 3:
            tunnel.generation = 8
            return False
        if call_count["n"] >= 4:
            return True
        return False
    monkeypatch.setattr(wt, "_tcp_probe", _probe, raising=True)

    dm = MagicMock()
    dm.udids_by_connection_type = MagicMock(return_value=["udid-A"])
    monkeypatch.setattr(ctx, "app_state",
                        SimpleNamespace(device_manager=dm), raising=False)

    monkeypatch.setattr(tunnel_liveness, "PROBE_INTERVAL_S", 0.02, raising=True)
    monkeypatch.setattr(tunnel_liveness, "PROBE_TIMEOUT_S", 0.05, raising=True)

    asyncio.run(_run_for(0.2))

    cleanup.assert_not_awaited()
    tunnel.stop.assert_not_awaited()
