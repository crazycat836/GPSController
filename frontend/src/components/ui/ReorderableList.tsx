import type { ReactNode } from 'react'
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
  type SensorDescriptor,
  type SensorOptions,
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'

interface ReorderableListProps {
  sensors: SensorDescriptor<SensorOptions>[]
  onDragEnd: (event: DragEndEvent) => void
  /** Sorted row ids, in render order. */
  items: string[]
  children: ReactNode
}

// Shared DndContext + SortableContext scaffold for every sortable list in
// the app. Keeps the collision/strategy policy (closestCenter + vertical
// list) defined once; sensors/onDragEnd come from useDragReorder.
export default function ReorderableList({ sensors, onDragEnd, items, children }: ReorderableListProps) {
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  )
}
