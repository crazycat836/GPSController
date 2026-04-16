# GPSController 安全審計報告

**審計日期：** 2026-04-15
**審計範圍：** MAC 版、Windows 版全部原始碼
**審計結論：** 兩個工具均不含惡意程式碼，可安全使用

---

## MAC 版

**專案位置：** `MAC/`
**檔案：** `gps_launcher.py`、`gps_map.html`、`.gitignore`
**架構：** Python (aiohttp) 後端 + 純 HTML/JS 前端

### 執行摘要

此工具不包含任何惡意程式碼。沒有發現後門、反向 Shell、資料竊取、混淆 payload、加密挖礦或持久性植入。

### 發現項目

#### MEDIUM — sudo 提權執行 pymobiledevice3 tunnel

- **檔案：** `gps_launcher.py`，第 180-184 行
- **說明：** 腳本用 `asyncio.create_subprocess_exec('sudo', sys.executable, '-m', 'pymobiledevice3', 'remote', 'start-tunnel', ...)` 以 root 權限啟動 tunnel 子程序。命令參數是固定的（僅有 `--udid` 來自已偵測裝置，非外部使用者輸入），沒有 shell 注入風險。
- **評估：** 此行為是合理需求。pymobiledevice3 的 RemoteServiceDiscovery（RSD）tunnel 在 macOS 上確實需要 root 才能建立 TUN/TAP 虛擬介面。這與 Apple 官方工具行為一致，並非濫用。使用者自行執行腳本時也需要輸入 sudo 密碼，沒有靜默提權。

#### MEDIUM — CORS 設定為完全開放

- **檔案：** `gps_launcher.py`，第 368-373 行
- **說明：** HTTP API 回應 header 設為 `Access-Control-Allow-Origin: *`，表示任何網頁都可以對 `http://localhost:8090` 發送請求。
- **評估：** 設計上的便利取捨，有實際影響。只要 Launcher 正在執行，你機器上任何惡意網頁或 XSS 攻擊都能在不需認證的情況下呼叫 `/device/{idx}/set` 和 `/device/{idx}/clear`，進而操控 iPhone GPS。不過這只影響 GPS 模擬控制，無法讀取系統資料。若擔心此問題，可在使用完畢後停止 Launcher。

#### MEDIUM — gps_map.html 中 innerHTML 插入未跳脫的資料

- **檔案：** `gps_map.html`，第 546-559、974-985、1117-1134 行
- **說明：** 多處使用 `innerHTML` 插入從 API 取回的資料，例如 `d.name`（來自裝置名稱）、`r.display_name`（來自 Nominatim OpenStreetMap 搜尋結果）、`f.name`（來自使用者輸入的最愛名稱）。這些資料均未經過 HTML 跳脫處理。
- **評估：** 這不是惡意程式碼，而是 XSS 安全漏洞。由於資料來源是本機 localhost API 和受信任的公開 API（Nominatim 是 OpenStreetMap 官方服務），且 HTML 檔案是直接在本機開啟，實際攻擊面極小。但若有人能控制 Nominatim 的回應內容（幾乎不可能），或是你自訂了奇特的裝置名稱，就可能觸發 XSS。屬於設計瑕疵，非惡意行為。

#### LOW — CDN 載入 Leaflet.js，無 SRI 完整性驗證

- **檔案：** `gps_map.html`，第 20 行和第 442 行
- **說明：** `<link>` 和 `<script>` 標籤從 `https://unpkg.com/leaflet@1.9.4/` 載入，未設定 `integrity=""` 屬性（Subresource Integrity）。
- **評估：** unpkg.com 是知名且廣泛使用的 npm CDN，版本已被釘定為 `1.9.4`。缺少 SRI 意味著若 CDN 被入侵（供應鏈攻擊），頁面會執行被竄改的腳本。這是常見的前端開發習慣問題，不是惡意行為。

#### LOW — Open-Meteo API 呼叫傳送座標

- **檔案：** `gps_map.html`，第 877-884 行
- **說明：** 每當地圖上有座標時，會向 `https://api.open-meteo.com/v1/forecast?latitude=...&longitude=...` 發送請求以取得時區資訊。這意味著你正在模擬的 GPS 座標會傳送到第三方伺服器。
- **評估：** Open-Meteo 是一個免費、開放的氣象 API，不需要 API 金鑰，由瑞士公司營運，政策透明。傳送的僅是地理座標，不含裝置識別資訊。這屬於功能性資料傳送，不是惡意資料竊取。如果你在意隱私，可注意此行為。

#### LOW — Nominatim 地址搜尋傳送查詢字串

- **檔案：** `gps_map.html`，第 957-960 行
- **說明：** 使用者輸入的地址搜尋詞會傳送至 `https://nominatim.openstreetmap.org`，且帶有自訂 User-Agent 標頭 `iPhoneGPSController/1.0`。
- **評估：** Nominatim 是 OpenStreetMap 的官方地理編碼服務，這是正常的地圖搜尋行為。

