import { useCallback, useMemo, useState } from 'react'
import { type DragEndEvent, type SensorDescriptor, type SensorOptions } from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import { useReorderSensors } from './useDragReorder'

/** Manager dialogs: a small 4px drag before activating so plain-click still
 *  edits / deletes via the row buttons instead of immediately entering a drag. */
const DIALOG_ACTIVATION_DISTANCE_PX = 4

/**
 * Optimistic drag-reorder for the Place / Tag manager dialogs.
 *
 * Prefers the locally-reordered list while a drag is in flight — once the
 * parent persists the order and refreshes the `items` prop we drop the
 * local order and trust props again. `getId` must be referentially stable
 * (module-level fn) so `orderedItems` only recomputes on real changes.
 */
export function useOptimisticOrder<T>(
  items: readonly T[],
  getId: (item: T) => string,
  onReorder?: (orderedIds: string[]) => void | Promise<void>,
): {
  sensors: SensorDescriptor<SensorOptions>[]
  orderedItems: readonly T[]
  handleDragEnd: (event: DragEndEvent) => void
} {
  const [localOrder, setLocalOrder] = useState<string[] | null>(null)

  const sensors = useReorderSensors({
    activationDistance: DIALOG_ACTIVATION_DISTANCE_PX,
    keyboard: false,
  })

  const orderedItems = useMemo(() => {
    if (!localOrder) return items
    const byId = new Map(items.map((item) => [getId(item), item]))
    const ordered: T[] = []
    for (const id of localOrder) {
      const item = byId.get(id)
      if (item) ordered.push(item)
    }
    for (const item of items) {
      if (!localOrder.includes(getId(item))) ordered.push(item)
    }
    return ordered
  }, [items, localOrder, getId])

  const handleDragEnd = useCallback((e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const ids = orderedItems.map(getId)
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    const next = arrayMove(ids, from, to)
    setLocalOrder(next)
    if (onReorder) void Promise.resolve(onReorder(next)).then(() => setLocalOrder(null))
  }, [orderedItems, getId, onReorder])

  return { sensors, orderedItems, handleDragEnd }
}
