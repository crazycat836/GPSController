"""WiFi-tunnel keep-alive loop.

When the user enables keep-alive (Settings → "Keep WiFi connection alive
when the screen dims"), this loop re-sends an engine's current virtual
location whenever the device hasn't received one for a few seconds.
Re-pushing the same coordinate keeps the DVT channel warm so iOS doesn't
suspend the RSD tunnel after the iPhone screen locks — which otherwise
drops a WiFi connection while the device sits on a teleported location,
during a user pause, or while a route waits between legs / laps.

Design notes:

  - Opt-in. The flag lives on ``AppState`` (persisted in settings.json) and
    is read fresh every tick, so toggling it in the UI takes effect without
    a restart.
  - Quiet channels only, whatever the engine state. An engine that is
    actually moving pushes a point every update interval (≤1s), so its
    ``last_push_at`` stays fresh and it is skipped — no fighting the live
    movement. Pauses and waits between legs keep the running state but go
    quiet, and those are exactly the gaps that used to drop the tunnel.
  - ``engine.reassert_position`` re-sends without changing state or
    emitting events, so a paused run resumes untouched.
  - Re-asserting the *same* coordinate never moves the dot and never stomps
    the phone's real GPS: only engines with ``location_active`` are touched,
    which a push sets and "restore real GPS" clears.
  - Cooperative stop via an ``asyncio.Event`` mirrors ``tunnel_liveness``.

Layering: part of the **connection-orchestration group** (see
``tools/check_layers.py``) — a runtime loop that may depend on both
``core/`` and ``services/``. ``main.py``'s lifespan passes ``app_state``
in explicitly at task creation; the lazy ``context.ctx`` fallback exists
only for tests that patch ``context.ctx`` instead of passing one.
"""

import asyncio
import logging

logger = logging.getLogger(__name__)

# How often the loop checks, and how long a channel may stay quiet before
# the position is re-sent. iOS can suspend a quiet RSD tunnel within tens of
# seconds of the screen locking; a few seconds of silence leaves headroom
# while costing one tiny DVT message per quiet engine.
KEEPALIVE_TICK_S = 1.0
KEEPALIVE_QUIET_S = 3.0


async def wifi_keepalive_loop(stop: asyncio.Event, app_state=None) -> None:
    """Re-send quiet engines' virtual locations until ``stop`` is set.

    No-op on every tick while keep-alive is disabled, so the loop is cheap
    to leave running for the whole process lifetime.

    ``app_state`` is passed in by ``main.py``'s lifespan at task-creation
    time. When omitted it falls back to ``context.ctx`` — that fallback is
    load-bearing for the unit tests, which patch ``context.ctx`` and start
    the loop without arguments.
    """
    import time

    from models.schemas import SimulationState
    from services.location_service import DeviceLostError

    if app_state is None:
        from context import ctx
        app_state = getattr(ctx, "app_state", None)

    logger.info("WiFi keep-alive loop started (re-send after %.1fs quiet)", KEEPALIVE_QUIET_S)

    try:
        while not stop.is_set():
            try:
                await asyncio.wait_for(stop.wait(), timeout=KEEPALIVE_TICK_S)
                break
            except asyncio.TimeoutError:
                pass

            if app_state is None or not app_state.get_wifi_keepalive():
                continue

            # Snapshot the registry so a concurrent connect/terminate can't
            # mutate it mid-iteration.
            engines = list(app_state.simulation_engines.items())
            now = time.monotonic()
            for udid, engine in engines:
                if engine.current_position is None or not engine.location_active:
                    continue
                if engine.state == SimulationState.DISCONNECTED:
                    continue
                if now - engine.last_push_at < KEEPALIVE_QUIET_S:
                    continue
                try:
                    await engine.reassert_position()
                    logger.debug("Keep-alive re-sent position for %s (%s)", udid, engine.state.value)
                except (DeviceLostError, ConnectionError, OSError):
                    # Expected: a dead device / mid-teardown engine — the
                    # liveness probe and watchdog own real reconnection; just
                    # don't let one failure kill the loop for the others.
                    logger.debug("Keep-alive re-assert skipped for %s (device unavailable)", udid)
                except Exception:
                    # Unexpected (e.g. a bug in teleport): surface at WARNING so
                    # it isn't hidden by the quiet dead-device path above.
                    logger.warning("Keep-alive re-assert failed for %s", udid, exc_info=True)
    except asyncio.CancelledError:
        raise
    finally:
        logger.info("WiFi keep-alive loop stopped")
