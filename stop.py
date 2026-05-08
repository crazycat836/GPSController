"""
GPSController 一鍵停止
"""

import os
import subprocess
import sys

# Single source of truth for the backend bind port lives in backend/config.py.
ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(ROOT, "backend"))
from config import API_PORT as BACKEND_PORT  # noqa: E402

FRONTEND_PORT = 5173  # Vite dev-server default; not a backend concern


def main():
    print("  正在停止 GPSController...")

    for port in (BACKEND_PORT, FRONTEND_PORT):
        if os.name == "nt":
            # Shell-free: run netstat with a list arg and parse listening
            # rows in Python so neither the port constant nor the PID is
            # ever interpolated into a cmd.exe pipeline.
            result = subprocess.run(
                ["netstat", "-ano"],
                capture_output=True, text=True,
            )
            suffix = f":{port}"
            seen_pids: set[int] = set()
            for line in result.stdout.splitlines():
                parts = line.split()
                if len(parts) < 5 or "LISTENING" not in parts:
                    continue
                local_addr = parts[1]
                if not local_addr.endswith(suffix):
                    continue
                try:
                    pid_int = int(parts[-1])
                except ValueError:
                    continue
                if pid_int in seen_pids:
                    continue
                seen_pids.add(pid_int)
                subprocess.run(
                    ["taskkill", "/F", "/PID", str(pid_int)],
                    check=False,
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                )
        else:
            result = subprocess.run(
                ["lsof", "-ti", f":{port}"],
                capture_output=True, text=True,
            )
            for pid in result.stdout.strip().splitlines():
                pid = pid.strip()
                if pid:
                    subprocess.run(["kill", "-9", pid],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    print("  GPSController 已停止。")


if __name__ == "__main__":
    main()
    input("  按 Enter 離開...")
