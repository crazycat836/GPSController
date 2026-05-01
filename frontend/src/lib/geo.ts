interface LatLng {
  lat: number
  lng: number
}

/**
 * Approx. metres per degree of latitude (mean meridional length).
 * Use for cheap planar distance estimates when full Haversine is
 * overkill — e.g. small-delta thresholds where ~0.5% accuracy is fine.
 */
export const METERS_PER_DEGREE_LAT = 111320

/** Great-circle distance in metres (Haversine formula). */
export function haversineM(a: LatLng, b: LatLng): number {
  const R = 6371000
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLng = (b.lng - a.lng) * Math.PI / 180
  const la1 = a.lat * Math.PI / 180
  const la2 = b.lat * Math.PI / 180
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(x))
}

/** Total distance of a polyline in metres (sum of haversine segments). */
export function polylineDistanceM(points: LatLng[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) {
    total += haversineM(points[i - 1], points[i])
  }
  return total
}
