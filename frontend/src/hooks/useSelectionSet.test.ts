// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useSelectionSet } from './useSelectionSet'

afterEach(cleanup)

describe('useSelectionSet', () => {
  it('starts with selection mode off and nothing selected', () => {
    const { result } = renderHook(() => useSelectionSet())

    expect(result.current.selectionMode).toBe(false)
    expect(result.current.selectedIds.size).toBe(0)
  })

  it('toggleSelected adds then removes an id', () => {
    const { result } = renderHook(() => useSelectionSet())

    act(() => result.current.toggleSelected('a'))
    expect(result.current.selectedIds).toEqual(new Set(['a']))

    act(() => result.current.toggleSelected('a'))
    expect(result.current.selectedIds.size).toBe(0)
  })

  it('enterSelection flips the mode on without touching the set', () => {
    const { result } = renderHook(() => useSelectionSet())

    act(() => result.current.toggleSelected('a'))
    act(() => result.current.enterSelection())

    expect(result.current.selectionMode).toBe(true)
    expect(result.current.selectedIds).toEqual(new Set(['a']))
  })

  it('exitSelection flips the mode off and clears the set', () => {
    const { result } = renderHook(() => useSelectionSet())

    act(() => result.current.enterSelection())
    act(() => result.current.toggleSelected('a'))
    act(() => result.current.exitSelection())

    expect(result.current.selectionMode).toBe(false)
    expect(result.current.selectedIds.size).toBe(0)
  })

  it('clearSelected empties the set but keeps the mode on', () => {
    const { result } = renderHook(() => useSelectionSet())

    act(() => result.current.enterSelection())
    act(() => result.current.toggleSelected('a'))
    act(() => result.current.clearSelected())

    expect(result.current.selectionMode).toBe(true)
    expect(result.current.selectedIds.size).toBe(0)
  })
})
