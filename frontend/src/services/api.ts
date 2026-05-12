import { STORAGE_KEYS } from '../lib/storage-keys'
import {
  API_BASE,
  DEFAULT_PAUSE,
  DEFAULT_TUNNEL_PORT,
  RETRY_BACKOFF_INITIAL_MS,
  RETRY_BACKOFF_MAX_MS,
  RETRY_BACKOFF_STEP_MS,
} from '../lib/constants'
import { devWarn } from '../lib/dev-log'
import { STRINGS } from '../i18n/strings'
import type { Bookmark, BookmarkPlace, BookmarkTag } from '../hooks/useBookmarks'
import type { DeviceInfo } from '../hooks/useDevice'
import type { LatLng } from '../hooks/sim/types'

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
  /** Added in route-store v1; legacy rows back-fill to "default". */
  category_id?: string
  /** Mirrors created_at on first save; bumped on rename/move/overwrite. */
  updated_at?: string
  /** Explicit drag-reorder position; legacy rows default to 0. */
  sort_order?: number
}

/** Route bucket — mirrors BookmarkPlace shape on purpose so the
 *  category-strip component can be shared. */
export interface RouteCategory {
  id: string
  name: string
  color: string
  sort_order: number
  created_at: string
}

/** Saved-route conflict policy mirroring backend `ConflictPolicy`. */
export type RouteConflictPolicy = 'new' | 'overwrite' | 'reject'

/** Detail body the backend ships with a 409 ROUTE_NAME_CONFLICT so the
 *  overwrite-prompt has enough context without a follow-up GET. */
