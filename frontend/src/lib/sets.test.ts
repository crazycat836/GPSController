import { describe, it, expect } from 'vitest'
import { toggleInSet } from './sets'

describe('toggleInSet', () => {
  it('adds the value when absent', () => {
    const prev = new Set(['a'])

    const next = toggleInSet(prev, 'b')

    expect(next).toEqual(new Set(['a', 'b']))
  })

  it('removes the value when present', () => {
    const prev = new Set(['a', 'b'])

    const next = toggleInSet(prev, 'b')

    expect(next).toEqual(new Set(['a']))
  })

  it('returns a new Set and never mutates the input', () => {
    const prev = new Set(['a'])

    const next = toggleInSet(prev, 'b')

    expect(next).not.toBe(prev)
    expect(prev).toEqual(new Set(['a']))
  })
})
