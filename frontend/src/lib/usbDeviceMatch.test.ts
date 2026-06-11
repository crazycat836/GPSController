import { describe, expect, test } from 'vitest'
import {
  discoveredDisplayName,
  findUsbDeviceName,
  matchesUsbDevice,
  normalizeDeviceName,
} from './usbDeviceMatch'

describe('normalizeDeviceName', () => {
  test('lowercases and strips separators', () => {
    expect(normalizeDeviceName('Garys-iPhone')).toBe('garysiphone')
  })

  test('strips trailing .local from mDNS hostnames', () => {
    expect(normalizeDeviceName('Garys-iPhone.local')).toBe('garysiphone')
    expect(normalizeDeviceName('Garys-iPhone.local.')).toBe('garysiphone')
  })

  test('strips straight and typographic apostrophes', () => {
    expect(normalizeDeviceName("Gary's iPhone")).toBe('garysiphone')
    expect(normalizeDeviceName('Gary’s iPhone')).toBe('garysiphone')
  })

  test('keeps CJK characters so Chinese device names still compare', () => {
    expect(normalizeDeviceName('Gary 的 iPhone')).toBe('gary的iphone')
  })
})

describe('matchesUsbDevice', () => {
  const usbNames = ["Gary's iPhone"]

  test('matches when discovered mDNS name equals the USB device name', () => {
    expect(matchesUsbDevice({ name: "Gary's iPhone" }, usbNames)).toBe(true)
  })

  test('matches via hostname when the broadcast name differs', () => {
    expect(
      matchesUsbDevice({ name: '192.168.1.20', host: 'Garys-iPhone.local' }, usbNames),
    ).toBe(true)
  })

  test('returns false for a different device', () => {
    expect(
      matchesUsbDevice({ name: 'Lisas-iPad', host: 'Lisas-iPad.local' }, usbNames),
    ).toBe(false)
  })

  test('returns false when there is no USB device', () => {
    expect(matchesUsbDevice({ name: "Gary's iPhone" }, [])).toBe(false)
  })

  test('never matches on empty normalized names', () => {
    expect(matchesUsbDevice({ name: '---' }, ['---'])).toBe(false)
  })
})

describe('findUsbDeviceName', () => {
  test('returns the original USB device name on a host match', () => {
    expect(
      findUsbDeviceName({ name: 'AD88F4C21B07', host: 'Gary.local' }, ['Gary']),
    ).toBe('Gary')
  })

  test('returns null when nothing matches', () => {
    expect(findUsbDeviceName({ name: 'AD88F4C21B07' }, ['Gary'])).toBeNull()
  })
})

describe('discoveredDisplayName', () => {
  test('uses the broadcast name when it is human-readable', () => {
    expect(
      discoveredDisplayName({ name: "Gary's iPhone", host: 'Garys-iPhone.local', ip: '192.168.1.20' }),
    ).toBe("Gary's iPhone")
  })

  test('falls back to the hostname when the name is an opaque hex identifier', () => {
    expect(
      discoveredDisplayName({ name: 'AD88F4C21B07', host: 'Gary.local', ip: '169.254.145.214' }),
    ).toBe('Gary')
  })

  test('skips a name that merely duplicates the IP', () => {
    expect(
      discoveredDisplayName({ name: '192.168.1.20', host: 'Garys-iPhone.local', ip: '192.168.1.20' }),
    ).toBe('Garys-iPhone')
  })

  test('falls back to the raw name when host is also unusable', () => {
    expect(
      discoveredDisplayName({ name: 'AD88F4C21B07', host: '169.254.145.214', ip: '169.254.145.214' }),
    ).toBe('AD88F4C21B07')
  })

  test('falls back to the IP when nothing else exists', () => {
    expect(discoveredDisplayName({ name: '', ip: '192.168.1.20' })).toBe('192.168.1.20')
  })
})
