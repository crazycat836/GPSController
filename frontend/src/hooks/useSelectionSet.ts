import { useCallback, useState } from 'react'
import { toggleInSet } from '../lib/sets'

/**
 * Multi-select mode state shared by the Bookmarks / Routes panels:
 * a mode flag plus the set of selected ids, with the usual enter /
 * toggle / clear / exit transitions.
 */
export function useSelectionSet(): {
  selectionMode: boolean
  selectedIds: Set<string>
  toggleSelected: (id: string) => void
  enterSelection: () => void
  exitSelection: () => void
  clearSelected: () => void
} {
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => toggleInSet(prev, id))
  }, [])

  const enterSelection = useCallback(() => setSelectionMode(true), [])

  const exitSelection = useCallback(() => {
    setSelectionMode(false)
    setSelectedIds(new Set())
  }, [])

  const clearSelected = useCallback(() => setSelectedIds(new Set()), [])

  return { selectionMode, selectedIds, toggleSelected, enterSelection, exitSelection, clearSelected }
}
