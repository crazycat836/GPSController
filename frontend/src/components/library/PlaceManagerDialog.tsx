import React, { useCallback, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MapPin, Pencil, Trash2, Plus, GripVertical } from 'lucide-react'
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
import type { BookmarkPlace } from '../../hooks/useBookmarks'
import { ICON_SIZE } from '../../lib/icons'
import { useT } from '../../i18n'
import { useModalDismiss } from '../../hooks/useModalDismiss'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import ConfirmDialog from '../ui/ConfirmDialog'

interface PlaceManagerDialogProps {
  open: boolean
  onClose: () => void
  places: readonly BookmarkPlace[]
  onAdd: (name: string) => void | Promise<void>
  onDelete: (id: string) => void | Promise<void>
  onRename?: (id: string, name: string) => void | Promise<void>
  onReorder?: (orderedIds: string[]) => void | Promise<void>
}

// Deterministic colour per place name. Keeps the fixed mappings that
// predate the place/tag split so existing names stay visually stable.
const FIXED_COLORS: Record<string, string> = {
  Default: 'var(--color-cat-default)',
  Home: 'var(--color-cat-home)',
  Work: 'var(--color-cat-work)',
  Favorites: 'var(--color-cat-favorites)',
  Custom: 'var(--color-cat-custom)',
}

export function getPlaceColor(name: string): string {
  if (FIXED_COLORS[name]) return FIXED_COLORS[name]
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  const hue = Math.abs(hash) % 360
  return `hsl(${hue}, 60%, 55%)`
}

const isDefault = (p: BookmarkPlace) =>
  p.id === 'default' || p.name === 'Default' || p.name === '預設'

interface SortableRowProps {
  place: BookmarkPlace
  editable: boolean
  deletable: boolean
  isEditing: boolean
  editingName: string
  onStartEdit: () => void
  onCommitEdit: () => void
  onChangeEditingName: (v: string) => void
  onCancelEdit: () => void
  onDelete: () => void
  displayName: string
}

