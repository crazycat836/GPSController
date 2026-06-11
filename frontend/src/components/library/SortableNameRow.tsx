import React from 'react'
import { Pencil, Trash2, GripVertical } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ICON_SIZE } from '../../lib/icons'
import { useT } from '../../i18n'
import InlineRenameInput from '../ui/InlineRenameInput'

/** Width (px) of the spacer that stands in for the grip on undraggable rows. */
const DRAG_HANDLE_SPACER_PX = 22

interface SortableNameRowProps {
  id: string
  /** Disable dragging and swap the grip for a spacer (preset rows). */
  dragDisabled?: boolean
  /** Color of the leading identity dot. */
  dotColor: string
  isEditing: boolean
  editingName: string
  onStartEdit: () => void
  onCommitEdit: () => void
  onChangeEditingName: (v: string) => void
  onCancelEdit: () => void
  /** Translated title/aria for the rename pencil. */
  renameLabel: string
  /** Show the rename pencil (hidden while editing). */
  renamable: boolean
  /** Omit to hide the delete button. */
  onDelete?: () => void
  /** Display node shown when not editing. */
  children: React.ReactNode
}

/**
 * One sortable name row in the Place / Tag manager dialogs: grip handle
 * (or spacer), color dot, inline-renamable name, pencil + trash actions.
 * The two dialogs are kept structurally identical so the mental model
 * stays consistent — this row is that shared structure.
 */
export default function SortableNameRow({
  id,
  dragDisabled = false,
  dotColor,
  isEditing,
  editingName,
  onStartEdit,
  onCommitEdit,
  onChangeEditingName,
  onCancelEdit,
  renameLabel,
  renamable,
  onDelete,
  children,
}: SortableNameRowProps) {
  const t = useT()
  const sortable = useSortable({ id, disabled: dragDisabled })
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = sortable
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    background: 'var(--color-surface-2)',
    opacity: isDragging ? 0.6 : 1,
  }

  return (
    <div ref={setNodeRef} className="list-row list-row--compact" style={style}>
      <span className="list-row-leading flex items-center gap-1">
        {!dragDisabled ? (
          <button
            type="button"
            className="kebab-btn"
            aria-label={t('bm.reorder')}
            {...attributes}
            {...listeners}
            style={{ cursor: 'grab', color: 'var(--color-text-3)' }}
          >
            <GripVertical width={ICON_SIZE.sm} height={ICON_SIZE.sm} />
          </button>
        ) : (
          <span aria-hidden style={{ width: DRAG_HANDLE_SPACER_PX }} />
        )}
        <span
          aria-hidden="true"
          style={{
            width: 10, height: 10, borderRadius: '50%',
            background: dotColor,
            flexShrink: 0,
          }}
        />
      </span>
      <div className="list-row-body">
        {isEditing ? (
          <InlineRenameInput
            value={editingName}
            onChange={onChangeEditingName}
            onCommit={onCommitEdit}
            onCancel={onCancelEdit}
          />
        ) : (
          children
        )}
      </div>
      <span className="list-row-trailing">
        {renamable && !isEditing && (
          <button
            type="button"
            className="kebab-btn"
            title={renameLabel}
            aria-label={renameLabel}
            onClick={onStartEdit}
          >
            <Pencil width={ICON_SIZE.sm} height={ICON_SIZE.sm} />
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            className="kebab-btn"
            title={t('generic.delete')}
            aria-label={t('generic.delete')}
            onClick={onDelete}
            style={{ color: 'var(--color-danger-text)' }}
          >
            <Trash2 width={ICON_SIZE.sm} height={ICON_SIZE.sm} />
          </button>
        )}
      </span>
    </div>
  )
}
