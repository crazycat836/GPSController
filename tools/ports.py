"""Shared port-clearing helper for the launcher scripts.

``start.py`` and ``stop.py`` both need to kill whatever is listening on
the backend / frontend ports; this module is the single copy of that
logic (the two scripts used to carry independently drifted duplicates).
Plain stdlib only, same as ``terminal_ui``.

Shell-free by design: netstat/lsof run with list-form args and the
output is parsed in Python, so neither the port nor a PID is ever
interpolated into a shell pipeline.
"""

from __future__ import annotations

import os
import subprocess


def _kill_port_windows(port: int) -> None:
    """Kill listeners on *port* via netstat + taskkill (no cmd.exe pipeline)."""
    result = subprocess.run(
        ["netstat", "-ano"],
        capture_output=True, text=True,
    )
    suffix = f":{port}"
    seen_pids: set[int] = set()
    for line in result.stdout.splitlines():
        # Expected listening row:
        #   "TCP  127.0.0.1:8000  0.0.0.0:0  LISTENING  1234"
        parts = line.split()
        if len(parts) < 5 or "LISTENING" not in parts:
            continue
        if not parts[1].endswith(suffix):
            continue
        try:
            pid = int(parts[-1])
        except ValueError:
            continue
        if pid in seen_pids:
            continue
        seen_pids.add(pid)
        subprocess.run(
            ["taskkill", "/F", "/PID", str(pid)],
            check=False, capture_output=True,
        )


def _kill_port_posix(port: int) -> None:
    """Kill listeners on *port* via lsof + kill -9."""
    result = subprocess.run(
        ["lsof", "-ti", f":{port}"],
        capture_output=True, text=True,
    )
    for pid in result.stdout.strip().splitlines():
        pid = pid.strip()
        if pid:
            subprocess.run(["kill", "-9", pid], capture_output=True)


def kill_port(port: int) -> None:
    """Terminate every process listening on *port* (Windows or POSIX)."""
    if os.name == "nt":
        _kill_port_windows(port)
    else:
        _kill_port_posix(port)
