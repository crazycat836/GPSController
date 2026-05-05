"""Periodic TCP liveness probe for the WiFi tunnel's RSD endpoint.

Catches the case where the iPhone silently leaves the WiFi network (or the
Mac wakes from sleep with a dead tunnel) — neither ``_tunnel_watchdog``
(only fires when the tunnel asyncio task *raises*) nor
``_usbmux_presence_watchdog`` (USB-only) covers this scenario. Without it,
the frontend keeps showing the device as "connected" indefinitely because
``DeviceManager._connections`` is never reconciled.

The probe is poll-driven; the existing watchdog stays event-driven. They
co-exist safely because the cleanup helper they share
(``_cleanup_wifi_connections``) is idempotent on an empty UDID list.
"""

import asyncio
import logging

logger = logging.getLogger(__name__)

# Probe cadence and threshold. ~5s × 3 misses = ~15s worst-case detection
# latency, which matches the user-perceptible "the pill is wrong" window
# without burning CPU on a dead-tunnel hot loop.
PROBE_INTERVAL_S = 5.0
PROBE_TIMEOUT_S = 2.0
MISS_THRESHOLD = 3


async def tunnel_liveness_loop(stop: asyncio.Event) -> None:
    """Probe the active WiFi tunnel's RSD endpoint until ``stop`` is set.

    Tears down WiFi connections + the tunnel itself once the endpoint has
    been unreachable for ``MISS_THRESHOLD * PROBE_INTERVAL_S`` seconds.
    Safe to run concurrently with ``_tunnel_watchdog`` — both ultimately
    route through ``_cleanup_wifi_connections``, which short-circuits when
    there are no Network devices left to disconnect.
    """
    # Late imports avoid circular dependency at module load: api.wifi_tunnel
    # transitively imports from core.* during router setup, and pulling those
    # symbols at module-top would create a cycle.
    from api.wifi_tunnel import _cleanup_wifi_connections, _tcp_probe, _tunnel
    from context import ctx

    miss_count = 0
    logger.info(
        "Tunnel liveness probe started (interval=%.1fs, threshold=%d misses)",
        PROBE_INTERVAL_S, MISS_THRESHOLD,
    )

    try:
        while not stop.is_set():
            # asyncio.wait_for(stop.wait(), timeout) returns when stop fires
            # (we exit the loop) or raises TimeoutError on the interval
            # (we run a probe). Cleaner than `await asyncio.sleep()` because
            # shutdown unblocks immediately instead of finishing the sleep.
            try:
                await asyncio.wait_for(stop.wait(), timeout=PROBE_INTERVAL_S)
                break
            except asyncio.TimeoutError:
                pass

            # Snapshot tunnel state under lock — `info` and `generation` must
            # be read together so the post-probe generation check below
            # compares against the same epoch we probed.
            async with _tunnel.lock:
                if not _tunnel.is_running() or _tunnel.info is None:
                    miss_count = 0
                    continue
                gen = _tunnel.generation
                rsd_address = _tunnel.info.get("rsd_address")
                rsd_port = _tunnel.info.get("rsd_port")

            if not rsd_address or not rsd_port:
                miss_count = 0
                continue

            # Skip probing when no Network device currently consumes the
            # tunnel — there's nothing to falsely advertise as "connected"
            # and the user may still be mid-handshake on a fresh tunnel.
            dm = ctx.app_state.device_manager
            if not dm.udids_by_connection_type("Network"):
                miss_count = 0
                continue

            alive = await _tcp_probe(rsd_address, rsd_port, timeout=PROBE_TIMEOUT_S)
            if alive:
                if miss_count > 0:
                    logger.info(
                        "Tunnel probe recovered after %d miss(es) rsd=%s:%d",
                        miss_count, rsd_address, rsd_port,
                    )
                miss_count = 0
                continue

            miss_count += 1
            logger.warning(
                "Tunnel probe failed (%d/%d) rsd=%s:%d",
                miss_count, MISS_THRESHOLD, rsd_address, rsd_port,
            )
            if miss_count < MISS_THRESHOLD:
                continue

            # Threshold reached — re-acquire the lock and verify the
            # generation we probed is still current. A user-driven
            # stop()/start() cycle inside the probe window bumps generation;
            # in that case the new tunnel owns its own future and we must
            # not tear it down based on the old tunnel's misses.
            async with _tunnel.lock:
                if _tunnel.generation != gen:
                    logger.info(
                        "Liveness threshold reached but tunnel generation moved "
                        "(seen=%d, current=%d) — yielding to new tunnel",
                        gen, _tunnel.generation,
                    )
                    miss_count = 0
                    continue

            logger.error(
                "Tunnel unreachable for ~%.0fs — declaring dead, cleaning up",
                PROBE_INTERVAL_S * MISS_THRESHOLD,
            )
            try:
                await _cleanup_wifi_connections(reason="tunnel_lost_liveness")
            except Exception:
                logger.exception("Liveness cleanup failed")
            try:
                await _tunnel.stop()
            except Exception:
                logger.exception("Liveness tunnel.stop failed")
            miss_count = 0
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.exception("Tunnel liveness loop crashed")
        raise
    finally:
        logger.info("Tunnel liveness probe stopped")
