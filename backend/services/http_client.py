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
