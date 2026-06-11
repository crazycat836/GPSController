import { useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Tag as TagIcon } from 'lucide-react'
import { DndContext, closestCenter } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { BookmarkTag } from '../../hooks/useBookmarks'
import { ICON_SIZE } from '../../lib/icons'
import { getTagColor } from '../../lib/bookmarks'
import { commitTrimmedRename } from '../../lib/rename'
import { useT } from '../../i18n'
import { useModalDismiss } from '../../hooks/useModalDismiss'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useOptimisticOrder } from '../../hooks/useOptimisticOrder'
import ConfirmDialog from '../ui/ConfirmDialog'
import SortableNameRow from './SortableNameRow'

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

const getTagId = (tg: BookmarkTag) => tg.id

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
  const dialogRef = useRef<HTMLDivElement>(null)

  const {
    sensors,
    orderedItems: orderedTags,
    handleDragEnd,
  } = useOptimisticOrder(tags, getTagId, onReorder)

  useModalDismiss({ open, onDismiss: onClose })
  useFocusTrap(dialogRef, open)

  const commitRename = useCallback((id: string) => {
    const current = tags.find((x) => x.id === id)
    if (onRename) {
      commitTrimmedRename(editingName, current?.name, (n) => onRename(id, n))
    }
    setEditingId(null)
  }, [editingName, tags, onRename])

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
              {orderedTags.map((tg) => {
                const deletable = !!onDelete && !PRESET_TAG_IDS.has(tg.id)
                return (
                  <SortableNameRow
                    key={tg.id}
                    id={tg.id}
                    dotColor={getTagColor(tg)}
                    isEditing={editingId === tg.id}
                    editingName={editingName}
                    onStartEdit={() => { setEditingId(tg.id); setEditingName(tg.name) }}
                    onCommitEdit={() => commitRename(tg.id)}
                    onChangeEditingName={setEditingName}
                    onCancelEdit={() => setEditingId(null)}
                    renameLabel={t('bm.rename_tag')}
                    renamable={!!onRename}
                    onDelete={deletable ? () => setConfirmDelete(tg) : undefined}
                  >
                    <div className="list-row-title flex items-center gap-1.5">
                      <span>{tg.name}</span>
                    </div>
                  </SortableNameRow>
                )
              })}
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
