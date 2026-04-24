"""Tests for the v0→v1 bookmark store migration.

v0 used a single ``category_id`` per bookmark and flat ``categories`` list.
v1 splits that into ``place_id`` (single) + ``tags`` (multi), with preset
tag-like categories (scanner/mushroom/flower) hoisted onto the new tags
axis while user-created categories (寺廟, 富士山, 隱藏…) stay as places.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

# Make backend/ importable regardless of where pytest is invoked from.
BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services.bookmarks import _migrate_v0_to_v1, BookmarkManager  # noqa: E402


def _v0_fixture() -> dict:
    """A representative v0 store: mixes preset tag-like categories with user
    place categories, and bookmarks that span both."""
    return {
        "categories": [
            {"id": "default", "name": "預設", "color": "#6c8cff", "sort_order": 0},
            {"id": "preset_scanner", "name": "掃描器", "color": "#4A90E2", "sort_order": 1},
            {"id": "preset_mushroom", "name": "菇", "color": "#A855F7", "sort_order": 2},
            {"id": "preset_flower", "name": "花", "color": "#EC4899", "sort_order": 3},
            {"id": "cat-fuji", "name": "富士山", "color": "#FF6B6B", "sort_order": 4},
            {"id": "cat-temple", "name": "寺廟", "color": "#8B5CF6", "sort_order": 5},
        ],
        "bookmarks": [
            {
                "id": "bm-1", "name": "富士山蘑菇點", "lat": 35.36, "lng": 138.73,
                "category_id": "preset_mushroom",
            },
            {
                "id": "bm-2", "name": "清水寺", "lat": 34.99, "lng": 135.78,
                "category_id": "cat-temple",
            },
            {
                "id": "bm-3", "name": "富士山展望台", "lat": 35.36, "lng": 138.73,
                "category_id": "cat-fuji",
            },
            {
                "id": "bm-4", "name": "未分類的點", "lat": 25.03, "lng": 121.56,
                "category_id": "default",
            },
        ],
    }


def test_migrate_splits_categories_into_places_and_tags():
    migrated, did_migrate = _migrate_v0_to_v1(_v0_fixture())

    assert did_migrate is True
    assert migrated["version"] == 1

    place_ids = [p["id"] for p in migrated["places"]]
    tag_ids = [t["id"] for t in migrated["tags"]]

    # Preset tag-like categories hoisted to tags, everything else stays as place.
    assert "preset_scanner" in tag_ids
    assert "preset_mushroom" in tag_ids
    assert "preset_flower" in tag_ids
    assert "default" in place_ids
    assert "cat-fuji" in place_ids
    assert "cat-temple" in place_ids
    # And no crosswiring:
    assert "preset_mushroom" not in place_ids
    assert "cat-fuji" not in tag_ids


def test_migrate_rewrites_each_bookmark_with_place_and_tags():
    migrated, _ = _migrate_v0_to_v1(_v0_fixture())
    by_id = {b["id"]: b for b in migrated["bookmarks"]}

    # Bookmark in a tag-like category: hoisted to default + tag stamped.
    mushroom = by_id["bm-1"]
    assert mushroom["place_id"] == "default"
    assert mushroom["tags"] == ["preset_mushroom"]
    # v0 category_id field must be gone.
    assert "category_id" not in mushroom

    # Bookmark in a user place category: place_id matches, no tags.
    temple = by_id["bm-2"]
    assert temple["place_id"] == "cat-temple"
    assert temple["tags"] == []

    fuji = by_id["bm-3"]
    assert fuji["place_id"] == "cat-fuji"
    assert fuji["tags"] == []

    # Default bookmark is unchanged (apart from field rename).
    default_bm = by_id["bm-4"]
    assert default_bm["place_id"] == "default"
    assert default_bm["tags"] == []


def test_migrate_is_idempotent_on_v1_store():
    v1 = {
        "version": 1,
        "places": [{"id": "default", "name": "預設", "color": "#6c8cff", "sort_order": 0}],
        "tags": [],
        "bookmarks": [{"id": "x", "name": "n", "lat": 0, "lng": 0, "place_id": "default", "tags": []}],
    }
    migrated, did = _migrate_v0_to_v1(v1)
    assert did is False
    assert migrated is v1  # no re-shape, same dict


def test_migrate_collapses_dangling_category_to_default():
    """If a v0 bookmark points at a category id we don't know about, it should
    land in the default place instead of carrying a dangling place_id."""
    v0 = {
        "categories": [{"id": "default", "name": "預設", "color": "#6c8cff", "sort_order": 0}],
        "bookmarks": [
            {"id": "orphan", "name": "孤兒", "lat": 0, "lng": 0, "category_id": "gone-cat"}
        ],
    }
    migrated, _ = _migrate_v0_to_v1(v0)
    assert migrated["bookmarks"][0]["place_id"] == "default"
    assert migrated["bookmarks"][0]["tags"] == []


def test_bookmark_manager_migrates_on_load(tmp_path, monkeypatch):
    """End-to-end: write a v0 JSON, have BookmarkManager pick it up, and
    verify the file is rewritten to v1 shape with migrated bookmarks."""
    bookmarks_file = tmp_path / "bookmarks.json"
    bookmarks_file.write_text(json.dumps(_v0_fixture()), encoding="utf-8")

    # BookmarkManager pulls BOOKMARKS_FILE from the config module at call
    # time, so patching the two places that dereference it is enough.
    import config as config_mod
    import services.bookmarks as svc_mod
    monkeypatch.setattr(config_mod, "BOOKMARKS_FILE", bookmarks_file)
    monkeypatch.setattr(svc_mod, "BOOKMARKS_FILE", bookmarks_file)

    manager = BookmarkManager()

    # In-memory state looks right.
    assert manager.store.version == 1
    place_ids = {p.id for p in manager.store.places}
    tag_ids = {t.id for t in manager.store.tags}
    assert {"default", "cat-fuji", "cat-temple"}.issubset(place_ids)
    assert {"preset_scanner", "preset_mushroom", "preset_flower"}.issubset(tag_ids)

    mushroom_bm = next(b for b in manager.store.bookmarks if b.id == "bm-1")
    assert mushroom_bm.place_id == "default"
    assert mushroom_bm.tags == ["preset_mushroom"]

    # And the file on disk was rewritten with the migrated shape.
    disk = json.loads(bookmarks_file.read_text(encoding="utf-8"))
    assert disk["version"] == 1
    assert "places" in disk and "tags" in disk
    assert "categories" not in disk  # old key must be gone from disk too


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
