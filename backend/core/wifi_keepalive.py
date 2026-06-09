"""WiFi-tunnel keep-alive loop.

When the user enables keep-alive (Settings → "Keep WiFi connection alive
when the screen dims"), this loop periodically re-asserts each *idle*
engine's current virtual location. Re-pushing the same coordinate keeps
the DVT channel warm so iOS doesn't suspend the RSD tunnel a few seconds
after the iPhone screen locks — which is what otherwise drops a WiFi
connection while the device is sitting idle on a teleported location.

Design notes:

  - Opt-in. The flag lives on ``AppState`` (persisted in settings.json) and
    is read fresh every tick, so toggling it in the UI takes effect without
    a restart.
  - Only IDLE engines with a position are touched. An engine actively
    running Navigate / Loop / etc. already streams ``position_update``
    frames at ~10 Hz, which keeps its own channel warm — re-asserting there
    would fight the live movement.
  - Re-asserting the *same* coordinate never moves the dot and never stomps
    the phone's real GPS (an engine only has a ``current_position`` after the
    user explicitly teleported / navigated this session).
  - Cooperative stop via an ``asyncio.Event`` mirrors ``tunnel_liveness``.
"""

import asyncio
import logging

logger = logging.getLogger(__name__)

# Re-assert cadence. iOS tends to suspend an idle RSD tunnel within ~30s of
# the screen locking; 20s leaves comfortable headroom without spamming the
# device. Kept here next to the rationale.
KEEPALIVE_INTERVAL_S = 20.0


async def wifi_keepalive_loop(stop: asyncio.Event) -> None:
    """Re-assert idle engines' virtual locations until ``stop`` is set.

    No-op on every tick while keep-alive is disabled, so the loop is cheap
    to leave running for the whole process lifetime.
    """
    from context import ctx
    from models.schemas import SimulationState
    from services.location_service import DeviceLostError

    logger.info("WiFi keep-alive loop started (interval=%.1fs)", KEEPALIVE_INTERVAL_S)

    try:
        while not stop.is_set():
            try:
                await asyncio.wait_for(stop.wait(), timeout=KEEPALIVE_INTERVAL_S)
                break
            except asyncio.TimeoutError:
                pass

            app_state = ctx.app_state
            if app_state is None or not app_state.get_wifi_keepalive():
                continue

            # Snapshot the registry so a concurrent connect/terminate can't
            # mutate it mid-iteration.
            engines = list(app_state.simulation_engines.items())
            for udid, engine in engines:
                pos = engine.current_position
                if pos is None:
                    continue
                if engine.state != SimulationState.IDLE:
                    continue
                try:
                    await engine.teleport(pos.lat, pos.lng)
                    logger.debug("Keep-alive re-asserted %s at %.6f,%.6f", udid, pos.lat, pos.lng)
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
