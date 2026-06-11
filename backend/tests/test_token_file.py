"""Tests for the session-token file write path in ``main``.

A previous ``sudo python3 start.py`` run could leave
``~/.gpscontroller/token`` owned by root (mode 0600), so the NEXT
unprivileged run gets EACCES when truncating it in place and the
renderer is locked out until the file is deleted by hand.
``_write_token_file`` must therefore:

* unlink-and-rewrite on PermissionError (the directory IS owned by the
  user, so unlink succeeds where open(O_TRUNC) cannot), and
* hand ownership back to the invoking user via ``chown_back`` after a
  successful write, so a sudo run can't poison the next non-sudo run.
"""

from __future__ import annotations

import os
import stat
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

# Make `backend/` importable when pytest runs from the repo root.
_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

import main  # noqa: E402


def test_token_write_plain(tmp_path: Path, monkeypatch) -> None:
    """Happy path: fresh file, 0600, exact token bytes."""
    token_file = tmp_path / "token"
    monkeypatch.setattr(main, "TOKEN_FILE", token_file)

    main._write_token_file("sekret-token")

    assert token_file.read_text(encoding="utf-8") == "sekret-token"
    assert stat.S_IMODE(token_file.stat().st_mode) == 0o600


@pytest.mark.skipif(os.geteuid() == 0, reason="chmod 0 does not block root")
def test_token_write_recovers_from_unwritable_file(tmp_path: Path, monkeypatch) -> None:
    """EACCES on open → unlink the stale file and rewrite.

    Simulates the root-owned leftover with chmod 0o000: opening it with
    O_WRONLY raises PermissionError exactly like a root-owned 0600 file
    would, while the (user-owned) directory still allows the unlink.
    """
    token_file = tmp_path / "token"
    monkeypatch.setattr(main, "TOKEN_FILE", token_file)
    token_file.write_text("stale-root-token", encoding="utf-8")
    token_file.chmod(0o000)

    main._write_token_file("fresh-token")

    assert token_file.read_text(encoding="utf-8") == "fresh-token"
    assert stat.S_IMODE(token_file.stat().st_mode) == 0o600


def test_token_write_recovers_when_os_open_raises_once(tmp_path: Path, monkeypatch) -> None:
    """Same recovery, driven by monkeypatching os.open to fail once."""
    token_file = tmp_path / "token"
    monkeypatch.setattr(main, "TOKEN_FILE", token_file)
    token_file.write_text("stale-root-token", encoding="utf-8")

    real_open = os.open
    calls = {"n": 0}

    def flaky_open(path, flags, mode=0o777, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            raise PermissionError(13, "Permission denied", str(path))
        return real_open(path, flags, mode, **kwargs)

    monkeypatch.setattr(os, "open", flaky_open)
    main._write_token_file("fresh-token")

    assert calls["n"] == 2  # failed once, retried after unlink
    assert not token_file.read_text(encoding="utf-8") == "stale-root-token"
    assert token_file.read_text(encoding="utf-8") == "fresh-token"


def test_token_write_propagates_persistent_failure(tmp_path: Path, monkeypatch) -> None:
    """If the rewrite ALSO fails, the error reaches the caller (the
    lifespan logs it) instead of being swallowed."""
    token_file = tmp_path / "token"
    monkeypatch.setattr(main, "TOKEN_FILE", token_file)

    monkeypatch.setattr(
        os, "open",
        lambda *a, **kw: (_ for _ in ()).throw(PermissionError(13, "denied")),
    )
    with pytest.raises(PermissionError):
        main._write_token_file("fresh-token")


def test_token_write_calls_chown_back(tmp_path: Path, monkeypatch) -> None:
    """Successful write hands ownership back to the sudo invoker."""
    token_file = tmp_path / "token"
    monkeypatch.setattr(main, "TOKEN_FILE", token_file)

    with patch.object(main, "chown_back") as mock_chown_back:
        main._write_token_file("sekret-token")

    mock_chown_back.assert_called_once_with(token_file)
