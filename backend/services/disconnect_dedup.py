"""De-duplicate rapid ``device_disconnected`` emits.

Two BE subsystems can both notice the same physical disconnect:

  * ``services.device_watchdog`` — USB poll, ~3s detection
  * ``core.tunnel_liveness`` — RSD probe, ~15s detection

For a USB unplug the watchdog wins; for a WiFi tunnel collapse the
liveness probe wins. In rare overlap windows (slow USB hot-replug, or
a WiFi+USB paired device) both fire. The renderer then shows two
"device dropped" toasts and the user sees redundant noise.

This module sits between every emit site and ``ws_broadcaster.broadcast``
so a duplicate within :data:`_DEDUP_WINDOW_S` for the *same* udids+cause
is silently dropped. Different causes (e.g. a manual ``/disconnect`` 1s
after a tunnel drop) still pass through — they're informationally
distinct events the user should see.

Thread-safety: the recent-emit map is mutated only from the asyncio
event loop, so no explicit lock.
"""

from __future__ import annotations

import time
from typing import Any

from services.ws_broadcaster import broadcast

# Two seconds is generous enough to swallow the watchdog (~3s)/liveness
# (~15s) overlap and any retry storms in a noisy USB session, while
# being short enough that a *distinct* second disconnect (unplug → replug
# → unplug) still surfaces.
_DEDUP_WINDOW_S = 2.0

# Soft cap on retained keys. We rely on the time-based filter for
# correctness, but cap the dict so a long-running process with many
# unique udids+causes can't grow it unbounded.
_MAX_ENTRIES = 256

_recent: dict[tuple[tuple[str, ...], str | None], float] = {}


def _key(payload: dict[str, Any]) -> tuple[tuple[str, ...], str | None]:
    """Stable identity for a device_disconnected payload.

    ``udids`` may be either a list (multi-device drops on tunnel teardown)
    or implicit in ``udid``. Normalising to a sorted tuple means the
    same logical loss event hashes the same regardless of which emit
    site assembled the payload.
    """
    udids = payload.get("udids") or []
    if not udids and (single := payload.get("udid")):
        udids = [single]
    cause = payload.get("cause")
    return (tuple(sorted(str(u) for u in udids)), cause)


def _prune(now: float) -> None:
    """Drop entries older than the window. Also enforces ``_MAX_ENTRIES``
    by evicting oldest first when the cap is exceeded."""
    stale = [k for k, ts in _recent.items() if now - ts > _DEDUP_WINDOW_S]
    for k in stale:
        _recent.pop(k, None)
    if len(_recent) > _MAX_ENTRIES:
        for k, _ in sorted(_recent.items(), key=lambda kv: kv[1])[
            : len(_recent) - _MAX_ENTRIES
        ]:
            _recent.pop(k, None)


async def emit_device_disconnected(payload: dict[str, Any]) -> None:
    """Broadcast ``device_disconnected`` with dedup.

    Drops the broadcast (silently) when the same (udids, cause) was
    emitted within :data:`_DEDUP_WINDOW_S`. Otherwise records the key
    and forwards to :func:`services.ws_broadcaster.broadcast`.
    """
    now = time.monotonic()
    key = _key(payload)
    last = _recent.get(key)
    if last is not None and now - last < _DEDUP_WINDOW_S:
        return
    _recent[key] = now
    _prune(now)
    await broadcast("device_disconnected", payload)


def reset_for_tests() -> None:
    """Clear the dedup map. Tests that emit synthetic disconnects need
    this so a prior test doesn't suppress a deliberate duplicate."""
    _recent.clear()
