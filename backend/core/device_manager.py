"""
GPSController Device Manager

Handles iOS device detection, connection lifecycle, tunnel establishment,
and location service creation.  Wraps pymobiledevice3 internals so the
rest of the application never touches low-level device APIs directly.

Supports both USB and WiFi connections.  ``list_devices()`` from usbmuxd
returns devices with ``connection_type`` of ``"USB"`` or ``"Network"``.
WiFi requires the device to be paired and on the same local network.

For iOS 17+, a TCP tunnel via CoreDeviceTunnelProxy is established first,
then a RemoteServiceDiscoveryService (RSD) is created over the tunnel to
access DVT services.  This requires administrator privileges on Windows.
"""

from __future__ import annotations

import asyncio
import logging
import socket
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from pymobiledevice3.lockdown import create_using_usbmux, create_using_tcp
from pymobiledevice3.remote.remote_service_discovery import RemoteServiceDiscoveryService
from pymobiledevice3.remote.tunnel_service import CoreDeviceTunnelProxy
from pymobiledevice3.services.dvt.instruments.dvt_provider import DvtProvider
from pymobiledevice3.usbmux import list_devices

from core.ddi_mount import (
    create_dvt_location_service,
    create_legacy_location_service,
)
from models.schemas import DeviceInfo
from services.location_service import LocationService


class UnsupportedIosVersionError(RuntimeError):
    """Raised when a connecting device's iOS version is below the minimum
    supported by GPSController (currently 16.0). Surfaces a structured error to
    the API layer so the frontend can show an actionable message rather
    than a stack trace."""

    MIN_VERSION = "16.0"

    def __init__(self, version: str) -> None:
        self.version = version
        super().__init__(f"iOS {version} is not supported (requires {self.MIN_VERSION}+)")

logger = logging.getLogger(__name__)


def parse_ios_version(version_string: str) -> tuple[int, ...]:
    """Convert an iOS version string like '17.4.1' into a comparable tuple."""
    try:
        return tuple(int(p) for p in version_string.split("."))
    except (ValueError, AttributeError):
        logger.warning("Unable to parse iOS version '%s', assuming 0.0", version_string)
        return (0, 0)


@dataclass
class _ActiveConnection:
    """Internal bookkeeping for a single connected device."""
    udid: str
    lockdown: object  # LockdownClient or RemoteServiceDiscoveryService
    ios_version: str
    connection_type: str = "USB"  # "USB" or "Network"
    dvt_provider: DvtProvider | None = None
    tunnel_proxy: CoreDeviceTunnelProxy | None = None
    tunnel_context: object = None  # async context manager for the tunnel
    rsd: RemoteServiceDiscoveryService | None = None
    location_service: LocationService | None = None
    usbmux_lockdown: object = None  # Original lockdown client (for legacy fallback on iOS 17+)
    # Cached Developer Mode toggle state. Queried once at connect and
    # invalidated by the AMFI reveal endpoint so `/device/list` doesn't
    # pay a lockdown round-trip per device per poll.
    developer_mode_enabled: bool | None = None


# Public alias so callers outside this module can type-annotate against
# the connection record without depending on the private name. The
# underlying dataclass is intentionally still named with a leading
# underscore — instances are owned and constructed exclusively by
# DeviceManager. External callers obtain one via DeviceManager.get_connection().
ConnectionInfo = _ActiveConnection


