import asyncio
import ipaddress
import logging
import socket
from collections.abc import Awaitable, Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator

from api._errors import ErrorCode, http_err, ios_unsupported_error, max_devices_error
from config import MAX_DEVICES
from context import ctx
from services.wifi_tunnel_service import (
    _cleanup_wifi_connections,
    _tcp_probe,
    _tunnel,
)

router = APIRouter(prefix="/api/device", tags=["device"])

# The tunnel runner singleton lives in services.wifi_tunnel_service so
# core.tunnel_liveness can reach it without crossing back into api/. The
# import above is the only access point the router uses.
# Watchdog task handle (lives at module level since TunnelRunner is now shared).
_tunnel_watchdog_task: "asyncio.Task | None" = None

# Bounded thread pool for reverse-DNS lookups during a /24 subnet scan.
# `socket.gethostbyaddr` is blocking; routing 253 concurrent lookups
# through the default executor saturates it (default = min(32, os.cpu_count() + 4))
# and stalls every other run_in_executor caller until the scan finishes.
# 16 workers is enough to keep the scan fast without monopolising threads.
_DNS_POOL = ThreadPoolExecutor(max_workers=16, thread_name_prefix="wifi-dns")

_tunnel_logger = logging.getLogger("wifi_tunnel")
logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class _TeardownStep:
    """One ordered step in a tunnel teardown / fallback rollback chain.

    `name` shows up in debug logs when the step raises. `fn` may be sync or
    async — `_run_teardown_steps` awaits the result if it's a coroutine.
    """
    name: str
    fn: Callable[[], Awaitable[None] | None]


async def _run_teardown_steps(steps: list[_TeardownStep]) -> list[dict[str, str]]:
    """Run *steps* in order with a single flat try/except per step.

    Errors are collected (for callers that want to inspect or surface them)
    and logged at DEBUG with `exc_info=True` — preserving this module's
    silent-`except` discipline. `asyncio.CancelledError` is treated as
    expected (e.g. the cancel-and-await teardown step) and never collected.
    """
    errors: list[dict[str, str]] = []
    for step in steps:
        try:
            result = step.fn()
            if asyncio.iscoroutine(result):
                await result
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            errors.append({"step": step.name, "error": str(exc)})
            _tunnel_logger.debug(
                "Teardown step %s failed", step.name, exc_info=True,
            )
    return errors


def _validate_local_ip(value: str) -> str:
    """Reject non-IP strings and addresses outside the loopback / RFC1918 /
    link-local ranges. The tunnel endpoints should only ever reach an
    iPhone on the same LAN — anything else points at SSRF.
    """
    try:
        addr = ipaddress.ip_address(value)
    except ValueError as exc:
        raise ValueError("invalid IP address") from exc
    if not (
        addr.is_loopback
        or addr.is_private
        or addr.is_link_local
    ):
        raise ValueError("address must be loopback / private / link-local")
    return str(addr)


def _dm():
    app_state = ctx.app_state
    return app_state.device_manager


# /wifi/connect (legacy direct-IP WiFi for iOS <17) removed in v0.1.49.


def _purge_stale_remote_pair_record(udid: str) -> None:
    """Best-effort delete of the cached RemotePairing record for *udid*.

    Required so RemotePairingProtocol.connect() can't short-circuit through
    a corrupt cached record and skip the actual _pair() handshake.
    """
    try:
        from pymobiledevice3.common import get_home_folder
        from pymobiledevice3.pair_records import (
            PAIRING_RECORD_EXT,
            get_remote_pairing_record_filename,
        )
        stale = get_home_folder() / f"{get_remote_pairing_record_filename(udid)}.{PAIRING_RECORD_EXT}"
        if stale.exists():
            stale.unlink()
            _tunnel_logger.info("Re-pair: removed stale remote pair record %s", stale)
    except Exception:
        _tunnel_logger.debug("Re-pair: could not check/remove stale pair record", exc_info=True)


