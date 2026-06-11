"""
GPSController 一鍵停止
"""

import os
import sys

# 共用 port 清理 helper (與 start.py 共用) — repo root 在 sys.path 才能
# import tools.*（與 start.py 的 sys.path.insert 模式一致）。
ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)
from tools.ports import kill_port  # noqa: E402

# Single source of truth for the backend bind port lives in backend/config.py.
sys.path.insert(0, os.path.join(ROOT, "backend"))
from config import API_PORT as BACKEND_PORT  # noqa: E402

FRONTEND_PORT = 5173  # Vite dev-server default; not a backend concern


def main():
    print("  正在停止 GPSController...")

    for port in (BACKEND_PORT, FRONTEND_PORT):
        kill_port(port)

    print("  GPSController 已停止。")


if __name__ == "__main__":
    main()
    input("  按 Enter 離開...")
