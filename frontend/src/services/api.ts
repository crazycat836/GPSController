import { STORAGE_KEYS } from '../lib/storage-keys'
import {
  API_BASE,
  DEFAULT_TUNNEL_PORT,
  RETRY_BACKOFF_INITIAL_MS,
  RETRY_BACKOFF_MAX_MS,
  RETRY_BACKOFF_STEP_MS,
} from '../lib/constants'
import type { Bookmark, BookmarkPlace, BookmarkTag } from '../hooks/useBookmarks'
import type { DeviceInfo } from '../hooks/useDevice'

// ─── Shared response shapes ─────────────────────────────────

/** Envelope used by most action endpoints (connect, teleport, etc.). */
export interface StatusResponse {
  status: string
  [key: string]: unknown
}

/** Stored route payload shared by RoutesPanel and the library flows. */
export interface SavedRoute {
  id: string
  name: string
  waypoints: { lat: number; lng: number }[]
  created_at?: string
  /** OSRM profile / movement mode (e.g. "foot", "car"). Sent by
   *  `saveRoute` and stored by the backend. */
  profile?: string
}

/** Store envelope returned by `/api/bookmarks`. */
export interface BookmarkStore {
  places: BookmarkPlace[]
  tags: BookmarkTag[]
  bookmarks: Bookmark[]
}

export interface WifiTunnelStatus {
  running: boolean
  ip?: string
  port?: number
  rsd_address?: string
  rsd_port?: number
}

export interface WifiScanResult {
  ip: string
  name: string
  udid: string
  ios_version: string
}

export interface AddressSearchResult {
  display_name: string
  lat: number
  lng: number
  type?: string
  importance?: number
}

const API = API_BASE

// Connection-refused means backend isn't up yet, retry with backoff.
// Other HTTP errors (4xx/5xx) are real errors and propagate immediately.
async function fetchWithRetry(url: string, opts: RequestInit, maxAttempts = 15): Promise<Response> {
  let lastErr: unknown
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fetch(url, opts)
    } catch (e) {
      lastErr = e
      const delay = Math.min(
        RETRY_BACKOFF_INITIAL_MS + i * RETRY_BACKOFF_STEP_MS,
        RETRY_BACKOFF_MAX_MS,
      )
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  throw lastErr ?? new Error('fetch failed')
}

// Bilingual backend error code → user-facing message.
// Looks up the currently selected language from localStorage (set by i18n/index.ts).
const ERROR_I18N: Record<string, { zh: string; en: string }> = {
  python313_missing: { zh: '需要 Python 3.13+ 才能啟動 WiFi Tunnel', en: 'Python 3.13+ is required to start the Wi-Fi tunnel' },
  tunnel_script_missing: { zh: '找不到 wifi_tunnel.py 腳本', en: 'wifi_tunnel.py script not found' },
  tunnel_spawn_failed: { zh: '無法啟動 Tunnel 進程', en: 'Failed to spawn tunnel process' },
  tunnel_exited: { zh: 'Tunnel 進程異常結束', en: 'Tunnel process exited unexpectedly' },
  tunnel_timeout: { zh: 'Tunnel 啟動逾時,請確認 iPhone 解鎖且與電腦同網段', en: 'Tunnel startup timed out, ensure iPhone is unlocked and on the same subnet' },
  no_device: { zh: '尚未連接任何 iOS 裝置,請先透過 USB 連線', en: 'No iOS device connected, connect via USB first' },
  no_position: { zh: '尚未取得目前位置,請先跳點到一個座標', en: 'No current position, teleport to a coordinate first' },
  tunnel_lost: { zh: 'WiFi Tunnel 連線中斷,請重新建立', en: 'Wi-Fi tunnel dropped, please reconnect' },
  cooldown_active: { zh: '冷卻中,請等待後再跳點', en: 'Cooldown active, wait before teleporting' },
  repair_needs_usb: { zh: '重新配對需要 USB, 請先用線連接 iPhone', en: 'Re-pair needs USB, please connect the iPhone first' },
  usbmux_unavailable: { zh: '無法列出 USB 裝置,請確認驅動與 Apple Mobile Device Service 是否正常', en: 'Cannot list USB devices, check iTunes/Apple Mobile Device Service' },
  trust_failed: { zh: 'USB 信任失敗, 請在 iPhone 上點「信任」後再試', en: 'USB trust failed, tap Trust on the iPhone and retry' },
  remote_pair_failed: { zh: 'RemotePairing 記錄重建失敗, 請以系統管理員身分重啟 GPSController', en: 'RemotePairing record rebuild failed, restart GPSController as Administrator' },
  device_lost: { zh: '裝置連線中斷(USB 拔除或 Tunnel 死亡),請重新插上 USB 後再操作', en: 'Device connection lost (USB unplugged or tunnel died), please reconnect USB and try again' },
  max_devices_reached: {
    zh: '已連接最多 2 台裝置',
    en: 'Maximum 2 devices connected',
  },
  ios_unsupported: {
    zh: '裝置 iOS 版本過舊,GPSController 僅支援 iOS 16 以上。請升級 iOS 後再試。',
    en: 'This device runs an unsupported iOS version. GPSController requires iOS 16 or later. Please update and try again.',
  },
}