async def _perform_remote_pair_handshake(
    lockdown,
    udid: str,
    ios_version: str,
    resources: dict,
) -> bool:
    """Run the iOS 17+ RemotePairing handshake and return whether the pair
    record was regenerated.

    Populates *resources* (mutable dict shared with the caller) as each step
    succeeds, so the caller's finally can close whatever was opened — even
    when this function raises mid-way.

    Raises a structured HTTPException on handshake failure, mapping
    pymobiledevice3's typed exceptions to user-friendly messages.
    """
    from pymobiledevice3.remote.tunnel_service import (
        CoreDeviceTunnelProxy,
        create_core_device_tunnel_service_using_rsd,
    )
    from pymobiledevice3.remote.remote_service_discovery import RemoteServiceDiscoveryService

    _purge_stale_remote_pair_record(udid)

    try:
        # 1. Open a CoreDeviceTunnelProxy tunnel over USB.
        resources["proxy"] = await CoreDeviceTunnelProxy.create(lockdown)
        resources["tunnel_ctx"] = resources["proxy"].start_tcp_tunnel()
        tunnel_result = await resources["tunnel_ctx"].__aenter__()

        # 2. Construct an RSD on the tunnel.
        resources["rsd"] = RemoteServiceDiscoveryService((tunnel_result.address, tunnel_result.port))
        await resources["rsd"].connect()

        # 3. This is the step that actually triggers the Trust dialog
        #    (when no cached record) and persists the RemotePairing file
        #    to ~/.pymobiledevice3/. RemotePairingProtocol.connect()
        #    calls _pair() which runs _request_pair_consent() — Trust
        #    prompt — then save_pair_record().
        _tunnel_logger.info(
            "Re-pair: opening CoreDeviceTunnelService over RSD %s:%s — "
            "Trust prompt should appear on iPhone...",
            tunnel_result.address, tunnel_result.port,
        )
        resources["tunnel_svc"] = await create_core_device_tunnel_service_using_rsd(
            resources["rsd"], autopair=True,
        )
        _tunnel_logger.info(
            "Re-pair: CoreDeviceTunnelService connected for %s — RemotePairing record written",
            udid,
        )
        return True
    except Exception as e:
        _tunnel_logger.exception("Re-pair: RemotePairing handshake failed")
        # Use isinstance against pymobiledevice3's typed exceptions instead
        # of substring-matching str(e) — the message wording drifts across
        # versions but the class names are stable API.
        from pymobiledevice3.exceptions import (
            NotPairedError,
            PairingDialogResponsePendingError,
            PairingError,
        )
        if isinstance(e, PairingDialogResponsePendingError):
            friendly = "Tap \"Trust\" on the iPhone unlock screen and retry (the timeout is only a few seconds)."
        elif isinstance(e, (NotPairedError, PairingError)):
            friendly = "USB pairing invalid; unplug and re-plug USB, then tap Trust."
        else:
            friendly = "RemotePairing handshake failed; check the backend log for details."
        raise HTTPException(
            status_code=500,
            detail={
                "code": ErrorCode.REMOTE_PAIR_FAILED.value,
                "message": friendly,
                "udid": udid,
                "ios_version": ios_version,
            },
        )


async def _close_remote_pair_resources(resources: dict) -> None:
    """Idempotently close every resource opened by the RemotePairing handshake.

    Safe to call when the handshake never started, succeeded fully, or failed
    mid-way — each entry in *resources* may be ``None``. Closers run in
    reverse-open order; close errors are swallowed (logged at DEBUG) so a
    partial teardown can still finish the rest.
    """
    # Service / RSD / tunnel-context first; CoreDeviceTunnelProxy last.
    for closer in (
        lambda: resources["tunnel_svc"] and resources["tunnel_svc"].close(),
        lambda: resources["rsd"] and resources["rsd"].close(),
        lambda: resources["tunnel_ctx"] and resources["tunnel_ctx"].__aexit__(None, None, None),
    ):
        try:
            r = closer()
            if hasattr(r, "__await__"):
                await r
        except Exception as exc:
            _tunnel_logger.debug(
                "Re-pair cleanup: closer raised (%s); ignoring",
                exc.__class__.__name__, exc_info=True,
            )
    try:
        if resources["proxy"] is not None:
            # CoreDeviceTunnelProxy.close() is a coroutine — mirror the
            # await-if-awaitable pattern used for the closers above so we
            # don't leak a "was never awaited" warning.
            r = resources["proxy"].close()
            if hasattr(r, "__await__"):
                await r
    except Exception as exc:
        _tunnel_logger.debug(
            "Re-pair cleanup: proxy.close() raised (%s); ignoring",
            exc.__class__.__name__, exc_info=True,
        )


