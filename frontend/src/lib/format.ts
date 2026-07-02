// Shared display-formatting helpers. Precision is a parameter so each
// call site keeps the exact output it had before these were extracted.

interface LatLng {
  lat: number
  lng: number
}

export const KM_THRESHOLD_M = 1000

/** "25.033000, 121.565400" — plain comma-joined pair. */
export function formatCoord(c: LatLng, precision = 6): string {
  return `${c.lat.toFixed(precision)}, ${c.lng.toFixed(precision)}`
}

/** "25.03300°N · 121.56540°E" — dock/waypoint cardinal style. */
export function formatCoordCardinal(c: LatLng, precision = 5): string {
  return `${c.lat.toFixed(precision)}°N · ${c.lng.toFixed(precision)}°E`
}

/** "25.033000°, 121.565400°" — degree-suffixed list-row style. */
export function formatCoordDegrees(c: LatLng, precision = 6): string {
  return `${c.lat.toFixed(precision)}°, ${c.lng.toFixed(precision)}°`
}

/** Compact "lat,lng" signature for memo/marker identity keys. */
export function coordKey(c: LatLng, precision = 7): string {
  return `${c.lat.toFixed(precision)},${c.lng.toFixed(precision)}`
}

/** "999 m" below the km threshold, "1.23 km" above it. */
export function formatDistanceM(m: number, kmPrecision: 1 | 2 = 2): string {
  if (m >= KM_THRESHOLD_M) return `${(m / KM_THRESHOLD_M).toFixed(kmPrecision)} km`
  return `${Math.round(m)} m`
}

/** Cooldown countdown: "M:SS" under an hour, "H:MM:SS" from one hour up. */
export function formatCountdown(totalSeconds: number): string {
  const total = Math.round(totalSeconds)
  const hrs = Math.floor(total / 3600)
  const mins = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const pad = (n: number) => n.toString().padStart(2, '0')
  return hrs > 0 ? `${hrs}:${pad(mins)}:${pad(secs)}` : `${mins}:${pad(secs)}`
}
