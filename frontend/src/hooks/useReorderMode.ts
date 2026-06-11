import { useCallback, useEffect, useRef, useState } from 'react'

interface UseReorderModeOptions<S> {
  /** Capture the filter/sort state to restore when reorder mode exits. */
  takeSnapshot: () => S
  /** Clear filters (and any conflicting modes) so the drag list shows everything. */
  onEnter?: () => void
  /** Restore the snapshot captured on enter. */
  restore: (snapshot: S) => void
}

/**
 * Reorder-mode round-trip shared by the Bookmarks / Routes panels.
 *
 * Entering snapshots the current filters and clears them so the drag list
 * shows every row — reordering within a filtered view would silently leave
 * hidden rows' sort_order untouched, and the user wouldn't see why their
 * drag didn't "stick" after switching back to All. Exiting restores
 * whatever the user had before.
 *
 * The snapshot lives in a ref (never rendered, no re-render needed) and
 * the options are read through a render-updated ref, so the returned
 * callbacks are stable and always see fresh filter state.
 */
export function useReorderMode<S>(options: UseReorderModeOptions<S>): {
  reorderMode: boolean
  enterReorderMode: () => void
  exitReorderMode: () => void
  /** Turn reorder mode off WITHOUT restoring the snapshot (e.g. when
   *  selection mode takes over the leading row slot). */
  cancelReorderMode: () => void
} {
  const [reorderMode, setReorderMode] = useState(false)
  const snapshotRef = useRef<S | null>(null)
  const optionsRef = useRef(options)
  useEffect(() => { optionsRef.current = options })

  const enterReorderMode = useCallback(() => {
    const { takeSnapshot, onEnter } = optionsRef.current
    snapshotRef.current = takeSnapshot()
    onEnter?.()
    setReorderMode(true)
  }, [])

  const exitReorderMode = useCallback(() => {
    setReorderMode(false)
    const snapshot = snapshotRef.current
    if (snapshot !== null) optionsRef.current.restore(snapshot)
  }, [])

  const cancelReorderMode = useCallback(() => setReorderMode(false), [])

  return { reorderMode, enterReorderMode, exitReorderMode, cancelReorderMode }
}