async def _select_usb_device() -> str:
    """Return the UDID of the first USB-attached iOS device.

    Raises a structured HTTPException when usbmux is unreachable or when no
    USB-connected device is plugged in (Network entries cannot regenerate the
    RemotePairing record).
    """
    from pymobiledevice3.usbmux import list_devices as mux_list_devices
    try:
        raw_devices = await mux_list_devices()
    except Exception:
        logger.exception("usbmux list_devices failed during /wifi/repair")
        raise http_err(500, ErrorCode.USBMUX_UNAVAILABLE, "Could not list USB devices; check that usbmuxd is running")

    usb_dev = next((d for d in raw_devices if getattr(d, "connection_type", "USB") == "USB"), None)
    if usb_dev is None:
        raise HTTPException(
            status_code=400,
            detail={
                "code": ErrorCode.REPAIR_NEEDS_USB.value,
                "message": "Please connect the iPhone via USB first. Re-pairing needs USB to trigger the \"Trust This Computer\" prompt.",
            },
        )
    return usb_dev.serial


@router.get("/wifi/scan")
async def wifi_scan():
    """Scan the local network for iOS devices."""
    dm = _dm()
    try:
        results = await dm.scan_wifi_devices()
        return results
    except Exception:
        logger.exception("WiFi scan failed")
        raise http_err(500, ErrorCode.SCAN_FAILED, "WiFi scan failed; please retry shortly")


class WifiTunnelConnectRequest(BaseModel):
    rsd_address: str
    rsd_port: int = Field(ge=1, le=65535)

    @field_validator("rsd_address")
    @classmethod
    def _check_rsd_address(cls, v: str) -> str:
        return _validate_local_ip(v)


@router.post("/wifi/tunnel")
async def wifi_tunnel_connect(req: WifiTunnelConnectRequest):
    """Connect to a device via an existing WiFi tunnel (RSD address/port)."""
    app_state = ctx.app_state
    from core.device_manager import UnsupportedIosVersionError
    dm = _dm()
    # Max MAX_DEVICES devices (group mode). connect_wifi_tunnel may reconnect an
    # existing udid; we can only cheaply check the pre-state here.
    if dm.connected_count >= MAX_DEVICES:
        raise max_devices_error()
    try:
        info = await dm.connect_wifi_tunnel(req.rsd_address, req.rsd_port)
        await app_state.create_engine_for_device(info.udid)
        try:
            from services.ws_broadcaster import broadcast
            await broadcast("device_connected", {
                "udid": info.udid,
                "name": info.name,
                "ios_version": info.ios_version,
                "connection_type": "Network",
            })
        except Exception as exc:
            logger.debug(
                "wifi_tunnel_connect: device_connected broadcast failed (%s)",
                exc.__class__.__name__, exc_info=True,
            )
        return {
            "status": "connected",
            "udid": info.udid,
            "name": info.name,
            "ios_version": info.ios_version,
            "connection_type": "Network",
        }
    except UnsupportedIosVersionError as e:
        raise ios_unsupported_error(e.version)
    except Exception:
        logger.exception("WiFi tunnel connect failed", extra={"rsd_address": req.rsd_address})
        raise http_err(500, ErrorCode.CONNECT_FAILED, "Connection failed; ensure the tunnel is still running and retry")


# ── WiFi Tunnel lifecycle (start / status / stop) ───────


