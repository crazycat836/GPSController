"""Per-iOS-version connection establishers for DeviceManager.

iOS 17+ requires a TCP tunnel via CoreDeviceTunnelProxy + RSD; iOS 16.x
uses direct lockdown over usbmux. Both return a populated
``_ActiveConnection``.

Circular-import note: ``_ActiveConnection`` is the dataclass instantiated
here but defined in ``core/device_manager.py``. ``TYPE_CHECKING`` covers
the static type hint; the runtime ``from core.device_manager import
_ActiveConnection`` inside each function defers the actual import until
DeviceManager has finished loading.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from pymobiledevice3.remote.remote_service_discovery import RemoteServiceDiscoveryService
from pymobiledevice3.remote.tunnel_service import CoreDeviceTunnelProxy

if TYPE_CHECKING:
    from core.device_manager import _ActiveConnection

logger = logging.getLogger(__name__)


async def connect_via_tunnel(
    udid: str, lockdown: Any, ios_version: str
) -> "_ActiveConnection":
    """TCP tunnel for iOS 17+ using CoreDeviceTunnelProxy + RSD.

    ``lockdown``: pymobiledevice3 lockdown handle (LockdownClient or
    similar). Typed as Any since pymobiledevice3 doesn't export a stable
    public protocol for it.
    """
    from core.device_manager import _ActiveConnection

    logger.debug("Establishing TCP tunnel for %s (iOS %s)", udid, ios_version)

    try:
        proxy = await CoreDeviceTunnelProxy.create(lockdown)
        tunnel_ctx = proxy.start_tcp_tunnel()
        tunnel_result = await tunnel_ctx.__aenter__()

        logger.info("Tunnel established for %s: %s:%s",
                    udid, tunnel_result.address, tunnel_result.port)

        rsd = RemoteServiceDiscoveryService((tunnel_result.address, tunnel_result.port))
        await rsd.connect()
        logger.info("RSD connected for %s", udid)

        return _ActiveConnection(
            udid=udid,
            lockdown=rsd,
            ios_version=ios_version,
            tunnel_proxy=proxy,
            tunnel_context=tunnel_ctx,
            rsd=rsd,
            usbmux_lockdown=lockdown,
        )
    except Exception:
        logger.exception(
            "TCP tunnel failed for %s (iOS %s). "
            "Ensure you are running as administrator.",
            udid, ios_version,
        )
        raise RuntimeError(
            f"Could not establish device tunnel (iOS {ios_version}). "
            f"Please run GPSController as Administrator."
        )


def connect_via_legacy(
    udid: str, lockdown: Any, ios_version: str
) -> "_ActiveConnection":
    """Direct usbmux lockdown connection for iOS 16.x devices.

    ``lockdown`` is a pymobiledevice3 lockdown handle (typed Any
    because pymobiledevice3 has no stable public protocol).
    """
    from core.device_manager import _ActiveConnection

    logger.info("Using legacy lockdown connection for %s (iOS %s)", udid, ios_version)
    return _ActiveConnection(
        udid=udid,
        lockdown=lockdown,
        ios_version=ios_version,
        usbmux_lockdown=lockdown,
    )