class DeviceManager:
    """
    Manages the full lifecycle of iOS device connections.

    Usage::

        dm = DeviceManager()
        devices = await dm.discover_devices()
        await dm.connect(devices[0].udid)
        loc = await dm.get_location_service(devices[0].udid)
        await loc.set(37.7749, -122.4194)
        await dm.disconnect(devices[0].udid)
    """

    # `/api/device/list` is hot-path: the frontend re-fetches on every WS
    # broadcast and multiple clients (Electron + stray browser tabs in dev)
    # multiply the load. A short TTL around usbmux enumeration coalesces
    # concurrent callers into one round-trip. Device metadata doesn't
    # change at sub-second timescales so this is invisible to the UI.
    _DISCOVER_TTL = 0.5

    def __init__(self) -> None:
        self._connections: dict[str, _ActiveConnection] = {}
        self._lock = asyncio.Lock()
        # Serialise DDI downloads/mounts across devices. Without this, two
        # parallel connects on a fresh machine race to write the same DDI
        # cache path and corrupt each other.
        self._ddi_mount_lock = asyncio.Lock()
        self._discover_cache: list[DeviceInfo] | None = None
        self._discover_cache_at: float = 0.0
        self._discover_inflight: asyncio.Task[list[DeviceInfo]] | None = None

    # ------------------------------------------------------------------
    # Discovery
    # ------------------------------------------------------------------

    async def discover_devices(self) -> list[DeviceInfo]:
        """
        Scan for all iOS devices visible over USB and WiFi (usbmuxd).

        usbmuxd returns both USB-connected and WiFi-paired devices on
        the same network.  Each device carries a ``connection_type`` of
        ``"USB"`` or ``"Network"``.

        Returns a list of ``DeviceInfo`` objects with basic identification
        data.  This does **not** establish a persistent connection.

        Results are cached for ``_DISCOVER_TTL`` seconds and concurrent
        callers share a single in-flight enumeration.
        """
        now = time.monotonic()
        if (
            self._discover_cache is not None
            and (now - self._discover_cache_at) < self._DISCOVER_TTL
        ):
            return self._discover_cache

        inflight = self._discover_inflight
        if inflight is not None and not inflight.done():
            # asyncio.shield() keeps the enumeration task running even if
            # *this* caller's await gets cancelled. Without shield, a
            # cancelled caller would also cancel the shared task and the
            # next caller would have to restart enumeration from scratch.
            # If the in-flight task raised, fall through and retry rather
            # than propagating a stale failure.
            try:
                return await asyncio.shield(inflight)
            except Exception:
                logger.debug(
                    "in-flight discover_devices raised; retrying with fresh task",
                    exc_info=True,
                )

        task = asyncio.create_task(self._discover_devices_uncached())
        self._discover_inflight = task
        try:
            try:
                result = await task
            except Exception:
                # Do NOT cache on error — a transient usbmux failure would
                # otherwise hand every caller an empty list for the full
                # TTL and mask the real error. Return [] for this caller;
                # the next one pays for a fresh enumeration immediately.
                return []
            self._discover_cache = result
            self._discover_cache_at = time.monotonic()
            return result
        finally:
            if self._discover_inflight is task:
                self._discover_inflight = None

    async def _discover_devices_uncached(self) -> list[DeviceInfo]:
        devices: list[DeviceInfo] = []
        seen_udids: set[str] = set()

        # Let usbmux failures propagate — the public ``discover_devices``
        # wrapper catches them so we don't poison the cache with an empty
        # list on transient errors.
        raw_devices = await list_devices()

        # "Nothing plugged in" is genuinely useful at INFO because it tells
        # ops "enumeration ran, there are no devices" — distinct from a
        # silent enumeration failure. The per-device line below stays at
        # DEBUG since it would otherwise repeat on every /api/device/list
        # poll.
        if not raw_devices:
            logger.info("discover_devices: usbmux returned 0 raw entries")
        else:
            logger.debug(
                "discover_devices: usbmux returned %d raw entr%s",
                len(raw_devices), "y" if len(raw_devices) == 1 else "ies",
            )

        for raw in raw_devices:
            try:
                conn_type = getattr(raw, "connection_type", "USB")
                # If we already saw this device via USB, skip the Network duplicate
                if raw.serial in seen_udids:
                    # But upgrade to USB if this entry is USB (prefer USB info)
                    if conn_type == "USB":
                        for d in devices:
                            if d.udid == raw.serial:
                                d.connection_type = "USB"
                    continue
                seen_udids.add(raw.serial)

                lockdown = await create_using_usbmux(serial=raw.serial)
                all_values = lockdown.all_values
                # If device is already connected, report the active connection type
                active_conn = self._connections.get(raw.serial)
                if active_conn:
                    conn_type = active_conn.connection_type
                info = DeviceInfo(
                    udid=raw.serial,
                    name=all_values.get("DeviceName", "Unknown"),
                    ios_version=all_values.get("ProductVersion", "0.0"),
                    connection_type=conn_type,
                )
                info.is_connected = raw.serial in self._connections
                # Populate `developer_mode_enabled` for iOS 16+ so the
                # frontend can offer an AMFI "Reveal in Settings" button
                # only when it's actually useful. Reuse the per-connection
                # cache when available so repeat polls don't pay a
                # lockdown round-trip.
                ios_major = parse_ios_version(info.ios_version)[0] if info.ios_version else 0
                if ios_major >= 16:
                    cached = active_conn.developer_mode_enabled if active_conn else None
                    if cached is not None:
                        info.developer_mode_enabled = cached
                    else:
                        try:
                            flag = bool(await lockdown.get_developer_mode_status())
                            info.developer_mode_enabled = flag
                            if active_conn is not None:
                                active_conn.developer_mode_enabled = flag
                        except Exception:
                            logger.debug(
                                "get_developer_mode_status failed for %s",
                                raw.serial, exc_info=True,
                            )
                # Derived gate for the frontend AMFI button — all
                # four preconditions in one place.
                info.can_reveal_developer_mode = (
                    info.is_connected
                    and (conn_type or "").lower() == "usb"
                    and ios_major >= 16
                    and info.developer_mode_enabled is False
                )
                devices.append(info)
                # DEBUG — see discover_devices() for rationale. This line
                # would otherwise repeat once per device per poll.
                logger.debug(
                    "  device %s '%s' iOS %s via %s (connected=%s)",
                    info.udid, info.name, info.ios_version, conn_type, info.is_connected,
                )
            except Exception:
                logger.exception("Failed to query device %s", getattr(raw, "serial", "?"))

        return devices

    def _invalidate_discover_cache(self) -> None:
        """Call after any mutation to ``_connections`` so the next
        ``discover_devices()`` reflects the new state without waiting
        for TTL expiry."""
        self._discover_cache = None
        self._discover_cache_at = 0.0

    # ------------------------------------------------------------------
    # Connection
    # ------------------------------------------------------------------

    async def connect(self, udid: str) -> None:
        """
        Establish a connection appropriate for the device's iOS version.

        Supports both USB and WiFi (Network) connections via usbmuxd.

        * **iOS 17+** -- TCP tunnel via CoreDeviceTunnelProxy + RSD.
        * **iOS 16.x** -- plain lockdown over usbmux + legacy location service.
        """
        async with self._lock:
            if udid in self._connections:
                logger.info("Device %s is already connected", udid)
                return

        # Detect connection type from usbmux device list.
        connection_type = "USB"
        try:
            raw_devices = await list_devices()
            for raw in raw_devices:
                if raw.serial == udid:
                    connection_type = getattr(raw, "connection_type", "USB")
                    # Prefer USB if device shows up as both
                    if connection_type == "USB":
                        break
        except Exception:
            logger.debug("Could not determine connection type for %s, assuming USB", udid)

        logger.info("Connecting to %s via %s", udid, connection_type)

        # Create a fresh lockdown client to read the iOS version.
        try:
            lockdown = await create_using_usbmux(serial=udid)
        except Exception:
            logger.exception("Cannot create lockdown client for %s via %s", udid, connection_type)
            raise

        ios_version_str: str = lockdown.all_values.get("ProductVersion", "0.0")
        ver = parse_ios_version(ios_version_str)

        if ver < (16, 0):
            logger.warning(
                "Refusing connect: %s reports iOS %s, below minimum %s",
                udid, ios_version_str, UnsupportedIosVersionError.MIN_VERSION,
            )
            raise UnsupportedIosVersionError(ios_version_str)

        if ver >= (17, 0):
            conn = await self._connect_tunnel(udid, lockdown, ios_version_str)
        else:
            conn = self._connect_legacy(udid, lockdown, ios_version_str)
        conn.connection_type = connection_type

        async with self._lock:
            self._connections[udid] = conn
        self._invalidate_discover_cache()

        logger.info("Connected to %s (iOS %s) via %s", udid, ios_version_str, connection_type)

    # -- iOS 17+ via CoreDeviceTunnelProxy ---------------------------------

    async def _connect_tunnel(
        self, udid: str, lockdown: Any, ios_version: str
    ) -> _ActiveConnection:
        # `lockdown`: pymobiledevice3 lockdown handle (LockdownClient or
        # similar). Typed as Any since pymobiledevice3 doesn't export a
        # stable public protocol for it.
        """TCP tunnel for iOS 17+ using CoreDeviceTunnelProxy + RSD."""
        logger.debug("Establishing TCP tunnel for %s (iOS %s)", udid, ios_version)

        try:
            proxy = await CoreDeviceTunnelProxy.create(lockdown)
            tunnel_ctx = proxy.start_tcp_tunnel()
            tunnel_result = await tunnel_ctx.__aenter__()

            logger.info("Tunnel established for %s: %s:%s",
                        udid, tunnel_result.address, tunnel_result.port)

            # Create RSD over the tunnel
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

    # iOS < 17 path removed in v0.1.49 — see UnsupportedIosVersionError.

    def _connect_legacy(
        self, udid: str, lockdown: Any, ios_version: str
    ) -> _ActiveConnection:
        """Direct usbmux lockdown connection for iOS 16.x devices.

        ``lockdown`` is a pymobiledevice3 lockdown handle (typed Any
        because pymobiledevice3 has no stable public protocol)."""
        logger.info("Using legacy lockdown connection for %s (iOS %s)", udid, ios_version)
        return _ActiveConnection(
            udid=udid,
            lockdown=lockdown,
            ios_version=ios_version,
            usbmux_lockdown=lockdown,
        )

    # ------------------------------------------------------------------
    # Disconnection
    # ------------------------------------------------------------------

    async def disconnect(self, udid: str) -> None:
        """Tear down the connection and clean up resources for *udid*.

        The five close steps below log WARN with a single-line summary
        instead of logger.exception, because this cleanup path runs both
        for user-initiated disconnects (where failures are genuinely
        unexpected) *and* for device-lost cleanup after a dead tunnel
        (where EOF/ConnectionReset/TimeoutError on every close is the
        expected outcome — the OS sockets are already gone). Dumping
        five full tracebacks per device-lost event produced ~150 lines
        of noise that masked real errors; the single-line summary
        preserves "which step and which exception class" for diagnostics
        without the ceremony. If a future maintainer needs full stacks,
        raise the logger to DEBUG."""
        async with self._lock:
            conn = self._connections.pop(udid, None)

        if conn is None:
            logger.warning("Disconnect requested for unknown device %s", udid)
            return
        self._invalidate_discover_cache()

        # Clear any active location simulation first.
        if conn.location_service is not None:
            try:
                await conn.location_service.clear()
                # stopLocationSimulation is declared `expects_reply=False`
                # in pymobiledevice3, so clear() returns as soon as the DTX
                # message is queued — iOS has not necessarily processed it
                # yet. Without this flush window, the teardown below rips
                # out the DVT channel / RSD / tunnel before the stop
                # reaches the device, so the phone keeps the last simulated
                # coordinate even though our log says "cleared".
                await asyncio.sleep(0.3)
            except Exception as exc:
                logger.warning("Error clearing location on disconnect for %s: %s", udid, exc)

        # Shut down the DVT provider if it was opened.
        if conn.dvt_provider is not None:
            try:
                await conn.dvt_provider.__aexit__(None, None, None)
            except Exception as exc:
                logger.warning("Error closing DvtProvider for %s: %s", udid, exc)

        # Close RSD.
        if conn.rsd is not None:
            try:
                await conn.rsd.close()
            except Exception as exc:
                logger.warning("Error closing RSD for %s: %s", udid, exc)

        # Close tunnel context.
        if conn.tunnel_context is not None:
            try:
                await conn.tunnel_context.__aexit__(None, None, None)
            except Exception as exc:
                logger.warning("Error closing tunnel for %s: %s", udid, exc)

        # Close tunnel proxy. CoreDeviceTunnelProxy.close() is an async
        # coroutine in current pymobiledevice3; without await it logs a
        # "coroutine was never awaited" RuntimeWarning on shutdown and the
        # underlying socket is cleaned up by GC rather than deterministically.
        if conn.tunnel_proxy is not None:
            try:
                await conn.tunnel_proxy.close()
            except Exception as exc:
                logger.warning("Error closing tunnel proxy for %s: %s", udid, exc)

        logger.info("Disconnected device %s", udid)

    # ------------------------------------------------------------------
    # Location service
    # ------------------------------------------------------------------

    async def get_location_service(self, udid: str) -> LocationService:
        """
        Return a ``LocationService`` instance for the given device.

        The concrete type depends on the iOS version:

        * iOS 17+  ->  ``DvtLocationService`` (uses DVT instrumentation)
        * iOS < 17 ->  ``LegacyLocationService`` (uses DtSimulateLocation)

        The service is cached on the connection so subsequent calls are cheap.
        """
        async with self._lock:
            conn = self._connections.get(udid)

        if conn is None:
            raise RuntimeError(
                f"Device {udid} is not connected. Call connect() first."
            )

        if conn.location_service is not None:
            return conn.location_service

        ver = parse_ios_version(conn.ios_version)
        if ver >= (17, 0):
            loc = await create_dvt_location_service(conn, self._ddi_mount_lock)
        else:
            loc = await create_legacy_location_service(conn)
        conn.location_service = loc
        return loc

    # connect_wifi (the legacy direct-IP WiFi connect helper) was removed
    # in v0.1.49 in favour of connect_wifi_tunnel below, which assumes a
    # pre-established RSD tunnel. The DDI mount and location-service
    # factory helpers used by ``get_location_service`` now live in
    # ``core.ddi_mount`` (extracted in v0.13.x). iOS 16.x devices remain
    # supported (UnsupportedIosVersionError only rejects < 16.0). iOS
    # 17+ continues to use the personalized DDI mount path +
    # DvtLocationService, with LegacyLocationService as a runtime
    # fallback inside ``create_dvt_location_service`` when DVT itself
    # fails.

    # ------------------------------------------------------------------
    # WiFi connection (iOS 17+ tunnel only)
    # ------------------------------------------------------------------

    async def connect_wifi_tunnel(
        self, rsd_address: str, rsd_port: int
    ) -> DeviceInfo:
        """Connect to a device via an existing WiFi tunnel.

        Use this when a WiFi tunnel has already been established (by the
        in-process ``TunnelRunner`` or ``pymobiledevice3 remote start-tunnel``).
        The caller provides the RSD address and port.

        Returns a ``DeviceInfo`` describing the connected device.
        """
        logger.info("Connecting via WiFi tunnel RSD at %s:%d", rsd_address, rsd_port)

        rsd = None
        last_exc: Exception | None = None
        # TUN interface routes may take a few seconds to become reachable
        # after the tunnel process reports ready, so retry with backoff.
        for attempt in range(1, 11):
            rsd = RemoteServiceDiscoveryService((rsd_address, rsd_port))
            try:
                await rsd.connect()
                last_exc = None
                break
            except Exception as exc:
                last_exc = exc
                logger.warning(
                    "RSD connect attempt %d/10 failed (%s): %s",
                    attempt, exc.__class__.__name__, exc,
                )
                try:
                    await rsd.close()
                except (OSError, ConnectionError):
                    logger.debug(
                        "rsd.close() failed after connect attempt %d (likely already closed)",
                        attempt,
                        exc_info=True,
                    )
                await asyncio.sleep(min(0.5 * attempt, 2.0))

        if last_exc is not None:
            logger.error("Failed to connect to RSD at %s:%d after retries", rsd_address, rsd_port)
            raise RuntimeError(
                f"Could not connect to WiFi tunnel RSD ({rsd_address}:{rsd_port}). "
                "Ensure the WiFi tunnel is still active."
            ) from last_exc

        peer = rsd.peer_info or {}
        props = peer.get("Properties", {})
        udid = props.get("UniqueDeviceID", "")
        ios_version_str = props.get("OSVersion", "0.0")
        device_name = props.get("DeviceClass", "iPhone")

        if udid in self._connections:
            await self.disconnect(udid)

        conn = _ActiveConnection(
            udid=udid,
            lockdown=rsd,
            ios_version=ios_version_str,
            connection_type="Network",
            rsd=rsd,
        )

        async with self._lock:
            self._connections[udid] = conn
        self._invalidate_discover_cache()

        logger.info("WiFi tunnel connected to %s (iOS %s)", udid, ios_version_str)

        return DeviceInfo(
            udid=udid,
            name=device_name,
            ios_version=ios_version_str,
            connection_type="Network",
            is_connected=True,
        )

    async def scan_wifi_devices(
        self,
        subnet: str | None = None,
        timeout: float = 0.5,
    ) -> list[dict]:
        """Scan the local network for iOS devices on port 62078 (lockdownd).

        Tries each IP in the subnet concurrently.  Returns a list of
        ``{"ip": ..., "name": ..., "udid": ...}`` dicts for reachable
        devices.

        If *subnet* is not given, the local machine's subnet is guessed
        from the default route interface.
        """
        if subnet is None:
            subnet = _guess_local_subnet()
            if subnet is None:
                logger.warning("Cannot determine local subnet for WiFi scan")
                return []

        logger.info("Scanning subnet %s for iOS devices...", subnet)

        # Generate IPs: e.g. "192.168.1" → .1 to .254
        base = subnet.rsplit(".", 1)[0]
        ips = [f"{base}.{i}" for i in range(1, 255)]

        async def _probe(ip: str) -> dict | None:
            try:
                _, writer = await asyncio.wait_for(
                    asyncio.open_connection(ip, 62078),
                    timeout=timeout,
                )
                writer.close()
                await writer.wait_closed()
                # Port is open — try a quick lockdown to get device info
                try:
                    pair_rec = _load_pair_record()
                    lockdown = await asyncio.wait_for(
                        create_using_tcp(
                            ip,
                            pair_record=pair_rec,
                            autopair=pair_rec is None,
                        ),
                        timeout=5.0,
                    )
                    vals = lockdown.all_values
                    return {
                        "ip": ip,
                        "name": vals.get("DeviceName", "Unknown"),
                        "udid": vals.get("UniqueDeviceID", lockdown.udid or ""),
                        "ios_version": vals.get("ProductVersion", "0.0"),
                    }
                except Exception:
                    # Port open but lockdown failed — still report it
                    return {"ip": ip, "name": "iOS Device", "udid": "", "ios_version": ""}
            except (OSError, asyncio.TimeoutError):
                return None

        results = await asyncio.gather(*[_probe(ip) for ip in ips])
        found = [r for r in results if r is not None]
        logger.info("WiFi scan found %d device(s)", len(found))
        return found

    # ------------------------------------------------------------------
    # Utilities
    # ------------------------------------------------------------------

    @property
    def connected_udids(self) -> list[str]:
        """Return the UDIDs of all currently connected devices."""
        return list(self._connections.keys())

    @property
    def connected_count(self) -> int:
        """Return the number of currently connected devices."""
        return len(self._connections)

    def is_connected(self, udid: str) -> bool:
        """Check whether a device is currently connected."""
        return udid in self._connections

    def get_connection(self, udid: str) -> "ConnectionInfo | None":
        """Return the live connection record for *udid*, or None if absent.

        Public accessor for the API layer, which previously reached into
        ``_connections`` directly. The returned object exposes
        ``lockdown``, ``ios_version``, ``connection_type``,
        ``developer_mode_enabled`` and similar fields callers need for
        cross-cutting concerns like AMFI. Mutations on the returned
        instance are visible to subsequent reads — that is intentional;
        DeviceManager owns the lifecycle but does not deep-copy on read."""
        return self._connections.get(udid)

    def udids_by_connection_type(self, connection_type: str) -> list[str]:
        """Return UDIDs whose connection matches ``connection_type``
        (e.g. ``'Network'`` or ``'USB'``). Preferred over reaching into
        ``_connections`` from the API layer."""
        return [
            udid for udid, conn in self._connections.items()
            if getattr(conn, "connection_type", "") == connection_type
        ]

    def get_connection_type(self, udid: str) -> str:
        """Return ``'USB'`` or ``'Network'`` for a connected device."""
        conn = self._connections.get(udid)
        return conn.connection_type if conn else "USB"

    async def disconnect_all(self) -> None:
        """Disconnect every active device."""
        udids = list(self._connections.keys())
        for udid in udids:
            await self.disconnect(udid)
        logger.info("All devices disconnected")


