import React, { useCallback, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Tag as TagIcon, Pencil, Trash2, GripVertical } from 'lucide-react'
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { BookmarkTag } from '../../hooks/useBookmarks'
import { ICON_SIZE } from '../../lib/icons'
import { useT } from '../../i18n'
import { useModalDismiss } from '../../hooks/useModalDismiss'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import ConfirmDialog from '../ui/ConfirmDialog'

interface TagManagerDialogProps {
  open: boolean
  onClose: () => void
  tags: readonly BookmarkTag[]
  /** Optional — omit to disable deletion entirely (tags-are-fixed mode). */
  onDelete?: (id: string) => void | Promise<void>
  /** Optional — omit to disable rename. */
  onRename?: (id: string, name: string) => void | Promise<void>
  onReorder?: (orderedIds: string[]) => void | Promise<void>
}

// Preset-tag ids seeded by the backend. Kept in lockstep with
// backend/services/bookmarks.py :: _PRESET_TAGS. Preset tags can be renamed
// and reordered but not deleted — the backend's _ensure_presets would
// re-seed them on the next load anyway, and deletion would silently churn
// bookmark tag lists for no user-visible gain.
const PRESET_TAG_IDS = new Set(['preset_scanner', 'preset_mushroom', 'preset_flower'])

const FIXED_COLORS: Record<string, string> = {
  '掃描器': '#4A90E2',
  '菇': '#A855F7',
  '花': '#EC4899',
}

export function getTagColor(tag: Pick<BookmarkTag, 'name' | 'color'>): string {
  if (tag.color) return tag.color
  if (FIXED_COLORS[tag.name]) return FIXED_COLORS[tag.name]
  let hash = 0
  for (let i = 0; i < tag.name.length; i++) {
    hash = tag.name.charCodeAt(i) + ((hash << 5) - hash)
  }
  const hue = (Math.abs(hash) % 360 + 280) % 360  // bias toward purple/pink range
  return `hsl(${hue}, 58%, 60%)`
}

interface SortableRowProps {
  tag: BookmarkTag
  isEditing: boolean
  editingName: string
  onStartEdit: () => void
  onCommitEdit: () => void
  onChangeEditingName: (v: string) => void
  onCancelEdit: () => void
  onDelete?: () => void
  onRenameAvailable: boolean
}

