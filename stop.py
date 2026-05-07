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
            # shell=True is intentional and safe here: fixed pipeline
            # with a developer-supplied integer port — no user input.
            result = subprocess.run(
                f'netstat -ano | findstr ":{port}" | findstr "LISTENING"',
                capture_output=True, text=True, shell=True,
            )
            for line in result.stdout.strip().splitlines():
                parts = line.split()
                if not parts:
                    continue
                try:
                    pid_int = int(parts[-1])
                except ValueError:
                    continue
                subprocess.run(
                    ["taskkill", "/PID", str(pid_int), "/F"],
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
