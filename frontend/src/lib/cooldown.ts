// Mirror of backend/config.py COOLDOWN_TABLE — used for client-side prediction only.
// The real cooldown is still enforced server-side.
const COOLDOWN_TABLE: [number, number][] = [
  [1, 0],
  [5, 30],
  [10, 120],
  [25, 300],
  [100, 900],
  [250, 1500],
  [500, 2700],
  [750, 3600],
  [1000, 5400],
  [Infinity, 7200],
]

/** Return predicted cooldown seconds for a given distance in km. */
export function predictCooldown(distanceKm: number): number {
  for (const [maxKm, seconds] of COOLDOWN_TABLE) {
    if (distanceKm <= maxKm) return seconds
  }
  return COOLDOWN_TABLE[COOLDOWN_TABLE.length - 1][1]
}

/** Format seconds as HH:MM:SS. */
export function formatCooldown(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
