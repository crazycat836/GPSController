"""Tiny network utilities.

Currently a single helper — :func:`get_primary_local_ip` — that returns
this machine's primary IPv4 by opening a UDP socket toward a public
address. The kernel resolves the route without sending any traffic,
which is the canonical cross-platform recipe for "which IP am I
egressing on right now". Used by the WiFi-tunnel /24 scan and the
device-manager subnet guesser.
"""

from __future__ import annotations

import socket


def get_primary_local_ip(timeout: float = 0.5) -> str | None:
    """Return the primary IPv4 of this host, or None on failure.

    Implementation note: opens a *UDP* socket and ``connect()``s to a
    public IP. UDP connect doesn't send traffic — the kernel just picks
    a source IP / interface for the route, which we read back via
    ``getsockname()``. This works without DNS, without internet
    reachability, and without privileges.
    """
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(timeout)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return None