#### LOW — 最愛資料存入 localStorage

- **檔案：** `gps_map.html`，第 1056-1064 行
- **說明：** 收藏的地點（名稱、座標）以 `gps_favorites_v1` 為鍵存入瀏覽器 localStorage。
- **評估：** 資料完全儲存在本機，不會傳送到任何伺服器。這是標準的前端狀態持久化做法，無安全顧慮。

### 威脅類別排查結果

| 威脅類別 | 結果 |
|---|---|
| 後門 / 反向 Shell | 未發現 |
| 資料竊取（SSH 金鑰、憑證、環境變數） | 未發現 |
| 混淆 payload（base64、eval、exec） | 未發現 |
| 檔案系統濫用（存取 ~/.ssh、~/Library、/etc） | 未發現 |
| 靜默提權（修改 sudoers、無提示 sudo） | 未發現 |
| 供應鏈風險（執行時期下載並執行腳本） | 未發現 |
| 程序注入 / 鍵盤側錄 | 未發現 |
| 加密挖礦 | 未發現 |
| 可疑外部連線 | 未發現（僅 localhost、OSM、Open-Meteo、unpkg） |
| 啟動持久化（LaunchAgent、crontab） | 未發現 |

### 外部網路連線清單

| 目的地 | 用途 | 風險評估 |
|---|---|---|
| `http://127.0.0.1:8090` | 與本機 Launcher 通訊 | 無風險 |
| `https://unpkg.com/leaflet@1.9.4/...` | 地圖 JS/CSS 函式庫 | 低（無 SRI） |
| `https://{s}.tile.openstreetmap.org/...` | 地圖瓦片資料 | 無風險 |
| `https://nominatim.openstreetmap.org/...` | 地址搜尋 | 無風險 |
| `https://api.open-meteo.com/...` | 時區查詢（傳送座標） | 低（隱私面） |

---

## Windows 版

**專案位置：** `Windows/`
**架構：** Python (FastAPI) 後端 + Electron/React/TypeScript 前端
**規模：** 約 50 個原始碼檔案

### 執行摘要

這是一個功能明確、無惡意意圖的 iOS GPS 位置模擬工具。未發現後門、反向 Shell、資料竊取、鍵盤記錄、加密挖礦或混淆惡意 Payload。

### 發現項目

#### HIGH — 後端 API 監聽 `0.0.0.0` 並開放 CORS `*`

- **檔案：** `backend/config.py` 第 84 行（`API_HOST = "0.0.0.0"`）、`backend/main.py` 第 350 行（`allow_origins=["*"]`）
- **說明：** 後端 FastAPI 服務綁定在 `0.0.0.0:8777`，代表監聽所有網路介面，而不只是 localhost。同時 CORS 設定為允許所有來源（`"*"`），允許任何域名的頁面對這個 API 發出請求。
- **實際風險：** 如果電腦連接到與他人共享的 Wi-Fi（例如咖啡廳、公司內部網路），同一網路上的其他人可以直接向 `http://你的電腦IP:8777` 發送請求，操控你 iPhone 的 GPS 位置。
- **評估：** 這是安全疏失，但不是惡意行為。這是 GPS 工具在設計上的便利性選擇，實際上沒有在向外竊取資料。
- **建議修復：** 將 `config.py` 的 `API_HOST` 改為 `127.0.0.1`

#### HIGH — `GPSController.bat` 硬編碼了開發者的 Python 路徑

- **檔案：** `GPSController.bat` 第 18 行
- **說明：** `"C:\Users\USER\AppData\Local\Programs\Python\Python312\python.exe" start.py` — 這個路徑是開發者自己電腦的 Python 安裝路徑（`USER` 顯然是未替換的佔位名稱），在你的電腦上不存在這個路徑時，此批次腳本會無聲失敗或報錯。
- **評估：** 開發上的疏忽，不是惡意程式碼，但在不同使用者電腦上可靠性差。

#### MEDIUM — `start.py` 使用 `shell=True` 執行系統命令

- **檔案：** `start.py` 第 57、64、107、142 行
- **說明：** `shell=True` 讓命令字串被 Shell 解析，如果 `port` 變數來自外部輸入，理論上存在 Shell 注入風險。不過，在這個程式碼中，`port` 的值是硬編碼的整數常數（`8777` 和 `5173`），並非使用者輸入。
- **評估：** 實際上不存在注入漏洞，只是一個不良的安全編碼習慣。

#### MEDIUM — DDI（開發者磁碟映像）從 GitHub 下載

