# GPSController 功能分析報告

**分析日期：** 2026-04-15
**範圍：** MAC 版、Windows 版（LocWarp）

---

## MAC 版

**架構：** Python (aiohttp) 後端 `localhost:8090` + 純 HTML/JS 前端（Leaflet 地圖）
**主要檔案：** `gps_launcher.py`、`gps_map.html`

### 連線功能

| 功能 | 說明 | 實現位置 |
|------|------|---------|
| USB 裝置自動偵測 | 每 6 秒掃描，三種後備偵測方法（API → CLI JSON → Regex） | `gps_launcher.py` 行 92-151 |
| USB 隧道自動建立 | 自動建立 RSD tunnel，3 次重試，40 秒超時 | `gps_launcher.py` 行 178-238 |
| GPS Worker 連接 | 透過 DvtProvider + LocationSimulation 持續連接，自動重連 | `gps_launcher.py` 行 247-291 |
| 多裝置支援 | 支援多台 iPhone 同時連接，可切換操作對象 | `gps_launcher.py` 行 89-90 |
| 裝置狀態監控 | 每 1.5 秒輪詢，追蹤連線/模擬/座標/送出次數/運行時間 | `gps_map.html` `pollDevices()` |

### 座標設定

| 功能 | 說明 | 實現位置 |
|------|------|---------|
| 直接座標輸入 | 手動輸入經緯度，預設台北 101 | `gps_map.html` `gotoInput()` |
| 地圖點擊設定 | 在 Leaflet 地圖上直接點擊設定位置 | `gps_map.html` `onMapClick()` |
| 方向性移動（D-Pad） | 8 向方向盤，1~10000 公尺，支援鍵盤 WASD/方向鍵/QEZC | `gps_map.html` `pan()` |
| 座標複製 | 複製座標到剪貼板（格式 `lat,lon`，6 位小數） | `gps_map.html` `copyCoords()` |
| GPS 模擬停止 | 停止模擬，清除位置 | `gps_launcher.py` 行 349-356 |

### 巡航功能

| 功能 | 說明 | 實現位置 |
|------|------|---------|
| 航點多點編輯 | 地圖上標記航點，可拖拽/雙擊刪除/撤銷/清除全部 | `gps_map.html` `addWaypoint()` |
| 路線資訊計算 | Haversine 公式計算總距離和預估時間，即時更新 | `gps_map.html` `updateRouteInfo()` |
| 速度調整 | 0.1~999 km/h，數字輸入框 + 滑塊 | `gps_map.html` `updateSpeed()` |
| 循環模式 | 巡航結束後自動重複路線 | `gps_map.html` `toggleLoop()` |
| 巡航播放 | 每秒更新位置，線性插值，進度條追蹤 | `gps_map.html` `playCruise()` |
| GPX 匯出 | 將航點匯出為 GPX 檔案 | `gps_map.html` `exportGPX()` |

### 搜尋功能

| 功能 | 說明 | 實現位置 |
|------|------|---------|
| 地點名稱搜尋 | Nominatim API，最多 7 結果，繁中/簡中/英文 | `gps_map.html` `searchPlace()` |
| 搜尋結果互動 | 地圖標記 + 彈出窗口（設定 GPS / 加入航點 / 加入最愛） | `gps_map.html` `jumpToPlace()` |
| 當地時間查詢 | Open-Meteo API 查時區，備選經度估算，0.1° 快取 | `gps_map.html` `lookupTz()` |
| 跨日偵測 | 自動判斷當地日期是否與台灣不同 | `gps_map.html` `_buildTzResult()` |

### 我的最愛

| 功能 | 說明 | 實現位置 |
|------|------|---------|
| 地點儲存 | localStorage 持久化，重複防護（5 位小數內） | `gps_map.html` `addFavorite()` |
| 快速加入 | 側邊欄按鈕 / 搜尋結果 / 目前位置一鍵儲存 | `gps_map.html` `addCurrentToFav()` |
| 清單管理 | 跳轉地圖 / 設定 GPS / 重新命名 / 刪除 | `gps_map.html` `renderFavorites()` |
| 全部清除 | confirm 確認後批次刪除 | `gps_map.html` `clearAllFavs()` |

### UI 功能

| 功能 | 說明 |
|------|------|
| 三種模式切換 | 一般（📍）/ 巡航（🗺）/ 我的最愛（⭐） |
| 鍵盤快速鍵 | 方向鍵/WASD/QEZC 移動，+/- 縮放，F 跟隨 |
| Toast 通知 | 成功（綠）/ 錯誤（紅）浮動通知 |
| 即時狀態 HUD | 地圖座標、裝置名稱、連線/模擬狀態 |

### 後端 API

