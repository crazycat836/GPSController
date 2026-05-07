"""WiFi RemotePairing discovery primitives.

Used by the ``/wifi/tunnel/discover`` route as a fallback when mDNS
(Bonjour) returns no instances:

  - :func:`scan_subnet_for_port` — gated /24 TCP scan that returns
    every host in the local subnet that answers on the requested port
  - :func:`resolve_hostname` — reverse-DNS lookup with a bounded
    thread pool so a 253-host scan cannot saturate the default
    executor and stall every other ``run_in_executor`` caller

Lifted out of ``api/wifi_tunnel.py`` so the router stays thin and the
discovery layer is independently testable.
"""

from __future__ import annotations

import asyncio
import logging
import socket
from concurrent.futures import ThreadPoolExecutor

from services.wifi_tunnel_service import _tcp_probe
from utils.net import get_primary_local_ip

logger = logging.getLogger("wifi_tunnel")


# Bounded thread pool for reverse-DNS lookups during a /24 subnet scan.
# `socket.gethostbyaddr` is blocking; routing 253 concurrent lookups
# through the default executor saturates it (default = min(32, os.cpu_count() + 4))
# and stalls every other run_in_executor caller until the scan finishes.
# 16 workers is enough to keep the scan fast without monopolising threads.
_DNS_POOL = ThreadPoolExecutor(max_workers=16, thread_name_prefix="wifi-dns")


# Per-scan TCP-connect concurrency cap. Without the gate, a single scan
# opens all 253 candidates simultaneously which (a) trips corporate-
# network IDS that flag horizontal port scans and (b) can saturate the
# local socket table. With the gate, worst-case latency is still bounded
# by ceil(253/32) * 0.4s ≈ 3.2s — fine for a user-initiated one-shot scan.
_SCAN_CONCURRENCY = 32
_SCAN_PROBE_TIMEOUT_S = 0.4


async def scan_subnet_for_port(port: int) -> list[str]:
    """Scan the local /24 subnet for hosts responding on the given TCP port."""
    my_ip = get_primary_local_ip()
    if not my_ip:
        return []
    try:
        parts = my_ip.split(".")
        prefix = ".".join(parts[:3])
    except (AttributeError, IndexError):
        return []

    candidates = [f"{prefix}.{i}" for i in range(1, 255) if f"{prefix}.{i}" != my_ip]
    sem = asyncio.Semaphore(_SCAN_CONCURRENCY)

    async def _probe_gated(ip: str) -> bool:
        async with sem:
            return await _tcp_probe(ip, port, _SCAN_PROBE_TIMEOUT_S)

    results = await asyncio.gather(
        *[_probe_gated(ip) for ip in candidates],
        return_exceptions=True,
    )
    return [ip for ip, ok in zip(candidates, results) if ok is True]


async def resolve_hostname(ip: str, *, timeout: float = 2.0) -> str | None:
    """Reverse-DNS lookup. Returns a friendly hostname or None on failure.

    Strips trailing dots and the `.local` suffix that Bonjour-aware
    routers typically advertise. Rejects names equal to the IP (no-op
    resolution).
    """
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
