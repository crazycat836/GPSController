import React from 'react'
import { GripVertical } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ICON_SIZE } from '../../lib/icons'

interface SortableHandleRowProps {
  id: string
  children: React.ReactNode
}

/**
 * Reorder-mode wrapper shared by the Bookmarks / Routes panels: a
 * dnd-kit sortable row with a leading grab handle and the fully-rendered
 * row content beside it. Drag activates only from the handle.
 */
export default function SortableHandleRow({ id, children }: SortableHandleRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.55 : 1,
  }
  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-1.5">
      <button
        type="button"
        className="cursor-grab active:cursor-grabbing px-1 text-[var(--color-text-3)] hover:text-[var(--color-text-1)] focus:outline-none"
        aria-label="drag handle"
        {...attributes}
        {...listeners}
      >
        <GripVertical width={ICON_SIZE.sm} height={ICON_SIZE.sm} />
      </button>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}
