import React, { useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Layers, Pencil, Trash2, Plus } from 'lucide-react'
import type { BookmarkCategory } from '../../hooks/useBookmarks'
import { ICON_SIZE } from '../../lib/icons'
import { useT } from '../../i18n'
import { useModalDismiss } from '../../hooks/useModalDismiss'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import ConfirmDialog from '../ui/ConfirmDialog'

interface CategoryManagerDialogProps {
  open: boolean
  onClose: () => void
  categories: readonly BookmarkCategory[]
  onAdd: (name: string) => void | Promise<void>
  onDelete: (id: string) => void | Promise<void>
  onRename?: (id: string, name: string) => void | Promise<void>
}

// Deterministic category color (mirrors the old BookmarkList implementation).
const FIXED_COLORS: Record<string, string> = {
  Default: 'var(--color-cat-default)',
  Home: 'var(--color-cat-home)',
  Work: 'var(--color-cat-work)',
  Favorites: 'var(--color-cat-favorites)',
  Custom: 'var(--color-cat-custom)',
}
export function getCategoryColor(name: string): string {
  if (FIXED_COLORS[name]) return FIXED_COLORS[name]
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  const hue = Math.abs(hash) % 360
  return `hsl(${hue}, 60%, 55%)`
}

// Full-screen-style modal for category CRUD. Replaces the inline collapse
// panel that used to cram this flow inside the bookmark list.
export default function CategoryManagerDialog({
  open,
  onClose,
  categories,
  onAdd,
  onDelete,
  onRename,
}: CategoryManagerDialogProps) {
  const t = useT()
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<BookmarkCategory | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  useModalDismiss({ open, onDismiss: onClose })
  useFocusTrap(dialogRef, open)

  const commitAdd = useCallback(() => {
    const n = newName.trim()
    if (!n) return
    void onAdd(n)
    setNewName('')
  }, [newName, onAdd])

  const commitRename = useCallback((id: string) => {
    const n = editingName.trim()
    const current = categories.find((c) => c.id === id)
    if (current && n && n !== current.name && onRename) {
      void onRename(id, n)
    }
    setEditingId(null)
  }, [editingName, categories, onRename])

  if (!open) return null

  const isDefault = (cat: BookmarkCategory) => cat.name === 'Default' || cat.name === '預設'

  return createPortal(
    <div data-fc="modal.category-manager" className="modal-overlay anim-fade-in" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('bm.manage_categories')}
        className="modal-dialog anim-scale-in"
        style={{ width: 380 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-title flex items-center gap-2">
          <Layers width={ICON_SIZE.md} height={ICON_SIZE.md} className="text-[var(--color-accent)]" />
          {t('bm.manage_categories')}
        </div>

        {/* List */}
        <div className="flex flex-col gap-1.5 mt-2 max-h-[280px] overflow-y-auto scrollbar-thin">
          {categories.map((cat) => {
            const editable = !isDefault(cat) && !!onRename
            const deletable = !isDefault(cat)
            const isEditing = editingId === cat.id
            return (
              <div
                key={cat.id}
                className="list-row list-row--compact"
                style={{ background: 'var(--color-surface-2)' }}
              >
                <span className="list-row-leading">
                  <span
                    aria-hidden="true"
                    style={{
                      width: 10, height: 10, borderRadius: '50%',
                      background: getCategoryColor(cat.name),
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
                      onChange={(e) => setEditingName(e.target.value)}
                      onBlur={() => commitRename(cat.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.nativeEvent.isComposing) commitRename(cat.id)
                        else if (e.key === 'Escape') setEditingId(null)
                      }}
                      style={{ paddingLeft: 8 }}
                    />
                  ) : (
                    <div className="list-row-title">
                      {isDefault(cat) ? t('bm.default') : cat.name}
                    </div>
                  )}
                </div>
                <span className="list-row-trailing">
                  {editable && !isEditing && (
                    <button
                      type="button"
                      className="kebab-btn"
                      title={t('bm.rename_category')}
                      aria-label={t('bm.rename_category')}
                      onClick={() => { setEditingId(cat.id); setEditingName(cat.name) }}
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
                      onClick={() => setConfirmDelete(cat)}
                      style={{ color: 'var(--color-danger-text)' }}
                    >
                      <Trash2 width={ICON_SIZE.sm} height={ICON_SIZE.sm} />
                    </button>
                  )}
                </span>
              </div>
            )
          })}
        </div>

        {/* Add new */}
        <div className="flex gap-2 mt-3">
          <input
            type="text"
            className="search-input flex-1"
            placeholder={t('bm.category_add_placeholder')}
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
          title={t('bm.category_delete_title')}
          description={confirmDelete ? t('bm.category_delete_confirm', { name: confirmDelete.name }) : undefined}
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
