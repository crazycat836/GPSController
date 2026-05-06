import asyncio
import logging
import os
import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException

from api._errors import http_err, ios_unsupported_error, max_devices_error
from api.websocket import broadcast
from config import MAX_DEVICES
from context import ctx
from core.device_manager import UnsupportedIosVersionError, parse_ios_version
from models.schemas import DeviceInfo

router = APIRouter(prefix="/api/device", tags=["device"])

logger = logging.getLogger(__name__)


def _dm():
    app_state = ctx.app_state
    return app_state.device_manager


@router.get("/list", response_model=list[DeviceInfo])
async def list_devices():
    dm = _dm()
    return await dm.discover_devices()


# ── Generic UDID routes (MUST be defined after all specific /wifi/* routes
#    so that /wifi/* paths do not accidentally match {udid}). ─────────────

@router.post("/{udid}/connect")
async def connect_device(udid: str):
    app_state = ctx.app_state
    dm = _dm()
    # User-initiated connect is the canonical "I want this device on"
    # signal — clear any prior auto-reconnect block for this UDID.
    app_state.unblock_auto_reconnect(udid)
    # Max MAX_DEVICES devices (group mode). Allow re-connect of an already-connected udid.
    if not dm.is_connected(udid) and dm.connected_count >= MAX_DEVICES:
        raise max_devices_error()
    try:
        await dm.connect(udid)
        await app_state.create_engine_for_device(udid)
        try:
            devs = await dm.discover_devices()
            info = next((d for d in devs if d.udid == udid), None)
            await broadcast("device_connected", {
                "udid": udid,
                "name": info.name if info else "",
                "ios_version": info.ios_version if info else "",
                "connection_type": info.connection_type if info else "USB",
            })
        except Exception as exc:
            logger.debug(
                "connect_device(%s): device_connected broadcast failed (%s)",
                udid, exc.__class__.__name__, exc_info=True,
            )
        return {"status": "connected", "udid": udid}
    except UnsupportedIosVersionError as e:
        raise ios_unsupported_error(e.version)
    except Exception:
        logger.exception("Device connect failed", extra={"udid": udid})
        raise http_err(500, "connect_failed", "Device connection failed; please retry")


@router.post("/auto-reconnect/reset")
async def reset_auto_reconnect_blocks():
    """Clear all 'user-disconnected' UDIDs. Called by the frontend on
    boot so a fresh page treats every device as eligible for auto-
    reconnect again."""
    app_state = ctx.app_state
    app_state.clear_auto_reconnect_blocks()
    return {"status": "ok"}


@router.delete("/{udid}/connect")
async def disconnect_device(udid: str):
    app_state = ctx.app_state
    dm = _dm()
    # Block auto-reconnect: the watchdog must not reverse the user's
    # explicit Disconnect. Cleared on user Connect, on frontend boot,
    # or on backend restart (in-memory only).
    app_state.block_auto_reconnect(udid)
    # Terminate the simulation engine *before* the transport goes away so
    # any running Navigate/Loop/MultiStop/RandomWalk task exits cleanly.
    await app_state.terminate_engine(udid)
    await dm.disconnect(udid)
    try:
        await broadcast("device_disconnected", {"udid": udid, "udids": [udid], "reason": "user"})
    except Exception as exc:
        logger.debug(
            "disconnect_device(%s): device_disconnected broadcast failed (%s)",
            udid, exc.__class__.__name__, exc_info=True,
        )
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


