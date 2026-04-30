import logging

from fastapi import APIRouter, HTTPException

from config import MAX_DEVICES
from context import ctx
from models.schemas import DeviceInfo

router = APIRouter(prefix="/api/device", tags=["device"])

logger = logging.getLogger(__name__)


# duplicated in api/wifi_tunnel.py
def _http_err(status: int, code: str, message: str) -> HTTPException:
    """Build a structured HTTPException with `{code, message}` detail.

    Use this instead of raising `HTTPException(detail=str(e))` so internal
    exception text never leaks to API clients.
    """
    return HTTPException(status_code=status, detail={"code": code, "message": message})


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
    from core.device_manager import UnsupportedIosVersionError
    dm = _dm()
    # Max MAX_DEVICES devices (group mode). Allow re-connect of an already-connected udid.
    if not dm.is_connected(udid) and dm.connected_count >= MAX_DEVICES:
        raise HTTPException(
            status_code=409,
            detail={"code": "max_devices_reached", "message": f"已連接最多 {MAX_DEVICES} 台裝置"},
        )
    try:
        await dm.connect(udid)
        await app_state.create_engine_for_device(udid)
        try:
            from api.websocket import broadcast
            devs = await dm.discover_devices()
            info = next((d for d in devs if d.udid == udid), None)
            await broadcast("device_connected", {
                "udid": udid,
                "name": info.name if info else "",
                "ios_version": info.ios_version if info else "",
                "connection_type": info.connection_type if info else "USB",
            })
        except Exception:
            pass
        return {"status": "connected", "udid": udid}
    except UnsupportedIosVersionError as e:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "ios_unsupported",
                "message": (
                    f"偵測到 iOS {e.version},GPSController 自 v0.1.49 起僅支援 "
                    f"iOS {UnsupportedIosVersionError.MIN_VERSION} 以上。"
                    f"請將裝置升級至 iOS {UnsupportedIosVersionError.MIN_VERSION} 或更新版本後再連線。"
                ),
                "ios_version": e.version,
                "min_version": UnsupportedIosVersionError.MIN_VERSION,
            },
        )
    except Exception:
        logger.exception("Device connect failed", extra={"udid": udid})
        raise _http_err(500, "connect_failed", "裝置連線失敗,請重試")


@router.delete("/{udid}/connect")
async def disconnect_device(udid: str):
    app_state = ctx.app_state
    dm = _dm()
    # Terminate the simulation engine *before* the transport goes away so
    # any running Navigate/Loop/MultiStop/RandomWalk task exits cleanly.
    await app_state.terminate_engine(udid)
    await dm.disconnect(udid)
    try:
        from api.websocket import broadcast
        await broadcast("device_disconnected", {"udid": udid, "udids": [udid], "reason": "user"})
    except Exception:
        pass
    return {"status": "disconnected", "udid": udid}


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
            detail={"code": "device_not_connected", "message": "裝置目前未連線"},
        )

    # iOS 15 and below have no Developer Mode concept, so the AMFI
    # service call would fail with a misleading error.
    from core.device_manager import _parse_ios_version
    ios_major = _parse_ios_version(conn.ios_version or "0")[0]
    if ios_major < 16:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "ios_version_unsupported",
                "message": "需要 iOS 16 或更新版本才能使用開發者模式",
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
                "message": "AMFI 需要 USB 連線(WiFi tunnel 不會轉發此服務)",
            },
        )

    try:
        from pymobiledevice3.services.amfi import AmfiService
    except ImportError:
        logger.exception("pymobiledevice3 AMFI module import failed", extra={"udid": udid})
        raise _http_err(500, "amfi_unavailable", "pymobiledevice3 AMFI 服務無法載入")

    try:
        AmfiService(conn.lockdown).reveal_developer_mode_option_in_ui()
    except Exception:
        logger.exception("AMFI reveal failed for %s", udid)
        raise _http_err(500, "amfi_reveal_failed", "AMFI 操作失敗,請確認裝置已解鎖並信任這台電腦")

    # Invalidate the cached status so the next discover pays a fresh
    # lockdown query and the frontend sees the toggle flip.
    conn.developer_mode_enabled = None
    return {"status": "ok", "udid": udid}
