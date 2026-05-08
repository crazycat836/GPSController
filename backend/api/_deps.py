"""Shared dependency helpers for the API layer.

Hosts tiny accessors that more than one router reaches into
``ctx.app_state`` for. Each router used to define a private ``_dm()``
copy-pasted across modules; centralising it here keeps the indirection
in one place.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from context import ctx

if TYPE_CHECKING:
    from core.device_manager import DeviceManager


def get_device_manager() -> "DeviceManager":
    """Return the live ``DeviceManager`` from the app-state singleton."""
    return ctx.app_state.device_manager
