import { describe, expect, test } from 'vitest'
import {
  DEFAULT_FLOWER_SETTINGS,
  estimateFlowerPlan,
  flowerCirclePathM,
  flowerPlanDistanceM,
  flowerPlanSeconds,
  sanitizeFlowerSettings,
  stepFlowerRounds,
  stepFlowerWait,
} from './flower'
import { haversineM } from './geo'

describe('sanitizeFlowerSettings', () => {
  test('falls back to defaults for garbage', () => {
    expect(sanitizeFlowerSettings(null)).toEqual(DEFAULT_FLOWER_SETTINGS)
    expect(sanitizeFlowerSettings('x')).toEqual(DEFAULT_FLOWER_SETTINGS)
    expect(sanitizeFlowerSettings({ radiusM: 'big', transfer: 'fly' })).toEqual(DEFAULT_FLOWER_SETTINGS)
  })

  test('clamps to backend bounds and snaps laps to half steps', () => {
    expect(sanitizeFlowerSettings({
      radiusM: 1, segments: 30.4, laps: 1.3, rounds: 500, waitBeforeS: -4, waitAfterS: 9999, transfer: 'teleport',
    })).toEqual({
      radiusM: 5, segments: 24, laps: 1.5, rounds: 99, waitBeforeS: 0, waitAfterS: 600, transfer: 'teleport',
    })
    expect(sanitizeFlowerSettings({ laps: 0.1 }).laps).toBe(0.5)
  })

  test('keeps unlimited rounds', () => {
    expect(sanitizeFlowerSettings({ rounds: null }).rounds).toBeNull()
  })
})

describe('steppers', () => {
  test('wait ladder moves between presets and stops at the ends', () => {
    expect(stepFlowerWait(0, 1)).toBe(5)
    expect(stepFlowerWait(7, 1)).toBe(10)
    expect(stepFlowerWait(7, -1)).toBe(5)
    expect(stepFlowerWait(600, 1)).toBe(600)
    expect(stepFlowerWait(0, -1)).toBe(0)
  })

  test('rounds go 99 → unlimited and back', () => {
    expect(stepFlowerRounds(98, 1)).toBe(99)
    expect(stepFlowerRounds(99, 1)).toBeNull()
    expect(stepFlowerRounds(null, 1)).toBeNull()
    expect(stepFlowerRounds(null, -1)).toBe(99)
    expect(stepFlowerRounds(1, -1)).toBe(1)
  })
})

describe('flowerCirclePathM', () => {
  test('one lap on a fine polygon approaches the circumference plus in/out legs', () => {
    const r = 20
    expect(flowerCirclePathM(r, 24, 1)).toBeCloseTo(2 * r + 24 * 2 * r * Math.sin(Math.PI / 24), 6)
    expect(flowerCirclePathM(r, 24, 1)).toBeGreaterThan(2 * r + 0.99 * 2 * Math.PI * r)
  })

  test('half a lap on an odd polygon ends on the exact opposite point', () => {
    const r = 10
    const step = (2 * Math.PI) / 7
    const expected = 2 * r + 3 * 2 * r * Math.sin(step / 2) + 2 * r * Math.sin((Math.PI - 3 * step) / 2)
    expect(flowerCirclePathM(r, 7, 0.5)).toBeCloseTo(expected, 9)
  })

  test('laps scale the polygon part linearly', () => {
    const one = flowerCirclePathM(20, 12, 1) - 40
    expect(flowerCirclePathM(20, 12, 3) - 40).toBeCloseTo(3 * one, 9)
  })
})

describe('estimateFlowerPlan', () => {
  const a = { lat: 25, lng: 121.5 }
  const b = { lat: 25.001, lng: 121.5 }
  const start = { lat: 24.999, lng: 121.5 }

  test('walk transfer adds start leg on round one and wrap leg afterwards', () => {
    const s = { ...DEFAULT_FLOWER_SETTINGS, rounds: 3, waitBeforeS: 5, waitAfterS: 10 }
    const plan = estimateFlowerPlan([a, b], s, start)
    const circle = flowerCirclePathM(s.radiusM, s.segments, s.laps)
    const ab = haversineM(a, b)
    expect(plan.firstRoundM).toBeCloseTo(2 * circle + ab + haversineM(start, a), 6)
    expect(plan.laterRoundM).toBeCloseTo(2 * circle + ab + haversineM(b, a), 6)
    expect(plan.roundWaitS).toBe(30)
    expect(flowerPlanDistanceM(plan)).toBeCloseTo(plan.firstRoundM + 2 * plan.laterRoundM, 6)
    const secs = flowerPlanSeconds(plan, 3.6)
    expect(secs).toBeCloseTo((plan.firstRoundM + 2 * plan.laterRoundM) + 90, 6)
  })

  test('teleport transfer counts only the circles', () => {
    const s = { ...DEFAULT_FLOWER_SETTINGS, transfer: 'teleport' as const }
    const plan = estimateFlowerPlan([a, b], s, start)
    expect(plan.firstRoundM).toBeCloseTo(2 * flowerCirclePathM(20, 12, 1), 9)
    expect(plan.laterRoundM).toBe(plan.firstRoundM)
  })

  test('unlimited rounds have no total', () => {
    const plan = estimateFlowerPlan([a], { ...DEFAULT_FLOWER_SETTINGS, rounds: null }, null)
    expect(flowerPlanDistanceM(plan)).toBeNull()
    expect(flowerPlanSeconds(plan, 5)).toBeNull()
  })

  test('no spots means nothing to walk', () => {
    const plan = estimateFlowerPlan([], DEFAULT_FLOWER_SETTINGS, start)
    expect(flowerPlanDistanceM(plan)).toBe(0)
  })
})
