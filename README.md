# GPSController

**iOS 虛擬定位模擬器** — 在 Windows 與 macOS 上控制 iPhone 的 GPS,支援瞬移、導航、路線循環、多點停留、隨機漫步、搖桿操控,經 USB 或 WiFi 連線。**全程不修改 iPhone 系統或使用者資料,斷開後裝置自動恢復真實 GPS。**

<p align="right">
  <a href="README.md"><img alt="繁體中文" src="https://img.shields.io/badge/繁體中文-active-2d3748?style=flat-square"></a>
  <a href="README.en.md"><img alt="English" src="https://img.shields.io/badge/English-gray?style=flat-square"></a>
</p>

<p align="center">
  <img src="frontend/build/icon.png" width="160" alt="GPSController">
</p>

<p align="center">
  <a href="https://github.com/crazycat836/GPSController/releases/latest">
    <img alt="下載安裝檔" src="https://img.shields.io/badge/下載安裝檔-4285f4?style=for-the-badge&logo=github&logoColor=white">
  </a>
  <a href="https://github.com/crazycat836/GPSController/releases/latest">
    <img alt="最新版本" src="https://img.shields.io/github/v/release/crazycat836/GPSController?style=for-the-badge&color=2d3748">
  </a>
  <a href="LICENSE">
    <img alt="License" src="https://img.shields.io/badge/license-MIT-2d3748?style=for-the-badge">
  </a>
</p>

<p align="center">
  <img src="docs/demo-v2.gif" width="720" alt="GPSController demo">
</p>

> ⚠️ **Pokémon GO / 寶可夢 / Monster Hunter Now 等定位遊戲使用者請注意**
> 這類平台禁止虛擬定位,使用本工具可能導致帳號警告或封禁。**開發者不負任何帳號損失責任**,請自行評估風險後再用。

---

## 目錄

