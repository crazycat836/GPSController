"""
GPSController 一鍵啟動器
雙擊此檔案即可啟動 GPSController
"""

import json
import subprocess
import sys
import os
import time
import shutil
import unicodedata
import webbrowser
import urllib.request
import socket

# 路徑設定
ROOT = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.join(ROOT, "backend")
FRONTEND = os.path.join(ROOT, "frontend")

BACKEND_PORT = 8777
FRONTEND_PORT = 5173


def _app_version() -> str:
    """Read the canonical version from frontend/package.json."""
    try:
        with open(os.path.join(FRONTEND, "package.json"), encoding="utf-8") as f:
            return json.load(f).get("version", "0.0.0")
    except (OSError, ValueError):
        return "0.0.0"


APP_VERSION = _app_version()

procs = []

BOX_WIDTH = 46


def _visual_width(text: str) -> int:
    """計算字串在終端機中的顯示寬度（CJK 與 fullwidth 字元佔 2 欄）。"""
    width = 0
    for ch in text:
        if unicodedata.east_asian_width(ch) in ("W", "F"):
            width += 2
        else:
            width += 1
    return width


def _box_line(content: str, inner_width: int = BOX_WIDTH) -> str:
    """以終端機顯示寬度對齊，產生一行帶邊框的文字。"""
    pad = inner_width - _visual_width(content)
    if pad < 0:
        pad = 0
    return "  ║" + content + " " * pad + "║"


def _box_border(left: str, fill: str, right: str, inner_width: int = BOX_WIDTH) -> str:
    return "  " + left + fill * inner_width + right


def print_banner():
    print()
    print(_box_border("╔", "═", "╗"))
    print(_box_line(f"   GPSController — iOS 虛擬定位模擬器 v{APP_VERSION}"))
    print(_box_border("╚", "═", "╝"))
    print()


def check_tool(name, hint):
    if shutil.which(name):
        print(f"  [✓] 已找到 {name}")
        return True
    else:
        print(f"  [✗] 找不到 {name}，請先安裝：{hint}")
        return False


def is_port_open(port):
    """檢查 port 是否有服務在監聽"""
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=1):
            return True
    except (ConnectionRefusedError, OSError, TimeoutError):
        return False


def kill_port(port):
    """清理佔用指定 port 的進程"""
    if os.name == "nt":
        result = subprocess.run(
            f'netstat -ano | findstr ":{port}" | findstr "LISTENING"',
            capture_output=True, text=True, shell=True,
        )
        for line in result.stdout.strip().splitlines():
            parts = line.split()
            if parts:
                pid = parts[-1]
                subprocess.run(f"taskkill /pid {pid} /f",
                               shell=True, capture_output=True)
    else:
        result = subprocess.run(
            ["lsof", "-ti", f":{port}"],
            capture_output=True, text=True,
        )
        for pid in result.stdout.strip().splitlines():
            pid = pid.strip()
            if pid:
                subprocess.run(["kill", "-9", pid], capture_output=True)


def wait_for_port(port, label, timeout=60):
    print(f"      等待{label}啟動中", end="", flush=True)
    start = time.time()
    while time.time() - start < timeout:
        if is_port_open(port):
            print(" OK ✓")
            return True
        print(".", end="", flush=True)
        time.sleep(2)
    print(" 超時！")
    return False


def install_backend():
    print("  [1/4] 檢查後端依賴...", end=" ", flush=True)
    req = os.path.join(BACKEND, "requirements.txt")

    dry = subprocess.run(
        [sys.executable, "-m", "pip", "install", "-r", req, "--dry-run", "-q"],
        capture_output=True, text=True,
    )

    if "would install" not in dry.stdout.lower():
        print("已就緒 ✓")
    else:
        print("安裝中...")
        subprocess.run(
            [sys.executable, "-m", "pip", "install", "-r", req, "-q"],
            cwd=BACKEND,
        )
        print("        完成 ✓")


def install_frontend():
    print("  [2/4] 檢查前端依賴...", end=" ", flush=True)
    nm = os.path.join(FRONTEND, "node_modules")
    if os.path.isdir(nm):
        print("已就緒 ✓")
    else:
        print("安裝中...")
        subprocess.run(["npm", "install"], cwd=FRONTEND, shell=(os.name == "nt"))
        print("        完成 ✓")


