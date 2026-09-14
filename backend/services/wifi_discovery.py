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


# RemotePairing listens on a port in the dynamic range (49152 by default,
# but it can move, e.g. after the iPhone restarts). 62078 is lockdownd's
# pairing port, never RemotePairing, so it's skipped.
_REMOTEPAIRING_PORT_RANGE = range(49152, 65536)
_LOCKDOWN_PORT = 62078
_PORT_SCAN_CONCURRENCY = 256
_PORT_SCAN_TIMEOUT_S = 0.3
_PORT_SCAN_BUDGET_S = 15.0


async def discover_remotepairing_ports(ip: str, *, exclude: set[int] | None = None) -> list[int]:
    """Candidate RemotePairing ports on *ip*, best first.

    Asks mDNS first (it advertises the real port); when that has nothing
    for this IP, TCP-scans the dynamic port range on that one host within a
    time budget. Ports in *exclude* (typically the one that just failed)
    and lockdownd's 62078 are left out.
    """
    exclude = set(exclude or ())
    exclude.add(_LOCKDOWN_PORT)

    ports: list[int] = []
    try:
        from pymobiledevice3.bonjour import browse_remotepairing
        for inst in await browse_remotepairing(timeout=3.0):
            if any(a.ip == ip for a in (inst.addresses or [])) and inst.port not in exclude:
                ports.append(inst.port)
    except Exception:
        logger.debug("mDNS browse during port recovery failed", exc_info=True)
    if ports:
        return sorted(set(ports))

    sem = asyncio.Semaphore(_PORT_SCAN_CONCURRENCY)
    candidates = [p for p in _REMOTEPAIRING_PORT_RANGE if p not in exclude]

    async def _probe(port: int) -> int | None:
        async with sem:
            return port if await _tcp_probe(ip, port, _PORT_SCAN_TIMEOUT_S) else None

    tasks = [asyncio.create_task(_probe(p)) for p in candidates]
    done, pending = await asyncio.wait(tasks, timeout=_PORT_SCAN_BUDGET_S)
    for task in pending:
        task.cancel()
    await asyncio.gather(*pending, return_exceptions=True)
    return sorted(t.result() for t in done if not t.cancelled() and t.exception() is None and t.result())