@router.post("/wifi/repair")
async def wifi_repair():
    """Regenerate the RemotePairing pair record (~/.pymobiledevice3/) using a
    currently-attached USB device. The iPhone will show a 'Trust This Computer'
    prompt the first time; after the user taps 信任, a fresh RemotePairing
    record is written and WiFi Tunnel will work again.

    Flow:
      1. List USB devices (must have at least one plugged in).
      2. Open a USB lockdown session with autopair=True — this triggers the
         Trust prompt if the Apple Lockdown USB record is missing.
      3. For iOS 17+: open CoreDeviceTunnelProxy.start_tcp_tunnel() briefly.
         pymobiledevice3 persists the RemotePairing record to
         ~/.pymobiledevice3/ as a side effect of the RSD handshake.
    """
    from pymobiledevice3.lockdown import create_using_usbmux

    udid = await _select_usb_device()
    _tunnel_logger.info("Re-pair requested for USB device %s", udid)

    # Step 1: USB lockdown autopair — pops Trust prompt if USB record missing.
    try:
        lockdown = await create_using_usbmux(serial=udid, autopair=True)
    except Exception:
        logger.exception("USB autopair failed during /wifi/repair", extra={"udid": udid})
        raise HTTPException(
            status_code=500,
            detail={
                "code": ErrorCode.TRUST_FAILED.value,
                "message": "USB trust failed — tap \"Trust\" on the iPhone unlock screen and retry",
                "udid": udid,
            },
        )

    ios_version = lockdown.all_values.get("ProductVersion", "0.0")
    name = lockdown.all_values.get("DeviceName", "iPhone")

    # Step 2: iOS 17+ — briefly open a CoreDeviceTunnelProxy. The RSD handshake
    # re-generates the ~/.pymobiledevice3/ RemotePairing record.
    try:
        major = int(ios_version.split(".")[0])
    except (ValueError, IndexError):
        major = 0

    remote_record_regenerated = False
    if major >= 17:
        resources: dict = {"proxy": None, "tunnel_ctx": None, "rsd": None, "tunnel_svc": None}
        try:
            remote_record_regenerated = await _perform_remote_pair_handshake(
                lockdown, udid, ios_version, resources,
            )
        finally:
            await _close_remote_pair_resources(resources)

    return {
        "status": "paired",
        "udid": udid,
        "name": name,
        "ios_version": ios_version,
        "remote_record_regenerated": remote_record_regenerated,
    }


class WifiTunnelStartRequest(BaseModel):
    ip: str
    port: int = Field(default=49152, ge=1, le=65535)
    udid: str | None = None

    @field_validator("ip")
    @classmethod
    def _check_ip(cls, v: str) -> str:
        return _validate_local_ip(v)


def _get_primary_local_ip() -> str | None:
    """Return this machine's primary IPv4 (the one used to reach the internet)."""
    import socket as _s
    try:
        s = _s.socket(_s.AF_INET, _s.SOCK_DGRAM)
        s.settimeout(0.5)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return None


async def _scan_subnet_for_port(port: int = 49152) -> list[str]:
    """Scan the local /24 subnet for hosts responding on the given TCP port.

    Probes are gated by a Semaphore so we never have more than 32 parallel
    TCP connects in flight. Without the gate, a single scan opens all 253
    candidates simultaneously which (a) trips corporate-network IDS that
    flag horizontal port scans and (b) can saturate the local socket
    table. With the gate, worst-case latency is still bounded by
    ceil(253/32) * 0.4s ≈ 3.2s — fine for a user-initiated one-shot scan.
    """
    my_ip = _get_primary_local_ip()
    if not my_ip:
        return []
    try:
        parts = my_ip.split(".")
        prefix = ".".join(parts[:3])
    except (AttributeError, IndexError):
        return []

    candidates = [f"{prefix}.{i}" for i in range(1, 255) if f"{prefix}.{i}" != my_ip]
    sem = asyncio.Semaphore(32)

    async def _probe_gated(ip: str) -> bool:
        async with sem:
            return await _tcp_probe(ip, port, 0.4)

    results = await asyncio.gather(
        *[_probe_gated(ip) for ip in candidates],
        return_exceptions=True,
    )
    hits = [ip for ip, ok in zip(candidates, results) if ok is True]
    return hits


async def _resolve_hostname(ip: str, *, timeout: float = 2.0) -> str | None:
    """Reverse-DNS lookup. Returns a friendly hostname or None on failure.

    Strips trailing dots and the `.local` suffix that Bonjour-aware routers
    typically advertise. Rejects names equal to the IP (no-op resolution)."""
    loop = asyncio.get_running_loop()
    try:
        info = await asyncio.wait_for(
            loop.run_in_executor(_DNS_POOL, socket.gethostbyaddr, ip),
            timeout=timeout,
        )
    except (socket.herror, socket.gaierror, OSError, asyncio.TimeoutError):
        return None
    name = (info[0] or "").rstrip(".").removesuffix(".local").rstrip(".")
    if not name or name == ip:
        return None
    return name