def start_backend():
    print(f"  [3/4] 啟動後端服務 (port {BACKEND_PORT})...")

    # 清理殘留
    if is_port_open(BACKEND_PORT):
        print(f"      Port {BACKEND_PORT} 被佔用，清理中...")
        kill_port(BACKEND_PORT)
        time.sleep(1)

    # Dev mode: disable the session token check so `vite dev` on port 5173
    # (no Electron preload to inject the token) can call the backend.
    # Packaged Electron builds always run with auth enabled.
    env = dict(os.environ)
    env.setdefault("GPSCONTROLLER_DEV_NOAUTH", "1")

    p = subprocess.Popen(
        [sys.executable, "main.py"],
        cwd=BACKEND,
        env=env,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
    )
    procs.append(p)
    return wait_for_port(BACKEND_PORT, "後端")


def start_frontend():
    print(f"  [4/4] 啟動前端服務 (port {FRONTEND_PORT})...")

    # 清理殘留
    if is_port_open(FRONTEND_PORT):
        print(f"      Port {FRONTEND_PORT} 被佔用，清理中...")
        kill_port(FRONTEND_PORT)
        time.sleep(1)

    # 用 --port 強制指定 port，避免 Vite 跳到其他 port
    p = subprocess.Popen(
        ["npx", "vite", "--host", "--port", str(FRONTEND_PORT), "--strictPort"],
        cwd=FRONTEND,
        shell=(os.name == "nt"),
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
    )
    procs.append(p)
    return wait_for_port(FRONTEND_PORT, "前端")


def cleanup():
    print("\n  正在關閉所有服務...")
    for p in procs:
        try:
            p.terminate()
            p.wait(timeout=5)
        except Exception:
            try:
                p.kill()
            except Exception:
                pass
    # 強制清理殘留 port
    kill_port(BACKEND_PORT)
    kill_port(FRONTEND_PORT)
    print("  已停止。再見！")


def check_admin():
    """Check if running with administrator/root privileges."""
    if os.name == "nt":
        import ctypes
        try:
            return ctypes.windll.shell32.IsUserAnAdmin()
        except Exception:
            return False
    else:
        return os.geteuid() == 0


def main():
    if os.name == "nt":
        os.system("title GPSController")
    print_banner()

    # 檢查管理員權限 (iOS 17+ 需要)
    if not check_admin():
        print("  [!] 未以系統管理員身份執行")
        print("      iOS 17+ 裝置需要管理員權限才能建立通道")
        if os.name == "nt":
            print("      請以系統管理員身份開啟 CMD / PowerShell 後執行 python start.py")
        else:
            print("      請使用 sudo python3 start.py 執行")
        print()

    # 檢查環境
    ok = True
    py_name = "python" if shutil.which("python") else "python3"
    ok = check_tool(py_name, "https://www.python.org/downloads/") and ok
    ok = check_tool("node", "https://nodejs.org/") and ok
    ok = check_tool("npm", "隨 Node.js 一起安裝") and ok
    print()

    if not ok:
        input("  缺少必要工具，請安裝後重試。按 Enter 離開...")
        return

    # 安裝依賴
    install_backend()
    print()
    install_frontend()
    print()

    # 啟動服務
    if not start_backend():
        print("  [錯誤] 後端啟動失敗，請查看上方錯誤訊息")
        cleanup()
        input("  按 Enter 離開...")
        return
    print()

    if not start_frontend():
        print("  [錯誤] 前端啟動失敗")
        cleanup()
        input("  按 Enter 離開...")
        return
    print()

    # 等待 Vite 完成首次編譯後再開瀏覽器
    time.sleep(2)
    url = f"http://localhost:{FRONTEND_PORT}"
    webbrowser.open(url)

    print(_box_border("╔", "═", "╗"))
    print(_box_line("          GPSController 已就緒！"))
    print(_box_border("╠", "═", "╣"))
    print(_box_line(f"  前端畫面:  http://localhost:{FRONTEND_PORT}"))
    print(_box_line(f"  後端 API:  http://localhost:{BACKEND_PORT}"))
    print(_box_line(f"  API 文件:  http://localhost:{BACKEND_PORT}/docs"))
    print(_box_border("╠", "═", "╣"))
    print(_box_line("  按 Enter 停止所有服務"))
    print(_box_border("╚", "═", "╝"))
    print()

    try:
        input()
    except (KeyboardInterrupt, EOFError):
        pass

    cleanup()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        cleanup()
