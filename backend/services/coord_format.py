"""Coordinate format switching: DD, DMS, DM."""

from __future__ import annotations

import math
import re

from models.schemas import Coordinate, CoordinateFormat


class CoordinateFormatter:
    """Formats and parses geographic coordinates in multiple notations."""

    def __init__(self) -> None:
        self.format: CoordinateFormat = CoordinateFormat.DD

    # ------------------------------------------------------------------
    # Formatting
    # ------------------------------------------------------------------

    def format_coord(self, lat: float, lng: float) -> str:
        """Format a lat/lng pair according to the current format setting."""
        return f"{self.format_lat(lat)}, {self.format_lng(lng)}"

    def format_lat(self, lat: float) -> str:
        """Format latitude with N/S suffix."""
        hemisphere = "N" if lat >= 0 else "S"
        return self._format_value(abs(lat), hemisphere)

    def format_lng(self, lng: float) -> str:
        """Format longitude with E/W suffix."""
        hemisphere = "E" if lng >= 0 else "W"
        return self._format_value(abs(lng), hemisphere)

    def _format_value(self, deg: float, suffix: str) -> str:
        if self.format == CoordinateFormat.DD:
            return f"{deg:.6f}\u00b0{suffix}"

        if self.format == CoordinateFormat.DMS:
            d, m, s = self._dd_to_dms(deg)
            return f"{d}\u00b0{m}'{s:.2f}\"{suffix}"

        if self.format == CoordinateFormat.DM:
            d, m = self._dd_to_dm(deg)
            return f"{d}\u00b0{m:.4f}'{suffix}"

        return f"{deg:.6f}\u00b0{suffix}"

    # ------------------------------------------------------------------
    # Parsing (auto-detect)
    # ------------------------------------------------------------------

    # Characters we strip before running the DD/DM/DMS matchers below.
    # Google Maps share URLs paste as "@35.68,139.69,15z" — leading '@'
    # and the trailing zoom token need to disappear. IME users often
    # wrap a coord pair in fullwidth parens / CJK brackets; those are
    # also decoration, not content. Fullwidth space U+3000 → ASCII.
    _PARENS_OPEN = "(（「【〔〈《"
    _PARENS_CLOSE = ")）」】〕〉》"

    @staticmethod
    def _preprocess(text: str) -> str:
        """Strip paste-noise so the DD/DM/DMS matchers get clean input.

        Handles (in order):
        * Fullwidth space U+3000 + other unicode whitespace → ASCII space.
        * Fullwidth comma U+FF0C / semicolon U+FF1B → ASCII.
        * Leading ``@`` from Google Maps share URLs.
        * Matched pairs of ``()`` ``（）`` ``「」`` ``【】`` ``〔〕`` ``〈〉`` ``《》``.
        * Trailing zoom token (``,15z`` style) appended by Maps.
        """
        t = text.strip()
        if not t:
            return t

        # Normalise whitespace and CJK punctuation to ASCII equivalents.
        t = t.replace("\u3000", " ").replace("\uFF0C", ",").replace("\uFF1B", ";")

        # Drop leading '@' used by Google Maps URLs.
        if t.startswith("@"):
            t = t[1:].lstrip()

        # Strip matched bracket pairs at the edges (iterative so
        # nested wrappings like "（(25, 121)）" collapse in one call).
        for _ in range(4):  # cap iterations; deep nesting is not a real case
            if len(t) < 2:
                break
            first, last = t[0], t[-1]
            opens = CoordinateFormatter._PARENS_OPEN
            closes = CoordinateFormatter._PARENS_CLOSE
            if first in opens and last in closes and opens.index(first) == closes.index(last):
                t = t[1:-1].strip()
                continue
            break

        # Chop off trailing Google Maps zoom/altitude tokens like ",15z".
        t = re.sub(r"\s*,\s*-?\d+(?:\.\d+)?z\s*$", "", t)

        return t

    @staticmethod
    def parse_coord(text: str) -> Coordinate | None:
        """Auto-detect and parse a coordinate string into a :class:`Coordinate`.

        Supported formats
        -----------------
        * DD:   ``25.033, 121.565``  or  ``25.033°N, 121.565°E``
        * DMS:  ``25°2'1.5"N, 121°33'52.3"E``
        * DM:   ``25°2.025'N, 121°33.872'E``
        * Paste-friendly wrappings around any of the above:
          - ``(25.033, 121.565)`` / ``（25.033, 121.565）`` / ``「...」`` / ``【...】``
          - ``@25.033,121.565,15z`` (Google Maps share URL tail)
          - Fullwidth space / comma / semicolon normalised to ASCII

        Returns ``None`` when the input cannot be parsed.
        """
        text = CoordinateFormatter._preprocess(text)
        if not text:
            return None

        # Try DMS first (most specific pattern)
        result = CoordinateFormatter._try_parse_dms(text)
        if result is not None:
            return result

        # Try DM
        result = CoordinateFormatter._try_parse_dm(text)
        if result is not None:
            return result

        # Try DD (plain decimal or with degree symbol)
        result = CoordinateFormatter._try_parse_dd(text)
        if result is not None:
            return result

        return None

    # -- DMS ---------------------------------------------------------------

    @staticmethod
    def _try_parse_dms(text: str) -> Coordinate | None:
        # Pattern: 25°2'1.5"N, 121°33'52.3"E
        pattern = (
            r"(-?\d+)\s*[°]\s*(\d+)\s*['\u2032]\s*([\d.]+)\s*[\"″\u2033]\s*([NSns])?"
            r"\s*[,;\s]+\s*"
            r"(-?\d+)\s*[°]\s*(\d+)\s*['\u2032]\s*([\d.]+)\s*[\"″\u2033]\s*([EWew])?"
        )
        m = re.match(pattern, text)
        if m is None:
            return None

        lat = int(m.group(1)) + int(m.group(2)) / 60 + float(m.group(3)) / 3600
        lng = int(m.group(5)) + int(m.group(6)) / 60 + float(m.group(7)) / 3600

        if m.group(4) and m.group(4).upper() == "S":
            lat = -lat
        if m.group(8) and m.group(8).upper() == "W":
            lng = -lng

        return Coordinate(lat=lat, lng=lng)

    # -- DM ----------------------------------------------------------------

    @staticmethod
    def _try_parse_dm(text: str) -> Coordinate | None:
        # Pattern: 25°2.025'N, 121°33.872'E
        pattern = (
            r"(-?\d+)\s*[°]\s*([\d.]+)\s*['\u2032]\s*([NSns])?"
            r"\s*[,;\s]+\s*"
            r"(-?\d+)\s*[°]\s*([\d.]+)\s*['\u2032]\s*([EWew])?"
        )
        m = re.match(pattern, text)
        if m is None:
            return None

        lat = int(m.group(1)) + float(m.group(2)) / 60
        lng = int(m.group(4)) + float(m.group(5)) / 60

        if m.group(3) and m.group(3).upper() == "S":
            lat = -lat
        if m.group(6) and m.group(6).upper() == "W":
            lng = -lng

        return Coordinate(lat=lat, lng=lng)

    # -- DD ----------------------------------------------------------------

    @staticmethod
    def _try_parse_dd(text: str) -> Coordinate | None:
        # Pattern: 25.033, 121.565  or  25.033°N, 121.565°E
        pattern = (
            r"(-?[\d.]+)\s*°?\s*([NSns])?"
            r"\s*[,;\s]+\s*"
            r"(-?[\d.]+)\s*°?\s*([EWew])?"
        )
        m = re.match(pattern, text)
        if m is None:
            return None

        try:
            lat = float(m.group(1))
            lng = float(m.group(3))
        except ValueError:
            return None

        if m.group(2) and m.group(2).upper() == "S":
            lat = -lat
        if m.group(4) and m.group(4).upper() == "W":
            lng = -lng

        from utils.geo import validate_coords
        if not validate_coords(lat, lng):
            return None

        return Coordinate(lat=lat, lng=lng)

    # ------------------------------------------------------------------
    # Conversion helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _dd_to_dms(deg: float) -> tuple[int, int, float]:
        """Convert decimal degrees to (degrees, minutes, seconds)."""
        d = int(deg)
        rem = (deg - d) * 60
        m = int(rem)
        s = (rem - m) * 60
        return d, m, round(s, 4)

    @staticmethod
    def _dd_to_dm(deg: float) -> tuple[int, float]:
        """Convert decimal degrees to (degrees, decimal_minutes)."""
        d = int(deg)
        m = (deg - d) * 60
        return d, round(m, 6)
