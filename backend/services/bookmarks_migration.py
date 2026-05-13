"""Bookmark-store schema migration + preset builders.

v0 stores had a single ``category_id`` per bookmark; v1 splits the axis
into ``place_id`` (single, "where") and ``tags`` (multi, "what").
:func:`migrate_v0_to_v1` rewrites the dict shape before Pydantic
validates it.

Preset constants live here so any future schema migration that touches
the preset list can be co-located with the version mapping.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from models.schemas import (
    BOOKMARK_STORE_VERSION,
    BookmarkPlace,
    BookmarkTag,
)

logger = logging.getLogger(__name__)


# (id, name, color, sort_order). Stable ids so _ensure_presets can idempotently
# detect whether a preset is already in a loaded store.
PRESET_PLACES: tuple[tuple[str, str, str, int], ...] = (
    ("default", "預設", "#6c8cff", 0),
)

PRESET_TAGS: tuple[tuple[str, str, str, int], ...] = (
    ("preset_scanner",  "掃描器", "#4A90E2", 0),
    ("preset_mushroom", "菇",     "#A855F7", 1),
    ("preset_flower",   "花",     "#EC4899", 2),
)

# Old `category_id` values that should become tags after migration. Anything
# not in this set (including "default" and user-created categories like
# "寺廟" / "富士山") becomes a place.
PRESET_TAG_IDS = {pid for pid, *_ in PRESET_TAGS}


def now_iso() -> str:
    """ISO 8601 UTC timestamp — single definition reused for created_at /
    updated_at stamps across the bookmark layer."""
    return datetime.now(timezone.utc).isoformat()


def build_preset_places() -> list[BookmarkPlace]:
    now = now_iso()
    return [
        BookmarkPlace(id=pid, name=name, color=color, sort_order=order, created_at=now)
        for pid, name, color, order in PRESET_PLACES
    ]


def build_preset_tags() -> list[BookmarkTag]:
    now = now_iso()
    return [
        BookmarkTag(id=pid, name=name, color=color, sort_order=order, created_at=now)
        for pid, name, color, order in PRESET_TAGS
    ]


def migrate_v0_to_v1(raw: dict) -> tuple[dict, bool]:
    """Transform a v0 bookmark store dict into v1 shape.

    v0: ``{categories: [...], bookmarks: [{category_id, ...}]}``
    v1: ``{version: 1, places: [...], tags: [...], bookmarks: [{place_id, tags, ...}]}``

    Preset tag-like categories (ids in :data:`PRESET_TAG_IDS`) become tags;
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
        if cid in PRESET_TAG_IDS:
            tags.append(cat)
        else:
            places.append(cat)

    place_ids = {p.get("id", "") for p in places}
    place_ids.add("default")

    old_bookmarks = raw.get("bookmarks", []) or []
    new_bookmarks: list[dict] = []
    for bm in old_bookmarks:
        new_bm = dict(bm)
        old_cat = new_bm.pop("category_id", "default") or "default"
        if old_cat in PRESET_TAG_IDS:
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
