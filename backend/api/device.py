from __future__ import annotations

import asyncio
import logging
import os
import sys
from pathlib import Path

from fastapi import APIRouter

from api._deps import get_device_manager
from api._errors import ErrorCode, http_err, ios_unsupported_error, max_devices_error
from api.tunnel._helpers import purge_stale_remote_pair_record
from services import connection_state
from config import MAX_DEVICES
from context import ctx
from core.device_manager import (
    UnsupportedIosVersionError,
    delete_usbmux_pair_record,
    parse_ios_version,
)
from models.schemas import DeviceInfo

router = APIRouter(prefix="/api/device", tags=["device"])

logger = logging.getLogger(__name__)


@router.get("/list", response_model=list[DeviceInfo])
async def list_devices():
    """Return every device the renderer should show on the device chip rail.

    Composed from two sources because neither alone is complete:

      1. ``dm.discover_devices()`` — usbmux's view, which sees plugged-in
         USB devices (connected or not) and lets the renderer offer a
         Connect button on a freshly trusted phone.
      2. ``connection_state.store`` — the unified SSoT for transport state.
         Picks up WiFi-tunnel connections that usbmux never enumerates,
         so a renderer reload mid-tunnel session doesn't see "no device"
         and clobber the WS ``device_snapshot`` that just told the truth.

    Anything live in the store but missing from usbmux is appended with
    metadata replayed from the store's cache (the same payload the WS
    ``device_connected`` event originally carried).
    """
    dm = get_device_manager()
    discovered = await dm.discover_devices()
    discovered_udids = {d.udid for d in discovered}

    snapshot = connection_state.store.snapshot()
    extras: list[DeviceInfo] = []
    for udid, state in snapshot.items():
        if udid in discovered_udids:
            continue
        # CONNECTED + DEGRADED both mean "this device is live"; DISCONNECTED
        # entries in the store have already been broadcast as gone and
        # would just confuse the UI if surfaced here.
        if state.value not in ("connected", "degraded"):
            continue
        md = connection_state.store.metadata_for(udid)
        extras.append(DeviceInfo(
            udid=udid,
            name=md.get("name", ""),
            ios_version=md.get("ios_version", ""),
            connection_type=md.get("connection_type", "USB"),
            is_connected=True,
        ))
    return discovered + extras


# ── Generic UDID routes (MUST be defined after all specific /wifi/* routes
#    so that /wifi/* paths do not accidentally match {udid}). ─────────────

@router.post("/{udid}/connect")
async def connect_device(udid: str):
    app_state = ctx.app_state
    dm = get_device_manager()
    # Max MAX_DEVICES devices (group mode). Allow re-connect of an already-connected udid.
    if not dm.is_connected(udid) and dm.connected_count >= MAX_DEVICES:
        raise max_devices_error()
    try:
        # `connect_device` runs ``dm.connect`` and broadcasts
        # ``device_connected`` via the installed WS observer. The engine
        # rebuild stays here since it's not part of the transport state
        # machine — but it goes through the rollback wrapper so an engine
        # failure never leaves the store advertising a connected device
        # with no engine behind it.
        await connection_state.connect_device(dm, udid, cause="user")
        await connection_state.create_engine_with_rollback(
            dm, app_state, udid,
            cause="engine_create_failed",
            stage="connect",
            error="Simulation engine creation failed",
        )
        return {"status": "connected", "udid": udid}
    except UnsupportedIosVersionError as e:
        raise ios_unsupported_error(e.version)
    except Exception:
        logger.exception("Device connect failed", extra={"udid": udid})
        raise http_err(500, ErrorCode.CONNECT_FAILED, "Device connection failed; please retry")


@router.delete("/{udid}/connect")
async def disconnect_device(udid: str):
    app_state = ctx.app_state
    dm = get_device_manager()
    # Terminate the simulation engine *before* the transport goes away so
    # any running Navigate/Loop/MultiStop/RandomWalk task exits cleanly.
    await app_state.terminate_engine(udid)
    # `disconnect_device` runs ``dm.disconnect`` and broadcasts
    # ``device_disconnected`` (via dedup) through the installed WS observer.
    await connection_state.disconnect_device(dm, udid, cause="user")
    return {"status": "disconnected", "udid": udid}