def _load_pair_record(udid: str | None = None) -> dict | None:
    """Load a USB pair record from Apple's system Lockdown store.

    On Windows, pair records live in ``%ALLUSERSPROFILE%\\Apple\\Lockdown``.
    If *udid* is given, loads that specific record; otherwise loads the
    first ``.plist`` found (most setups have only one device).
    """
    import os
    import plistlib

    lockdown_dir = Path(os.environ.get("ALLUSERSPROFILE", "C:/ProgramData")) / "Apple" / "Lockdown"
    if not lockdown_dir.exists():
        logger.debug("Apple Lockdown directory not found: %s", lockdown_dir)
        return None

    target: Path | None = None
    if udid:
        candidate = lockdown_dir / f"{udid}.plist"
        if candidate.exists():
            target = candidate
    else:
        # Pick the first device plist (skip SystemConfiguration.plist)
        for f in lockdown_dir.glob("*.plist"):
            if f.stem != "SystemConfiguration":
                target = f
                break

    if target is None:
        logger.debug("No pair record found in %s", lockdown_dir)
        return None

    try:
        with open(target, "rb") as fh:
            record = plistlib.load(fh)
        logger.debug("Loaded pair record from %s", target)
        return record
    except Exception:
        logger.exception("Failed to load pair record from %s", target)
        return None


def _guess_local_subnet() -> str | None:
    """Best-effort guess of the local LAN subnet (e.g. '192.168.1.0/24').

    Returns the base IP like '192.168.1.0' or ``None`` if unable to determine.
    """
    try:
        # Open a UDP socket to a public IP (doesn't actually send)
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
        s.close()
        # Return the /24 base
        parts = local_ip.rsplit(".", 1)
        return f"{parts[0]}.0"
    except (OSError, IndexError):
        return None