@router.delete("/{udid}/pair")
async def forget_device(udid: str):
    """Forget a paired device — disconnects it (if connected), tells the
    device to drop our pair record, and removes the local cached record.

    After this, the iPhone will show "Trust This Computer" again the next
    time it's plugged in via USB.
    """
    app_state = ctx.app_state
    dm = _dm()

    conn = dm.get_connection(udid)
    if conn is not None:
        async def _unpair() -> None:
            # lockdown.unpair() may be sync or async depending on
            # connection type — normalise both to a coroutine.
            result = conn.lockdown.unpair()
            if asyncio.iscoroutine(result):
                await result

        # Run the device-side unpair in parallel with the local
        # engine teardown — they touch different resources and the
        # unpair RPC is the long pole.
        unpair_task = asyncio.create_task(_unpair())
        await app_state.terminate_engine(udid)
        try:
            await unpair_task
        except Exception:
            logger.warning(
                "lockdown.unpair() failed for %s; will still remove local record",
                udid, exc_info=True,
            )
        await dm.disconnect(udid)

    # One syscall per candidate — atomic, no TOCTOU. FileNotFoundError
    # means the path already absent (fine); other OSErrors are tracked so
    # the response can flag partial-success (e.g. /var/db/lockdown needs
    # root on macOS — without sudo the unlink raises and the iPhone keeps
    # trusting us even though the route used to claim "forgotten").
    removed: list[str] = []
    failed: list[dict[str, str]] = []
    for p in _pair_record_candidates(udid):
        try:
            p.unlink()
        except FileNotFoundError:
            pass
        except OSError as exc:
            logger.warning("Could not remove pair record %s", p, exc_info=True)
            failed.append({"path": str(p), "error": exc.strerror or str(exc)})
        else:
            removed.append(str(p))

    # The forgotten UDID can't auto-reconnect anyway (the pair record is
    # gone), but if the user later re-pairs the same device they'd want
    # auto-connect to work again — drop the stale blocklist entry.
    app_state.unblock_auto_reconnect(udid)

    try:
        await broadcast("device_disconnected", {"udid": udid, "udids": [udid], "reason": "forget"})
    except Exception:
        logger.warning("forget_device: device_disconnected broadcast failed", exc_info=True)

    # Only treat the request as a hard failure when *every* candidate that
    # existed errored out. If at least one record was actually removed we
    # surface a 200 partial-success envelope so the UI can warn the user
    # about the leftover paths instead of silently lying about the state.
    if failed and not removed:
        logger.error(
            "Forget device %s failed: could not remove any pair record (%d attempted)",
            udid, len(failed),
        )
        raise http_err(
            500,
            "forget_failed",
            "Could not remove any trust record; admin privileges may be required — restart the backend with sudo and retry",
        )

    status = "partial" if failed else "forgotten"
    logger.info(
        "Forgot device %s (status=%s, removed %d, failed %d pair-record file(s))",
        udid, status, len(removed), len(failed),
    )
    return {"status": status, "udid": udid, "removed": removed, "failed": failed}


@router.get("/{udid}/info", response_model=DeviceInfo | None)
async def device_info(udid: str):
    dm = _dm()
    devices = await dm.discover_devices()
    for d in devices:
        if d.udid == udid:
            return d
    raise HTTPException(status_code=404, detail="Device not found")


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
    dm = _dm()
    # AMFI reads several fields off the live Connection (ios_version,
    # connection_type) via the public ConnectionInfo accessor.
    conn = dm.get_connection(udid)
    if conn is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "device_not_connected", "message": "Device is not currently connected"},
        )

    # iOS 15 and below have no Developer Mode concept, so the AMFI
    # service call would fail with a misleading error.
    ios_major = parse_ios_version(conn.ios_version or "0")[0]
    if ios_major < 16:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "ios_version_unsupported",
                "message": "iOS 16 or newer is required to use Developer Mode",
                "ios_version": conn.ios_version,
            },
        )

    # WiFi tunnels don't route the AMFI lockdown service (it's a USB-only
    # advertised port). Reject up-front instead of letting the service
    # open fail deep inside pymobiledevice3.
    if (conn.connection_type or "").lower() != "usb":
        raise HTTPException(
            status_code=400,
            detail={
                "code": "usb_required",
                "message": "AMFI requires a USB connection (WiFi tunnel does not forward this service)",
            },
        )

    try:
        from pymobiledevice3.services.amfi import AmfiService
    except ImportError:
        logger.exception("pymobiledevice3 AMFI module import failed", extra={"udid": udid})
        raise http_err(500, "amfi_unavailable", "pymobiledevice3 AMFI service failed to load")

    try:
        AmfiService(conn.lockdown).reveal_developer_mode_option_in_ui()
    except Exception:
        logger.exception("AMFI reveal failed for %s", udid)
        raise http_err(500, "amfi_reveal_failed", "AMFI operation failed; ensure the device is unlocked and trusts this computer")

    # Invalidate the cached status so the next discover pays a fresh
    # lockdown query and the frontend sees the toggle flip.
    conn.developer_mode_enabled = None
    return {"status": "ok", "udid": udid}
