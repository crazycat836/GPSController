# GPSController

**iOS Virtual Location Simulator** — a cross-platform (Windows / macOS) desktop tool that controls an iPhone's GPS over USB or Wi-Fi. Supports Teleport, Navigate, Route Loop, Multi-Stop, Random Walk, and Joystick modes. **Never modifies iOS data or system files — the device returns to real GPS as soon as you disconnect.**

<p align="right">
  <a href="README.md"><img alt="繁體中文" src="https://img.shields.io/badge/繁體中文-gray?style=flat-square"></a>
  <a href="README.en.md"><img alt="English" src="https://img.shields.io/badge/English-active-2d3748?style=flat-square"></a>
</p>

<p align="center">
  <img src="frontend/build/icon.png" width="160" alt="GPSController">
</p>

<p align="center">
  <a href="https://github.com/crazycat836/GPSController/releases/latest">
    <img alt="Download" src="https://img.shields.io/badge/Download-4285f4?style=for-the-badge&logo=github&logoColor=white">
  </a>
  <a href="https://github.com/crazycat836/GPSController/releases/latest">
    <img alt="Latest release" src="https://img.shields.io/github/v/release/crazycat836/GPSController?style=for-the-badge&color=2d3748">
  </a>
  <a href="LICENSE">
    <img alt="License" src="https://img.shields.io/badge/license-MIT-2d3748?style=for-the-badge">
  </a>
</p>

<p align="center">
  <img src="docs/demo-v2.gif" width="720" alt="GPSController demo">
</p>

> ⚠️ **Pokémon GO / Monster Hunter Now / similar location-based games**
> These platforms forbid virtual location. Using GPSController may result in account warnings or bans. **The developer accepts no liability for any account loss.** Use at your own risk.

---

## Table of Contents

