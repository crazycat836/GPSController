import { afterEach, describe, expect, test, vi } from 'vitest'
import { readJSON, readLS, removeLS, writeJSON, writeLS } from './local-storage'

// Sandbox-safe localStorage accessors: every function must swallow the
// DOMException thrown when storage is disabled (Electron sandbox,
// private browsing) instead of crashing the caller.

function stubStorage(overrides: Partial<Storage> = {}) {
  const store = new Map<string, string>()
  const stub = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
    ...overrides,
  }
  vi.stubGlobal('localStorage', stub)
  return store
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('readLS', () => {
  test('returns the stored string', () => {
    const store = stubStorage()
    store.set('k', 'v')
    expect(readLS('k')).toBe('v')
  })

  test('returns null for a missing key', () => {
    stubStorage()
    expect(readLS('missing')).toBeNull()
  })

  test('returns null when storage access throws', () => {
    stubStorage({ getItem: () => { throw new Error('denied') } })
    expect(readLS('k')).toBeNull()
  })
})

describe('writeLS', () => {
  test('persists the value', () => {
    const store = stubStorage()
    writeLS('k', 'v')
    expect(store.get('k')).toBe('v')
  })

  test('swallows storage errors (full / disabled)', () => {
    stubStorage({ setItem: () => { throw new Error('quota') } })
    expect(() => writeLS('k', 'v')).not.toThrow()
  })
})

describe('removeLS', () => {
  test('removes the key', () => {
    const store = stubStorage()
    store.set('k', 'v')
    removeLS('k')
    expect(store.has('k')).toBe(false)
  })

  test('swallows storage errors', () => {
    stubStorage({ removeItem: () => { throw new Error('denied') } })
    expect(() => removeLS('k')).not.toThrow()
  })
})

describe('readJSON', () => {
  test('parses stored JSON', () => {
    const store = stubStorage()
    store.set('k', '{"a":1}')
    expect(readJSON('k')).toEqual({ a: 1 })
  })

  test('returns null for missing key, corrupt JSON, or storage errors', () => {
    const store = stubStorage()
    expect(readJSON('missing')).toBeNull()
    store.set('bad', '{oops')
    expect(readJSON('bad')).toBeNull()
    stubStorage({ getItem: () => { throw new Error('denied') } })
    expect(readJSON('k')).toBeNull()
  })
})

describe('writeJSON', () => {
  test('stringifies and persists', () => {
    const store = stubStorage()
    writeJSON('k', { a: 1 })
    expect(store.get('k')).toBe('{"a":1}')
  })

  test('swallows storage errors', () => {
    stubStorage({ setItem: () => { throw new Error('quota') } })
    expect(() => writeJSON('k', { a: 1 })).not.toThrow()
  })
})
