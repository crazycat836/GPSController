"""
GPSController 一鍵停止
"""

import os
import subprocess


def main():
    print("  正在停止 GPSController...")

    for port in [8777, 5173]:
        if os.name == "nt":
            result = subprocess.run(
                f'netstat -ano | findstr ":{port}" | findstr "LISTENING"',
                capture_output=True, text=True, shell=True,
            )
            for line in result.stdout.strip().splitlines():
                parts = line.split()
                if parts:
                    pid = parts[-1]
                    subprocess.run(f"taskkill /pid {pid} /f", shell=True,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
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