- [目錄](#目錄)
- [功能](#功能)
- [Quick Start](#quick-start-3-步開始模擬)
- [使用者端需求](#使用者端需求)
- [疑難排解](#疑難排解)
- [iOS 相容性](#ios-相容性)
- [給開發者](#給開發者)
- [License](#license)
- [Disclaimer(免責聲明)](#disclaimer免責聲明)

---

## 功能

### 移動模式

| 模式 | 說明 |
| --- | --- |
| **Teleport** | 瞬間跳到指定座標 |
| **Navigate** | 從目前位置沿 OSRM 路線步行 / 跑步 / 開車到目的地 |
| **Route Loop** | 閉路線無限循環,每圈隨機停頓 |
| **Multi-Stop** | 依序經過多個停靠點,每點可自訂停頓 |
| **Random Walk** | 在指定半徑內隨機漫遊,半徑可選 200 m / 500 m / 1 km / 2 km |
| **Joystick** | 以方向 + 力度即時操控,支援 WASD / 方向鍵,Shift 衝刺 |

左鍵點擊地圖依目前模式自動新增點位。Loop / Multi-Stop 可設**圈數上限**,到數自動停止。

### 連線與雙裝置

- **USB 有線** — 插上即自動連線,鎖屏不影響;熱插拔偵測,重插自動重連
- **WiFi Tunnel** — mDNS 廣播失敗自動退回 /24 TCP 掃描;成功 IP / Port 記入 localStorage 供下次預填
- **雙裝置群組** — 同時連接兩台 iPhone,所有操作同步發送;裝置 chip 顯示各台連線狀態

### 速度控制

- **預設三檔**:走路 10.8 / 跑步 19.8 / 開車 60 km/h
- **自訂固定 / 隨機範圍**:輸入任意 km/h,或 min ~ max 讓後端每段重抽模擬真實路況
- **運行中即時套用**:導航 / 巡迴 / 多點 / 隨機漫步 / 搖桿進行中可修改速度後按「套用新速度」,從當前位置接續執行

### 路線與地圖

- **ETA 預覽** — Navigate / Loop / Multi-Stop 啟動前顯示規劃距離與預估時間
- **目的地 reverse geocode** — 自動顯示地址(Nominatim,帶去抖動 + 快取)
- **收藏** — 自訂名稱、分類、JSON 匯出 / 匯入(合併不覆蓋)、批次貼上座標(支援 `(lat, lng)` / 全形括號 / `@lat,lng,15z` Google Maps 格式)、右鍵複製
- **Route library** — WaypointChain 儲存整段多點路線、GPX 匯入 / 匯出、依分類瀏覽
- **Waypoint 互動** — 點 chain 上的 stop 飛到該點(保留目前模式);右鍵地圖新增;拖曳重排
- **地址搜尋** — Nominatim,座標格式 DD / DMS / DM
- **OSRM fallback** — 無覆蓋區域自動走密化直線,不再等待逾時

### 輔助工具

- **Locate PC**(定位我的電腦)— 用瀏覽器 Geolocation API 抓電腦實際座標,在地圖上標獨立 pin,可選「只飛過去」或「把 iPhone 也帶過去」
- **清除虛擬定位** — 一鍵清掉 iPhone 上的虛擬 GPS override,恢復裝置真實 GPS(雙裝置模式自動同步兩台)
- **自訂預設畫面** — 設定啟動時的地圖中心座標,僅影響地圖視角,不觸發虛擬 GPS
- **上次位置記憶** — backend 在關機前寫檔,下次開啟前端直接 pre-render 上次座標,idle state 不再空白

### 無障礙

WCAG AA 對比(≥ 4.5:1)、44 / 36 / 24 px 分層觸控目標、焦點圈、ARIA dialog / switch / menu 語意及鍵盤導航,符合 iOS HIG 規範。

---

## Quick Start(3 步開始模擬)

1. [**下載對應平台的安裝檔**](https://github.com/crazycat836/GPSController/releases/latest) — Windows `.exe` 或 macOS `.dmg`
2. **首次使用**先完成 [使用者端需求](#使用者端需求)(iTunes / 信任 / 開發者模式)
3. **啟動 GPSController**,USB 插上 iPhone,左鍵地圖任一點 → 按 Teleport 的 **Move**

首次連線 GPSController 會自動下載並掛載 Developer Disk Image(約 20 MB)。

---

## 使用者端需求

**[從 Releases 頁面下載安裝檔](https://github.com/crazycat836/GPSController/releases/latest)**

### Windows

1. **iTunes for Windows(必裝)** — 從 [Apple 官網](https://www.apple.com/itunes/)下載 iTunes for Windows (64-bit) 並安裝。
   > ⚠️ **勿用 Microsoft Store 版本的「Apple Devices」**,不相容。
2. **信任此電腦** — 首次 USB 連接,iPhone 跳出「信任這台電腦?」時點 **信任** 並輸入密碼。
3. **開發者模式(iOS 16+)** — 設定 → 隱私權與安全性 → 開發者模式 → 開啟,重啟確認。若選項未顯示,見下方[附錄](#附錄iphone-開啟開發者模式)。
4. **WiFi Tunnel(選用)** — iPhone 與電腦需同一 WiFi 網段;首次需先 USB 配對,按 **啟動 WiFi Tunnel** 後可拔除。需以系統管理員身份啟動 GPSController。

### macOS(Apple Silicon)

1. **Apple 簽章** — DMG 未經 notarize,首次開啟會被 Gatekeeper 擋,請在 **系統設定 → 隱私權與安全性** 點「強制開啟」。
2. **信任此電腦** — 和 Windows 同。
3. **開發者模式** — 和 Windows 同。
4. **WiFi Tunnel / iOS 17+** — 需 `sudo python3 start.py`(或安裝後給 App 管理員權限)才能建立 TUN 介面。

### 連線模式對照

| 連線 | 鎖屏影響 | 適用 |
| --- | --- | --- |
| **USB** | 可自由鎖定 | 開發測試 / 長時間跑路線 |
| **WiFi Tunnel** | 鎖屏會中斷 Tunnel;設定 → 自動鎖定 → **永不** | 不想被線綁住時 |

---

## 疑難排解

| 症狀 | 可能原因 / 解法 |
| --- | --- |
| **打開 App 白屏 / 無反應** | 確認 backend port 8777 沒被其他程式佔用(netstat / lsof);防毒軟體可能擋 Electron app,加入白名單 |
| **iPhone 已連接但 GPSController 顯示未連線** | 先在 iPhone 上點「信任這台電腦」;若已點過仍失敗,拔 cable 重插 |
| **Tunnel 啟動後 backend 連不上** | 確認以系統管理員 / sudo 身份啟動 |
| `No such service: com.apple.instruments.dtservicehub` | 自動掛載 DDI 失敗。關閉再重新開啟開發者模式後重插裝置;確認能連 github.com(DDI 約 20 MB) |
| **DDI 下載卡住 / 逾時** | 公司或校園網路可能封鎖 raw.githubusercontent.com;改用手機熱點重試一次 |
| **開發者模式選項未顯示**(iOS 16+) | 需先側載自簽 IPA 觸發選項出現,見下方附錄 |
| **WiFi Tunnel 建立後突然斷線** | iPhone 鎖屏會中斷 Tunnel,請把自動鎖定設成「永不」 |

### 附錄:iPhone 開啟開發者模式

iOS 16+ 的「開發者模式」預設不顯示,需先側載任一自簽 IPA 觸發。使用 [Sideloadly](https://sideloadly.io/) 側載任意小型 IPA 後,回到 **設定 → 隱私權與安全性 → 開發者模式** 開啟並重啟裝置即可。IPA 可至 [Decrypt IPA Store](https://decrypt.day/) 或 [ARM Converter Decrypted App Store](https://armconverter.com/decryptedappstore/us) 取得,建議挑小的以縮短側載時間。

完成後回 GPSController 建立連線;首次連線時會自動下載並掛載 Developer Disk Image。

**問題回報**:[開 Issue](https://github.com/crazycat836/GPSController/issues),請附上 backend.log(設定 → Log 資料夾可找到)。

---

## iOS 相容性

| iOS 版本 | 支援狀態 | 備註 |
| --- | --- | --- |
| **iOS 26.x** | ✅ 開發者實測 | 主要測試環境(iPhone 16 Pro Max / iOS 26.4.1) |
| **iOS 17–25** | ✅ 社群回報可用 | 大致無問題 |
| **iOS 16.x** | ✅ 社群維護 | 走 LegacyLocationService(較舊 API) |
| **iOS 15 以下** | ❌ 不支援 | pymobiledevice3 的 DDI / 新 Tunnel 語意無法套用 |

---

## 給開發者

<details>
<summary>架構圖 / Stack / 專案結構 / 開發環境(點擊展開)</summary>

### 架構

```
┌─────────────────┐      IPC / HTTP + WS       ┌──────────────────┐
│ Electron + React│ ─────────────────────────► │ FastAPI backend  │
│  (port 5173 dev)│ ◄───────────────────────── │  (port 8777)     │
└─────────────────┘                            └────────┬─────────┘
                                                        │ pymobiledevice3
                                                        ▼
                                              ┌──────────────────┐
                                              │ iPhone (USB/WiFi)│
                                              └──────────────────┘
```

| 層 | 技術 |
| --- | --- |
| Frontend | Electron 41, React 19, TypeScript 6, Vite 8, Tailwind CSS 4.2, Leaflet 1.9 |
| Backend | Python 3.13, FastAPI, uvicorn, websockets, pymobiledevice3 9.9+, pydantic 2, httpx, gpxpy |
| 外部服務 | OSRM(`router.project-osrm.org`)、Nominatim、CartoDB Voyager tiles(皆免費、無需 API key) |
| 打包 | PyInstaller + electron-builder(Windows NSIS / macOS DMG) |

### 專案結構

```
gpscontroller/
├── backend/          # FastAPI + pymobiledevice3 (api/, core/, services/)
├── frontend/         # Electron + React (electron/, src/)
├── start.py          # Dev launcher (Windows + macOS)
└── build.py          # Installer builder (Windows + macOS)
```

### 開發環境

**先決條件**:Windows 10/11 或 macOS(Apple Silicon)、Python 3.13、Node.js 18+、iPhone 已配對(iOS 16+ 需開啟開發者模式)。

```bash
# 安裝依賴
python -m pip install -r backend/requirements.txt pyinstaller  # Windows 用 py -3.13
cd frontend && npm install && cd ..

# 啟動 dev(兩平台共用);iOS 17+ 的 tunnel 需 admin / sudo
python start.py
# macOS: sudo python3 start.py
# Windows: 以系統管理員身份開啟 CMD / PowerShell 後執行

# 建置安裝檔(自動偵測平台,Win → NSIS、Mac → DMG)
python build.py
```

產物位置:
- Windows → `frontend/release/GPSController Setup X.Y.Z.exe`
- macOS → `frontend/release/GPSController-X.Y.Z-arm64.dmg`

</details>

歡迎開 PR 或 Issue 討論。Commit 採 [Conventional Commits](https://www.conventionalcommits.org/) 格式。

---

## License

本專案採用 **MIT License** 授權釋出,詳見 [LICENSE](LICENSE)。

---

## Disclaimer(免責聲明)

> **TL;DR** — 這工具不會改 iPhone 裡的任何資料,斷開後裝置恢復真實 GPS。但用在 location-based games 可能違反平台 ToS 導致帳號被 ban,開發者不負責。WiFi Tunnel 模式要管理員權限,可能和 VPN / 防火牆衝突,使用前請自行評估。

本專案開發初衷僅供 GIS 研究、行動應用程式開發測試及位置服務原型驗證使用。請勿將本工具用於任何違反第三方服務條款或平台政策之行為。若將本工具用於基於地理位置的遊戲或社交類應用,可能違反該平台服務條款,導致帳號遭警告或封禁。**開發者對因使用本工具所造成之任何帳號損失或衍生糾紛,概不負責。**

WiFi Tunnel 模式需以系統管理員權限執行以建立 TUN 虛擬網路介面。本工具可能與 VPN 軟體或第三方防火牆發生衝突,使用者應自行評估風險。地圖底圖與路線資訊(CartoDB、OSRM、Nominatim)僅供參考,開發者不保證其完整性或即時性。本工具**不會修改 iOS 裝置內任何使用者資料,亦不會變更作業系統核心檔案**。使用者應自行遵守所在地法律法規,因濫用或違法使用所引發之責任由使用者個人承擔。

GPSController 為個人獨立維護之開源專案(hobby project),非商業產品,亦無專職團隊。開發者將盡力維護與更新,然僅保證於**開發者本人測試環境**(iPhone 16 Pro Max / iOS 26.4.1 + Windows 11 專業版)下運作正常,不保證於其他裝置或系統配置下皆能穩定使用。本專案不保證永續維護,亦不承擔因使用所生之任何責任。

**下載、安裝或執行本軟體,即視為您已完整閱讀並同意上述免責條款。**