@router.get("/wifi/tunnel/discover")
async def wifi_tunnel_discover():
    """Find iPhones on the local network. First tries mDNS (Bonjour RemotePairing
    broadcast); if that yields nothing, falls back to a /24 subnet TCP scan on the
    standard RemotePairing port (49152). TCP-scan hits get a parallel reverse-DNS
    lookup so devices broadcasting a hostname (e.g. `Johns-iPhone.local`) show a
    real name instead of duplicating the IP."""
    results: list[dict] = []

    # --- 1) mDNS / Bonjour broadcast ---
    try:
        from pymobiledevice3.bonjour import browse_remotepairing
        instances = await browse_remotepairing(timeout=3.0)
        for inst in instances:
            ipv4s = [a for a in (inst.addresses or []) if ":" not in a]
            addrs = ipv4s if ipv4s else list(inst.addresses or [])
            for addr in addrs:
                results.append({
                    "ip": addr,
                    "port": inst.port,
                    "host": inst.host,
                    "name": inst.instance or inst.host,
                    "method": "mdns",
                })
    except Exception as e:
        _tunnel_logger.warning("mDNS browse failed: %s", e)

    # --- 2) Fallback: TCP subnet scan on port 49152 ---
    if not results:
        _tunnel_logger.info("mDNS empty; falling back to /24 TCP scan on port 49152")
        try:
            hits = await _scan_subnet_for_port(49152)
            names = await asyncio.gather(*(_resolve_hostname(ip) for ip in hits))
            for ip, resolved in zip(hits, names):
                results.append({
                    "ip": ip,
                    "port": 49152,
                    "host": ip,
                    "name": resolved or ip,
                    "method": "tcp_scan",
                })
        except Exception as e:
            _tunnel_logger.warning("TCP scan failed: %s", e)

    # De-dupe on (ip, port)
    seen = set()
    unique = []
    for r in results:
        key = (r["ip"], r["port"])
        if key in seen:
            continue
        seen.add(key)
        unique.append(r)

    return {"devices": unique}


async def _tunnel_watchdog(task: asyncio.Task, gen: int) -> None:
    """Watch the tunnel task; if it dies unexpectedly (WiFi blip, iPhone
    locked, admin revoked), clean up any dependent WiFi connections so the
    UI can recover gracefully. A 5s grace window allows the user to restart
    the tunnel before we tear down engines.

    *gen* is the tunnel epoch we were spawned to watch. Comparing the
    live ``_tunnel.generation`` against this snapshot survives a
    stop + start cycle inside the grace window — the previous identity
    check against ``_tunnel.task`` (which transiently goes None between
    ``stop()`` and the next ``start()``) would have torn down the
    brand-new tunnel's resources by mistake.
    """
    try:
        try:
            await task
        except asyncio.CancelledError:
            return
        except BaseException as exc:
            _tunnel_logger.debug(
                "watchdog: tunnel task raised %s; proceeding to cleanup",
                exc.__class__.__name__, exc_info=True,
            )

        # Task has ended. If a newer tunnel has already replaced ours,
        # this watchdog is stale — nothing to do.
        if _tunnel.generation != gen:
            _tunnel_logger.info(
                "watchdog: generation mismatch (current=%d, expected=%d); "
                "stale watchdog exiting without cleanup",
                _tunnel.generation, gen,
            )
            return

        _tunnel_logger.warning("Tunnel task exited unexpectedly; 5s grace period")
        try:
            from services.ws_broadcaster import broadcast
            await broadcast("tunnel_degraded", {"reason": "task_exited"})
        except Exception:
            _tunnel_logger.exception("Failed to emit tunnel_degraded event")

        await asyncio.sleep(5.0)

        async with _tunnel.lock:
            # Generation gate is the post-sleep authority. If anything
            # ran start() inside the grace window the epoch will have
            # moved on and we must not tear down the new tunnel — even
            # if our original task identity also happens to be None.
            if _tunnel.generation != gen:
                _tunnel_logger.info(
                    "watchdog: generation mismatch after grace "
                    "(current=%d, expected=%d); bailing without cleanup",
                    _tunnel.generation, gen,
                )
                if _tunnel.is_running():
                    try:
                        from services.ws_broadcaster import broadcast
                        await broadcast("tunnel_recovered", {})
                    except Exception as exc:
                        _tunnel_logger.debug(
                            "watchdog: tunnel_recovered broadcast failed (%s)",
                            exc.__class__.__name__, exc_info=True,
                        )
                return
            await _cleanup_wifi_connections()
            _tunnel.task = None
            _tunnel.info = None
            try:
                from services.ws_broadcaster import broadcast
                await broadcast("tunnel_lost", {"reason": "task_exited"})
            except Exception:
                _tunnel_logger.exception("Failed to emit tunnel_lost event")
    except asyncio.CancelledError:
        raise


