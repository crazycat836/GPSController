import { describe, expect, test } from 'vitest'
import { asNumber, asObject, asString, asStringArray } from './ws-guards'

// Characterization tests for the WS payload type-guards that used to be
// duplicated in useSimWsDispatcher and device/parsers.

describe('asObject', () => {
  test('returns the object for plain objects and arrays', () => {
    const o = { a: 1 }
    expect(asObject(o)).toBe(o)
    const arr = [1, 2]
    expect(asObject(arr)).toBe(arr)
  })

  test('returns null for primitives and null', () => {
    expect(asObject(null)).toBeNull()
    expect(asObject(undefined)).toBeNull()
    expect(asObject('x')).toBeNull()
    expect(asObject(3)).toBeNull()
  })
})

describe('asString', () => {
  test('passes strings through and rejects everything else', () => {
    expect(asString('hi')).toBe('hi')
    expect(asString('')).toBe('')
    expect(asString(3)).toBeUndefined()
    expect(asString(null)).toBeUndefined()
  })
})

describe('asNumber', () => {
  test('passes numbers through and rejects everything else', () => {
    expect(asNumber(0)).toBe(0)
    expect(asNumber(-1.5)).toBe(-1.5)
    expect(asNumber('3')).toBeUndefined()
    expect(asNumber(null)).toBeUndefined()
  })
})

describe('asStringArray', () => {
  test('accepts arrays whose every element is a string', () => {
    expect(asStringArray([])).toEqual([])
    expect(asStringArray(['a', 'b'])).toEqual(['a', 'b'])
  })

  test('rejects non-arrays and mixed arrays', () => {
    expect(asStringArray('a')).toBeUndefined()
    expect(asStringArray(['a', 1])).toBeUndefined()
    expect(asStringArray(null)).toBeUndefined()
  })
})