- **檔案：** `backend/core/device_manager.py` 第 383-413 行
- **說明：** 連接 iOS 17+ 裝置時，若未掛載 DDI，程式會透過 `pymobiledevice3` 的 `auto_mount_personalized` 函式從 GitHub 下載約 20MB 的 Personalized Developer Disk Image。
- **評估：** 這是 `pymobiledevice3` 函式庫的合法功能，等同於 Xcode 在連接裝置時自動安裝 DevTools 的行為。

#### MEDIUM — `wifi_tunnel.py` 將通道資訊寫入 `~/.gpscontroller/`

- **檔案：** `wifi_tunnel.py` 第 73-78 行
- **說明：** JSON 檔案包含 `rsd_address` 和 `rsd_port`，寫入使用者主目錄的 `~/.gpscontroller/` 資料夾。
- **評估：** 正常的 IPC（進程間通訊）機制，後端讀取這個檔案以自動完成 Wi-Fi 連接，不是資料滲漏。

#### LOW — 後端 API 無驗證機制

- **檔案：** 所有 `backend/api/*.py` 文件
- **說明：** 後端沒有任何 API 金鑰、Token 或驗證機制。結合 `0.0.0.0` 綁定，在共享網路上任何人都能控制你的 iPhone GPS。
- **評估：** 若在家用私人網路使用，風險極低。

#### LOW — `UpdateChecker.tsx` 對 GitHub API 發出請求

- **檔案：** `frontend/src/components/UpdateChecker.tsx` 第 9 行
- **說明：** 前端啟動時向 `https://api.github.com/repos/keezxc1223/gpscontroller/releases/latest` 發出 GET 請求檢查版本。
- **評估：** 完全正常的更新檢查行為，不執行任何從網路取回的程式碼。

#### LOW — Electron 的 User-Agent 欺騙

- **檔案：** `frontend/electron/main.js` 第 85-87 行
- **說明：** 當 Electron 向 OpenStreetMap tile 伺服器發出請求時，替換 User-Agent 為 `GPSController/0.1.49`。
- **評估：** 符合 OSM 使用政策的合規做法，不是惡意行為。

#### LOW — 管理員權限申請

- **檔案：** `GPSController.bat` 第 8-13 行、`wifi-tunnel.spec` 第 36 行
- **說明：** 批次腳本透過 VBScript 請求 UAC 提升為管理員，這是 iOS 17+ Wi-Fi Tunnel 建立 TUN 介面所必需的。
- **評估：** 合理的需求，不是惡意提權。

### Electron 安全設定

- **檔案：** `frontend/electron/main.js` 第 103-106 行
- `nodeIntegration: false` — 正確
- `contextIsolation: true` — 正確
- 未設定 `webSecurity: false` — 正確
- `allowRunningInsecureContent` 未啟用 — 正確

### wifi_tunnel.py 功能說明

此檔案不是中間人代理（MITM），也不是惡意通道。它使用 `pymobiledevice3` 的 `RemotePairing` 協議建立合法的 Apple TCP Tunnel，讓後端在 USB 拔除後仍能透過 Wi-Fi 繼續與 iPhone 通訊。不攔截任何其他流量。

### 硬編碼密鑰/憑證掃描

全域搜尋結果：未發現任何硬編碼的 API 金鑰、密碼、Token 或私鑰。`~/.gpscontroller/` 目錄只儲存用戶設定（書籤、路線、位置設定）和日誌，不儲存憑證。

### 供應鏈風險

**Python 依賴（`requirements.txt`）：**
- `pymobiledevice3>=9.9.0` — 廣泛使用的開源專案（GitHub `doronz88/pymobiledevice3`），數千 stars，知名 iOS 安全研究員維護

**npm 依賴（`package.json`）：**
- React、Leaflet、Electron、Vite、TypeScript — 均為廣泛使用的正常套件，無可疑或不知名套件

### 外部網路連線清單

| 目標 | 用途 | 觸發時機 |
|------|------|---------|
| `nominatim.openstreetmap.org` | 地址搜尋/反向地理編碼 | 使用者搜尋地址時 |
| `router.project-osrm.org` | 路線規劃 | 使用導航功能時 |
| `*.tile.openstreetmap.org` / `*.tile.openstreetmap.fr` | 地圖圖磚 | 顯示地圖時 |
| `api.github.com/repos/keezxc1223/gpscontroller` | 版本更新檢查 | 應用啟動時一次 |

---

## 使用建議

1. **不要在公共 Wi-Fi 上執行 Windows 版**（或將 `config.py` 的 `API_HOST` 改為 `127.0.0.1`）
2. 兩個版本都需要管理員/sudo 權限 — 這是 pymobiledevice3 建立 tunnel 的正常技術需求
3. 使用完畢後記得停止服務
4. 核心依賴 `pymobiledevice3` 是廣泛使用的開源專案，但建議保持更新
