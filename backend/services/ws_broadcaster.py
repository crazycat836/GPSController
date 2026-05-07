"""Process-wide WebSocket broadcaster.

Owns the live connection set and fans events out across them with a
per-client timeout. Lives at the ``services/`` layer so both ``api/``
routers and ``core/`` business logic can publish without ``core/``
having to reach back into ``api/``.

Architectural intent (matches main.py layout): ``api/ -> core/ -> services/``.
A pre-commit lint (``tools/check_layers.py``) enforces it.
"""

from __future__ import annotations

import asyncio
import json
import logging

from fastapi import WebSocket

logger = logging.getLogger(__name__)

# Per-client send budget. One stalled client must not block the rest of the
# fan-out, so each ws.send_text is wrapped in wait_for and slow ones are
# treated as dead so the broadcast loop reclaims their slot.
_BROADCAST_PER_CLIENT_TIMEOUT_S = 1.0

# Active WebSocket connections. Mutated by ``register`` / ``unregister``
# from the WS endpoint in api/websocket.py and pruned by ``broadcast``
# when a client times out / errors mid-send.
_connections: list[WebSocket] = []


def register(ws: WebSocket) -> None:
    """Add a freshly-authed socket to the broadcast set."""
    _connections.append(ws)


def unregister(ws: WebSocket) -> None:
    """Remove a socket on disconnect. Idempotent — broadcast may have
    already pruned it after a send timeout."""
    if ws in _connections:
        _connections.remove(ws)


def connection_count() -> int:
    """Number of live clients. Used in WS endpoint logging only."""
    return len(_connections)


async def broadcast(event_type: str, data: dict) -> None:
    """Broadcast event to all connected WebSocket clients.

    Sends fan out in parallel with a per-client timeout so a single slow /
    stuck client cannot stall every other broadcast that follows. Failing
    clients (timeout, exception) are removed from the connection list.
    """
    message = json.dumps({"type": event_type, "data": data})

    async def _send_one(ws: WebSocket) -> "WebSocket | None":
        try:
            await asyncio.wait_for(
                ws.send_text(message), timeout=_BROADCAST_PER_CLIENT_TIMEOUT_S,
            )
            return None  # success
        except Exception:
            return ws  # mark for removal

    # Snapshot the connection list — concurrent disconnects mutate
    # _connections from the websocket_endpoint's finally clause.
    targets = list(_connections)
    if not targets:
        return
    results = await asyncio.gather(*[_send_one(ws) for ws in targets])
    for ws in results:
        if ws is not None and ws in _connections:
            _connections.remove(ws)