- [Table of Contents](#table-of-contents)
- [Features](#features)
- [Quick Start](#quick-start-3-steps-to-your-first-teleport)
- [Prerequisites](#prerequisites)
- [Troubleshooting](#troubleshooting)
- [iOS Compatibility](#ios-compatibility)
- [For Developers](#for-developers)
- [License](#license)
- [Disclaimer](#disclaimer)

---

## Features

### Movement Modes

| Mode | Description |
| --- | --- |
| **Teleport** | Instantly jump to a coordinate |
| **Navigate** | Walk / run / drive along an OSRM route to a destination |
| **Route Loop** | Loop a closed route indefinitely with a random pause each lap |
| **Multi-Stop** | Visit waypoints in order with configurable dwell time |
| **Random Walk** | Wander randomly within a configurable radius (200 m / 500 m / 1 km / 2 km presets) |
| **Joystick** | Realtime direction + intensity control; WASD / arrow keys, Shift to sprint |

Left-click the map to add points contextually for the active mode. Loop / Multi-Stop support a **lap limit** that auto-stops once reached.

### Connectivity & Dual-Device

- **USB** — plug in and auto-connect; screen can be locked freely; hotplug detection with automatic reconnect.
- **Wi-Fi Tunnel** — auto-detects via mDNS, falls back to local /24 subnet scan; saved IP / port is auto-filled next launch.
- **Dual-Device Group Mode** — two iPhones in lockstep; every action fans out in parallel; device chips show per-device state.

### Speed Control

- Three presets: Walking 10.8 / Running 19.8 / Driving 60 km/h.
- Custom fixed speed or random range (e.g., 40–80 km/h) with per-leg re-pick for realistic variation.
- Apply a new speed mid-route — the backend re-interpolates from the current position without stopping.

### Routing & Map

- **ETA preview** — planned distance and estimated time before you start.
- **Destination reverse-geocoding** — address label via Nominatim with debouncing and cache.
- **Bookmarks** — custom names, categories, JSON import / export (merge, never overwrite), bulk paste (supports `(lat, lng)`, full-width brackets, `@lat,lng,15z` Google Maps format), right-click copy.
- **Route library** — save full multi-point routes (WaypointChain), GPX import / export, category-filtered browsing.
- **Waypoint interaction** — click a stop on the chain to fly there (mode preserved); right-click map to add; drag to reorder.
- **Address search** — Nominatim, with DD / DMS / DM coordinate parsing.
- **OSRM fallback** — uncovered areas skip the timeout and use a straight-line route instantly.

### Utilities

- **Locate PC** — uses the browser Geolocation API to place a separate pin at your computer's real coordinates; choose *fly only* or *fly & teleport the iPhone*.
- **Clear virtual location** — wipes the virtual GPS override from the iPhone so the device returns to its real GPS (dual-device mode syncs both phones).
- **Custom default view** — set the map centre used at launch — affects the viewport only, never the iPhone's GPS.
- **Last-position recall** — the backend persists the final position on shutdown; on next launch the frontend pre-renders it so the idle map isn't empty.

### Accessibility

WCAG AA contrast (≥ 4.5:1), 3-tier touch targets (44 / 36 / 24 px), focus rings, ARIA dialog / switch / menu semantics, and full keyboard navigation. Compliant with iOS HIG guidelines.

---

## Quick Start (3 steps to your first teleport)

1. [**Download the installer for your platform**](https://github.com/crazycat836/GPSController/releases/latest) — Windows `.exe` or macOS `.dmg`.
2. **First-time setup** — complete [Prerequisites](#prerequisites) (iTunes / Trust / Developer Mode).
3. **Launch GPSController**, plug in the iPhone, left-click any point on the map → press **Move** in Teleport mode.

First connection downloads and mounts the Developer Disk Image automatically (~20 MB).

---

## Prerequisites

**[Download the installer from Releases](https://github.com/crazycat836/GPSController/releases/latest)**

### Windows

1. **iTunes for Windows (required)** — Download iTunes for Windows (64-bit) from [apple.com/itunes](https://www.apple.com/itunes/) and install.
   > ⚠️ **Do not use "Apple Devices" from the Microsoft Store** — it is incompatible.
2. **Trust the computer** — when the iPhone prompts "Trust this computer?", tap **Trust** and enter the passcode.
3. **Developer Mode (iOS 16+)** — Settings → Privacy & Security → Developer Mode → Enable, reboot to confirm. If the toggle is missing, see [appendix](#appendix-enabling-developer-mode) below.
4. **Wi-Fi Tunnel (optional)** — iPhone and PC must be on the same Wi-Fi subnet; USB pairing must be done first. Click **Start Wi-Fi Tunnel** in GPSController, then unplug the cable. Requires GPSController to be launched as Administrator.

### macOS (Apple Silicon)

1. **Gatekeeper** — the DMG is not notarised, so first launch is blocked. Go to **System Settings → Privacy & Security** and click **Open Anyway**.
2. **Trust the computer** — same as Windows.
3. **Developer Mode** — same as Windows.
4. **Wi-Fi Tunnel / iOS 17+** — requires `sudo python3 start.py` (or grant the installed app admin privileges) to create the TUN interface.

### Connection Modes

| Method | Screen lock | Good for |
| --- | --- | --- |
| **USB** | Can lock freely | Dev testing, long routes |
| **Wi-Fi Tunnel** | Locking drops the tunnel — set Auto-Lock → **Never** | When you don't want to be tethered |

---

## Troubleshooting

| Symptom | Likely cause / Fix |
| --- | --- |
| **App launches, window is blank / unresponsive** | Check backend port 8777 isn't occupied by another process (netstat / lsof); whitelist Electron in any antivirus software |
| **iPhone connected but GPSController says disconnected** | Tap **Trust** on the iPhone first; if already trusted, unplug and replug the cable |
| **Backend unreachable after tunnel started** | Launch GPSController as Administrator / sudo |
| `No such service: com.apple.instruments.dtservicehub` | DDI auto-mount failed. Toggle Developer Mode off / on and reboot; ensure github.com is reachable (DDI is ~20 MB) |
| **DDI download hangs** | Corporate / school networks may block `raw.githubusercontent.com`; retry on a mobile hotspot |
| **Developer Mode toggle missing** (iOS 16+) | You need to sideload a signed IPA to unlock it — see appendix below |
| **Wi-Fi Tunnel drops suddenly** | Screen lock kills the tunnel — set Auto-Lock to **Never** |

### Appendix: Enabling Developer Mode

On iOS 16+, the Developer Mode toggle is hidden until the device has had at least one developer-signed app installed. Use [Sideloadly](https://sideloadly.io/) to sideload any small IPA with a personal Apple ID — once the sideload completes, the toggle appears at **Settings → Privacy & Security → Developer Mode**. Enable it, reboot, then reconnect to GPSController (which will auto-download and mount the DDI on first connect).

**Bug reports**: [open an issue](https://github.com/crazycat836/GPSController/issues) and attach `backend.log` (Settings → Log Folder to locate it).

---

## iOS Compatibility

| iOS Version | Status | Notes |
| --- | --- | --- |
| **iOS 26.x** | ✅ Developer-tested | Primary test environment (iPhone 16 Pro Max / iOS 26.4.1) |
| **iOS 17–25** | ✅ Community-reported | Generally works |
| **iOS 16.x** | ✅ Community-maintained | Uses LegacyLocationService (older API) |
| **iOS ≤ 15** | ❌ Unsupported | pymobiledevice3 DDI / newer tunnel semantics don't apply |

---

## For Developers

<details>
<summary>Architecture / Stack / Project structure / Development (click to expand)</summary>

### Architecture

```
┌─────────────────┐      IPC / HTTP + WS       ┌──────────────────┐
│ Electron + React│ ─────────────────────────► │ FastAPI backend  │
│  (port 5173 dev)│ ◄───────────────────────── │  (port 8777)     │
└─────────────────┘                            └────────┬─────────┘
                                                        │ pymobiledevice3
                                                        ▼
                                              ┌──────────────────┐
                                              │ iPhone (USB/Wi-Fi)│
                                              └──────────────────┘
```

| Layer | Stack |
| --- | --- |
| Frontend | Electron 41, React 18.3, TypeScript 5.5, Vite 8, Tailwind CSS 4.2, Leaflet 1.9 |
| Backend | Python 3.13, FastAPI, uvicorn, websockets, pymobiledevice3 9.9+, pydantic 2, httpx, gpxpy |
| External services | OSRM (routing), Nominatim (geocoding), CartoDB Voyager (map tiles) — all free, no API key |
| Packaging | PyInstaller + electron-builder (Windows NSIS / macOS DMG) |

### Project Structure

```
GPSController/
├── backend/      # FastAPI app, services, geocoding, iOS tunnel
├── frontend/src/ # components/, contexts/, hooks/, i18n/, lib/, services/
├── start.py      # Dev launcher (Windows + macOS)
└── build.py      # Installer builder (Windows + macOS)
```

### Development

**Prerequisites:** Windows 10/11 or macOS (Apple Silicon), Python 3.13, Node.js 18+, paired iPhone (Developer Mode enabled for iOS 16+).

```bash
# Install dependencies
python -m pip install -r backend/requirements.txt pyinstaller  # Windows: py -3.13
cd frontend && npm install && cd ..

# Launch dev (same command on both OSes); iOS 17+ tunnel needs admin / sudo
python start.py
# macOS: sudo python3 start.py
# Windows: run from an elevated CMD / PowerShell

# Build installer (auto-detects host OS → NSIS / DMG)
python build.py
```

Runs backend on `:8777`, Vite on `:5173`, and opens your default browser. Build output:

- Windows → `frontend/release/GPSController Setup X.Y.Z.exe` (NSIS, ~110 MB)
- macOS → `frontend/release/GPSController-X.Y.Z-arm64.dmg` + `-arm64-mac.zip`

</details>

PRs and Issues welcome. Commits follow [Conventional Commits](https://www.conventionalcommits.org/).

---

## License

Released under the **MIT License** — see [LICENSE](LICENSE).

---

## Disclaimer

> **TL;DR** — GPSController doesn't touch any data on your iPhone, and the device goes back to real GPS the moment you disconnect. But using it with location-based games may violate those platforms' ToS and get your account banned — the developer is not responsible. Wi-Fi Tunnel needs admin privileges and may conflict with VPNs or firewalls; evaluate before use.

Using GPSController with location-based games or apps (e.g., Pokémon GO) may violate those platforms' terms of service and result in account bans. The developer is not responsible for account loss or any other consequences arising from the use of this tool. Users must comply with the laws of their jurisdiction; the developer bears no liability for misuse.

Wi-Fi Tunnel mode requires administrator privileges to create a TUN virtual network interface. The application may conflict with VPN software or third-party firewalls; users should evaluate the risk themselves. Map tiles and routing data (CartoDB, OSRM, Nominatim) are provided for reference only and may not reflect real-world conditions. The application **does not modify any user data on the iOS device, nor does it touch operating-system files** — it only modifies its own transient network interfaces and config files in `~/.gpscontroller/`.

GPSController is an independently-maintained open source hobby project, not a commercial product. Stable operation is guaranteed only in the developer's own test environment (iPhone 16 Pro Max / iOS 26.4.1 + Windows 11 Pro). The project does not guarantee continued maintenance and accepts no liability for consequences arising from its use.

**By downloading, installing, or running this software, you acknowledge that you have read and agreed to the terms above.**
