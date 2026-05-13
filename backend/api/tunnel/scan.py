"""WiFi-scan / discover endpoints under /api/device/wifi/*."""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter

from api._deps import get_device_manager
from api._errors import ErrorCode, http_err
from config import REMOTE_PAIRING_PORT
from services.wifi_discovery import resolve_hostname, scan_subnet_for_port

logger = logging.getLogger(__name__)
_tunnel_logger = logging.getLogger("wifi_tunnel")

router = APIRouter()


@router.get("/wifi/scan")
async def wifi_scan():
    """Scan the local network for iOS devices."""
    dm = get_device_manager()
    try:
        results = await dm.scan_wifi_devices()
        return results
    except Exception:
        logger.exception("WiFi scan failed")
        raise http_err(500, ErrorCode.SCAN_FAILED, "WiFi scan failed; please retry shortly")


@router.get("/wifi/tunnel/discover")
async def wifi_tunnel_discover():
    """Find iPhones on the local network. First tries mDNS (Bonjour RemotePairing
    broadcast); if that yields nothing, falls back to a /24 subnet TCP scan on the
    standard RemotePairing port (49152). TCP-scan hits get a parallel reverse-DNS
    lookup so devices broadcasting a hostname (e.g. `Johns-iPhone.local`) show a
    real name instead of duplicating the IP."""
    results: list[dict] = []

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

    if not results:
        _tunnel_logger.info("mDNS empty; falling back to /24 TCP scan on port 49152")
        try:
            hits = await scan_subnet_for_port(REMOTE_PAIRING_PORT)
            names = await asyncio.gather(*(resolve_hostname(ip) for ip in hits))
            for ip, resolved in zip(hits, names):
                results.append({
                    "ip": ip,
                    "port": REMOTE_PAIRING_PORT,
                    "host": ip,
                    "name": resolved or ip,
                    "method": "tcp_scan",
                })
        except Exception as e:
            _tunnel_logger.warning("TCP scan failed: %s", e)

    seen = set()
    unique = []
    for r in results:
        key = (r["ip"], r["port"])
        if key in seen:
            continue
        seen.add(key)
        unique.append(r)

    return {"devices": unique}
