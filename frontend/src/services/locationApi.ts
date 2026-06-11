/**
 * Location-simulation endpoints (`/api/location/*`): teleport, navigation,
 * loops, joystick, status, cooldown, speed, and location-related settings.
 */
import { DEFAULT_PAUSE } from '../lib/constants'
import { request, type StatusResponse } from './http'

// Every action accepts an optional `udid` so the caller can target a specific
// device in group mode. When omitted, the backend routes to the primary engine.
const ud = (udid?: string | null) => (udid ? { udid } : {})
const qs = (udid?: string | null) => (udid ? `?udid=${encodeURIComponent(udid)}` : '')

export const teleport = (lat: number, lng: number, udid?: string, autoJitter?: boolean) =>
  request<StatusResponse>('POST', '/api/location/teleport', { lat, lng, ...ud(udid), ...(autoJitter ? { auto_jitter: true } : {}) })
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

export const getInitialPosition = () =>
  request<{ position: { lat: number; lng: number } | null }>('GET', '/api/location/settings/initial-position')
export const setInitialPosition = (lat: number | null, lng: number | null) =>
  request<{ position: { lat: number; lng: number } | null }>('PUT', '/api/location/settings/initial-position', { lat, lng })

// WiFi-tunnel keep-alive (opt-in). When enabled, the backend periodically
// re-asserts idle virtual locations so the tunnel survives the iPhone screen
// dimming. Persisted server-side in settings.json.
export const getWifiKeepalive = () =>
  request<{ enabled: boolean }>('GET', '/api/location/settings/wifi-keepalive')
export const setWifiKeepalive = (enabled: boolean) =>
  request<{ enabled: boolean }>('PUT', '/api/location/settings/wifi-keepalive', { enabled })

// Last device position before the previous shutdown — used to pre-render
// the current-position pin on startup without pushing anything to the iPhone.
export const getLastDevicePosition = () =>
  request<{ position: { lat: number; lng: number } | null }>('GET', '/api/location/last-device-position')

export const applySpeed = (mode: string, opts: SpeedOpts, udid?: string) =>
  request<{ status: string; speed_mps: number }>('POST', '/api/location/apply-speed', {
    mode,
    speed_kmh: opts.speed_kmh ?? null,
    speed_min_kmh: opts.speed_min_kmh ?? null,
    speed_max_kmh: opts.speed_max_kmh ?? null,
    ...ud(udid),
  })

// Gold Ditto (拉金盆) one-shot cycle — pushes simulated GPS to ``lat,lng``
// then immediately restores real GPS. See backend core/gold_ditto.py.
export const goldDittoCycle = (lat: number, lng: number, udid?: string) =>
  request<StatusResponse>('POST', '/api/location/gold-ditto',
    udid ? { lat, lng, udid } : { lat, lng })
