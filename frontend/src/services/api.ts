const API = 'http://127.0.0.1:8777'

// Connection-refused means backend isn't up yet — retry with backoff.
// Other HTTP errors (4xx/5xx) are real errors and propagate immediately.
async function fetchWithRetry(url: string, opts: RequestInit, maxAttempts = 15): Promise<Response> {
  let lastErr: unknown
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fetch(url, opts)
    } catch (e) {
      lastErr = e
      const delay = Math.min(500 + i * 300, 2000)
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  throw lastErr ?? new Error('fetch failed')
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const opts: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  }
  if (body !== undefined) opts.body = JSON.stringify(body)
  const res = await fetchWithRetry(`${API}${path}`, opts)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || res.statusText)
  }
  return res.json()
}

// Device
export const listDevices = () => request<any[]>('GET', '/api/device/list')
export const connectDevice = (udid: string) => request<any>('POST', `/api/device/${udid}/connect`)
export const disconnectDevice = (udid: string) => request<any>('DELETE', `/api/device/${udid}/connect`)
export const wifiConnect = (ip: string) => request<any>('POST', '/api/device/wifi/connect', { ip })
export const wifiScan = () => request<any[]>('GET', '/api/device/wifi/scan')
export const wifiTunnelStartAndConnect = (ip: string, port = 49152, udid?: string) =>
  request<any>('POST', '/api/device/wifi/tunnel/start-and-connect', { ip, port, ...(udid ? { udid } : {}) })
export const wifiTunnelStatus = () => request<any>('GET', '/api/device/wifi/tunnel/status')
export const wifiTunnelDiscover = () => request<{ devices: { ip: string; port: number; host: string; name: string }[] }>('GET', '/api/device/wifi/tunnel/discover')
export const wifiTunnelStop = () => request<any>('POST', '/api/device/wifi/tunnel/stop')

// Location simulation
export const teleport = (lat: number, lng: number) =>
  request<any>('POST', '/api/location/teleport', { lat, lng })
export interface SpeedOpts { speed_kmh?: number | null; speed_min_kmh?: number | null; speed_max_kmh?: number | null }
const sp = (o?: SpeedOpts) => ({
  speed_kmh: o?.speed_kmh ?? null,
  speed_min_kmh: o?.speed_min_kmh ?? null,
  speed_max_kmh: o?.speed_max_kmh ?? null,
})
export const navigate = (lat: number, lng: number, mode: string, speed?: SpeedOpts) =>
  request<any>('POST', '/api/location/navigate', { lat, lng, mode, ...sp(speed) })
export const startLoop = (waypoints: { lat: number; lng: number }[], mode: string, speed?: SpeedOpts) =>
  request<any>('POST', '/api/location/loop', { waypoints, mode, ...sp(speed) })
export const multiStop = (waypoints: { lat: number; lng: number }[], mode: string, stop_duration: number, loop: boolean, speed?: SpeedOpts) =>
  request<any>('POST', '/api/location/multistop', { waypoints, mode, stop_duration, loop, ...sp(speed) })
export const randomWalk = (center: { lat: number; lng: number }, radius_m: number, mode: string, speed?: SpeedOpts) =>
  request<any>('POST', '/api/location/randomwalk', { center, radius_m, mode, ...sp(speed) })
export const joystickStart = (mode: string) =>
  request<any>('POST', '/api/location/joystick/start', { mode })
export const joystickStop = () => request<any>('POST', '/api/location/joystick/stop')
export const pauseSim = () => request<any>('POST', '/api/location/pause')
export const resumeSim = () => request<any>('POST', '/api/location/resume')
export const restoreSim = () => request<any>('POST', '/api/location/restore')
export const getStatus = () => request<any>('GET', '/api/location/status')

// Cooldown
export const getCooldownStatus = () => request<any>('GET', '/api/location/cooldown/status')
export const setCooldownEnabled = (enabled: boolean) =>
  request<any>('PUT', '/api/location/cooldown/settings', { enabled })
export const dismissCooldown = () => request<any>('POST', '/api/location/cooldown/dismiss')

// Coord format
export const getCoordFormat = () => request<any>('GET', '/api/location/settings/coord-format')
export const setCoordFormat = (format: string) =>
  request<any>('PUT', '/api/location/settings/coord-format', { format })

// Geocoding
export const searchAddress = (q: string) => request<any[]>('GET', `/api/geocode/search?q=${encodeURIComponent(q)}`)
export const reverseGeocode = (lat: number, lng: number) =>
  request<any>('GET', `/api/geocode/reverse?lat=${lat}&lng=${lng}`)

// Bookmarks
export const getBookmarks = () => request<any>('GET', '/api/bookmarks')
export const createBookmark = (bm: any) => request<any>('POST', '/api/bookmarks', bm)
export const updateBookmark = (id: string, bm: any) => request<any>('PUT', `/api/bookmarks/${id}`, bm)
export const deleteBookmark = (id: string) => request<any>('DELETE', `/api/bookmarks/${id}`)
export const moveBookmarks = (ids: string[], catId: string) =>
  request<any>('POST', '/api/bookmarks/move', { bookmark_ids: ids, target_category_id: catId })
export const getCategories = () => request<any[]>('GET', '/api/bookmarks/categories')
export const createCategory = (cat: any) => request<any>('POST', '/api/bookmarks/categories', cat)
export const updateCategory = (id: string, cat: any) => request<any>('PUT', `/api/bookmarks/categories/${id}`, cat)
export const deleteCategory = (id: string) => request<any>('DELETE', `/api/bookmarks/categories/${id}`)

// Routes
export const planRoute = (start: any, end: any, profile: string) =>
  request<any>('POST', '/api/route/plan', { start, end, profile })
export const getSavedRoutes = () => request<any[]>('GET', '/api/route/saved')
export const saveRoute = (route: any) => request<any>('POST', '/api/route/saved', route)
export const deleteRoute = (id: string) => request<any>('DELETE', `/api/route/saved/${id}`)
