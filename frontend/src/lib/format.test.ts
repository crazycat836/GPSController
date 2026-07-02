import { describe, expect, test } from 'vitest'
import {
  KM_THRESHOLD_M,
  coordKey,
  formatCoord,
  formatCoordCardinal,
  formatCoordDegrees,
  formatCountdown,
  formatDistanceM,
} from './format'

const TAIPEI = { lat: 25.033, lng: 121.5654 }

describe('formatCoord', () => {
  test('joins lat/lng with comma at the given precision', () => {
    expect(formatCoord(TAIPEI, 6)).toBe('25.033000, 121.565400')
    expect(formatCoord(TAIPEI, 4)).toBe('25.0330, 121.5654')
  })

  test('defaults to 6 decimal places', () => {
    expect(formatCoord(TAIPEI)).toBe('25.033000, 121.565400')
  })

  test('keeps sign for southern/western coordinates', () => {
    expect(formatCoord({ lat: -33.8688, lng: -70.6693 }, 4)).toBe('-33.8688, -70.6693')
  })
})

describe('formatCoordCardinal', () => {
  test('renders the °N · °E style used by the dock', () => {
    expect(formatCoordCardinal(TAIPEI, 5)).toBe('25.03300°N · 121.56540°E')
    expect(formatCoordCardinal(TAIPEI, 4)).toBe('25.0330°N · 121.5654°E')
  })

  test('defaults to 5 decimal places', () => {
    expect(formatCoordCardinal(TAIPEI)).toBe('25.03300°N · 121.56540°E')
  })
})

describe('formatCoordDegrees', () => {
  test('renders the °-suffixed comma style used by list rows', () => {
    expect(formatCoordDegrees(TAIPEI, 6)).toBe('25.033000°, 121.565400°')
    expect(formatCoordDegrees(TAIPEI, 4)).toBe('25.0330°, 121.5654°')
  })

  test('defaults to 6 decimal places', () => {
    expect(formatCoordDegrees(TAIPEI)).toBe('25.033000°, 121.565400°')
  })
})

describe('coordKey', () => {
  test('builds a compact signature at 7 decimal places by default', () => {
    expect(coordKey(TAIPEI)).toBe('25.0330000,121.5654000')
  })

  test('honours a custom precision', () => {
    expect(coordKey(TAIPEI, 6)).toBe('25.033000,121.565400')
  })
})

describe('formatDistanceM', () => {
  test('rounds to whole metres below the km threshold', () => {
    expect(formatDistanceM(0)).toBe('0 m')
    expect(formatDistanceM(999.4)).toBe('999 m')
  })

  test('switches to km at the threshold with 2 decimal places by default', () => {
    expect(formatDistanceM(KM_THRESHOLD_M)).toBe('1.00 km')
    expect(formatDistanceM(1234)).toBe('1.23 km')
  })

  test('supports 1-decimal km precision', () => {
    expect(formatDistanceM(1234, 1)).toBe('1.2 km')
    expect(formatDistanceM(999, 1)).toBe('999 m')
  })
})

describe('formatCountdown', () => {
  test('renders M:SS below one hour', () => {
    expect(formatCountdown(0)).toBe('0:00')
    expect(formatCountdown(59)).toBe('0:59')
    expect(formatCountdown(125)).toBe('2:05')
  })

  test('renders H:MM:SS from one hour up', () => {
    expect(formatCountdown(3600)).toBe('1:00:00')
    expect(formatCountdown(5400)).toBe('1:30:00')
    expect(formatCountdown(3725)).toBe('1:02:05')
  })

  test('rounds fractional seconds like the cooldown badge did', () => {
    expect(formatCountdown(59.6)).toBe('1:00')
  })
})