def _pair_record_candidates(udid: str) -> list[Path]:
    """Return every OS-specific path the lockdown pair-record for *udid*
    could live at. We try them all on forget so a stale record doesn't
    survive in a fallback location."""
    if sys.platform == "win32":
        base = Path(os.environ.get("ALLUSERSPROFILE", "C:/ProgramData")) / "Apple" / "Lockdown"
        return [base / f"{udid}.plist"]
    # macOS + Linux: try system-wide first, then user-level.
    return [
        Path("/var/db/lockdown") / f"{udid}.plist",
        Path("/var/lib/lockdown") / f"{udid}.plist",
        Path.home() / "Library" / "Lockdown" / f"{udid}.plist",
    ]


def _lockdown_with_unpair(conn) -> object | None:
    """Return the lockdown client that can issue a device-side ``unpair()``.

    For iOS 17+, ``conn.lockdown`` is a ``RemoteServiceDiscoveryService``
    (RSD) — it has NO ``unpair()`` — while the real USB ``LockdownClient``
    is kept in ``conn.usbmux_lockdown``. The earlier code called
    ``conn.lockdown.unpair()`` and raised ``AttributeError`` for every
    iOS 17+ device, so the device was never actually untrusted. Prefer the
    LockdownClient; fall back to ``conn.lockdown`` for the iOS 16 legacy
    path where it *is* the LockdownClient.
    """
    for client in (getattr(conn, "usbmux_lockdown", None), getattr(conn, "lockdown", None)):
        if client is not None and hasattr(client, "unpair"):
            return client
    return None


def _remove_pair_record_files(udid: str) -> tuple[list[str], list[dict[str, str]]]:
    """Best-effort delete of the local lockdown pair-record files.

    One syscall per candidate — atomic, no TOCTOU. FileNotFoundError means
    the path is already absent (fine); other OSErrors are tracked. On macOS
    ``/var/db/lockdown`` is OS-protected and ``unlink`` raises
    ``PermissionError`` even as root — that's why this is best-effort and
    the authoritative "forget" is the device-side ``unpair()`` in the
    caller, not these files.
    """
    removed: list[str] = []
    failed: list[dict[str, str]] = []
    for p in _pair_record_candidates(udid):
        try:
            p.unlink()
        except FileNotFoundError:
            pass
        except OSError as exc:
            logger.warning("Could not remove pair record %s", p, exc_info=True)
            failed.append({"path": str(p), "error": getattr(exc, "strerror", None) or str(exc)})
        else:
            removed.append(str(p))
    return removed, failed


@router.delete("/{udid}/pair")
async def forget_device(udid: str):
    """Forget a paired device — disconnects it (if connected), tells the
    device to drop our pair record, and removes the local cached record.

    After this, the iPhone/iPad shows "Trust This Computer" again the next
    time it connects. The device-side ``unpair()`` (issued through
    lockdownd over USB) is the authoritative action; the local file removal
    is best-effort because macOS protects ``/var/db/lockdown``.
    """
    app_state = ctx.app_state
    dm = get_device_manager()

    device_unpaired = False
    conn = dm.get_connection(udid)
    if conn is not None:
        unpair_client = _lockdown_with_unpair(conn)

        async def _unpair() -> None:
            # unpair() may be sync or async depending on the client —
            # normalise both to a coroutine.
            result = unpair_client.unpair()
            if asyncio.iscoroutine(result):
                await result

        if unpair_client is not None:
            # Run the device-side unpair in parallel with the local engine
            # teardown — they touch different resources and the unpair RPC
            # is the long pole.
            unpair_task = asyncio.create_task(_unpair())
            await app_state.terminate_engine(udid)
            try:
                await unpair_task
                device_unpaired = True
            except Exception:
                logger.warning(
                    "unpair() failed for %s; will still remove local records",
                    udid, exc_info=True,
                )
        else:
            # No LockdownClient available (e.g. a pure WiFi-tunnel device
            # never connected over USB) — we can't issue a device-side
            # unpair. Fall through to local cleanup and surface the gap.
            await app_state.terminate_engine(udid)
            logger.warning(
                "No USB lockdown client for %s; cannot issue a device-side "
                "unpair — connect it over USB to fully untrust this computer",
                udid,
            )
        # Routed through connection_state so the WS observer broadcasts
        # ``device_disconnected`` with cause="forget" exactly once.
        await connection_state.disconnect_device(dm, udid, cause="forget")

    # Authoritative host-side unpair: ask usbmuxd to drop its stored pair
    # record. This is what makes forget work in the cases the device-side
    # unpair can't — device on WiFi, unplugged, or locked (a locked device
    # makes lockdownd's unpair raise PasswordRequiredError) — and it
    # deletes the macOS-protected /var/db/lockdown record that os.unlink
    # below can't touch even as root. Done before the file sweep so that
    # sweep becomes a clean no-op once usbmuxd has removed the record.
    host_record_deleted = await delete_usbmux_pair_record(udid)

    # iOS 17+ RemotePairing record (~/.pymobiledevice3) — best-effort so a
    # later WiFi-tunnel re-pair starts from a clean slate.
    purge_stale_remote_pair_record(udid)

    # Best-effort direct file removal for records usbmuxd doesn't manage
    # (Windows/Linux, user-level macOS records).
    removed, failed = _remove_pair_record_files(udid)

    # device_disconnected broadcast already happened in disconnect_device
    # above — no need to fire it again here.

    # The forget genuinely succeeded if ANY authoritative step landed: the
    # device-side unpair, the usbmuxd record delete, or a local file removal.
    # Only hard-fail when every path failed AND there was something to clean.
    forgotten = device_unpaired or host_record_deleted or bool(removed)
    if not forgotten and failed:
        logger.error(
            "Forget device %s failed: device-side unpair, usbmuxd "
            "DeletePairRecord, and local file removal all failed "
            "(%d file(s) attempted)", udid, len(failed),
        )
        raise http_err(
            500,
            ErrorCode.FORGET_FAILED,
            "Could not forget the device. Connect it via USB and unlock it, "
            "then retry.",
        )

    status = "forgotten" if (forgotten or not failed) else "partial"
    logger.info(
        "Forgot device %s (status=%s, device_unpaired=%s, usbmux_deleted=%s, "
        "removed %d, failed %d file(s))",
        udid, status, device_unpaired, host_record_deleted, len(removed), len(failed),
    )
    return {
        "status": status,
        "udid": udid,
        "device_unpaired": device_unpaired,
        "usbmux_record_deleted": host_record_deleted,
        "removed": removed,
        "failed": failed,
    }


