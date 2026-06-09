import { cooldownForDistM } from './constants'

/**
 * Return predicted cooldown seconds for a given distance in km.
 *
 * Thin km→m adapter over the single `COOLDOWN_TABLE` / `cooldownForDistM`
 * in `constants.ts` — previously this module carried its own copy of the
 * table (a three-way drift surface against constants.ts and the backend).
 */
export function predictCooldown(distanceKm: number): number {
  return cooldownForDistM(distanceKm * 1000)
}

/** Format seconds as HH:MM:SS. */
export function formatCooldown(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