function currentLang(): 'zh' | 'en' {
  try {
    const v = localStorage.getItem(STORAGE_KEYS.lang)
    if (v === 'en' || v === 'zh') return v
  } catch { /* ignore */ }
  return (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('zh')) ? 'zh' : 'en'
}

/** Structured error returned in the response envelope. */
interface ApiError {
  code?: string
  message?: string
}

/** Standard `{success, data, error, meta}` envelope per
 * `~/.claude/rules/common/patterns.md`. Every JSON response from the
 * backend is wrapped in this shape; `request()` unwraps `data` so
 * callers see only the inner type they asked for. */
interface ApiEnvelope<T> {
  success: boolean
  data: T | null
  error: ApiError | null
  meta?: { total?: number; page?: number; limit?: number } | null
}

function isEnvelope(body: unknown): body is ApiEnvelope<unknown> {
  return (
    body !== null &&
    typeof body === 'object' &&
    'success' in body &&
    'data' in body &&
    'error' in body
  )
}

function formatError(error: unknown, fallback: string): string {
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const e = error as ApiError
    if (e.code && ERROR_I18N[e.code]) return ERROR_I18N[e.code][currentLang()]
    if (e.message) return e.message
  }
  return fallback
}

/**
 * Read the session auth token. In the packaged Electron build the token
 * is held by the main process and fetched once via the
 * `session:get-token` IPC handshake (see frontend/electron/preload.js
 * and frontend/electron/main.js). The bridge exposes it as the async
 * `window.gpsController.getSessionToken()`. In Vite dev mode the
 * backend is expected to run with GPSCONTROLLER_DEV_NOAUTH=1, so when
 * the bridge is absent we resolve to an empty string — empty token is
 * accepted by the dev backend.
 *
 * The first call performs the IPC round-trip; subsequent calls return
 * the cached promise so the token isn't refetched on every request.
 */
let authTokenPromise: Promise<string> | null = null

