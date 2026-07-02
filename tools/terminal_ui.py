"""Shared terminal UI helpers for the project's Python launcher scripts.

Used by ``start.py`` and ``build.py`` to render the framed banners that
greet the user. Plain stdlib only so the helpers work in any interpreter
without extra deps.
"""

from __future__ import annotations

import os
import re
import sys
import unicodedata

# Matches a CSI SGR escape (e.g. "\033[2m", "\033[0m"). Used to strip colour
# codes before measuring display width so framed boxes still line up.
_ANSI_RE = re.compile(r"\033\[[0-9;]*m")


def _supports_color() -> bool:
    """Whether to emit ANSI colour on stdout.

    Honour the de-facto ``NO_COLOR`` convention and disable colour when
    stdout is not a TTY (piped / redirected) or the terminal is ``dumb``,
    so logs and CI output stay free of escape noise.
    """
    if os.environ.get("NO_COLOR") is not None:
        return False
    if os.environ.get("TERM") == "dumb":
        return False
    return bool(getattr(sys.stdout, "isatty", lambda: False)())


_COLOR = _supports_color()


def _style(text: str, *codes: str) -> str:
    """Wrap *text* in the given SGR *codes*, or return it bare when colour
    is disabled. No-op for empty code lists."""
    if not _COLOR or not codes:
        return text
    return f"\033[{';'.join(codes)}m{text}\033[0m"


def dim(text: str) -> str:
    """Faint / secondary text (versions, subtitles)."""
    return _style(text, "2")


def bold(text: str) -> str:
    """Emphasised text (titles)."""
    return _style(text, "1")


def green(text: str) -> str:
    """Success accent (ready banner, check marks)."""
    return _style(text, "32")


def cyan(text: str) -> str:
    """Link accent (URLs)."""
    return _style(text, "36")


def visual_width(text: str) -> int:
    """Return the terminal display width of *text*.

    CJK and other east-asian fullwidth characters occupy two columns; all
    other characters are treated as one column. ANSI colour escapes are
    invisible and contribute zero width. Matches what most modern terminals
    render so framed boxes line up.
    """
    width = 0
    for ch in _ANSI_RE.sub("", text):
        if unicodedata.east_asian_width(ch) in ("W", "F"):
            width += 2
        else:
            width += 1
    return width


def box_line(content: str, inner_width: int) -> str:
    """Render *content* as a single bordered line padded to ``inner_width``."""
    pad = max(0, inner_width - visual_width(content))
    return "  ║" + content + " " * pad + "║"


def box_border(left: str, fill: str, right: str, inner_width: int) -> str:
    """Render a horizontal border row (top/middle/bottom of a box)."""
    return "  " + left + fill * inner_width + right