function SortableRow({
  tag,
  isEditing,
  editingName,
  onStartEdit,
  onCommitEdit,
  onChangeEditingName,
  onCancelEdit,
  onDelete,
  onRenameAvailable,
}: SortableRowProps) {
  const t = useT()
  const sortable = useSortable({ id: tag.id })
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = sortable
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    background: 'var(--color-surface-2)',
    opacity: isDragging ? 0.6 : 1,
  }

  const deletable = !!onDelete && !PRESET_TAG_IDS.has(tag.id)

  return (
    <div ref={setNodeRef} className="list-row list-row--compact" style={style}>
      <span className="list-row-leading flex items-center gap-1">
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
        <span
          aria-hidden="true"
          style={{
            width: 10, height: 10, borderRadius: '50%',
            background: getTagColor(tag),
            flexShrink: 0,
          }}
        />
      </span>
      <div className="list-row-body">
        {isEditing ? (
          <input
            autoFocus
            type="text"
            className="search-input"
            value={editingName}
            onChange={(e) => onChangeEditingName(e.target.value)}
            onBlur={onCommitEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) onCommitEdit()
              else if (e.key === 'Escape') onCancelEdit()
            }}
            style={{ paddingLeft: 8 }}
          />
        ) : (
          <div className="list-row-title flex items-center gap-1.5">
            <span>{tag.name}</span>
          </div>
        )}
      </div>
      <span className="list-row-trailing">
        {onRenameAvailable && !isEditing && (
          <button
            type="button"
            className="kebab-btn"
            title={t('bm.rename_tag')}
            aria-label={t('bm.rename_tag')}
            onClick={onStartEdit}
          >
            <Pencil width={ICON_SIZE.sm} height={ICON_SIZE.sm} />
          </button>
        )}
        {deletable && (
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

/**
 * Manage the "tag" axis (multi-valued per bookmark: what you'll find there).
 *
 * Tags are a fixed vocabulary — the three presets (掃描器 / 菇 / 花) seeded
 * by the backend. This dialog supports rename + reorder only; creation and
 * preset-tag deletion are intentionally absent.
 */
export default function TagManagerDialog({
  open,
  onClose,
  tags,
  onDelete,
  onRename,
  onReorder,
}: TagManagerDialogProps) {
  const t = useT()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<BookmarkTag | null>(null)
  const [localOrder, setLocalOrder] = useState<string[] | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  )

  useModalDismiss({ open, onDismiss: onClose })
  useFocusTrap(dialogRef, open)

  const orderedTags = useMemo(() => {
    if (!localOrder) return tags
    const byId = new Map(tags.map((t) => [t.id, t]))
    const ordered: BookmarkTag[] = []
    for (const id of localOrder) {
      const tg = byId.get(id)
      if (tg) ordered.push(tg)
    }
    for (const tg of tags) {
      if (!localOrder.includes(tg.id)) ordered.push(tg)
    }
    return ordered
  }, [tags, localOrder])

  const commitRename = useCallback((id: string) => {
    const n = editingName.trim()
    const current = tags.find((x) => x.id === id)
    if (current && n && n !== current.name && onRename) {
      void onRename(id, n)
    }
    setEditingId(null)
  }, [editingName, tags, onRename])

  const handleDragEnd = useCallback(
    (e: DragEndEvent) => {
      const { active, over } = e
      if (!over || active.id === over.id) return
      const ids = orderedTags.map((tg) => tg.id)
      const from = ids.indexOf(String(active.id))
      const to = ids.indexOf(String(over.id))
      if (from < 0 || to < 0) return
      const next = arrayMove(ids, from, to)
      setLocalOrder(next)
      if (onReorder) void Promise.resolve(onReorder(next)).then(() => setLocalOrder(null))
    },
    [orderedTags, onReorder],
  )

  if (!open) return null

  return createPortal(
    <div data-fc="modal.tag-manager" className="modal-overlay anim-fade-in" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('bm.manage_tags')}
        className="modal-dialog anim-scale-in"
        style={{ width: 380 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-title flex items-center gap-2">
          <TagIcon width={ICON_SIZE.md} height={ICON_SIZE.md} className="text-[var(--color-accent)]" />
          {t('bm.manage_tags')}
        </div>

        <div className="flex flex-col gap-1.5 mt-2 max-h-[320px] overflow-y-auto scrollbar-thin">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={orderedTags.map((tg) => tg.id)} strategy={verticalListSortingStrategy}>
              {orderedTags.map((tg) => (
                <SortableRow
                  key={tg.id}
                  tag={tg}
                  isEditing={editingId === tg.id}
                  editingName={editingName}
                  onStartEdit={() => { setEditingId(tg.id); setEditingName(tg.name) }}
                  onCommitEdit={() => commitRename(tg.id)}
                  onChangeEditingName={setEditingName}
                  onCancelEdit={() => setEditingId(null)}
                  onDelete={onDelete ? () => setConfirmDelete(tg) : undefined}
                  onRenameAvailable={!!onRename}
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>

        <div className="modal-actions">
          <button type="button" className="action-btn" onClick={onClose}>
            {t('generic.cancel')}
          </button>
        </div>

        <ConfirmDialog
          open={!!confirmDelete}
          title={t('bm.tag_delete_title')}
          description={confirmDelete ? t('bm.tag_delete_confirm', { name: confirmDelete.name }) : undefined}
          confirmLabel={t('generic.delete')}
          cancelLabel={t('generic.cancel')}
          tone="danger"
          onConfirm={async () => {
            if (confirmDelete && onDelete) await onDelete(confirmDelete.id)
            setConfirmDelete(null)
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      </div>
    </div>,
    document.body,
  )
}
