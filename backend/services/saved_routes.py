"""Persistent store for user-saved routes.

Wraps the in-memory list + asyncio.Lock + JSON persist cycle that used to
live as module-level globals in ``api/route.py``. Tests (and any future
multi-instance scenarios) can construct an isolated store instead of
inheriting whatever the real disk file contains.

The store is the single owner of mutation under its lock; callers only
interact via the async methods. ``add`` / ``import_all`` assign fresh
ids and ``created_at`` timestamps so imported / saved routes never
collide with existing entries.

Route-store v1 adds a ``categories`` axis modelled after the bookmark
store: every route carries a ``category_id``, and the on-disk file gains
a ``version`` + ``categories`` block. v0 files (flat ``routes`` list) are
re-shaped on load by :func:`_migrate_v0_to_v1`.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from models.schemas import (
    ROUTE_STORE_VERSION,
    RouteCategory,
    RouteStore,
    SavedRoute,
)
from services.json_safe import safe_load_json, safe_write_json

logger = logging.getLogger(__name__)


# Stable preset category — always present so a route with
# ``category_id="default"`` never dangles after a delete-category cascade.
_DEFAULT_CATEGORY_ID = "default"
_PRESET_CATEGORIES: tuple[tuple[str, str, str, int], ...] = (
    (_DEFAULT_CATEGORY_ID, "預設", "#6c8cff", 0),
)


# What the POST /route/saved endpoint does when a request comes in with a
# name that already exists. ``new`` always saves a fresh row (the legacy
# behaviour); ``overwrite`` keeps the existing id+created_at and only
# replaces the mutable fields; ``reject`` lets the API hand a 409 back to
# the UI so the user can pick.
ConflictPolicy = Literal["new", "overwrite", "reject"]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _build_preset_categories() -> list[RouteCategory]:
    now = _now_iso()
    return [
        RouteCategory(id=cid, name=name, color=color, sort_order=order, created_at=now)
        for cid, name, color, order in _PRESET_CATEGORIES
    ]


def _migrate_v0_to_v1(raw: dict) -> tuple[dict, bool]:
    """Reshape a v0 routes file into v1 layout.

    v0: ``{"routes": [{id, name, waypoints, profile, created_at}, ...]}``
        — no ``version`` key, no per-route category.
    v1: ``{"version": 1, "categories": [...], "routes": [{..., category_id,
        updated_at, sort_order}, ...]}``.

    Every v0 route is back-filled to the preset "default" category. The
    ``updated_at`` field clones ``created_at`` (no edit signal exists for
    legacy rows), and ``sort_order`` is the insertion index so the UI's
    "default (insertion)" sort matches what the user remembers.

    Returns ``(new_raw, did_migrate)`` — ``did_migrate=True`` means the
    caller should re-persist the file with the migrated shape.
    """
    version = raw.get("version", 0)
    if version >= ROUTE_STORE_VERSION:
        return raw, False

    old_routes = raw.get("routes", []) or []
    new_routes: list[dict] = []
    for idx, route in enumerate(old_routes):
        new_route = dict(route)
        new_route.setdefault("category_id", _DEFAULT_CATEGORY_ID)
        new_route.setdefault("updated_at", new_route.get("created_at", ""))
        new_route.setdefault("sort_order", idx)
        new_routes.append(new_route)

    logger.info("Migrated route store v0→v1: %d routes", len(new_routes))
    return (
        {
            "version": ROUTE_STORE_VERSION,
            "categories": [],  # preset back-fill happens after schema load
            "routes": new_routes,
        },
        True,
    )


# Route name comparisons are case-insensitive trimmed — so "Mt. Fuji "
# and "mt. fuji" hit the same conflict bucket. Mirrors the user's mental
# model: the rename input strips whitespace before storing too.
def _normalise_name(name: str) -> str:
    return name.strip().casefold()


class SavedRoutesStore:
    """Persistent route store with categories, guarded by an asyncio.Lock."""

    def __init__(self, routes_file: Path) -> None:
        self._routes_file = routes_file
        self._store: RouteStore = self._load()
        self._lock = asyncio.Lock()

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def _load(self) -> RouteStore:
        raw = safe_load_json(self._routes_file)
        if raw is None:
            return RouteStore(
                version=ROUTE_STORE_VERSION,
                categories=_build_preset_categories(),
                routes=[],
            )
        migrated = False
        try:
            raw, migrated = _migrate_v0_to_v1(raw)
            store = RouteStore(**raw)
        except Exception as exc:
            logger.warning("Route payload failed schema validation: %s", exc)
            return RouteStore(
                version=ROUTE_STORE_VERSION,
                categories=_build_preset_categories(),
                routes=[],
            )

        # Ensure presets exist even if a hand-edited file dropped them.
        store, ensured = self._ensure_presets(store)
        if migrated or ensured:
            self._persist_now(store)
        return store

    def _persist_now(self, store: RouteStore) -> None:
        """Write *store* to disk. Used during load when we don't hold
        ``self._lock`` yet; the public mutators call ``_persist()`` which
        snapshots ``self._store`` for the same purpose."""
        payload = json.loads(store.model_dump_json())
        safe_write_json(self._routes_file, payload)

    def _persist(self) -> None:
        self._persist_now(self._store)

    @staticmethod
    def _ensure_presets(store: RouteStore) -> tuple[RouteStore, bool]:
        """Return *store* with any missing preset categories appended.

        Idempotent — existing entries by id are preserved. Returns
        ``(store, added)`` so the caller knows whether to persist.
        """
        existing_ids = {c.id for c in store.categories}
        missing: list[RouteCategory] = []
        now = _now_iso()
        for cid, name, color, order in _PRESET_CATEGORIES:
            if cid in existing_ids:
                continue
            missing.append(
                RouteCategory(id=cid, name=name, color=color, sort_order=order, created_at=now)
            )
        if not missing:
            return store, False
        return store.model_copy(update={
            "categories": list(store.categories) + missing,
        }), True

    # ------------------------------------------------------------------
    # Read API (snapshots — never expose the live list)
    # ------------------------------------------------------------------

    def list(self) -> list[SavedRoute]:
        """Snapshot of every route in insertion order. Callers wanting to
        filter / search / sort do that themselves (route count is small)."""
        return list(self._store.routes)

    def list_categories(self) -> list[RouteCategory]:
        return sorted(self._store.categories, key=lambda c: c.sort_order)

    def get(self, route_id: str) -> SavedRoute | None:
        return next((r for r in self._store.routes if r.id == route_id), None)

    def __contains__(self, route_id: str) -> bool:
        return any(r.id == route_id for r in self._store.routes)

    # ------------------------------------------------------------------
    # Routes — mutators
    # ------------------------------------------------------------------

    async def add(
        self,
        route: SavedRoute,
        on_conflict: ConflictPolicy = "new",
    ) -> tuple[SavedRoute, Literal["created", "overwritten"]] | None:
        """Save *route*, applying *on_conflict* when a same-name entry
        already exists.

        Returns ``(route, action)`` where ``action`` is ``"created"`` for
        a fresh save and ``"overwritten"`` when an existing same-name
        entry was replaced in-place. Returns ``None`` when
        ``on_conflict="reject"`` and a conflict was found — the API
        translates that to a 409 so the UI can prompt.
        """
        async with self._lock:
            existing = self._find_same_name(route.name, route.category_id)
            if existing is not None:
                if on_conflict == "reject":
                    return None
                if on_conflict == "overwrite":
                    return self._overwrite_locked(existing, route), "overwritten"
                # on_conflict == "new" — fall through to fresh insert
            saved = self._insert_locked(route)
            return saved, "created"

    def _insert_locked(self, route: SavedRoute) -> SavedRoute:
        """Append a fresh row. Must be called under ``self._lock``."""
        now = _now_iso()
        max_order = max((r.sort_order for r in self._store.routes), default=-1)
        new_route = route.model_copy(update={
            "id": str(uuid.uuid4()),
            "created_at": now,
            "updated_at": now,
            "sort_order": max_order + 1,
            "category_id": self._resolve_category_id(route.category_id),
        })
        self._store.routes.append(new_route)
        self._persist()
        return new_route

    def _overwrite_locked(self, existing: SavedRoute, incoming: SavedRoute) -> SavedRoute:
        """Replace mutable fields on *existing* with *incoming*; keep id,
        created_at, sort_order. Must be called under ``self._lock``."""
        updated = existing.model_copy(update={
            "name": incoming.name,
            "waypoints": incoming.waypoints,
            "profile": incoming.profile,
            "category_id": self._resolve_category_id(incoming.category_id),
            "updated_at": _now_iso(),
        })
        idx = self._store.routes.index(existing)
        self._store.routes[idx] = updated
        self._persist()
        return updated

    def _resolve_category_id(self, category_id: str) -> str:
        """Fall back to ``default`` when an unknown id is supplied — same
        contract as ``BookmarkManager`` for unknown place_id."""
        known = {c.id for c in self._store.categories}
        return category_id if category_id in known else _DEFAULT_CATEGORY_ID

    def _find_same_name(self, name: str, category_id: str) -> SavedRoute | None:
        """Locate an existing route with the same case-insensitive name
        in the same category. None if no match."""
        target = _normalise_name(name)
        resolved_cat = self._resolve_category_id(category_id)
        for r in self._store.routes:
            if r.category_id == resolved_cat and _normalise_name(r.name) == target:
                return r
        return None

    async def delete(self, route_id: str) -> bool:
        async with self._lock:
            before = len(self._store.routes)
            self._store.routes = [r for r in self._store.routes if r.id != route_id]
            if len(self._store.routes) == before:
                return False
            self._persist()
            return True

    async def batch_delete(self, route_ids: list[str]) -> int:
        """Delete several routes in one persist cycle. Returns count deleted."""
        if not route_ids:
            return 0
        targets = set(route_ids)
        async with self._lock:
            before = len(self._store.routes)
            self._store.routes = [r for r in self._store.routes if r.id not in targets]
            deleted = before - len(self._store.routes)
            if deleted:
                self._persist()
            return deleted

    async def move(self, route_ids: list[str], target_category_id: str) -> int:
        """Reassign *route_ids* to *target_category_id*. Unknown target
        falls back to "default" (matches bookmark semantics)."""
        if not route_ids:
            return 0
        targets = set(route_ids)
        async with self._lock:
            resolved = self._resolve_category_id(target_category_id)
            now = _now_iso()
            moved = 0
            new_routes: list[SavedRoute] = []
            for r in self._store.routes:
                if r.id not in targets or r.category_id == resolved:
                    new_routes.append(r)
                    continue
                new_routes.append(r.model_copy(update={
                    "category_id": resolved,
                    "updated_at": now,
                }))
                moved += 1
            if moved:
                self._store.routes = new_routes
                self._persist()
            return moved

    async def rename(self, route_id: str, name: str) -> SavedRoute | None:
        async with self._lock:
            idx = next(
                (i for i, r in enumerate(self._store.routes) if r.id == route_id),
                None,
            )
            if idx is None:
                return None
            current = self._store.routes[idx]
            new_route = current.model_copy(update={
                "name": name,
                "updated_at": _now_iso(),
            })
            self._store.routes[idx] = new_route
            self._persist()
            return new_route

    async def import_all(self, routes: list[SavedRoute]) -> int:
        """Merge *routes* into the store with fresh ids. Returns count imported."""
        if not routes:
            return 0
        async with self._lock:
            now = _now_iso()
            max_order = max((r.sort_order for r in self._store.routes), default=-1)
            for offset, r in enumerate(routes, start=1):
                self._store.routes.append(r.model_copy(update={
                    "id": str(uuid.uuid4()),
                    "created_at": now,
                    "updated_at": now,
                    "sort_order": max_order + offset,
                    "category_id": self._resolve_category_id(r.category_id),
                }))
            self._persist()
            return len(routes)

    # ------------------------------------------------------------------
    # Categories — mutators
    # ------------------------------------------------------------------

    async def create_category(self, name: str, color: str = "#6c8cff") -> RouteCategory:
        async with self._lock:
            max_order = max((c.sort_order for c in self._store.categories), default=-1)
            category = RouteCategory(
                id=str(uuid.uuid4()),
                name=name,
                color=color,
                sort_order=max_order + 1,
                created_at=_now_iso(),
            )
            self._store.categories.append(category)
            self._persist()
            return category

    async def update_category(
        self,
        category_id: str,
        name: str | None = None,
        color: str | None = None,
    ) -> RouteCategory | None:
        async with self._lock:
            idx = next(
                (i for i, c in enumerate(self._store.categories) if c.id == category_id),
                None,
            )
            if idx is None:
                return None
            applied = {k: v for k, v in (("name", name), ("color", color)) if v is not None}
            if not applied:
                return self._store.categories[idx]
            updated = self._store.categories[idx].model_copy(update=applied)
            self._store.categories[idx] = updated
            self._persist()
            return updated

    async def delete_category(self, category_id: str) -> bool:
        """Drop *category_id*; routes pointing at it fall back to ``default``.
        The preset ``default`` category is non-deletable."""
        if category_id == _DEFAULT_CATEGORY_ID:
            return False
        async with self._lock:
            existing = next(
                (c for c in self._store.categories if c.id == category_id),
                None,
            )
            if existing is None:
                return False
            now = _now_iso()
            self._store.routes = [
                r.model_copy(update={"category_id": _DEFAULT_CATEGORY_ID, "updated_at": now})
                if r.category_id == category_id else r
                for r in self._store.routes
            ]
            self._store.categories = [
                c for c in self._store.categories if c.id != category_id
            ]
            self._persist()
            return True
