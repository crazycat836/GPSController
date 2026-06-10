"""Coordinate display-format preference (DD, DMS, DM).

Historically this module carried full format/parse logic for all three
notations; nothing ever called it (the frontend renders coordinates
itself), so it has been reduced to the preference holder that the
settings endpoints round-trip through ``GET/PUT /api/location/settings``.
The old implementation lives in git history if parsing is ever needed.
"""

from __future__ import annotations

from models.schemas import CoordinateFormat


class CoordinateFormatter:
    """Holds the user's preferred coordinate display format."""

    def __init__(self) -> None:
        self.format: CoordinateFormat = CoordinateFormat.DD
