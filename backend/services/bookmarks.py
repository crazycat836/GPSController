"""Bookmark, place, and tag management with JSON file persistence.

Data model is dual-axis:
  * place_id (single) — "where": e.g. 富士山, 寺廟, default (未分類)
  * tags (multi)      — "what": e.g. 掃描器, 菇, 花

v0 stores had a single `category_id`; on load we migrate those dicts to the
new shape via :func:`_migrate_v0_to_v1` before handing them to Pydantic.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from config import BOOKMARKS_FILE
from models.schemas import (
    BOOKMARK_STORE_VERSION,
    Bookmark,
    BookmarkPlace,
    BookmarkStore,
    BookmarkTag,
)
from services.json_safe import safe_load_json, safe_write_json

logger = logging.getLogger(__name__)


# (id, name, color, sort_order). Stable ids so _ensure_presets can idempotently
# detect whether a preset is already in a loaded store.
_PRESET_PLACES: tuple[tuple[str, str, str, int], ...] = (
    ("default", "預設", "#6c8cff", 0),
)

_PRESET_TAGS: tuple[tuple[str, str, str, int], ...] = (
    ("preset_scanner",  "掃描器", "#4A90E2", 0),
    ("preset_mushroom", "菇",     "#A855F7", 1),
    ("preset_flower",   "花",     "#EC4899", 2),
)

# Old `category_id` values that should become tags after migration. Anything
# not in this set (including "default" and user-created categories like
# "寺廟" / "富士山") becomes a place.
_PRESET_TAG_IDS = {pid for pid, *_ in _PRESET_TAGS}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _build_preset_places() -> list[BookmarkPlace]:
    now = _now_iso()
    return [
        BookmarkPlace(id=pid, name=name, color=color, sort_order=order, created_at=now)
        for pid, name, color, order in _PRESET_PLACES
    ]


def _build_preset_tags() -> list[BookmarkTag]:
    now = _now_iso()
    return [
        BookmarkTag(id=pid, name=name, color=color, sort_order=order, created_at=now)
        for pid, name, color, order in _PRESET_TAGS
    ]


def _migrate_v0_to_v1(raw: dict) -> tuple[dict, bool]:
    """Transform a v0 bookmark store dict into v1 shape.

    v0: ``{categories: [...], bookmarks: [{category_id, ...}]}``
    v1: ``{version: 1, places: [...], tags: [...], bookmarks: [{place_id, tags, ...}]}``

    Preset tag-like categories (ids in :data:`_PRESET_TAG_IDS`) become tags;
    every other category — including user-created ones like 寺廟 / 富士山 /
    隱藏 — becomes a place. The "default" place is always kept as the
    fallback for bookmarks whose old category was migrated to a tag.

    Returns ``(new_raw, did_migrate)`` — ``did_migrate=True`` means the dict
    was re-shaped and the caller should write the file back to disk.
    """
    version = raw.get("version", 0)
    if version >= BOOKMARK_STORE_VERSION:
        return raw, False

    old_categories = raw.get("categories", []) or []
    places: list[dict] = []
    tags: list[dict] = []
    for cat in old_categories:
        cid = cat.get("id", "")
        if cid in _PRESET_TAG_IDS:
            tags.append(cat)
        else:
            places.append(cat)

    # Pre-compute the set of surviving place ids so orphaned bookmarks
    # collapse to default instead of dangling.
    place_ids = {p.get("id", "") for p in places}
    place_ids.add("default")

    old_bookmarks = raw.get("bookmarks", []) or []
    new_bookmarks: list[dict] = []
    for bm in old_bookmarks:
        new_bm = dict(bm)
        old_cat = new_bm.pop("category_id", "default") or "default"
        if old_cat in _PRESET_TAG_IDS:
            # The bookmark was in a tag-like category — hoist to default place
            # and stamp the tag on it.
            new_bm["place_id"] = "default"
            existing_tags = list(new_bm.get("tags", []) or [])
            if old_cat not in existing_tags:
                existing_tags.append(old_cat)
            new_bm["tags"] = existing_tags
        else:
            new_bm["place_id"] = old_cat if old_cat in place_ids else "default"
            new_bm.setdefault("tags", [])
        new_bookmarks.append(new_bm)

    logger.info(
        "Migrated bookmark store v0→v1: %d places, %d tags, %d bookmarks",
        len(places), len(tags), len(new_bookmarks),
    )

    return (
        {
            "version": BOOKMARK_STORE_VERSION,
            "places": places,
            "tags": tags,
            "bookmarks": new_bookmarks,
        },
        True,
    )


class BookmarkManager:
    """CRUD manager for bookmarks, places, and tags.

    State is persisted to :data:`BOOKMARKS_FILE` (JSON) on every write.
    """

    def __init__(self) -> None:
        self.store = BookmarkStore(
            version=BOOKMARK_STORE_VERSION,
            places=_build_preset_places(),
            tags=_build_preset_tags(),
            bookmarks=[],
        )
        # Serialise every public mutator + _save() so concurrent
        # POST /api/bookmarks (and place/tag/import) requests cannot
        # interleave list mutations and write a torn JSON snapshot to
        # disk. asyncio.Lock created here is bound lazily to the running
        # loop on first acquire (Python 3.10+), so __init__ at import
        # time is safe.
        self._lock = asyncio.Lock()
        self._load()

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def _load(self) -> None:
        """Load bookmarks from the JSON file, if it exists.

        Migrates v0 stores to v1 at the raw-dict level before Pydantic
        validation so we don't lose data to the stricter schema.
        """
        data = safe_load_json(Path(BOOKMARKS_FILE))
        if data is None:
            logger.info("No bookmark file (or unreadable); using defaults")
            return
        migrated = False
        try:
            data, migrated = _migrate_v0_to_v1(data)
            self.store = BookmarkStore(**data)
            logger.info(
                "Loaded %d bookmarks across %d places, %d tags",
                len(self.store.bookmarks),
                len(self.store.places),
                len(self.store.tags),
            )
            backfilled = self._ensure_presets()
            if migrated or backfilled:
                self._save()
        except Exception as exc:
            logger.warning("Bookmark payload failed schema validation: %s", exc)

    def _ensure_presets(self) -> bool:
        """Append any missing preset places/tags. Idempotent by id."""
        added = False
        now = _now_iso()

        place_ids = {p.id for p in self.store.places}
        for pid, name, color, order in _PRESET_PLACES:
            if pid in place_ids:
                continue
            self.store.places.append(
                BookmarkPlace(id=pid, name=name, color=color, sort_order=order, created_at=now)
            )
            added = True

        tag_ids = {t.id for t in self.store.tags}
        for pid, name, color, order in _PRESET_TAGS:
            if pid in tag_ids:
                continue
            self.store.tags.append(
                BookmarkTag(id=pid, name=name, color=color, sort_order=order, created_at=now)
            )
            added = True

        if added:
            logger.info("Backfilled missing preset places/tags")
        return added

    def _save(self) -> None:
        """Persist the current store to disk atomically."""
        payload = json.loads(self.store.model_dump_json())
        safe_write_json(Path(BOOKMARKS_FILE), payload)

    # ------------------------------------------------------------------
    # Places
    # ------------------------------------------------------------------

    async def create_place(self, name: str, color: str = "#6c8cff") -> BookmarkPlace:
        async with self._lock:
            max_order = max((p.sort_order for p in self.store.places), default=-1)
            place = BookmarkPlace(
                id=str(uuid.uuid4()),
                name=name,
                color=color,
                sort_order=max_order + 1,
                created_at=_now_iso(),
            )
            self.store.places.append(place)
            self._save()
            return place

    async def update_place(
        self,
        place_id: str,
        name: str | None = None,
        color: str | None = None,
    ) -> BookmarkPlace | None:
        async with self._lock:
            place = self._find_place(place_id)
            if place is None:
                return None
            updates: dict[str, object] = {}
            if name is not None:
                updates["name"] = name
            if color is not None:
                updates["color"] = color
            if updates:
                new_place = place.model_copy(update=updates)
                idx = self.store.places.index(place)
                self.store.places[idx] = new_place
                place = new_place
            self._save()
            return place

    async def delete_place(self, place_id: str) -> bool:
        """Delete a place; bookmarks pointing at it fall back to *default*."""
        if place_id == "default":
            logger.warning("Cannot delete the default place")
            return False
        async with self._lock:
            if self._find_place(place_id) is None:
                return False

            self.store.bookmarks = [
                bm.model_copy(update={"place_id": "default"}) if bm.place_id == place_id else bm
                for bm in self.store.bookmarks
            ]

            self.store.places = [p for p in self.store.places if p.id != place_id]
            self._save()
            return True

    def list_places(self) -> list[BookmarkPlace]:
        return sorted(self.store.places, key=lambda p: p.sort_order)

    async def reorder_places(self, ordered_ids: list[str]) -> int:
        """Rewrite sort_order to match the given id sequence. Unknown ids are
        ignored. Returns number of places whose sort_order actually changed."""
        async with self._lock:
            id_to_order = {pid: i for i, pid in enumerate(ordered_ids)}
            changed = 0
            new_places: list[BookmarkPlace] = []
            for place in self.store.places:
                new_order = id_to_order.get(place.id)
                if new_order is None or place.sort_order == new_order:
                    new_places.append(place)
                    continue
                new_places.append(place.model_copy(update={"sort_order": new_order}))
                changed += 1
            if changed:
                self.store.places = new_places
                self._save()
            return changed

    def _find_place(self, place_id: str) -> BookmarkPlace | None:
        return next((p for p in self.store.places if p.id == place_id), None)

    # ------------------------------------------------------------------
    # Tags
    # ------------------------------------------------------------------

    async def create_tag(self, name: str, color: str = "#A855F7") -> BookmarkTag:
        async with self._lock:
            max_order = max((t.sort_order for t in self.store.tags), default=-1)
            tag = BookmarkTag(
                id=str(uuid.uuid4()),
                name=name,
                color=color,
                sort_order=max_order + 1,
                created_at=_now_iso(),
            )
            self.store.tags.append(tag)
            self._save()
            return tag

    async def update_tag(
        self,
        tag_id: str,
        name: str | None = None,
        color: str | None = None,
    ) -> BookmarkTag | None:
        async with self._lock:
            tag = self._find_tag(tag_id)
            if tag is None:
                return None
            updates: dict[str, object] = {}
            if name is not None:
                updates["name"] = name
            if color is not None:
                updates["color"] = color
            if updates:
                new_tag = tag.model_copy(update=updates)
                idx = self.store.tags.index(tag)
                self.store.tags[idx] = new_tag
                tag = new_tag
            self._save()
            return tag

    async def delete_tag(self, tag_id: str) -> bool:
        """Delete a tag. Also strips it from every bookmark's tags list."""
        async with self._lock:
            if self._find_tag(tag_id) is None:
                return False
            self.store.bookmarks = [
                bm.model_copy(update={"tags": [t for t in bm.tags if t != tag_id]})
                if tag_id in bm.tags
                else bm
                for bm in self.store.bookmarks
            ]
            self.store.tags = [t for t in self.store.tags if t.id != tag_id]
            self._save()
            return True

    def list_tags(self) -> list[BookmarkTag]:
        return sorted(self.store.tags, key=lambda t: t.sort_order)

    async def reorder_tags(self, ordered_ids: list[str]) -> int:
        async with self._lock:
            id_to_order = {tid: i for i, tid in enumerate(ordered_ids)}
            changed = 0
            new_tags: list[BookmarkTag] = []
            for tag in self.store.tags:
                new_order = id_to_order.get(tag.id)
                if new_order is None or tag.sort_order == new_order:
                    new_tags.append(tag)
                    continue
                new_tags.append(tag.model_copy(update={"sort_order": new_order}))
                changed += 1
            if changed:
                self.store.tags = new_tags
                self._save()
            return changed

    def _find_tag(self, tag_id: str) -> BookmarkTag | None:
        return next((t for t in self.store.tags if t.id == tag_id), None)

    # ------------------------------------------------------------------
    # Bookmarks
    # ------------------------------------------------------------------

    async def create_bookmark(
        self,
        name: str,
        lat: float,
        lng: float,
        address: str = "",
        place_id: str = "default",
        tags: list[str] | None = None,
        country_code: str = "",
        country: str = "",
    ) -> Bookmark:
        async with self._lock:
            if self._find_place(place_id) is None:
                place_id = "default"

            known_tag_ids = {t.id for t in self.store.tags}
            cleaned_tags = [t for t in (tags or []) if t in known_tag_ids]

            now = _now_iso()
            bm = Bookmark(
                id=str(uuid.uuid4()),
                name=name,
                lat=lat,
                lng=lng,
                address=address,
                place_id=place_id,
                tags=cleaned_tags,
                created_at=now,
                last_used_at=now,
                country_code=country_code,
                country=country,
            )
            self.store.bookmarks.append(bm)
            self._save()
            return bm

    async def update_bookmark(self, bm_id: str, **kwargs: object) -> Bookmark | None:
        async with self._lock:
            bm = self._find_bookmark(bm_id)
            if bm is None:
                return None

            allowed = {
                "name", "lat", "lng", "address", "place_id", "tags",
                "last_used_at", "country_code", "country",
            }
            updates: dict[str, object] = {}
            for key, value in kwargs.items():
                if key not in allowed or value is None:
                    continue
                if key == "place_id" and self._find_place(str(value)) is None:
                    continue  # reject unknown place silently; keep current value
                if key == "tags":
                    known = {t.id for t in self.store.tags}
                    value = [t for t in value if t in known]  # type: ignore[union-attr]
                updates[key] = value

            if updates:
                new_bm = bm.model_copy(update=updates)
                idx = self.store.bookmarks.index(bm)
                self.store.bookmarks[idx] = new_bm
                bm = new_bm

            self._save()
            return bm

    async def delete_bookmark(self, bm_id: str) -> bool:
        async with self._lock:
            before = len(self.store.bookmarks)
            self.store.bookmarks = [b for b in self.store.bookmarks if b.id != bm_id]
            if len(self.store.bookmarks) < before:
                self._save()
                return True
            return False

    async def delete_bookmarks(self, bm_ids: list[str]) -> int:
        if not bm_ids:
            return 0
        async with self._lock:
            ids = set(bm_ids)
            before = len(self.store.bookmarks)
            self.store.bookmarks = [b for b in self.store.bookmarks if b.id not in ids]
            removed = before - len(self.store.bookmarks)
            if removed:
                self._save()
            return removed

    def list_bookmarks(self) -> list[Bookmark]:
        return list(self.store.bookmarks)

    async def move_bookmarks(self, bookmark_ids: list[str], target_place_id: str) -> int:
        """Move multiple bookmarks to *target_place_id*.

        Returns the number of bookmarks actually moved.
        """
        async with self._lock:
            if self._find_place(target_place_id) is None:
                logger.warning("Target place %s does not exist", target_place_id)
                return 0

            moved = 0
            ids_set = set(bookmark_ids)
            new_bookmarks: list[Bookmark] = []
            for bm in self.store.bookmarks:
                if bm.id in ids_set and bm.place_id != target_place_id:
                    new_bookmarks.append(bm.model_copy(update={"place_id": target_place_id}))
                    moved += 1
                else:
                    new_bookmarks.append(bm)

            if moved:
                self.store.bookmarks = new_bookmarks
                self._save()
            return moved

    async def tag_bookmarks(
        self,
        bookmark_ids: list[str],
        tag_ids_add: list[str] | None = None,
        tag_ids_remove: list[str] | None = None,
    ) -> int:
        """Apply tag diffs to the given bookmarks. Unknown tag ids are ignored
        (never silently created). Returns the number of bookmarks whose tag
        list actually changed."""
        if not bookmark_ids:
            return 0

        async with self._lock:
            known = {t.id for t in self.store.tags}
            add = [t for t in (tag_ids_add or []) if t in known]
            remove_set = set(tag_ids_remove or [])
            ids_set = set(bookmark_ids)

            changed = 0
            new_bookmarks: list[Bookmark] = []
            for bm in self.store.bookmarks:
                if bm.id not in ids_set:
                    new_bookmarks.append(bm)
                    continue
                before = list(bm.tags)
                after = [t for t in before if t not in remove_set]
                for t in add:
                    if t not in after:
                        after.append(t)
                if after != before:
                    new_bookmarks.append(bm.model_copy(update={"tags": after}))
                    changed += 1
                else:
                    new_bookmarks.append(bm)

            if changed:
                self.store.bookmarks = new_bookmarks
                self._save()
            return changed

    def _find_bookmark(self, bm_id: str) -> Bookmark | None:
        return next((b for b in self.store.bookmarks if b.id == bm_id), None)

    # ------------------------------------------------------------------
    # Import / Export
    # ------------------------------------------------------------------

    def export_json(self) -> str:
        return self.store.model_dump_json(indent=2)

    async def import_json(self, data: str) -> int:
        """Import bookmarks (and places/tags) from a JSON string.

        Accepts both v0 (`categories` + `category_id`) and v1 payloads — v0
        blobs are run through the same migration as on-disk loads. Merges
        by ID; duplicates are skipped.

        Returns the number of bookmarks imported.
        """
        try:
            raw = json.loads(data)
            raw, _ = _migrate_v0_to_v1(raw)
            incoming = BookmarkStore(**raw)
        except Exception as exc:
            logger.error("Invalid bookmark JSON: %s", exc)
            return 0

        async with self._lock:
            existing_place_ids = {p.id for p in self.store.places}
            for place in incoming.places:
                if place.id not in existing_place_ids:
                    self.store.places.append(place)
                    existing_place_ids.add(place.id)

            existing_tag_ids = {t.id for t in self.store.tags}
            for tag in incoming.tags:
                if tag.id not in existing_tag_ids:
                    self.store.tags.append(tag)
                    existing_tag_ids.add(tag.id)

            existing_bm_ids = {b.id for b in self.store.bookmarks}
            imported = 0
            for bm in incoming.bookmarks:
                if bm.id in existing_bm_ids:
                    continue
                updates: dict[str, object] = {
                    "tags": [t for t in bm.tags if t in existing_tag_ids],
                }
                if bm.place_id not in existing_place_ids:
                    updates["place_id"] = "default"
                new_bm = bm.model_copy(update=updates)
                self.store.bookmarks.append(new_bm)
                existing_bm_ids.add(new_bm.id)
                imported += 1

            if imported:
                self._save()
            logger.info("Imported %d bookmarks", imported)
            return imported
