"""Shared terminal UI helpers for the project's Python launcher scripts.

Used by ``start.py`` and ``build.py`` to render the framed banners that
greet the user. Plain stdlib only so the helpers work in any interpreter
without extra deps.
"""

from __future__ import annotations

import unicodedata


def _visual_width(text: str) -> int:
    """Return the terminal display width of *text*.

    CJK and other east-asian fullwidth characters occupy two columns; all
    other characters are treated as one column. Matches what most modern
    terminals render so framed boxes line up.
    """
    width = 0
    for ch in text:
        if unicodedata.east_asian_width(ch) in ("W", "F"):
            width += 2
        else:
            width += 1
    return width


def _box_line(content: str, inner_width: int) -> str:
    """Render *content* as a single bordered line padded to ``inner_width``."""
    pad = max(0, inner_width - _visual_width(content))
    return "  ║" + content + " " * pad + "║"


def _box_border(left: str, fill: str, right: str, inner_width: int) -> str:
    """Render a horizontal border row (top/middle/bottom of a box)."""
    return "  " + left + fill * inner_width + right