function getAuthToken(): Promise<string> {
  if (authTokenPromise) return authTokenPromise
  const bridge = (globalThis as unknown as {
    gpsController?: { getSessionToken?: () => Promise<unknown> }
  }).gpsController
  if (!bridge || typeof bridge.getSessionToken !== 'function') {
    authTokenPromise = Promise.resolve('')
    return authTokenPromise
  }
  authTokenPromise = bridge
    .getSessionToken()
    .then((value) => (typeof value === 'string' ? value : ''))
    .catch(() => '')
  return authTokenPromise
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = await getAuthToken()
  if (token) headers['X-GPS-Token'] = token
  const opts: RequestInit = { method, headers }
  if (body !== undefined) opts.body = JSON.stringify(body)
  const res = await fetchWithRetry(`${API}${path}`, opts)
  // Single .json() read regardless of status — the envelope shape is the
  // same on success and on failure (just `success`/`data`/`error` fields
  // flipped), so we don't need to branch before parsing.
  const parsed: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    if (isEnvelope(parsed)) {
      throw new Error(formatError(parsed.error, res.statusText))
    }
    // Backend should always emit the envelope; this branch only fires if a
    // proxy / dev-server intercepts the response and returns its own body.
    throw new Error(res.statusText || `HTTP ${res.status}`)
  }
  if (!isEnvelope(parsed) || parsed.success !== true) {
    // 200 with a non-envelope body means we hit a non-API endpoint or the
    // backend version is older than this client expects.
    throw new Error('Malformed API response (missing envelope)')
  }
  return parsed.data as T
}

// Device
export const listDevices = () => request<DeviceInfo[]>('GET', '/api/device/list')
export const connectDevice = (udid: string) => request<StatusResponse>('POST', `/api/device/${udid}/connect`)
export const disconnectDevice = (udid: string) => request<StatusResponse>('DELETE', `/api/device/${udid}/connect`)
export const forgetDevice = (udid: string) =>
  request<{ status: string; udid: string; removed: string[] }>('DELETE', `/api/device/${udid}/pair`)
export const clearAutoReconnectBlocks = () =>
  request<{ status: string }>('POST', '/api/device/auto-reconnect/reset')
export interface WifiConnectResponse {
  status: string
  udid: string
  name: string
  ios_version: string
  connection_type?: string
}
export const wifiConnect = (ip: string) => request<WifiConnectResponse>('POST', '/api/device/wifi/connect', { ip })
export const wifiScan = () => request<WifiScanResult[]>('GET', '/api/device/wifi/scan')
export const wifiTunnelStartAndConnect = (ip: string, port = DEFAULT_TUNNEL_PORT, udid?: string) =>
  request<WifiConnectResponse & WifiTunnelStatus>('POST', '/api/device/wifi/tunnel/start-and-connect', { ip, port, ...(udid ? { udid } : {}) })
export const wifiTunnelStatus = () => request<WifiTunnelStatus>('GET', '/api/device/wifi/tunnel/status')
export const wifiTunnelDiscover = () => request<{ devices: { ip: string; port: number; host: string; name: string }[] }>('GET', '/api/device/wifi/tunnel/discover')
export const wifiTunnelStop = () => request<StatusResponse>('POST', '/api/device/wifi/tunnel/stop')
export const wifiRepair = () => request<{ status: string; udid: string; name: string; ios_version: string; remote_record_regenerated: boolean }>('POST', '/api/device/wifi/repair')
export const revealDeveloperMode = (udid: string) =>
  request<{ status: string; udid: string }>(
    'POST',
    `/api/device/${encodeURIComponent(udid)}/amfi/reveal-developer-mode`,
  )

// Location simulation
// Every action accepts an optional `udid` so the caller can target a specific
// device in group mode. When omitted, the backend routes to the primary engine.
const ud = (udid?: string | null) => (udid ? { udid } : {})
const qs = (udid?: string | null) => (udid ? `?udid=${encodeURIComponent(udid)}` : '')

export const teleport = (lat: number, lng: number, udid?: string) =>
  request<StatusResponse>('POST', '/api/location/teleport', { lat, lng, ...ud(udid) })
