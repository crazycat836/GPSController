"""Persistent store for user-saved routes.

Wraps the in-memory dict + asyncio.Lock + JSON persist cycle that used to
live as module-level globals in ``api/route.py``. Tests (and any future
multi-instance scenarios) can construct an isolated store instead of
inheriting whatever the real disk file contains.

The store is the single owner of mutation under its lock; callers only
interact via the async methods. ``add`` / ``import_all`` assign fresh
ids and ``created_at`` timestamps so imported / saved routes never
collide with existing entries.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from models.schemas import SavedRoute
from services.json_safe import safe_load_json, safe_write_json

logger = logging.getLogger(__name__)


class SavedRoutesStore:
    """Persistent dict[id, SavedRoute] guarded by an asyncio.Lock."""

    def __init__(self, routes_file: Path) -> None:
        self._routes_file = routes_file
        self._routes: dict[str, SavedRoute] = self._load()
        self._lock = asyncio.Lock()

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def _load(self) -> dict[str, SavedRoute]:
        raw = safe_load_json(self._routes_file)
        if raw is None:
            return {}
        out: dict[str, SavedRoute] = {}
        for item in raw.get("routes", []):
            try:
                route = SavedRoute(**item)
                out[route.id] = route
            except Exception as e:
                logger.warning("skip malformed saved route: %s", e)
        return out

    def _persist(self) -> None:
        payload = {"routes": [r.model_dump(mode="json") for r in self._routes.values()]}
        safe_write_json(self._routes_file, payload)

    # ------------------------------------------------------------------
    # Read API (snapshots — never expose the live dict)
    # ------------------------------------------------------------------

    def list(self) -> list[SavedRoute]:
        """Snapshot of all saved routes in insertion order."""
        return list(self._routes.values())

    def get(self, route_id: str) -> SavedRoute | None:
        return self._routes.get(route_id)

    def __contains__(self, route_id: str) -> bool:
        return route_id in self._routes

    # ------------------------------------------------------------------
    # Mutating API (always under the lock + persist on success)
    # ------------------------------------------------------------------

    async def add(self, route: SavedRoute) -> SavedRoute:
        """Assign a fresh id + created_at, persist, and return the route."""
        route.id = str(uuid.uuid4())
        route.created_at = datetime.now(timezone.utc).isoformat()
        async with self._lock:
            self._routes[route.id] = route
            self._persist()
        return route

    async def delete(self, route_id: str) -> bool:
        """Remove *route_id*. Returns True if it existed."""
        async with self._lock:
            if route_id not in self._routes:
                return False
            del self._routes[route_id]
            self._persist()
        return True

    async def rename(self, route_id: str, name: str) -> SavedRoute | None:
        """Update the route's display name. Returns the route or None if missing."""
        async with self._lock:
            route = self._routes.get(route_id)
            if route is None:
                return None
            route.name = name
            self._persist()
            return route

    async def import_all(self, routes: list[SavedRoute]) -> int:
        """Merge *routes* into the store with fresh ids. Returns count imported."""
        if not routes:
            return 0
        imported = 0
        async with self._lock:
            for r in routes:
                r.id = str(uuid.uuid4())
                r.created_at = datetime.now(timezone.utc).isoformat()
                self._routes[r.id] = r
                imported += 1
            if imported:
                self._persist()
        return imported