# ── AMFI: "Reveal Developer Mode in Settings" (iOS 16+) ─────────────
#
# Same end state as sideloading a dev-signed IPA via Sideloadly / Xcode,
# but done directly through AMFI. Action 0 of the
# `com.apple.amfi.lockdown` service creates the `AMFIShowOverridePath`
# marker file on the device — no reboot, no passcode prompt, no
# sideload round-trip. Saves new users the "why doesn't the Developer
# Mode toggle appear" question entirely.
@router.post("/{udid}/amfi/reveal-developer-mode")
async def amfi_reveal_developer_mode(udid: str):
    dm = get_device_manager()
    # AMFI reads several fields off the live Connection (ios_version,
    # connection_type) via the public ConnectionInfo accessor.
    conn = dm.get_connection(udid)
    if conn is None:
        raise http_err(404, ErrorCode.DEVICE_NOT_CONNECTED, "Device is not currently connected")

    # iOS 15 and below have no Developer Mode concept, so the AMFI
    # service call would fail with a misleading error.
    ios_major = parse_ios_version(conn.ios_version or "0")[0]
    if ios_major < 16:
        raise http_err(
            400, ErrorCode.IOS_VERSION_UNSUPPORTED,
            "iOS 16 or newer is required to use Developer Mode",
            ios_version=conn.ios_version,
        )

    # WiFi tunnels don't route the AMFI lockdown service (it's a USB-only
    # advertised port). Reject up-front instead of letting the service
    # open fail deep inside pymobiledevice3.
    if (conn.connection_type or "").lower() != "usb":
        raise http_err(
            400, ErrorCode.USB_REQUIRED,
            "AMFI requires a USB connection (WiFi tunnel does not forward this service)",
        )

    try:
        from pymobiledevice3.services.amfi import AmfiService
    except ImportError:
        logger.exception("pymobiledevice3 AMFI module import failed", extra={"udid": udid})
        raise http_err(500, ErrorCode.AMFI_UNAVAILABLE, "pymobiledevice3 AMFI service failed to load")

    try:
        AmfiService(conn.lockdown).reveal_developer_mode_option_in_ui()
    except Exception:
        logger.exception("AMFI reveal failed for %s", udid)
        raise http_err(500, ErrorCode.AMFI_REVEAL_FAILED, "AMFI operation failed; ensure the device is unlocked and trusts this computer")

    # Invalidate the cached status so the next discover pays a fresh
    # lockdown query and the frontend sees the toggle flip.
    conn.developer_mode_enabled = None
    return {"status": "ok", "udid": udid}