function SortableRow({
  place,
  editable,
  deletable,
  isEditing,
  editingName,
  onStartEdit,
  onCommitEdit,
  onChangeEditingName,
  onCancelEdit,
  onDelete,
  displayName,
}: SortableRowProps) {
  const t = useT()
  const sortable = useSortable({ id: place.id, disabled: isDefault(place) })
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
        {!isDefault(place) ? (
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
          <span aria-hidden style={{ width: 22 }} />
        )}
        <span
          aria-hidden="true"
          style={{
            width: 10, height: 10, borderRadius: '50%',
            background: getPlaceColor(place.name),
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
          <div className="list-row-title">{displayName}</div>
        )}
      </div>
      <span className="list-row-trailing">
        {editable && !isEditing && (
          <button
            type="button"
            className="kebab-btn"
            title={t('bm.rename_category')}
            aria-label={t('bm.rename_category')}
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
 * Manage the "place" axis (single-valued per bookmark: where the bookmark
 * is located). Mirrors the Tag manager but for places; the two are kept
 * structurally identical so the mental model stays consistent.
 */
export default function PlaceManagerDialog({
  open,
  onClose,
  places,
  onAdd,
  onDelete,
  onRename,
  onReorder,
}: PlaceManagerDialogProps) {
  const t = useT()
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<BookmarkPlace | null>(null)
  const [localOrder, setLocalOrder] = useState<string[] | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Require a small drag before activating so plain-click still edits /
      // deletes via the row buttons instead of immediately entering a drag.
      activationConstraint: { distance: 4 },
    }),
  )

  useModalDismiss({ open, onDismiss: onClose })
  useFocusTrap(dialogRef, open)

  // Prefer the locally-reordered list while a drag is in flight — once the
  // parent refreshes the `places` prop we drop it and trust props again.
  const orderedPlaces = useMemo(() => {
    if (!localOrder) return places
    const byId = new Map(places.map((p) => [p.id, p]))
    const ordered: BookmarkPlace[] = []
    for (const id of localOrder) {
      const p = byId.get(id)
      if (p) ordered.push(p)
    }
    for (const p of places) {
      if (!localOrder.includes(p.id)) ordered.push(p)
    }
    return ordered
  }, [places, localOrder])

  const commitAdd = useCallback(() => {
    const n = newName.trim()
    if (!n) return
    void onAdd(n)
    setNewName('')
  }, [newName, onAdd])

  const commitRename = useCallback((id: string) => {
    const n = editingName.trim()
    const current = places.find((p) => p.id === id)
    if (current && n && n !== current.name && onRename) {
      void onRename(id, n)
    }
    setEditingId(null)
  }, [editingName, places, onRename])

  const handleDragEnd = useCallback(
    (e: DragEndEvent) => {
      const { active, over } = e
      if (!over || active.id === over.id) return
      const ids = orderedPlaces.map((p) => p.id)
      const from = ids.indexOf(String(active.id))
      const to = ids.indexOf(String(over.id))
      if (from < 0 || to < 0) return
      const next = arrayMove(ids, from, to)
      setLocalOrder(next)
      if (onReorder) void Promise.resolve(onReorder(next)).then(() => setLocalOrder(null))
    },
    [orderedPlaces, onReorder],
  )

  if (!open) return null

  return createPortal(
    <div data-fc="modal.place-manager" className="modal-overlay anim-fade-in" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('bm.manage_places')}
        className="modal-dialog anim-scale-in"
        style={{ width: 380 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-title flex items-center gap-2">
          <MapPin width={ICON_SIZE.md} height={ICON_SIZE.md} className="text-[var(--color-accent)]" />
          {t('bm.manage_places')}
        </div>

        <div className="flex flex-col gap-1.5 mt-2 max-h-[320px] overflow-y-auto scrollbar-thin">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext
              items={orderedPlaces.map((p) => p.id)}
              strategy={verticalListSortingStrategy}
            >
              {orderedPlaces.map((place) => {
                const editable = !isDefault(place) && !!onRename
                const deletable = !isDefault(place)
                const displayName = isDefault(place) ? t('bm.default') : place.name
                return (
                  <SortableRow
                    key={place.id}
                    place={place}
                    editable={editable}
                    deletable={deletable}
                    isEditing={editingId === place.id}
                    editingName={editingName}
                    onStartEdit={() => { setEditingId(place.id); setEditingName(place.name) }}
                    onCommitEdit={() => commitRename(place.id)}
                    onChangeEditingName={setEditingName}
                    onCancelEdit={() => setEditingId(null)}
                    onDelete={() => setConfirmDelete(place)}
                    displayName={displayName}
                  />
                )
              })}
            </SortableContext>
          </DndContext>
        </div>

        <div className="flex gap-2 mt-3">
          <input
            type="text"
            className="search-input flex-1"
            placeholder={t('bm.place_add_placeholder')}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) commitAdd() }}
            style={{ paddingLeft: 10 }}
          />
          <button
            type="button"
            className="action-btn primary"
            disabled={!newName.trim()}
            onClick={commitAdd}
          >
            <Plus width={ICON_SIZE.sm} height={ICON_SIZE.sm} />
            {t('bm.new_category')}
          </button>
        </div>

        <div className="modal-actions">
          <button type="button" className="action-btn" onClick={onClose}>
            {t('generic.cancel')}
          </button>
        </div>

        <ConfirmDialog
          open={!!confirmDelete}
          title={t('bm.place_delete_title')}
          description={confirmDelete ? t('bm.place_delete_confirm', { name: confirmDelete.name }) : undefined}
          confirmLabel={t('generic.delete')}
          cancelLabel={t('generic.cancel')}
          tone="danger"
          onConfirm={async () => {
            if (confirmDelete) await onDelete(confirmDelete.id)
            setConfirmDelete(null)
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      </div>
    </div>,
    document.body,
  )
}