@router.post("/wifi/tunnel/start")
async def wifi_tunnel_start(req: WifiTunnelStartRequest):
    """Start an in-process WiFi tunnel (requires admin)."""
    global _tunnel_watchdog_task
    async with _tunnel.lock:
        if _tunnel.is_running():
            if _tunnel.info:
                return {"status": "already_running", **_tunnel.info}
            return {"status": "already_running"}

        resolved_udid = req.udid
        if not resolved_udid:
            try:
                conns = _dm().connected_udids
                if conns:
                    resolved_udid = conns[0]
            except (RuntimeError, AttributeError) as exc:
                _tunnel_logger.debug(
                    "wifi_tunnel_start: could not pre-resolve udid from device manager (%s)",
                    exc.__class__.__name__, exc_info=True,
                )
        if not resolved_udid:
            resolved_udid = "auto"

        _tunnel_logger.info(
            "Starting WiFi tunnel: udid=%s ip=%s port=%d",
            resolved_udid, req.ip, req.port,
        )

        try:
            info = await _tunnel.start(resolved_udid, req.ip, req.port, timeout=20.0)
        except asyncio.TimeoutError:
            raise HTTPException(
                status_code=500,
                detail={"code": ErrorCode.TUNNEL_TIMEOUT.value, "message": "Tunnel startup timed out (20 s)"},
            )
        except Exception:
            logger.exception(
                "Tunnel spawn failed",
                extra={"udid": resolved_udid, "ip": req.ip, "port": req.port},
            )
            raise http_err(500, ErrorCode.TUNNEL_SPAWN_FAILED, "Could not start the tunnel; see the backend log")

        _tunnel_logger.info("WiFi tunnel started: %s", info)
        if _tunnel_watchdog_task is None or _tunnel_watchdog_task.done():
            _tunnel_watchdog_task = asyncio.create_task(
                _tunnel_watchdog(_tunnel.task, _tunnel.generation)
            )
        return {"status": "started", **info}


@router.get("/wifi/tunnel/status")
async def wifi_tunnel_status():
    """Check if the WiFi tunnel is running."""
    if not _tunnel.is_running():
        _tunnel.info = None
        return {"running": False}
    return {"running": True, **(_tunnel.info or {})}


def _cancel_watchdog() -> None:
    """Cancel + drop the module-level watchdog task if it's still alive."""
    global _tunnel_watchdog_task
    task = _tunnel_watchdog_task
    if task is None or task.done():
        _tunnel_watchdog_task = None
        return
    task.cancel()
    _tunnel_watchdog_task = None


async def _broadcast_usb_fallback_error(udid: str) -> None:
    from services.ws_broadcaster import broadcast
    await broadcast("device_error", {
        "udid": udid,
        "stage": "usb_fallback",
        "error": "USB fallback engine creation failed",
    })


async def _rollback_usb_fallback(app_state, dm, udid: str) -> None:
    """Undo a partially-completed USB fallback: terminate engine, disconnect,
    notify the frontend. Each sub-step runs as an independent teardown step
    so a failure in one does not skip the others."""
    rollback_steps: list[_TeardownStep] = [
        _TeardownStep("usb_fallback_terminate_engine",
                      lambda: app_state.terminate_engine(udid)),
        _TeardownStep("usb_fallback_disconnect",
                      lambda: dm.disconnect(udid)),
        _TeardownStep("usb_fallback_broadcast_error",
                      lambda: _broadcast_usb_fallback_error(udid)),
    ]
    await _run_teardown_steps(rollback_steps)