export interface SpeedOpts { speed_kmh?: number | null; speed_min_kmh?: number | null; speed_max_kmh?: number | null }
export interface PauseOpts { pause_enabled?: boolean; pause_min?: number; pause_max?: number }
const sp = (o?: SpeedOpts) => ({
  speed_kmh: o?.speed_kmh ?? null,
  speed_min_kmh: o?.speed_min_kmh ?? null,
  speed_max_kmh: o?.speed_max_kmh ?? null,
})
const pp = (o?: PauseOpts) => (o ? {
  pause_enabled: o.pause_enabled ?? true,
  pause_min: o.pause_min ?? 5,
  pause_max: o.pause_max ?? 20,
} : {})
const sl = (v?: boolean) => (v ? { straight_line: true } : {})
export const navigate = (lat: number, lng: number, mode: string, speed?: SpeedOpts, udid?: string, straightLine?: boolean) =>
  request<StatusResponse>('POST', '/api/location/navigate', { lat, lng, mode, ...sp(speed), ...sl(straightLine), ...ud(udid) })
// lap_count is `null` = unlimited (matches backend Field default). Only
// included in the payload when a positive target is set, so existing
// backend contracts keep working for callers that don't care.
const lc = (lapCount?: number | null) =>
  lapCount != null && lapCount > 0 ? { lap_count: lapCount } : {}

export const startLoop = (waypoints: { lat: number; lng: number }[], mode: string, speed?: SpeedOpts, pause?: PauseOpts, udid?: string, straightLine?: boolean, lapCount?: number | null) =>
  request<StatusResponse>('POST', '/api/location/loop', { waypoints, mode, ...sp(speed), ...pp(pause), ...sl(straightLine), ...ud(udid), ...lc(lapCount) })
export const multiStop = (waypoints: { lat: number; lng: number }[], mode: string, stop_duration: number, loop: boolean, speed?: SpeedOpts, pause?: PauseOpts, udid?: string, straightLine?: boolean, lapCount?: number | null) =>
  request<StatusResponse>('POST', '/api/location/multistop', { waypoints, mode, stop_duration, loop, ...sp(speed), ...pp(pause), ...sl(straightLine), ...ud(udid), ...lc(lapCount) })
export const randomWalk = (center: { lat: number; lng: number }, radius_m: number, mode: string, speed?: SpeedOpts, pause?: PauseOpts, udid?: string, seed?: number | null, straightLine?: boolean) =>
  request<StatusResponse>('POST', '/api/location/randomwalk', { center, radius_m, mode, ...sp(speed), ...pp(pause), ...sl(straightLine), ...ud(udid), ...(seed != null ? { seed } : {}) })
export const joystickStart = (mode: string, udid?: string) =>
  request<StatusResponse>('POST', '/api/location/joystick/start', { mode, ...ud(udid) })
export const joystickStop = (udid?: string) => request<StatusResponse>('POST', `/api/location/joystick/stop${qs(udid)}`)
export const pauseSim = (udid?: string) => request<StatusResponse>('POST', `/api/location/pause${qs(udid)}`)
export const resumeSim = (udid?: string) => request<StatusResponse>('POST', `/api/location/resume${qs(udid)}`)
export const restoreSim = (udid?: string) => request<StatusResponse>('POST', `/api/location/restore${qs(udid)}`)
export const stopSim = (udid?: string) => request<StatusResponse>('POST', `/api/location/stop${qs(udid)}`)
export interface SimulationStatusResponse {
  running?: boolean
  paused?: boolean
  speed?: number
  mode?: string
  position?: { lat: number; lng: number } | null
  destination?: { lat: number; lng: number } | null
  progress?: number
  eta_seconds?: number | null
  [key: string]: unknown
}
export const getStatus = (udid?: string) =>
  request<SimulationStatusResponse>('GET', `/api/location/status${qs(udid)}`)

// Cooldown
/**
 * Mirrors the backend `CooldownStatus` Pydantic model
 * (`backend/models/schemas.py`). The status route returns this shape via
 * `response_model=CooldownStatus`, so the snake_case keys are authoritative.
 */
