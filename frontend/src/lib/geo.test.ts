import { describe, expect, test } from 'vitest'
import { clampLat, normalizeLng } from './geo'

// Characterization tests — pinned when these helpers moved out of
// SimContext into lib/geo.

describe('normalizeLng', () => {
  test('passes through longitudes already in range (modulo float error)', () => {
    expect(normalizeLng(0)).toBe(0)
    expect(normalizeLng(121.5654)).toBeCloseTo(121.5654, 10)
    expect(normalizeLng(-70.6693)).toBeCloseTo(-70.6693, 10)
  })

  test('wraps values beyond the antimeridian', () => {
    expect(normalizeLng(190)).toBe(-170)
    expect(normalizeLng(-190)).toBe(170)
    expect(normalizeLng(360)).toBe(0)
    // Only a literal input of 180 keeps the +180 sign; wrapped
    // equivalents like 540 land on -180.
    expect(normalizeLng(540)).toBe(-180)
  })

  test('keeps +180 as +180 instead of flipping to -180', () => {
    expect(normalizeLng(180)).toBe(180)
    expect(normalizeLng(-180)).toBe(-180)
  })
})

describe('clampLat', () => {
  test('passes through latitudes in range', () => {
    expect(clampLat(0)).toBe(0)
    expect(clampLat(25.033)).toBe(25.033)
    expect(clampLat(-89.9)).toBe(-89.9)
  })

  test('clamps out-of-range latitudes to the poles', () => {
    expect(clampLat(91)).toBe(90)
    expect(clampLat(-95)).toBe(-90)
  })
})
