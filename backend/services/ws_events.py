"""Typed broadcast helpers built on the WS event registry.

Wraps :func:`services.ws_broadcaster.broadcast` so call sites pass a
Pydantic event model instead of a `(name, dict)` pair. Two payoffs:

  - **Type safety.** A typo like ``DeviceDisconnectedEvent(udid=42)``
    becomes a Pydantic ValidationError at the call site instead of a
    silent runtime drop on the frontend.
  - **Single source of truth.** The event name lives in the registry
    (``backend.models.ws_events.WS_EVENTS``); no string literals at
    individual call sites means typos like ``"deivce_disconnected"``
    (a real review finding) cannot recur.

The legacy ``broadcast(name, dict)`` API is intentionally still
exported from :mod:`services.ws_broadcaster` so this migration can
happen incrementally without a flag-day rewrite.
"""

from __future__ import annotations

from pydantic import BaseModel

from models.ws_events import WS_EVENTS
from services.ws_broadcaster import broadcast


# Reverse map: model class → event name. Built once at import.
_NAME_BY_MODEL: dict[type[BaseModel], str] = {
    cls: name for name, cls in WS_EVENTS.items()
}


async def broadcast_event(event: BaseModel) -> None:
    """Validate and broadcast a typed event.

    The event class must be registered in ``WS_EVENTS``; passing an
    unregistered model raises :class:`KeyError` so registry drift
    surfaces at the call site instead of silently shipping an unknown
    ``msg.type`` the frontend will ignore.
    """
    name = _NAME_BY_MODEL.get(type(event))
    if name is None:
        raise KeyError(
            f"Event class {type(event).__name__} not in WS_EVENTS registry; "
            "add it to backend/models/ws_events.py first."
        )
    # Pydantic v2: model_dump() with mode='json' so enum members serialise
    # to their .value (matches what the legacy dict-broadcast would emit).
    await broadcast(name, event.model_dump(mode="json"))
