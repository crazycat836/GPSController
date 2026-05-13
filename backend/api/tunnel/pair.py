"""Pair / repair endpoints — connect via existing tunnel + regenerate pair record."""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator

from api._deps import get_device_manager
from api._errors import ErrorCode, http_err, ios_unsupported_error, max_devices_error
from api.tunnel._helpers import (
    RemotePairResources,
    close_remote_pair_resources,
    perform_remote_pair_handshake,
    select_usb_device,
    validate_local_ip,
)
from config import MAX_DEVICES
from context import ctx

logger = logging.getLogger(__name__)
_tunnel_logger = logging.getLogger("wifi_tunnel")

router = APIRouter()


class WifiTunnelConnectRequest(BaseModel):
    rsd_address: str
    rsd_port: int = Field(ge=1, le=65535)

    @field_validator("rsd_address")
    @classmethod
    def _check_rsd_address(cls, v: str) -> str:
        return validate_local_ip(v)


@router.post("/wifi/tunnel")
async def wifi_tunnel_connect(req: WifiTunnelConnectRequest):
    """Connect to a device via an existing WiFi tunnel (RSD address/port)."""
    app_state = ctx.app_state
    from core.device_manager import UnsupportedIosVersionError
    dm = get_device_manager()
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

    udid = await select_usb_device()
    _tunnel_logger.info("Re-pair requested for USB device %s", udid)

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

    try:
        major = int(ios_version.split(".")[0])
    except (ValueError, IndexError):
        major = 0

    remote_record_regenerated = False
    if major >= 17:
        resources: RemotePairResources = {
            "proxy": None,
            "tunnel_ctx": None,
            "rsd": None,
            "tunnel_svc": None,
        }
        try:
            remote_record_regenerated = await perform_remote_pair_handshake(
                lockdown, udid, ios_version, resources,
            )
        finally:
            await close_remote_pair_resources(resources)

    return {
        "status": "paired",
        "udid": udid,
        "name": name,
        "ios_version": ios_version,
        "remote_record_regenerated": remote_record_regenerated,
    }
