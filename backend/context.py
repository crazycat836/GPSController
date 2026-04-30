"""Shared application context — a tiny indirection layer that holds the
``AppState`` singleton so routers and core services can reach it without
re-importing ``main`` (which would cause a circular import).

``main.py`` populates ``ctx.app_state`` immediately after constructing
``AppState``; everything else just imports ``ctx`` at module top.
"""
from __future__ import annotations
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from main import AppState  # forward reference only — never executed at runtime


class _Context:
    """Singleton holder for the live ``AppState`` instance."""
    app_state: "AppState"  # set by main.py at startup


ctx = _Context()