| 端點 | 功能 |
|------|------|
| `GET /devices` | 裝置列表 |
| `POST /device/{idx}/set` | 設定座標 |
| `POST /device/{idx}/clear` | 清除位置 |
| `GET /device/{idx}/status` | 單一裝置狀態 |

---

## Windows 版（LocWarp）

**架構：** Python (FastAPI/uvicorn) 後端 `0.0.0.0:8777` + Electron/React/TypeScript 前端
**主要檔案：** `backend/` 目錄（~30 個 Python 檔案）+ `frontend/` 目錄（React 組件）

### 位置模擬模式

| 功能 | 說明 | 後端實現 | 前端實現 |
|------|------|---------|---------|
| 瞬移（Teleport） | 立即跳轉到指定座標，支援距離型冷卻 | `core/teleport.py` | `hooks/useSimulation.ts` |
| 導航（Navigate） | OSRM 路由引擎規劃路線，逐點行進 + GPS 抖動 | `core/navigator.py` | `hooks/useSimulation.ts` |
| 路線循環（Loop） | 多途經點閉合路線，無限循環，可選圈間暫停 | `core/route_loop.py` | `hooks/useSimulation.ts` |
| 多站點導航（Multi-Stop） | 依序訪問多站，每站可設停留時間 | `core/multi_stop.py` | `hooks/useSimulation.ts` |
| 隨機漫步（Random Walk） | 指定中心 + 半徑，隨機生成目的地反覆導航 | `core/random_walk.py` | `hooks/useSimulation.ts` |
| 搖桿控制（Joystick） | 虛擬搖桿即時方向控制，200ms 更新週期 | `core/joystick.py` | `components/JoystickPad.tsx` |

### 速度配置

| 功能 | 說明 |
|------|------|
| 預設速度 | 步行 1.4 m/s、跑步 2.8 m/s、開車 11.1 m/s |
| 自訂速度 | 固定 km/h 或隨機範圍（min_kmh ~ max_kmh） |
| 行進中熱交換 | 可在運動途中即時更改速度，下一 tick 生效 |

### 設備連接

| 功能 | 說明 | 實現位置 |
|------|------|---------|
| USB 連接 | 自動偵測，iOS 17+ 強制檢查 | `core/device_manager.py` |
| Wi-Fi 隧道 | RemotePairing 協議，mDNS 發現 + TCP 掃描後備 | `wifi_tunnel.py` + `api/device.py` |
| Wi-Fi 修復 | USB 重新生成 RemotePairing 記錄 | `api/device.py` |
| 隧道監控 | 看門狗監控隧道進程，異常退出自動清理 | `api/device.py` |
| USB 回退 | 隧道停止後自動嘗試 USB 連接 | `api/device.py` |
| 群組模式 | 最多 2 台設備同時控制，獨立引擎 | `main.py` |
| DDI 自動掛載 | iOS 17+ 自動下載 Developer Disk Image | `core/device_manager.py` |
| 自動重連看門狗 | 監控設備卸載，自動斷開標記 | `core/device_manager.py` |

### 路線規劃

| 功能 | 說明 | 實現位置 |
|------|------|---------|
| OSRM 路由規劃 | 支援步行/跑步(foot) 和 開車(car) 配置文件 | `services/route_service.py` |
| 路線儲存 | 本地 JSON 儲存，建立/重新命名/刪除/載入 | `api/route.py` |
| 路線匯入匯出 | JSON 匯入/匯出 + GPX 匯入/匯出 | `api/route.py` + `services/gpx_service.py` |

### 書籤系統

| 功能 | 說明 | 實現位置 |
|------|------|---------|
| 書籤 CRUD | 建立/編輯/刪除書籤，指定名稱+座標+類別 | `api/bookmarks.py` |
| 類別管理 | 自訂類別（建立/重新命名/刪除），彩色標籤 | `api/bookmarks.py` |
| 批量移動 | 多個書籤批量移至其他類別 | `api/bookmarks.py` |
| 匯入匯出 | JSON 格式備份與分享 | `api/bookmarks.py` |
| 地圖集成 | 右擊新增書籤，彩色標記顯示 | `components/BookmarkList.tsx` |

### 地理編碼

| 功能 | 說明 | 實現位置 |
|------|------|---------|
| 地址搜尋（正向） | Nominatim API，自動完成，最多 5 結果 | `services/geocoding.py` |
| 反向地理編碼 | 座標 → 地址名稱 | `api/geocode.py` |

### 控制與狀態

