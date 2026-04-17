import { useEffect, useState } from 'react'

export type WeatherIcon = 'sun' | 'cloud' | 'cloud-sun' | 'fog' | 'rain' | 'snow' | 'thunder'

export interface WeatherSnapshot {
  temperatureC: number
  weatherCode: number
  icon: WeatherIcon
  isDay: boolean
  fetchedAt: number
}

interface UseWeatherOptions {
  /** Pause fetching while simulation is active. The cached value is
   *  returned unchanged until the hook is unpaused. */
  paused?: boolean
}

interface CacheEntry {
  snapshot: WeatherSnapshot
  expires: number
}

// Static module cache keyed by rounded (lat, lng) — the whole app
// mounts at most one status bar, but keeping the cache module-scoped
// lets late-mount consumers benefit from the same recent lookup
// without duplicate network calls.
const cache = new Map<string, CacheEntry>()
const TTL_MS = 5 * 60 * 1000
const COORD_BUCKET = 0.1

function cacheKey(lat: number, lng: number): string {
  const rl = Math.round(lat / COORD_BUCKET) * COORD_BUCKET
  const rg = Math.round(lng / COORD_BUCKET) * COORD_BUCKET
  return `${rl.toFixed(1)},${rg.toFixed(1)}`
}

// Open-Meteo WMO weather codes → glyph bucket. Ranges sourced from
// https://open-meteo.com/en/docs (weathercode appendix).
function codeToIcon(code: number): WeatherIcon {
  if (code === 0) return 'sun'
  if (code >= 1 && code <= 2) return 'cloud-sun'
  if (code === 3) return 'cloud'
  if (code >= 45 && code <= 48) return 'fog'
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain'
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return 'snow'
  if (code >= 95 && code <= 99) return 'thunder'
  return 'cloud'
}

export function useWeather(
  pos: { lat: number; lng: number } | null,
  options: UseWeatherOptions = {},
): WeatherSnapshot | null {
  const { paused = false } = options
  const [snapshot, setSnapshot] = useState<WeatherSnapshot | null>(null)

  useEffect(() => {
    if (!pos || paused) return
    const key = cacheKey(pos.lat, pos.lng)
    const now = Date.now()
    const hit = cache.get(key)
    if (hit && hit.expires > now) {
      setSnapshot(hit.snapshot)
      return
    }

    let cancelled = false
    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${pos.lat.toFixed(2)}&longitude=${pos.lng.toFixed(2)}` +
      `&current_weather=true`
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: unknown) => {
        if (cancelled) return
        const cw = (data as { current_weather?: { temperature?: number; weathercode?: number; is_day?: number } }).current_weather
        if (!cw || typeof cw.temperature !== 'number' || typeof cw.weathercode !== 'number') return
        const snap: WeatherSnapshot = {
          temperatureC: cw.temperature,
          weatherCode: cw.weathercode,
          icon: codeToIcon(cw.weathercode),
          isDay: cw.is_day !== 0,
          fetchedAt: Date.now(),
        }
        cache.set(key, { snapshot: snap, expires: Date.now() + TTL_MS })
        setSnapshot(snap)
      })
      .catch(() => {
        // Open-Meteo is free and public, but offline / rate-limited
        // failures are common. Silent fall-through is fine — the chip
        // just doesn't render until a later retry succeeds.
      })

    return () => {
      cancelled = true
    }
  }, [pos?.lat, pos?.lng, paused])

  return snapshot
}