export interface RouteNameConflictDetail {
  code: 'route_name_conflict'
  message: string
  existing_id: string | null
  existing_created_at: string | null
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

// Latched once when localStorage throws so the navigator-language fallback
// path doesn't silently hide a sandboxed-storage misconfiguration in dev.
//
// Test isolation: this module-level latch persists across `currentLang()`
// calls within a single Vitest module run; tests that need to assert the
// warning fires more than once should reset module state via vi.resetModules()
// between cases.
let warnedLocalStorage = false

function currentLang(): 'zh' | 'en' {
  try {
    const v = localStorage.getItem(STORAGE_KEYS.lang)
    if (v === 'en' || v === 'zh') return v
  } catch (e) {
    if (!warnedLocalStorage) {
      warnedLocalStorage = true
      devWarn('[api.currentLang] localStorage unavailable, falling back to navigator.language', e)
    }
  }
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
    if (e.code) {
      // Look up `err.<code>` in the central translation table — single
      // source of truth for both UI strings and backend-error messages.
      const key = `err.${e.code}` as keyof typeof STRINGS
      const entry = STRINGS[key] as { zh?: string; en?: string } | undefined
      if (entry) {
        return entry[currentLang()] ?? entry.zh ?? entry.en ?? fallback
      }
    }
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
 * The cache is invalidated on a 401 response (see `authedFetch`) so a
 * rotated session token is picked up automatically without a reload.
 */
// Test isolation: this cache is a module-level singleton. Tests that need
// to exercise multiple bridge states must reset it via vi.resetModules() or
// `invalidateAuthToken()` (used in production by the 401 handler) between cases.
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

/** Force the next `getAuthToken()` call to re-fetch from the bridge. */
function invalidateAuthToken(): void {
  authTokenPromise = null
}

/**
 * Issue a fetch with the current session token attached. If the server
 * answers 401 we drop the cached token, fetch a fresh one, and retry
 * exactly once. A second 401 (e.g. wrong shared secret) propagates to
 * the caller as a normal error response — no infinite retry loop.
 *
 * `buildInit` is invoked per attempt so callers that need fresh request
 * bodies / FormData per try can rebuild them. The argument receives the
 * headers object pre-populated with `X-GPS-Token` so the caller only
 * needs to layer on its own (e.g. `Content-Type`).
 */
async function authedFetch(
  url: string,
  buildInit: (headers: Record<string, string>) => RequestInit,
): Promise<Response> {
  const attempt = async (): Promise<Response> => {
    const headers: Record<string, string> = {}
    const token = await getAuthToken()
    if (token) headers['X-GPS-Token'] = token
    return fetchWithRetry(url, buildInit(headers))
  }
  const res = await attempt()
  if (res.status !== 401) return res
  invalidateAuthToken()
  return attempt()
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await authedFetch(`${API}${path}`, (headers) => {
    headers['Content-Type'] = 'application/json'
    const opts: RequestInit = { method, headers }
    if (body !== undefined) opts.body = JSON.stringify(body)
    return opts
  })
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
  request<{
    status: string
    udid: string
    removed: string[]
    // Populated when at least one pair-record path could not be unlinked
    // (e.g. /var/db/lockdown needs root on macOS). When present and non-
    // empty the backend returns status: "partial" — the UI can warn the
    // user that the iPhone still trusts this host until the file goes.
    failed?: { path: string; error: string }[]
  }>('DELETE', `/api/device/${udid}/pair`)
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
  pause_enabled: o.pause_enabled ?? DEFAULT_PAUSE.enabled,
  pause_min: o.pause_min ?? DEFAULT_PAUSE.min,
  pause_max: o.pause_max ?? DEFAULT_PAUSE.max,
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

/**
 * Download an authenticated GET as a file. Goes through `authedFetch`
 * so the `X-GPS-Token` header is attached and stale-token retry kicks
 * in — `<a href>` / `window.open` cannot do either, so the URL-only
 * helpers we used to expose 401'd silently and the user got a blank
 * tab. The Blob URL is revoked once the click is dispatched so we
 * don't leak per-export memory.
 */
async function downloadAuthed(path: string, filename: string): Promise<void> {
  const res = await authedFetch(`${API}${path}`, (headers) => ({ method: 'GET', headers }))
  if (!res.ok) {
    // Try to surface a structured error from the standard envelope
    // first; fall back to the bare HTTP status if the response isn't
    // JSON (e.g. a proxy intercepted it).
    const parsed: unknown = await res.json().catch(() => null)
    if (isEnvelope(parsed)) {
      throw new Error(formatError(parsed.error, res.statusText))
    }
    throw new Error(res.statusText || `HTTP ${res.status}`)
  }
  const blob = await res.blob()
  const blobUrl = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = filename
    a.rel = 'noopener'
    a.click()
  } finally {
    URL.revokeObjectURL(blobUrl)
  }
}

export const downloadBookmarksExport = (filename: string) =>
  downloadAuthed('/api/bookmarks/export', filename)
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
export interface RoutePlanResponse {
  coordinates: LatLng[]
  distance_m?: number
  duration_s?: number
}
export const planRoute = (start: LatLng, end: LatLng, profile: string) =>
  request<RoutePlanResponse>('POST', '/api/route/plan', { start, end, profile })
export const getSavedRoutes = () => request<SavedRoute[]>('GET', '/api/route/saved')
export const saveRoute = (
  route: Omit<SavedRoute, 'id' | 'created_at' | 'updated_at' | 'sort_order'>,
  onConflict: RouteConflictPolicy = 'new',
) => request<SavedRoute>('POST', `/api/route/saved?on_conflict=${onConflict}`, route)
export const deleteRoute = (id: string) => request<StatusResponse>('DELETE', `/api/route/saved/${id}`)
export const renameRoute = (id: string, name: string) => request<SavedRoute>('PATCH', `/api/route/saved/${id}`, { name })

// Route categories (v0.2.133)
export const getRouteCategories = () =>
  request<RouteCategory[]>('GET', '/api/route/saved/categories')
export const createRouteCategory = (name: string, color: string) =>
  request<RouteCategory>('POST', '/api/route/saved/categories', { name, color })
export const updateRouteCategory = (id: string, patch: { name?: string; color?: string }) =>
  request<RouteCategory>('PUT', `/api/route/saved/categories/${id}`, patch)
export const deleteRouteCategory = (id: string) =>
  request<StatusResponse>('DELETE', `/api/route/saved/categories/${id}`)
export const batchDeleteRoutes = (routeIds: string[]) =>
  request<{ deleted: number }>('POST', '/api/route/saved/batch-delete', { route_ids: routeIds })
export const moveRoutesToCategory = (routeIds: string[], targetCategoryId: string) =>
  request<{ moved: number }>('POST', '/api/route/saved/move', {
    route_ids: routeIds, target_category_id: targetCategoryId,
  })

// Drag-reorder (v0.2.146)
export const reorderRoutes = (orderedIds: string[]) =>
  request<{ reordered: number }>('POST', '/api/route/saved/reorder', { ordered_ids: orderedIds })
export const reorderRouteCategories = (orderedIds: string[]) =>
  request<{ reordered: number }>(
    'POST', '/api/route/saved/categories/reorder', { ordered_ids: orderedIds },
  )
export const reorderBookmarks = (orderedIds: string[]) =>
  request<{ reordered: number }>('POST', '/api/bookmarks/reorder', { ordered_ids: orderedIds })

// GPX import/export
export async function importGpx(file: File): Promise<{ status: string; id: string; points: number }> {
  // Rebuild FormData per attempt — `authedFetch` may retry on 401 and
  // a consumed body cannot be replayed safely.
  const res = await authedFetch(`${API}/api/route/gpx/import`, (headers) => {
    const form = new FormData()
    form.append('file', file)
    return { method: 'POST', body: form, headers }
  })
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

export const downloadGpx = (routeId: string, filename: string) =>
  downloadAuthed(`/api/route/gpx/export/${encodeURIComponent(routeId)}`, filename)

// Bulk JSON export / import for saved routes
export const downloadAllRoutes = (filename: string) =>
  downloadAuthed('/api/route/saved/export', filename)

export const importAllRoutes = (data: { routes: SavedRoute[] }) =>
  request<{ imported: number }>('POST', '/api/route/saved/import', data)
