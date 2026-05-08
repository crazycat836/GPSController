"""WiFi tunnel service primitives shared by the api/ router and core/.

Hosts the cross-layer state and helpers the WiFi tunnel needs from
business logic (``core/tunnel_liveness``) without that layer having to
reach back up into ``api/``:

  - ``tunnel`` — process-wide :class:`TunnelRunner` singleton. The
    :mod:`api.tunnel_router` router and the liveness watcher both serialise
    against the same instance via its internal lock.
  - ``_tcp_probe`` — single-port TCP reachability probe used both by the
    /24 subnet scan and by ``tunnel_liveness`` to confirm the RSD is
    still answering.
  - ``cleanup_wifi_connections`` — drop every Network-mode device,
    terminate its engine, and emit ``device_disconnected`` so the UI
    re-renders before the next user action errors out.

Architectural intent (matches main.py layout): ``api/ -> core/ -> services/``.
A pre-commit lint (``tools/check_layers.py``) enforces it.
"""

from __future__ import annotations

import asyncio
import logging

from context import ctx
from core.wifi_tunnel import TunnelRunner
from services.location_service import DeviceLostCause
from services.ws_broadcaster import broadcast

logger = logging.getLogger("wifi_tunnel")

# Process-wide tunnel runner. Serialised by its own asyncio.Lock so
# concurrent /start or /stop requests never race.
tunnel = TunnelRunner()


async def _tcp_probe(ip: str, port: int, timeout: float = 0.4) -> bool:
    """Open a single TCP connection to ``ip:port`` and immediately close.

    Returns True if the SYN/ACK handshake completed within ``timeout``.
    Used by the subnet scan + the liveness probe; both treat a single
    miss as transient and require multiple consecutive misses before
    declaring the endpoint dead.
    """
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(ip, port), timeout=timeout,
        )
        writer.close()
        try:
            await writer.wait_closed()
        except (OSError, ConnectionError) as exc:
            logger.debug(
                "_tcp_probe(%s:%d): wait_closed raised (%s); socket already torn down",
                ip, port, exc.__class__.__name__, exc_info=True,
            )
        return True
    except (OSError, ConnectionError, asyncio.TimeoutError):
        return False


async def cleanup_wifi_connections(reason: str = "wifi_tunnel_stopped") -> list[str]:
    """Disconnect any Network devices + drop the simulation engine.

    Broadcasts ``device_disconnected`` so the frontend banners/disables
    context menu items immediately instead of waiting for the next failed
    action. Returns the UDIDs that were disconnected.

    *reason* is forwarded as the ``reason`` field in the broadcast so
    consumers (frontend toasts, future analytics) can distinguish a
    user/admin stop from a liveness-probe-detected death.
    """
    app_state = ctx.app_state
    dm = app_state.device_manager
    udids: list[str] = []
    try:
        udids = dm.udids_by_connection_type("Network")
        # Stop engine tasks *before* tearing down the transport. A running
        # Navigate / RandomWalk loop would otherwise keep emitting events
        # against a dead RSD and spam "arrived at destination" log noise.
        for udid in udids:
            try:
                await app_state.terminate_engine(udid)
            except Exception:
                logger.exception("Failed to terminate engine for %s", udid)
        for udid in udids:
            try:
                await dm.disconnect(udid)
                logger.info("Disconnected WiFi device %s (reason=%s)", udid, reason)
            except (OSError, RuntimeError):
                logger.exception("Failed to disconnect %s", udid)
        if udids:
            try:
                # cleanup is always a tunnel/network condition — whether
                # triggered by user stop, watchdog, or liveness probe, the
                # device-level effect is the same: WiFi-side path is gone.
                await broadcast("device_disconnected", {
                    "udids": udids,
                    "reason": reason,
                    "cause": DeviceLostCause.WIFI_DROPPED.value,
                })
            except Exception:
                logger.exception("WiFi cleanup: broadcast failed")
    except Exception:
        logger.exception("WiFi cleanup step failed")
    return udids
