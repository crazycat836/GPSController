// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import type { DragEndEvent } from '@dnd-kit/core'
import { useOptimisticOrder } from './useOptimisticOrder'

interface Item { id: string; name: string }

const getId = (item: Item) => item.id

const ITEMS: Item[] = [
  { id: 'a', name: 'Alpha' },
  { id: 'b', name: 'Beta' },
  { id: 'c', name: 'Gamma' },
]

const dragEvent = (activeId: string, overId: string | null): DragEndEvent =>
  ({ active: { id: activeId }, over: overId === null ? null : { id: overId } }) as DragEndEvent

afterEach(cleanup)

describe('useOptimisticOrder', () => {
  it('returns items as-is before any drag', () => {
    const { result } = renderHook(() => useOptimisticOrder(ITEMS, getId))

    expect(result.current.orderedItems).toBe(ITEMS)
  })

  it('applies the dragged order optimistically and reports the id order', () => {
    const onReorder = vi.fn(() => new Promise<void>(() => {})) // never resolves
    const { result } = renderHook(() => useOptimisticOrder(ITEMS, getId, onReorder))

    act(() => result.current.handleDragEnd(dragEvent('c', 'a')))

    expect(onReorder).toHaveBeenCalledExactlyOnceWith(['c', 'a', 'b'])
    expect(result.current.orderedItems.map(getId)).toEqual(['c', 'a', 'b'])
  })

  it('drops the local order and trusts props again once onReorder resolves', async () => {
    const onReorder = vi.fn(() => Promise.resolve())
    const { result } = renderHook(() => useOptimisticOrder(ITEMS, getId, onReorder))

    act(() => result.current.handleDragEnd(dragEvent('c', 'a')))
    await act(async () => {})

    expect(result.current.orderedItems).toBe(ITEMS)
  })

  it('ignores drops with no target or onto the same row', () => {
    const onReorder = vi.fn()
    const { result } = renderHook(() => useOptimisticOrder(ITEMS, getId, onReorder))

    act(() => result.current.handleDragEnd(dragEvent('a', null)))
    act(() => result.current.handleDragEnd(dragEvent('a', 'a')))

    expect(onReorder).not.toHaveBeenCalled()
    expect(result.current.orderedItems).toBe(ITEMS)
  })

  it('keeps the optimistic order locally when no onReorder is provided', () => {
    const { result } = renderHook(() => useOptimisticOrder(ITEMS, getId))

    act(() => result.current.handleDragEnd(dragEvent('b', 'c')))

    expect(result.current.orderedItems.map(getId)).toEqual(['a', 'c', 'b'])
  })

  it('snaps back to the props order when onReorder rejects (no pinned stale order)', async () => {
    const onReorder = vi.fn(() => Promise.reject(new Error('persist failed')))
    const { result } = renderHook(() => useOptimisticOrder(ITEMS, getId, onReorder))

    act(() => result.current.handleDragEnd(dragEvent('c', 'a')))
    // Optimistic order applies first…
    expect(result.current.orderedItems.map(getId)).toEqual(['c', 'a', 'b'])
    await act(async () => {})

    // …then the rejection rolls back to props — no unhandled rejection.
    expect(result.current.orderedItems).toBe(ITEMS)
  })

  it('invokes onError with the rejection reason so callers can toast', async () => {
    const failure = new Error('persist failed')
    const onReorder = vi.fn(() => Promise.reject(failure))
    const onError = vi.fn()
    const { result } = renderHook(() => useOptimisticOrder(ITEMS, getId, onReorder, onError))

    act(() => result.current.handleDragEnd(dragEvent('c', 'a')))
    await act(async () => {})

    expect(onError).toHaveBeenCalledExactlyOnceWith(failure)
    expect(result.current.orderedItems).toBe(ITEMS)
  })

  it('does not invoke onError when onReorder resolves', async () => {
    const onReorder = vi.fn(() => Promise.resolve())
    const onError = vi.fn()
    const { result } = renderHook(() => useOptimisticOrder(ITEMS, getId, onReorder, onError))

    act(() => result.current.handleDragEnd(dragEvent('c', 'a')))
    await act(async () => {})

    expect(onError).not.toHaveBeenCalled()
  })

  it('handles a synchronously-throwing onReorder via the same rollback path', async () => {
    // Promise.resolve(onReorder(next)) — a sync throw escapes the promise
    // chain entirely, so the hook must not be wired in a way that lets it
    // crash the drag handler. Document the current contract: sync throws
    // propagate to the caller (dnd-kit), async rejections roll back.
    const onReorder = vi.fn(async () => { throw new Error('boom') })
    const onError = vi.fn()
    const { result } = renderHook(() => useOptimisticOrder(ITEMS, getId, onReorder, onError))

    act(() => result.current.handleDragEnd(dragEvent('b', 'c')))
    await act(async () => {})

    expect(onError).toHaveBeenCalledTimes(1)
    expect(result.current.orderedItems).toBe(ITEMS)
  })
})
