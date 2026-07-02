"""Tests for ``core.handler_common.random_pause_seconds``.

The clamp + empty-range guard + uniform draw used to be copy-pasted in
route_loop / multi_stop / random_walk; these tests pin the shared
helper's contract.
"""

from __future__ import annotations

import random
import sys
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from core.handler_common import random_pause_seconds  # noqa: E402


def test_returns_zero_when_range_is_empty():
    assert random_pause_seconds(0.0, 0.0) == 0.0


def test_returns_zero_when_range_is_all_negative():
    # clamp_pause_range floors negatives to 0, so (-5, -1) collapses to hi=0.
    assert random_pause_seconds(-5.0, -1.0) == 0.0


def test_draws_within_the_clamped_range():
    rng = random.Random(42)
    for _ in range(50):
        d = random_pause_seconds(5.0, 10.0, rng)
        assert 5.0 <= d <= 10.0


def test_sorts_a_reversed_range_before_drawing():
    rng = random.Random(7)
    for _ in range(50):
        d = random_pause_seconds(10.0, 5.0, rng)
        assert 5.0 <= d <= 10.0


def test_degenerate_range_returns_that_value_without_rng():
    # uniform(3, 3) == 3.0 exactly, so the module-random path is deterministic.
    assert random_pause_seconds(3.0, 3.0) == 3.0