export interface CooldownStatusResponse {
  enabled: boolean
  is_active: boolean
  remaining_seconds: number
  total_seconds: number
  distance_km: number
}
export const getCooldownStatus = () =>
  request<CooldownStatusResponse>('GET', '/api/location/cooldown/status')
export const setCooldownEnabled = (enabled: boolean) =>
  request<StatusResponse>('PUT', '/api/location/cooldown/settings', { enabled })
export const dismissCooldown = () => request<StatusResponse>('POST', '/api/location/cooldown/dismiss')

// Coord format
export const getCoordFormat = () => request<{ format: string }>('GET', '/api/location/settings/coord-format')
export const setCoordFormat = (format: string) =>
  request<StatusResponse>('PUT', '/api/location/settings/coord-format', { format })

// Geocoding
export interface ReverseGeocodeResult {
  display_name: string
  lat: number
  lng: number
  type: string
  importance: number
  country_code: string  // ISO 3166-1 alpha-2 lowercase, '' if unknown
  country: string       // localized country name
  /** Short human label (POI > road > neighbourhood > …); empty string if
   *  Nominatim has no usable label for the coordinate. */
  place_name?: string
}

export const searchAddress = (q: string) => request<AddressSearchResult[]>('GET', `/api/geocode/search?q=${encodeURIComponent(q)}`)
export const reverseGeocode = (lat: number, lng: number, lang?: string) =>
  request<ReverseGeocodeResult | null>(
    'GET',
    `/api/geocode/reverse?lat=${lat}&lng=${lng}${lang ? `&lang=${encodeURIComponent(lang)}` : ''}`,
  )

// Bookmarks
export const getBookmarks = () => request<BookmarkStore>('GET', '/api/bookmarks')
export const createBookmark = (bm: Omit<Bookmark, 'id'>) => request<Bookmark>('POST', '/api/bookmarks', bm)
export const updateBookmark = (id: string, bm: Partial<Bookmark>) => request<Bookmark>('PUT', `/api/bookmarks/${id}`, bm)
export const deleteBookmark = (id: string) => request<StatusResponse>('DELETE', `/api/bookmarks/${id}`)
export const deleteBookmarksBatch = (ids: string[]) =>
  request<{ deleted: number; requested: number }>('POST', '/api/bookmarks/batch-delete', { ids })
export const backfillBookmarkFlags = () =>
  request<{ filled: number }>('POST', '/api/bookmarks/backfill-flags')
export const moveBookmarks = (ids: string[], placeId: string) =>
  request<{ moved: number }>('POST', '/api/bookmarks/move', { bookmark_ids: ids, target_place_id: placeId })
export const tagBookmarks = (ids: string[], add: string[] = [], remove: string[] = []) =>
  request<{ tagged: number }>('POST', '/api/bookmarks/tag', {
    bookmark_ids: ids,
    tag_ids_add: add,
    tag_ids_remove: remove,
  })

// Places (single-axis, "where")
export const getPlaces = () => request<BookmarkPlace[]>('GET', '/api/bookmarks/places')
export const createPlace = (p: Omit<BookmarkPlace, 'id'>) => request<BookmarkPlace>('POST', '/api/bookmarks/places', p)
export const updatePlace = (id: string, p: Partial<BookmarkPlace>) => request<BookmarkPlace>('PUT', `/api/bookmarks/places/${id}`, p)
export const deletePlace = (id: string) => request<StatusResponse>('DELETE', `/api/bookmarks/places/${id}`)
export const reorderPlaces = (orderedIds: string[]) =>
  request<{ reordered: number }>('POST', '/api/bookmarks/places/reorder', { ordered_ids: orderedIds })

