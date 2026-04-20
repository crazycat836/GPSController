# GPSController

**iOS 虛擬定位模擬器**,在 Windows 與 macOS 上控制 iPhone 的 GPS 定位,支援直接跳點、導航、路線循環、多點停留、隨機漫步、搖桿操作等模擬模式,可經由 USB 或 WiFi 連線。

<p align="right">
  <a href="README.md"><img alt="繁體中文" src="https://img.shields.io/badge/繁體中文-active-2d3748?style=flat-square"></a>
  <a href="README.en.md"><img alt="English" src="https://img.shields.io/badge/English-gray?style=flat-square"></a>
</p>

> **專案性質聲明**
>
> GPSController 為個人獨立維護之開源專案(hobby project),非商業產品,亦無專職團隊。開發者將盡力維護與更新,然本專案僅保證**於開發者本人測試環境**(iPhone 16 Pro Max / iOS 26.4.1 + Windows 11 專業版)下運作正常,不保證於其他裝置或系統配置下皆能穩定使用。若遇問題歡迎至 [Issues](https://github.com/crazycat836/GPSController/issues) 回報。本專案不保證永續維護,亦不承擔因使用所生之任何責任。

> **iOS 支援範圍**: 開發者實測 iOS 26.4.1;社群回報涵蓋 iOS 17–26 多版本;iOS 16 由社群透過 LegacyLocationService 維護;iOS 15 以下不支援。

<p align="center">
  <img src="frontend/build/icon.png" width="128" alt="GPSController">
</p>

<p align="center">
  <a href="#使用者端需求">
    <img alt="使用者端說明" src="https://img.shields.io/badge/使用者端說明-2d3748?style=for-the-badge&logo=readthedocs&logoColor=white">
  </a>
  <a href="https://github.com/crazycat836/GPSController/releases">
    <img alt="下載安裝檔" src="https://img.shields.io/badge/下載安裝檔-4285f4?style=for-the-badge&logo=github&logoColor=white">
  </a>
</p>

<p align="center">
  <img src="docs/demo-v2.gif" width="720" alt="GPSController demo">
</p>

---

## 功能

### 移動模式

| 模式 | 說明 |
| --- | --- |
| **Teleport** | 瞬間跳到指定座標 |
| **Navigate** | 從目前位置沿 OSRM 路線步行 / 跑步 / 開車到目的地 |
| **Route Loop** | 閉路線無限循環,每圈隨機停頓 |
| **Multi-Stop** | 依序經過多個停靠點,每點可自訂停頓 |
| **Random Walk** | 在指定半徑內隨機漫遊 |
| **Joystick** | 以方向 + 力度即時操控,支援 WASD / 方向鍵 |

左鍵點擊地圖依目前模式自動新增點位(Teleport 設目的地、Navigate 設終點、Loop / Multi-Stop 加入路徑點、Random Walk 設中心)。

### 雙裝置群組

- 同時連接兩台 iPhone,所有操作同步發送;裝置 chip 顯示各台連線狀態,底部狀態列並陳兩台座標
- USB 偵測到新裝置 1 秒內自動配對,直到 2 台上限

### 連線

- **USB 有線**:插上即自動連線,鎖屏不影響;熱插拔偵測,重插自動重連
- **WiFi Tunnel**:mDNS 廣播失敗自動退回 /24 TCP 掃描;成功 IP / Port 記入 localStorage 供下次預填

### 速度控制

- **預設三檔**:走路 10.8 / 跑步 19.8 / 開車 60 km/h
- **自訂固定 / 隨機範圍**:輸入任意 km/h,或 min ~ max 讓後端每段重抽模擬真實路況
- **運行中即時套用**:導航 / 巡迴 / 多點 / 隨機漫步 / 搖桿進行中可修改速度後按「套用新速度」,從當前位置接續執行

### 路線與地圖

- **ETA 預覽**:Navigate / Loop / Multi-Stop 啟動前顯示規劃距離與預估時間
- **目的地 reverse geocode**:Navigate 面板自動顯示目的地地址(Nominatim,帶去抖動 + 快取)
- **收藏**:自訂名稱、分類、JSON 匯出 / 匯入(合併不覆蓋)、批次貼上座標、右鍵複製
- **GPX 匯入 / 匯出**、**地址搜尋**(Nominatim)、座標格式 DD / DMS / DM
- **OSRM fallback**:無覆蓋區域自動走密化直線,不再等待逾時

**無障礙**: WCAG AA 對比(≥ 4.5:1)、44/36/24 px 分層觸控目標、焦點圈、ARIA dialog/switch/menu 語意及鍵盤導航,符合 iOS HIG 規範。

---

## 使用者端需求

**[下載安裝檔](https://github.com/crazycat836/GPSController/releases)**

1. **iTunes for Windows(必裝)**:安裝 [iTunes for Windows (64-bit)](https://secure-appldnld.apple.com/itunes12/047-76416-20260302-fefe4356-211d-4da1-8bc4-058eb36ea803/iTunes64Setup.exe),勿用 Microsoft Store 版本(不相容)。
2. **信任此電腦**:首次 USB 連接後,iPhone 跳出信任提示時點選 **信任** 並輸入密碼。
3. **開發者模式(iOS 16+)**:設定 → 隱私權與安全性 → 開發者模式 → 開啟,重啟確認。若選項未顯示請見下方[附錄](#附錄iphone-開啟開發者模式windows-流程)。
4. **WiFi Tunnel(選用)**:iPhone 與電腦需同一 WiFi 網段;首次需先 USB 配對,之後按 **啟動 WiFi Tunnel** 後可拔除。

| 連線方式 | 鎖屏影響 | 建議 |
| --- | --- | --- |
| **USB 有線** | 可自由鎖定 | n/a |
| **WiFi Tunnel** | 鎖屏導致 Tunnel 中斷 | 設定 → 自動鎖定 → **永不** |

> **WiFi Tunnel 模式下螢幕熄滅會造成 RSD Tunnel 中斷。** 建議關閉自動鎖定或保持螢幕常亮。

---

## 架構

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
| Frontend | Electron 41, React 18.3, TypeScript 5.5, Vite 8, Tailwind CSS 4.2, Leaflet 1.9 |
| Backend | Python 3.13, FastAPI, uvicorn, websockets, pymobiledevice3 9.9+, pydantic 2, httpx, gpxpy |
| 外部服務 | OSRM(`router.project-osrm.org`), Nominatim, CartoDB Voyager tiles(皆免費、無需 API key) |
| 打包 | PyInstaller + electron-builder(Windows NSIS / macOS DMG) |

---

## 專案結構

```
gpscontroller/
├── backend/          # FastAPI + pymobiledevice3 (api/, core/, services/)
├── frontend/         # Electron + React (electron/, src/)
├── start.py          # Dev launcher (Windows + macOS)
└── build.py          # Installer builder (Windows + macOS)
```

---

## 開發環境

**先決條件**: Windows 10/11 或 macOS(Apple Silicon)、Python 3.13、Node.js 18+、iPhone 已配對過(iOS 16+ 需開啟開發者模式)。

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

---

## 疑難排解

| 症狀 | 可能原因 / 解法 |
| --- | --- |
| Tunnel 啟動後 backend 連不上 | 確認以系統管理員身份啟動 |
| `No such service: com.apple.instruments.dtservicehub` | GPSController 會自動掛載 DDI;若仍失敗,請關閉再重新開啟開發者模式後重插裝置,並確認可連線至 github.com(DDI 約 20 MB) |
| DDI 下載卡住 / 逾時 | 公司或校園網路可能封鎖 raw.githubusercontent.com |
| **開發者模式未顯示**(iOS 16+) | 需先側載一個自簽 IPA;詳見下方附錄 |

---

### 附錄:iPhone 開啟開發者模式(Windows 流程)

iOS 16+ 的「開發者模式」預設不顯示,需先側載任一自簽 IPA 觸發。使用 [Sideloadly](https://sideloadly.io/) 側載任意小型 IPA 後,前往 **設定 → 隱私權與安全性 → 開發者模式** 開啟並重啟裝置即可。可至 [Decrypt IPA Store](https://decrypt.day/) 或 [ARM Converter Decrypted App Store](https://armconverter.com/decryptedappstore/us) 取得 IPA 檔案,建議挑選體積較小的應用以縮短側載時間。

完成後回到 GPSController 建立連線;首次連線時 GPSController 會自動下載並掛載 Developer Disk Image。

---

## License

本專案採用 **MIT License** 授權釋出,詳見 [LICENSE](LICENSE)。

---

## Disclaimer(免責聲明)

本專案開發初衷僅供 GIS 研究、行動應用程式開發測試及位置服務原型驗證使用。請勿將本工具用於任何違反第三方服務條款或平台政策之行為。若將本工具用於基於地理位置的遊戲或社交類應用,可能違反該平台服務條款,導致帳號遭警告或封禁。**開發者對因使用本工具所造成之任何帳號損失或衍生糾紛,概不負責。**

WiFi Tunnel 模式需以系統管理員權限執行以建立 TUN 虛擬網路介面。本工具可能與 VPN 軟體或第三方防火牆發生衝突,使用者應自行評估風險。地圖底圖與路線資訊(CartoDB、OSRM、Nominatim)僅供參考,開發者不保證其完整性或即時性。本工具**不會修改 iOS 裝置內任何使用者資料,亦不會變更作業系統核心檔案**。使用者應自行遵守所在地法律法規,因濫用或違法使用所引發之責任由使用者個人承擔。

**下載、安裝或執行本軟體,即視為您已完整閱讀並同意上述免責條款。**
