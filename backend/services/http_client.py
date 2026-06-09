"""Shared async HTTP client singleton factory.

Both :mod:`services.geocoding` and :mod:`services.route_service` need a
lifespan-scoped :class:`httpx.AsyncClient` to avoid paying the TCP+TLS
handshake on every outbound request during a 10 Hz navigation. Each
service had its own copy of an identical double-checked-locking
singleton; this module exposes a factory that returns a fresh
``(get_client, close_client)`` pair, each closing over its own private
state, so the pattern is implemented once and reused.
"""

from __future__ import annotations

import asyncio
from typing import Awaitable, Callable

import httpx


# Shared outbound timeout for the geocoding providers (Nominatim / Photon /
# Google): 10s overall, 5s to connect. Declared once here so all three
# provider modules reference the same value instead of each re-constructing an
# identical ``httpx.Timeout``.
GEOCODING_HTTP_TIMEOUT = httpx.Timeout(10.0, connect=5.0)


def make_async_client_singleton(
    timeout: httpx.Timeout | float,
    *,
    headers: dict[str, str] | None = None,
) -> tuple[Callable[[], Awaitable[httpx.AsyncClient]], Callable[[], Awaitable[None]]]:
    """Build a lifespan-scoped :class:`httpx.AsyncClient` singleton pair.

    Parameters
    ----------
    timeout:
        ``httpx.Timeout`` (or bare ``float``) used to construct the client
        on first use.
    headers:
        Optional default headers applied to every request issued through
        the client (e.g. a ``User-Agent``). Per-call headers passed to
        ``client.get(...)`` still merge on top.

    Returns
    -------
    (get_client, close_client):
        Two coroutine factories. ``get_client()`` lazily constructs the
        shared client on first call (double-checked-locking so concurrent
        callers don't race two clients into existence) and returns it on
        every subsequent call. ``close_client()`` releases the underlying
        connection pool and resets state, so a follow-up ``get_client()``
        will build a fresh client. Both close over private state — each
        factory call yields an independent singleton.
    """
    client: httpx.AsyncClient | None = None
    lock = asyncio.Lock()

    async def get_client() -> httpx.AsyncClient:
        nonlocal client
        if client is None:
            async with lock:
                if client is None:
                    if headers is not None:
                        client = httpx.AsyncClient(timeout=timeout, headers=headers)
                    else:
                        client = httpx.AsyncClient(timeout=timeout)
        return client

    async def close_client() -> None:
        """Release the shared HTTP client. Called from the FastAPI lifespan."""
        nonlocal client
        if client is not None:
            try:
                await client.aclose()
            finally:
                client = None

    return get_client, close_client


def make_min_interval_gate(
    min_interval_s: float,
) -> Callable[[], Awaitable[None]]:
    """Build a single-slot rate gate that spaces calls ≥ ``min_interval_s`` apart.

    Returns one coroutine factory; awaiting it blocks until at least
    ``min_interval_s`` has elapsed since the previous awaiter returned. The
    last-call timestamp + lock are private to the returned closure, so each
    factory call yields an independent gate — the same implement-once-reuse
    pattern as :func:`make_async_client_singleton`, replacing the
    copy-pasted module-global ``_last_request_at`` floats that the geocoding
    providers each carried.

    Used to honour upstream fair-use policies (Nominatim ≤1 req/s; Photon's
    public host asks callers to be fair) so a runaway local caller can't
    trigger an IP ban that hurts every user behind the NAT.
    """
    lock = asyncio.Lock()
    last_at = 0.0

    async def gate() -> None:
        nonlocal last_at
        async with lock:
            # get_running_loop() (not the deprecated get_event_loop()) is
            # correct here — gate() only runs inside a coroutine.
            loop = asyncio.get_running_loop()
            now = loop.time()
            wait = min_interval_s - (now - last_at)
            if wait > 0:
                await asyncio.sleep(wait)
            last_at = loop.time()

    return gate
