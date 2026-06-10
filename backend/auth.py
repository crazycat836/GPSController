"""Session-auth state — a leaf module with no upward imports.

Holds the process-wide API token and the auth-policy helpers shared by the
HTTP middleware (``main``), the WebSocket auth-frame check
(``api.websocket``), and the location/info gate (``api.location.info``).
Living here — below the routers and the app entrypoint — means those layers
no longer reach UP into ``main`` for auth state.

IMPORTANT — late binding: ``API_TOKEN`` is (re)assigned by ``main``'s lifespan
at startup (``auth.API_TOKEN = ...``). Every reader MUST access it as a module
attribute (``auth.API_TOKEN``), NEVER ``from auth import API_TOKEN`` — a value
import would permanently bind the empty-string default and silently disable
token auth.
"""

from __future__ import annotations

import os

# Session auth token. Generated once per backend process by main's lifespan
# and required on every /api/* request via the X-GPS-Token header; the
# WebSocket auth frame validates against the same value. Stays "" when running
# with GPSCONTROLLER_DEV_NOAUTH=1 for local dev convenience.
API_TOKEN: str = ""


def _is_auth_disabled() -> bool:
    return os.environ.get("GPSCONTROLLER_DEV_NOAUTH") == "1"


# Only expose the interactive docs / OpenAPI schema in dev mode (when the
# session token is disabled). In packaged production runs the docs surface
# would let any local listener enumerate every API path, so it stays off once
# auth is on. Computed at import — the env var doesn't change mid-process.
_DOCS_ENABLED = _is_auth_disabled()


# Paths that don't require the token. Docs + health check stay open so the
# Electron shell can `GET /docs` to decide the backend is up.
_AUTH_EXEMPT_PATHS = frozenset({
    "/",
    "/docs",
    "/openapi.json",
    "/redoc",
    "/docs/oauth2-redirect",
})
