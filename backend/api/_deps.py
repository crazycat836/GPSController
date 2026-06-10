"""Shared dependency accessors for the API layer.

The single seam between routers and the process-wide singletons. Every
long-lived object a router needs (AppState and the managers / services /
stores hanging off it, plus the WiFi TunnelRunner) is reached through one
of these accessors — no router touches ``ctx.app_state`` directly. This
module is the only place under ``api/`` allowed to import ``context``.

Each accessor resolves at call time (never at import), so tests can swap
``ctx.app_state`` (or ``services.wifi_tunnel_service.tunnel``) and every
router observes the replacement.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from context import ctx

if TYPE_CHECKING:
    from core.device_manager import DeviceManager
    from core.wifi_tunnel import TunnelRunner
    from services.bookmarks import BookmarkManager
    from services.cooldown import CooldownTimer
    from services.coord_format import CoordinateFormatter
    from services.gpx_service import GpxService
    from services.route_service import RouteService
    from services.saved_routes import SavedRoutesStore
    from state import AppState


def get_app_state() -> "AppState":
    """Return the live ``AppState`` composition root."""
    return ctx.app_state


def get_device_manager() -> "DeviceManager":
    """Return the live ``DeviceManager`` from the app-state singleton."""
    return ctx.app_state.device_manager


def get_bookmark_manager() -> "BookmarkManager":
    """Return the persistent bookmark store."""
    return ctx.app_state.bookmark_manager


def get_cooldown_timer() -> "CooldownTimer":
    """Return the teleport cooldown timer."""
    return ctx.app_state.cooldown_timer


def get_coord_formatter() -> "CoordinateFormatter":
    """Return the user-facing coordinate formatter."""
    return ctx.app_state.coord_formatter


def get_saved_routes_store() -> "SavedRoutesStore":
    """Return the persistent saved-routes store."""
    return ctx.app_state.saved_routes_store


def get_route_service() -> "RouteService":
    """Return the OSRM route-planning service."""
    return ctx.app_state.route_service


def get_gpx_service() -> "GpxService":
    """Return the GPX import/export service."""
    return ctx.app_state.gpx_service


def get_tunnel_runner() -> "TunnelRunner":
    """Return the process-wide WiFi ``TunnelRunner``.

    The runner stays owned by :mod:`services.wifi_tunnel_service` (core/
    and services/ consumers — liveness probe, device health, USB→WiFi
    fallback — reach it without going through the API layer); resolved
    via the module attribute at call time so tests that swap
    ``wifi_tunnel_service.tunnel`` are observed.
    """
    from services import wifi_tunnel_service

    return wifi_tunnel_service.tunnel
