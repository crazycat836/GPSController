// Flower mode settings + plan estimate. Pure functions — behaviour is
// pinned by ./flower.test.ts. Bounds mirror backend `FlowerRequest`.
import { haversineM } from './geo'

type LatLng = { lat: number; lng: number }

export type FlowerTransfer = 'walk' | 'teleport'

export interface FlowerSettings {
  radiusM: number
  /** Vertices per circle. */
  segments: number
  /** Laps around each spot, in half-lap steps. */
  laps: number
  /** Passes over the spot list. null = until stopped. */
  rounds: number | null
  waitBeforeS: number
  waitAfterS: number
  transfer: FlowerTransfer
}

export const FLOWER_LIMITS = {
  radiusM: { min: 5, max: 100, step: 5 },
  segments: { min: 6, max: 24, step: 2 },
  laps: { min: 0.5, max: 10, step: 0.5 },
  rounds: { min: 1, max: 99 },
  waitS: { min: 0, max: 600 },
} as const

/** Stepper ladder for the wait controls (seconds). */
export const FLOWER_WAIT_STEPS_S = [0, 5, 10, 15, 30, 60, 120, 180, 300, 600] as const

export const DEFAULT_FLOWER_SETTINGS: FlowerSettings = {
  radiusM: 20,
  segments: 12,
  laps: 1,
  rounds: 1,
  waitBeforeS: 0,
  waitAfterS: 0,
  transfer: 'walk',
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

function finite(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** Coerce anything (e.g. a stored JSON blob) into valid settings. */
export function sanitizeFlowerSettings(raw: unknown): FlowerSettings {
  const o = (raw != null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const d = DEFAULT_FLOWER_SETTINGS
  const L = FLOWER_LIMITS
  const radius = finite(o.radiusM)
  const segments = finite(o.segments)
  const laps = finite(o.laps)
  const rounds = finite(o.rounds)
  const before = finite(o.waitBeforeS)
  const after = finite(o.waitAfterS)
  return {
    radiusM: radius == null ? d.radiusM : clamp(radius, L.radiusM.min, L.radiusM.max),
    segments: segments == null ? d.segments : clamp(Math.round(segments), L.segments.min, L.segments.max),
    laps: laps == null
      ? d.laps
      : clamp(Math.round(laps / L.laps.step) * L.laps.step, L.laps.min, L.laps.max),
    rounds: o.rounds === null
      ? null
      : rounds == null ? d.rounds : clamp(Math.round(rounds), L.rounds.min, L.rounds.max),
    waitBeforeS: before == null ? d.waitBeforeS : clamp(before, L.waitS.min, L.waitS.max),
    waitAfterS: after == null ? d.waitAfterS : clamp(after, L.waitS.min, L.waitS.max),
    transfer: o.transfer === 'teleport' ? 'teleport' : 'walk',
  }
}

/** Next value on the wait ladder in direction `dir` (+1 / -1). */
export function stepFlowerWait(current: number, dir: 1 | -1): number {
  const steps = FLOWER_WAIT_STEPS_S
  if (dir > 0) return steps.find((s) => s > current) ?? steps[steps.length - 1]
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i] < current) return steps[i]
  }
  return steps[0]
}

/** Next rounds value: 1…99, then unlimited (null); down from unlimited
 *  lands on 99. */
export function stepFlowerRounds(current: number | null, dir: 1 | -1): number | null {
  const { min, max } = FLOWER_LIMITS.rounds
  if (current === null) return dir > 0 ? null : max
  if (dir > 0) return current >= max ? null : current + 1
  return Math.max(min, current - 1)
}

/** Length of one spot's walked path: centre → circle → `laps` around the
 *  polygon (partial final chord for a fractional lap) → centre. Mirrors
 *  backend `core.flower.circle_path`. */
export function flowerCirclePathM(radiusM: number, segments: number, laps: number): number {
  const step = (2 * Math.PI) / segments
  const total = laps * 2 * Math.PI
  const fullSteps = Math.floor(total / step + 1e-9)
  const chord = 2 * radiusM * Math.sin(step / 2)
  const rem = total - fullSteps * step
  const partial = rem > 1e-9 ? 2 * radiusM * Math.sin(rem / 2) : 0
  return 2 * radiusM + fullSteps * chord + partial
}

export interface FlowerPlan {
  /** Walking distance of the first round (includes reaching spot 1). */
  firstRoundM: number
  /** Walking distance of every later round (includes last → first). */
  laterRoundM: number
  /** Total waiting per round. */
  roundWaitS: number
  rounds: number | null
}

export function estimateFlowerPlan(
  spots: LatLng[],
  settings: FlowerSettings,
  start: LatLng | null,
): FlowerPlan {
  const n = spots.length
  const circles = n * flowerCirclePathM(settings.radiusM, settings.segments, settings.laps)
  let chain = 0
  let toFirst = 0
  let wrap = 0
  if (settings.transfer === 'walk' && n > 0) {
    for (let i = 0; i + 1 < n; i++) chain += haversineM(spots[i], spots[i + 1])
    toFirst = start ? haversineM(start, spots[0]) : 0
    wrap = haversineM(spots[n - 1], spots[0])
  }
  return {
    firstRoundM: n === 0 ? 0 : circles + chain + toFirst,
    laterRoundM: n === 0 ? 0 : circles + chain + wrap,
    roundWaitS: n * (settings.waitBeforeS + settings.waitAfterS),
    rounds: settings.rounds,
  }
}

/** Total walking distance; null when rounds are unlimited. */
export function flowerPlanDistanceM(plan: FlowerPlan): number | null {
  if (plan.rounds === null) return null
  return plan.firstRoundM + (plan.rounds - 1) * plan.laterRoundM
}

/** Estimated run time in seconds; null when rounds are unlimited or the
 *  speed is not positive. */
export function flowerPlanSeconds(plan: FlowerPlan, speedKmh: number): number | null {
  const dist = flowerPlanDistanceM(plan)
  if (dist === null || speedKmh <= 0 || plan.rounds === null) return null
  return dist / (speedKmh / 3.6) + plan.rounds * plan.roundWaitS
}
