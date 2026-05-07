/**
 * Pick `count` random waypoints inside a circle of radius `radius` (metres)
 * centred on `origin`, then return them in nearest-neighbour visit order.
 *
 * Lat/lng-to-metre scale is approximate (equirectangular at the origin's
 * latitude) — fine for the small circles this is used with (≤ a few km).
 *
 * Lifted out of `SimContext.tsx` so the geometry / ordering logic is
 * pure and testable. The caller owns side effects (toast on no-origin,
 * `setWaypoints` afterwards).
 */

export interface LatLng {
  lat: number
  lng: number
}

const _METRES_PER_DEGREE_LAT = 111_320

/** Random point inside a disk of `radius` metres around `origin`. */
function _samplePoint(origin: LatLng, radius: number, lngScale: number): LatLng {
  const r = radius * Math.sqrt(Math.random())
  const theta = Math.random() * 2 * Math.PI
  return {
    lat: origin.lat + (r * Math.cos(theta)) / _METRES_PER_DEGREE_LAT,
    lng: origin.lng + (r * Math.sin(theta)) / lngScale,
  }
}

/**
 * Generate a tour of `count` random waypoints inside a circle of
 * `radius` metres centred on `origin`. The returned list starts with
 * `origin` followed by the picked points in nearest-neighbour visit
 * order — the simplest tour heuristic that beats raw random ordering
 * for short paths.
 */
export function generateRandomTour(
  origin: LatLng,
  radius: number,
  count: number,
): LatLng[] {
  const lngScale = _METRES_PER_DEGREE_LAT * Math.cos((origin.lat * Math.PI) / 180)

  const remaining: LatLng[] = []
  for (let i = 0; i < count; i++) {
    remaining.push(_samplePoint(origin, radius, lngScale))
  }

  const ordered: LatLng[] = []
  let cx = origin.lat
  let cy = origin.lng
  while (remaining.length) {
    let bestIdx = 0
    let bestD = Infinity
    for (let i = 0; i < remaining.length; i++) {
      const dx = (remaining[i].lat - cx) * _METRES_PER_DEGREE_LAT
      const dy = (remaining[i].lng - cy) * lngScale
      const d = dx * dx + dy * dy
      if (d < bestD) {
        bestD = d
        bestIdx = i
      }
    }
    const [next] = remaining.splice(bestIdx, 1)
    ordered.push(next)
    cx = next.lat
    cy = next.lng
  }

  return [{ lat: origin.lat, lng: origin.lng }, ...ordered]
}