// Tags (multi-axis, "what")
export const getTags = () => request<BookmarkTag[]>('GET', '/api/bookmarks/tags')
export const createTag = (t: Omit<BookmarkTag, 'id'>) => request<BookmarkTag>('POST', '/api/bookmarks/tags', t)
export const updateTag = (id: string, t: Partial<BookmarkTag>) => request<BookmarkTag>('PUT', `/api/bookmarks/tags/${id}`, t)
export const deleteTag = (id: string) => request<StatusResponse>('DELETE', `/api/bookmarks/tags/${id}`)
export const reorderTags = (orderedIds: string[]) =>
  request<{ reordered: number }>('POST', '/api/bookmarks/tags/reorder', { ordered_ids: orderedIds })

export const bookmarksExportUrl = () => `${API}/api/bookmarks/export`
export const importBookmarks = (data: BookmarkStore) => request<{ imported: number }>('POST', '/api/bookmarks/import', data)

export const getInitialPosition = () =>
  request<{ position: { lat: number; lng: number } | null }>('GET', '/api/location/settings/initial-position')
export const setInitialPosition = (lat: number | null, lng: number | null) =>
  request<{ position: { lat: number; lng: number } | null }>('PUT', '/api/location/settings/initial-position', { lat, lng })

// Last device position before the previous shutdown — used to pre-render
// the current-position pin on startup without pushing anything to the iPhone.
export const getLastDevicePosition = () =>
  request<{ position: { lat: number; lng: number } | null }>('GET', '/api/location/last-device-position')

export const openLog = () => request<{ status: string; path: string }>('POST', '/api/system/open-log')
export const openLogFolder = () => request<{ status: string; path: string }>('POST', '/api/system/open-log-folder')

export const applySpeed = (mode: string, opts: SpeedOpts, udid?: string) =>
  request<{ status: string; speed_mps: number }>('POST', '/api/location/apply-speed', {
    mode,
    speed_kmh: opts.speed_kmh ?? null,
    speed_min_kmh: opts.speed_min_kmh ?? null,
    speed_max_kmh: opts.speed_max_kmh ?? null,
    ...ud(udid),
  })

// Routes
interface LatLng { lat: number; lng: number }
export interface RoutePlanResponse {
  coordinates: LatLng[]
  distance_m?: number
  duration_s?: number
}
export const planRoute = (start: LatLng, end: LatLng, profile: string) =>
  request<RoutePlanResponse>('POST', '/api/route/plan', { start, end, profile })
export const getSavedRoutes = () => request<SavedRoute[]>('GET', '/api/route/saved')
export const saveRoute = (route: Omit<SavedRoute, 'id' | 'created_at'>) =>
  request<SavedRoute>('POST', '/api/route/saved', route)
export const deleteRoute = (id: string) => request<StatusResponse>('DELETE', `/api/route/saved/${id}`)
export const renameRoute = (id: string, name: string) => request<SavedRoute>('PATCH', `/api/route/saved/${id}`, { name })

// GPX import/export
export async function importGpx(file: File): Promise<{ status: string; id: string; points: number }> {
  const form = new FormData()
  form.append('file', file)
  const token = await getAuthToken()
  const headers: Record<string, string> = {}
  if (token) headers['X-GPS-Token'] = token
  const res = await fetch(`${API}/api/route/gpx/import`, { method: 'POST', body: form, headers })
  const parsed: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    if (isEnvelope(parsed)) {
      throw new Error(formatError(parsed.error, res.statusText))
    }
    throw new Error(res.statusText || `HTTP ${res.status}`)
  }
  if (!isEnvelope(parsed) || parsed.success !== true) {
    throw new Error('Malformed API response (missing envelope)')
  }
  return parsed.data as { status: string; id: string; points: number }
}

export function exportGpxUrl(routeId: string): string {
  return `${API}/api/route/gpx/export/${routeId}`
}

// Bulk JSON export / import for saved routes
export function exportAllRoutesUrl(): string {
  return `${API}/api/route/saved/export`
}

export const importAllRoutes = (data: { routes: SavedRoute[] }) =>
  request<{ imported: number }>('POST', '/api/route/saved/import', data)
