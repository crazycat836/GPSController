import React, { useCallback, useEffect, useRef } from 'react'
import { devLog } from '../lib/dev-log'

/**
 * Serialized optimistic reorder with an in-flight guard. A rapid second
 * drag while the first reorder POST is still landing would otherwise race
 * — the second drag's id list is computed from the stale pre-refresh local
 * order, both POSTs hit the server back-to-back, and whichever refresh lands
 * second wins. We serialise the POST and queue the *latest* ordering on top,
 * so a burst of N drags collapses into one in-flight call plus one tail call
 * carrying the final order.
 *
 * `deps` is forwarded to the handler's `useCallback` so each caller keeps its
 * own memo profile: routes key on `refreshRoutes` (stable), bookmarks key on
 * `bm` (which `useBookmarks` rebuilds every render).
 */
export function useSerializedReorder(
  post: (orderedIds: string[]) => Promise<unknown>,
  refresh: () => Promise<unknown>,
  label: string,
  deps: React.DependencyList,
): (orderedIds: string[]) => Promise<void> {
  const inflightRef = useRef(false)
  const pendingRef = useRef<string[] | null>(null)
  const handlerRef = useRef<((orderedIds: string[]) => Promise<void>) | null>(null)
  const handler = useCallback(async (orderedIds: string[]) => {
    if (inflightRef.current) {
      pendingRef.current = orderedIds
      return
    }
    inflightRef.current = true
    try {
      await post(orderedIds)
    } catch (err) {
      devLog(label, err)
    } finally {
      await refresh()
      inflightRef.current = false
      const queued = pendingRef.current
      pendingRef.current = null
      if (queued) void handlerRef.current?.(queued)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  // Self-ref lets the finally block re-enter without a forward reference;
  // updated in an effect so the latest handler is always called.
  useEffect(() => { handlerRef.current = handler }, [handler])
  return handler
}
