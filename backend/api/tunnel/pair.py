"""Repair endpoint — regenerate the RemotePairing pair record."""

from __future__ import annotations

import logging

from fastapi import APIRouter

from api._errors import ErrorCode, http_err
from api.tunnel._helpers import (
    RemotePairResources,
    close_remote_pair_resources,
    perform_remote_pair_handshake,
    select_usb_device,
)

logger = logging.getLogger(__name__)
_tunnel_logger = logging.getLogger("wifi_tunnel")

router = APIRouter()


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
        raise http_err(
            500, ErrorCode.TRUST_FAILED,
            "USB trust failed — tap \"Trust\" on the iPhone unlock screen and retry",
            udid=udid,
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