async def _attempt_usb_fallback(app_state, dm) -> None:
    """If a non-Network device is still attached, reconnect it over USB and
    spin up a new simulation engine. On engine-creation failure, roll back
    the half-built connection so the device list never advertises a
    connected device without a backing engine."""
    devices = await dm.discover_devices()
    usb_dev = next((d for d in devices if d.connection_type != "Network"), None)
    if usb_dev is None:
        return

    udid = usb_dev.udid
    try:
        await dm.connect(udid)
    except Exception:
        _tunnel_logger.exception("USB fallback: connect failed for %s", udid)
        return

    try:
        await app_state.create_engine_for_device(udid)
        _tunnel_logger.info("Switched back to USB connection: %s", udid)
    except Exception:
        _tunnel_logger.exception(
            "USB fallback: engine creation failed for %s; rolling back", udid,
        )
        await _rollback_usb_fallback(app_state, dm, udid)


@router.post("/wifi/tunnel/stop")
async def wifi_tunnel_stop():
    """Stop the WiFi tunnel and clean up any network-based device
    connections that were routed through it."""
    app_state = ctx.app_state
    dm = _dm()

    async with _tunnel.lock:
        # Always disconnect Network devices first — even when the tunnel
        # isn't running we may still hold stale Network entries.
        await _cleanup_wifi_connections()

        if not _tunnel.is_running():
            _tunnel.info = None
            _tunnel.task = None
            return {"status": "not_running"}

        # Order matters: cancel the watchdog *before* tearing down the
        # tunnel so it can't race on our cleanup; then close the tunnel
        # task itself (TunnelRunner.stop encapsulates cancel + await +
        # service/RSD/tunnel-ctx close).
        shutdown_steps: list[_TeardownStep] = [
            _TeardownStep("cancel_watchdog", _cancel_watchdog),
            _TeardownStep("tunnel_stop", _tunnel.stop),
        ]
        await _run_teardown_steps(shutdown_steps)

    # USB fallback runs outside the tunnel lock — it acquires its own
    # device-manager locks and we don't want to hold _tunnel.lock across
    # a network/USB discovery + connect roundtrip.
    fallback_steps: list[_TeardownStep] = [
        _TeardownStep("usb_fallback", lambda: _attempt_usb_fallback(app_state, dm)),
    ]
    await _run_teardown_steps(fallback_steps)

    return {"status": "stopped"}


@router.post("/wifi/tunnel/start-and-connect")
async def wifi_tunnel_start_and_connect(req: WifiTunnelStartRequest):
    """Start a WiFi tunnel and immediately connect the device through it."""
    app_state = ctx.app_state

    # Start the tunnel
    tunnel_result = await wifi_tunnel_start(req)
    if tunnel_result.get("status") not in ("started", "already_running"):
        raise http_err(500, ErrorCode.TUNNEL_FAILED, "Tunnel startup failed")

    rsd_address = tunnel_result.get("rsd_address")
    rsd_port = tunnel_result.get("rsd_port")

    if not rsd_address or not rsd_port:
        raise http_err(500, ErrorCode.TUNNEL_NO_RSD, "Tunnel started but RSD info is missing")

    # Connect through the tunnel
    dm = _dm()
    if dm.connected_count >= MAX_DEVICES:
        raise max_devices_error()
    try:
        info = await dm.connect_wifi_tunnel(rsd_address, rsd_port)
        await app_state.create_engine_for_device(info.udid)
        return {
            "status": "connected",
            "udid": info.udid,
            "name": info.name,
            "ios_version": info.ios_version,
            "connection_type": "Network",
            "rsd_address": rsd_address,
            "rsd_port": rsd_port,
        }
    except Exception:
        logger.exception(
            "Tunnel started but device connection failed",
            extra={"rsd_address": rsd_address, "rsd_port": rsd_port},
        )
        raise http_err(500, ErrorCode.CONNECT_FAILED, "Tunnel started but device connection failed")
