# GPSController

**iOS Virtual Location Simulator** — a cross-platform (Windows / macOS) desktop tool that controls an iPhone's GPS over USB or Wi-Fi. Supports Teleport, Navigate, Route Loop, Multi-Stop, Random Walk, and Joystick modes.

<p align="right">
  <a href="README.md"><img alt="繁體中文" src="https://img.shields.io/badge/繁體中文-gray?style=flat-square"></a>
  <a href="README.en.md"><img alt="English" src="https://img.shields.io/badge/English-active-2d3748?style=flat-square"></a>
</p>

> GPSController is an independently-maintained open source hobby project, not a commercial product. Stable operation is guaranteed only in the developer's own test environment (iPhone 16 Pro Max / iOS 26.4.1 + Windows 11 Pro). The project accepts no liability for consequences arising from its use.

<p align="center">
  <img src="frontend/build/icon.png" width="128" alt="GPSController">
</p>

<p align="center">
  <a href="https://github.com/crazycat836/GPSController/releases">
    <img alt="Download" src="https://img.shields.io/badge/Download-4285f4?style=for-the-badge&logo=github&logoColor=white">
  </a>
</p>

<p align="center">
  <img src="docs/demo-v2.gif" width="720" alt="GPSController demo">
</p>

---

## Compatibility

Developer-tested on iOS 26.4.1; community reports span iOS 17–26. iOS 16.x is community-maintained via the LegacyLocationService path. iOS 15 and below are unsupported.

## Features

### Movement Modes

| Mode | Description |
| --- | --- |
| **Teleport** | Instantly jump to a coordinate |
| **Navigate** | Walk / run / drive along an OSRM route to a destination |
| **Route Loop** | Loop a closed route indefinitely, with a random pause each lap |
| **Multi-Stop** | Visit waypoints in order with configurable dwell time |
| **Random Walk** | Wander randomly within a configurable radius |
| **Joystick** | Realtime direction + intensity control; WASD / arrow keys supported |

Left-click on the map to add points contextually for the active mode.

### Dual-Device Group Mode

- Two iPhones in lockstep — every action fans out in parallel; device chips show per-device state.
- USB watchdog auto-pairs up to two devices; a third plugged-in device is ignored.

### Connectivity

- **USB**: plug in and auto-connect; screen can be locked freely.
- **Wi-Fi Tunnel**: auto-detects via mDNS then local subnet scan; saved IP/port is auto-filled on next launch.
- Real-time hotplug: disconnect detected within ~4 s, reconnect auto-detected with no refresh needed.

### Speed Control

- Three presets: Walking 10.8 / Running 19.8 / Driving 60 km/h.
- Custom fixed speed or random range (e.g., 40–80 km/h) with per-leg re-pick for realistic variation.
- Apply a new speed mid-route — the backend re-interpolates from the current position without stopping.

### Routing & Map

- ETA preview shows planned distance and estimated time before you start.
- Destination reverse-geocoding displays the address label via Nominatim with debouncing and cache.
- Address search (Nominatim) and bookmark manager with GPX import / export.
- OSRM routing with smart regional fallback — uncovered areas skip the timeout and use a straight-line route instantly.

### Accessibility

WCAG AA contrast (≥ 4.5:1), 3-tier touch targets (44 / 36 / 24 px), focus rings, ARIA dialog / switch / menu semantics, and full keyboard navigation. Compliant with iOS HIG guidelines.

---

## Prerequisites

**[Download the installer from Releases](https://github.com/crazycat836/GPSController/releases)**

### 1. Install iTunes for Windows

Windows needs Apple's USB driver to communicate with iPhone. Install [iTunes for Windows (64-bit)](https://secure-appldnld.apple.com/itunes12/047-76416-20260302-fefe4356-211d-4da1-8bc4-058eb36ea803/iTunes64Setup.exe) from Apple directly.

> Do **not** use "Apple Devices" from the Microsoft Store — it is incompatible.

### 2. Trust the Computer

Connect via USB. When the iPhone prompts "Trust this computer?", tap **Trust** and enter the passcode.

### 3. Enable Developer Mode (iOS 16+)

**Settings → Privacy & Security → Developer Mode → Enable.** The device will reboot; confirm when prompted.

If the Developer Mode toggle is missing, see the [appendix](#appendix-enabling-developer-mode-on-iphone-windows) below.

### 4. Wi-Fi Tunnel (optional)

iPhone and PC must be on the same Wi-Fi subnet. USB pairing (step 2) must be done first. Click **Start Wi-Fi Tunnel** in GPSController, then unplug the cable.

| Method | Screen lock |
| --- | --- |
| **USB** | Can lock freely |
| **Wi-Fi Tunnel** | Locking drops the tunnel — set Auto-Lock → Never |

---

## Development

**Prerequisites:** Windows 10/11 or macOS (Apple Silicon), Python 3.13, Node.js 18+.

```bash
python -m pip install -r backend/requirements.txt pyinstaller  # Windows: py -3.13
cd frontend && npm install && cd ..
```

Launch dev mode (same command on both OSes; iOS 17+ tunnel needs admin / sudo):

```bash
python start.py
# macOS: sudo python3 start.py
# Windows: run from an elevated CMD / PowerShell
```

Runs backend `:8777`, Vite `:5173`, and opens your default browser.

### Build Installer

```bash
python build.py
```

Auto-detects the host OS and produces:

- Windows → `frontend/release/GPSController Setup X.Y.Z.exe` (NSIS, ~110 MB)
- macOS → `frontend/release/GPSController-X.Y.Z-arm64.dmg` + `-arm64-mac.zip`

---

## Architecture

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
| External services | OSRM (routing), Nominatim (geocoding), CartoDB Voyager (map tiles) |
| Packaging | PyInstaller + electron-builder + NSIS |

### Project Structure

```
GPSController/
├── backend/      # FastAPI app, services, geocoding, iOS tunnel
├── frontend/src/ # components/, contexts/, hooks/, i18n/, lib/, services/
└── docs/
```

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Backend unreachable after tunnel started | Launch GPSController as Administrator |
| `No such service: com.apple.instruments.dtservicehub` | Toggle Developer Mode off/on and reboot; ensure github.com is reachable for DDI download (~20 MB) |
| DDI download hangs | Check that github.com and raw.githubusercontent.com are reachable (some networks block them) |
| Developer Mode toggle missing | Deploy any signed app to the device first — see [appendix](#appendix-enabling-developer-mode-on-iphone-windows) |

---

## Appendix: Enabling Developer Mode on iPhone (Windows)

On iOS 16+, the Developer Mode toggle is hidden until the device has had at least one developer-signed app installed. Use [Sideloadly](https://sideloadly.io/) to sideload any small IPA with a personal Apple ID — once the sideload completes the toggle appears at **Settings → Privacy & Security → Developer Mode**. Enable it, reboot when prompted, then reconnect to GPSController.

---

## License

Released under the **MIT License** — see [LICENSE](LICENSE).

---

## Disclaimer

Using GPSController with location-based games or apps (e.g., Pokémon GO) may violate those platforms' terms of service and result in account bans. The developer is not responsible for account loss or any other consequences arising from the use of this tool. Users must comply with the laws of their jurisdiction; the developer bears no liability for misuse.

Wi-Fi Tunnel mode requires administrator privileges. The application only modifies its own transient network interfaces and config files in `~/.gpscontroller/` — it does not touch iOS device data or OS files. Map routes and addresses are for reference only and may not reflect real-world conditions.