| 功能 | 說明 |
|------|------|
| 暫停 / 繼續 | 暫停運動但保留位置 |
| 停止（保留位置） | 停止運動，不清除虛擬位置 |
| 恢復真實 GPS | 停止所有模擬，清除虛擬位置，恢復真實 GPS |
| 即時狀態 | 當前位置/目的地/進度/速度/ETA/距離/圈數/冷卻 |

### 高級特性

| 功能 | 說明 | 實現位置 |
|------|------|---------|
| 冷卻系統 | 距離型冷卻（1km 0秒 → 1000km+ 2小時），可啟用/禁用/手動取消 | `services/cooldown.py` |
| GPS 抖動 | 每次位置更新添加細微隨機偏移，模擬真實 GPS | `core/navigator.py` |
| 座標格式切換 | DD / DMS / DM 三種格式，持久化儲存 | `services/coord_format.py` |
| 自訂初始地圖位置 | 保存首選地圖中心，重啟恢復 | `api/location.py` |
| 版本更新檢查 | 啟動時查 GitHub API | `components/UpdateChecker.tsx` |
| 雙語支援 | 多語言介面 | `frontend/src/i18n/` |

### WebSocket 事件

| 事件 | 說明 |
|------|------|
| `position_update` | 位置變更（lat, lng, speed, bearing） |
| `state_change` | 模擬狀態變更 |
| `route_path` | 路線座標推送 |
| `navigation_complete` | 導航完成 |
| `lap_complete` | 循環完成一圈 |
| `pause_countdown` / `_end` | 暫停倒計時 |
| `waypoint_progress` | 到達途經點 |
| `device_connected` / `_disconnected` / `_error` | 設備事件 |
| `tunnel_degraded` / `_recovered` / `_lost` | Wi-Fi 隧道狀態 |

### 前端組件

| 組件 | 功能 |
|------|------|
| MapView | 互動式 Leaflet 地圖，點擊瞬移/導航，右鍵菜單，路線可視化 |
| ControlPanel | 模式切換、速度調整、運動控制、書籤/路線選擇 |
| DeviceStatus | USB 設備列表、Wi-Fi 隧道控制、設備發現與配對修復 |
| JoystickPad | 虛擬搖桿，滑鼠/觸控輸入 |
| BookmarkList | 書籤瀏覽/CRUD、類別管理、匯入匯出 |
| StatusBar | 模擬狀態、進度、ETA、冷卻即時顯示 |
| EtaBar | 詳細 ETA 和進度條 |
| AddressSearch | 地址搜尋自動完成 |
| PauseControl | 暫停/繼續按鈕 |
| DeviceChipRow | 群組模式設備晶片行 |
| UpdateChecker | 版本更新提示 |
| LangToggle | 語言切換 |

### 存儲位置（`~/.locwarp/`）

| 檔案 | 內容 |
|------|------|
| `settings.json` | 應用設定（座標格式、冷卻、初始位置） |
| `bookmarks.json` | 書籤與類別 |
| `routes.json` | 已保存路線 |
| `logs/backend.log` | 後端日誌（循環，最多 3 備份） |
| `wifi_tunnel_info.json` | Wi-Fi 隧道暫時資訊 |

---

## 兩版對比總結

| 面向 | MAC 版 | Windows 版（LocWarp） |
|------|--------|----------------------|
| **架構** | Python aiohttp + 純 HTML/JS | Python FastAPI + Electron/React/TS |
| **位置模式** | 單點設定 + 巡航（前端插值） | 瞬移 / 導航 / 循環 / 多站點 / 隨機漫步 / 搖桿（6 種） |
| **路由引擎** | 無（直線插值） | OSRM（真實道路路徑） |
| **速度控制** | 固定 km/h | 預設模式 + 自訂 + 隨機範圍 + 行進中熱交換 |
| **GPS 抖動** | 無 | 有（模擬真實 GPS 漂移） |
| **冷卻系統** | 無 | 有（距離型冷卻表） |
| **連接方式** | USB only | USB + Wi-Fi 隧道 |
| **多裝置** | 支援（無上限） | 支援（最多 2 台） |
| **書籤** | localStorage 簡單儲存 | 伺服器端 JSON + 類別 + 匯入匯出 |
| **路線管理** | GPX 匯出 only | 完整 CRUD + JSON/GPX 匯入匯出 |
| **搜尋** | Nominatim（7 結果） | Nominatim（5 結果）+ 反向地理編碼 |
| **時區功能** | 有（Open-Meteo + 跨日偵測） | 無 |
| **即時通訊** | HTTP 輪詢（1.5s） | WebSocket 即時推送 |
| **座標格式** | DD only | DD / DMS / DM 可切換 |
| **多語言** | 無 | 有（i18n） |
| **iOS 要求** | 無版本限制 | iOS 17+ |
| **平台** | macOS | Windows（需管理員權限） |
