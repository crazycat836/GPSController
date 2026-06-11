// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useReorderMode } from './useReorderMode'

afterEach(cleanup)

interface Snapshot { filter: string }

function setup(initialFilter: string) {
  const onEnter = vi.fn()
  const restore = vi.fn()
  let filter = initialFilter
  const hook = renderHook(() =>
    useReorderMode<Snapshot>({
      takeSnapshot: () => ({ filter }),
      onEnter,
      restore,
    }),
  )
  return { hook, onEnter, restore, setFilter: (next: string) => { filter = next } }
}

describe('useReorderMode', () => {
  it('starts with reorder mode off', () => {
    const { hook } = setup('all')

    expect(hook.result.current.reorderMode).toBe(false)
  })

  it('enter snapshots, runs onEnter, and flips the mode on', () => {
    const { hook, onEnter } = setup('places')

    act(() => hook.result.current.enterReorderMode())

    expect(hook.result.current.reorderMode).toBe(true)
    expect(onEnter).toHaveBeenCalledOnce()
  })

  it('exit flips the mode off and restores the snapshot taken on enter', () => {
    const { hook, restore, setFilter } = setup('places')

    act(() => hook.result.current.enterReorderMode())
    setFilter('changed-while-reordering')
    act(() => hook.result.current.exitReorderMode())

    expect(hook.result.current.reorderMode).toBe(false)
    expect(restore).toHaveBeenCalledExactlyOnceWith({ filter: 'places' })
  })

  it('reads the snapshot fresh at enter time, not at render time', () => {
    const { hook, restore, setFilter } = setup('stale')

    setFilter('fresh')
    act(() => hook.result.current.enterReorderMode())
    act(() => hook.result.current.exitReorderMode())

    expect(restore).toHaveBeenCalledExactlyOnceWith({ filter: 'fresh' })
  })

  it('cancel flips the mode off without restoring', () => {
    const { hook, restore } = setup('places')

    act(() => hook.result.current.enterReorderMode())
    act(() => hook.result.current.cancelReorderMode())

    expect(hook.result.current.reorderMode).toBe(false)
    expect(restore).not.toHaveBeenCalled()
  })

  it('exit without a prior enter does not restore', () => {
    const { hook, restore } = setup('places')

    act(() => hook.result.current.exitReorderMode())

    expect(restore).not.toHaveBeenCalled()
  })
})
