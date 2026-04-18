import React, { useCallback, useMemo, useState } from 'react'
import {
  Plus, Bookmark as BookmarkIcon, Pencil, Trash2, Copy,
  FolderInput, Download, Upload, Layers, Check, X, ClipboardList, StickyNote,
} from 'lucide-react'
import { useBookmarkContext } from '../../contexts/BookmarkContext'
import type { Bookmark, BookmarkCategory } from '../../hooks/useBookmarks'
import { useT } from '../../i18n'
import { ICON_SIZE } from '../../lib/icons'
import ListRow from '../ui/ListRow'
import SearchField from '../ui/SearchField'
import ChipFilterBar, { type Chip } from '../ui/ChipFilterBar'
import KebabMenu, { type KebabMenuItem } from '../ui/KebabMenu'
import EmptyState from '../ui/EmptyState'
import ConfirmDialog from '../ui/ConfirmDialog'
import BookmarkEditDialog, { type BookmarkEditValues } from './BookmarkEditDialog'
import CategoryManagerDialog, { getCategoryColor } from './CategoryManagerDialog'

interface BookmarksPanelProps {
  onBookmarkClick: (lat: number, lng: number) => void
  currentPosition: { lat: number; lng: number } | null
}

const ALL_ID = '__all__' as const

export default function BookmarksPanel({ onBookmarkClick, currentPosition }: BookmarksPanelProps) {
  const t = useT()
  const bm = useBookmarkContext()
  const { bookmarks, categories } = bm

  const [search, setSearch] = useState('')
  const [activeCategoryId, setActiveCategoryId] = useState<string>(ALL_ID)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<{ mode: 'create' | 'edit'; bookmark?: Bookmark } | null>(null)
  const [categoryMgrOpen, setCategoryMgrOpen] = useState(false)
  const [confirm, setConfirm] = useState<null | { kind: 'single'; id: string; name: string } | { kind: 'batch'; ids: string[] }>(null)
  const [inlineEditId, setInlineEditId] = useState<string | null>(null)
  const [inlineEditName, setInlineEditName] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const displayCat = useCallback((name: string) => (name === '預設' ? t('bm.default') : name), [t])

  const categoryMap = useMemo(() => {
    const m = new Map<string, BookmarkCategory>()
    categories.forEach((c) => m.set(c.id, c))
    return m
  }, [categories])

  // Filtering: search first (flat), then category chip.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const searching = q.length > 0
    return bookmarks.filter((b) => {
      const cat = categoryMap.get(b.category_id || '')
      const catName = cat?.name || ''
      if (searching) {
        const name = (b.name ?? '').toLowerCase()
        const catLower = catName.toLowerCase()
        const coord = `${b.lat.toFixed(5)}, ${b.lng.toFixed(5)}`
        return name.includes(q) || catLower.includes(q) || coord.includes(q)
      }
      if (activeCategoryId === ALL_ID) return true
      return b.category_id === activeCategoryId
    })
  }, [bookmarks, search, activeCategoryId, categoryMap])

  const chips = useMemo<Chip<string>[]>(() => {
    const list: Chip<string>[] = [{ id: ALL_ID, label: t('bm.filter_all'), count: bookmarks.length }]
    for (const cat of categories) {
      list.push({
        id: cat.id,
        label: displayCat(cat.name),
        color: getCategoryColor(cat.name),
        count: bookmarks.filter((b) => b.category_id === cat.id).length,
      })
    }
    return list
  }, [bookmarks, categories, displayCat])

  // ─── Selection mode ─────────────────────────────────────────
  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  const exitSelection = useCallback(() => {
    setSelectionMode(false)
    setSelectedIds(new Set())
  }, [])

  // ─── Mutations ──────────────────────────────────────────────
  const handleCreate = useCallback((values: BookmarkEditValues) => {
    void bm.createBookmark({
      name: values.name,
      lat: values.lat,
      lng: values.lng,
      category_id: values.categoryId,
      note: values.note,
    })
    setEditing(null)
  }, [bm])

  const handleUpdate = useCallback((id: string, values: BookmarkEditValues) => {
    void bm.updateBookmark(id, {
      name: values.name,
      lat: values.lat,
      lng: values.lng,
      category_id: values.categoryId,
      note: values.note,
    })
    setEditing(null)
  }, [bm])

  const handleCopy = useCallback(async (b: Bookmark) => {
    const text = `${b.name} ${b.lat.toFixed(6)}, ${b.lng.toFixed(6)}`
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand('copy') } catch { /* ignore */ }
      document.body.removeChild(ta)
    }
    setCopiedId(b.id)
    setTimeout(() => setCopiedId((prev) => (prev === b.id ? null : prev)), 1200)
  }, [])

  const confirmDeleteOne = useCallback((b: Bookmark) => {
    setConfirm({ kind: 'single', id: b.id, name: b.name })
  }, [])

  const confirmBatchDelete = useCallback(() => {
    setConfirm({ kind: 'batch', ids: Array.from(selectedIds) })
  }, [selectedIds])

  const runConfirm = useCallback(async () => {
    if (!confirm) return
    if (confirm.kind === 'single') {
      await bm.deleteBookmark(confirm.id)
    } else {
      await bm.deleteBookmarksBatch(confirm.ids)
      exitSelection()
    }
    setConfirm(null)
  }, [confirm, bm, exitSelection])

  const commitInlineRename = useCallback((id: string) => {
    const next = inlineEditName.trim()
    const current = bookmarks.find((b) => b.id === id)
    if (next && current && next !== current.name) {
      void bm.updateBookmark(id, { name: next })
    }
    setInlineEditId(null)
  }, [inlineEditName, bookmarks, bm])

  // ─── Import helper ──────────────────────────────────────────
  const handleImportFile = useCallback(async (file: File) => {
    await bm.handleBookmarkImport(file)
  }, [bm])

  // ─── Header kebab items ─────────────────────────────────────
  const headerMenuItems: KebabMenuItem[] = useMemo(() => [
    {
      id: 'custom',
      label: t('bm.add_custom'),
      icon: <Plus width={ICON_SIZE.sm} height={ICON_SIZE.sm} />,
      onSelect: () => setEditing({ mode: 'create' }),
    },
    {
      id: 'select',
      label: selectionMode ? t('bm.select_cancel') : t('bm.select'),
      icon: <ClipboardList width={ICON_SIZE.sm} height={ICON_SIZE.sm} />,
      onSelect: () => {
        if (selectionMode) exitSelection()
        else setSelectionMode(true)
      },
    },
    {
      id: 'import',
      label: t('bm.import'),
      icon: <Upload width={ICON_SIZE.sm} height={ICON_SIZE.sm} />,
      onSelect: () => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = 'application/json,.json'
        input.onchange = () => {
          const f = input.files?.[0]
          if (f) void handleImportFile(f)
        }
        input.click()
      },
    },
    {
      id: 'export',
      label: t('bm.export'),
      icon: <Download width={ICON_SIZE.sm} height={ICON_SIZE.sm} />,
      disabled: bookmarks.length === 0,
      onSelect: () => {
        const a = document.createElement('a')
        a.href = bm.bookmarkExportUrl
        a.download = 'bookmarks.json'
        a.click()
      },
    },
    {
      id: 'manage',
      label: t('bm.manage_categories'),
      icon: <Layers width={ICON_SIZE.sm} height={ICON_SIZE.sm} />,
      onSelect: () => setCategoryMgrOpen(true),
    },
  ], [t, selectionMode, exitSelection, bookmarks.length, bm.bookmarkExportUrl, handleImportFile])

  // ─── Row kebab builder ──────────────────────────────────────
  const rowMenuItems = useCallback((b: Bookmark): KebabMenuItem[] => {
    const items: KebabMenuItem[] = [
      {
        id: 'edit',
        label: t('bm.edit'),
        icon: <Pencil width={ICON_SIZE.sm} height={ICON_SIZE.sm} />,
        onSelect: () => setEditing({ mode: 'edit', bookmark: b }),
      },
      {
        id: 'copy',
        label: t('bm.copy'),
        icon: <Copy width={ICON_SIZE.sm} height={ICON_SIZE.sm} />,
        onSelect: () => void handleCopy(b),
      },
      {
        id: 'delete',
        label: t('generic.delete'),
        icon: <Trash2 width={ICON_SIZE.sm} height={ICON_SIZE.sm} />,
        kind: 'danger',
        onSelect: () => confirmDeleteOne(b),
      },
    ]
    const others = categories.filter((c) => c.id !== b.category_id)
    if (others.length > 0) {
      items.push({ id: 'move-section', kind: 'section', label: t('bm.move_to') })
      others.forEach((cat) => {
        items.push({
          id: `move-${cat.id}`,
          label: displayCat(cat.name),
          icon: <FolderInput width={ICON_SIZE.sm} height={ICON_SIZE.sm} />,
          colorDot: getCategoryColor(cat.name),
          onSelect: () => void bm.updateBookmark(b.id, { category_id: cat.id }),
        })
      })
    }
    return items
  }, [t, categories, bm, handleCopy, confirmDeleteOne, displayCat])

  // ─── Render ─────────────────────────────────────────────────
  const searching = search.trim().length > 0

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* Header: primary CTA + kebab */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="seg-cta seg-cta-sm seg-cta-accent flex-1"
          onClick={() => setEditing({ mode: 'create' })}
          disabled={selectionMode}
        >
          <Plus width={ICON_SIZE.sm} height={ICON_SIZE.sm} />
          {t('bm.add')}
        </button>
        <KebabMenu items={headerMenuItems} ariaLabel={t('bm.manage_categories')} />
      </div>

      {/* Search */}
      <SearchField
        value={search}
        onChange={setSearch}
        placeholder={t('bm.search_placeholder')}
        clearLabel={t('bm.search_clear')}
      />

      {/* Category chip filter — hidden while searching */}
      {!searching && categories.length > 0 && (
        <ChipFilterBar
          chips={chips}
          activeId={activeCategoryId}
          onChange={setActiveCategoryId}
          ariaLabel={t('bm.manage_categories')}
          visibleCap={5}
        />
      )}

      {/* Batch bar */}
      {selectionMode && (
        <div className="batch-bar" role="toolbar" aria-label={t('bm.selection_toolbar')}>
          <span className="batch-bar-count">{t('bm.selected_count', { n: selectedIds.size })}</span>
          <button
            type="button"
            className="action-btn"
            disabled={selectedIds.size === 0}
            onClick={() => setSelectedIds(new Set())}
          >
            {t('bm.clear_selection')}
          </button>
          <button
            type="button"
            className="action-btn danger"
            disabled={selectedIds.size === 0}
            onClick={confirmBatchDelete}
          >
            <Trash2 width={ICON_SIZE.sm} height={ICON_SIZE.sm} />
            {t('generic.delete')}
          </button>
          <button
            type="button"
            className="kebab-btn"
            aria-label={t('bm.select_cancel')}
            title={t('bm.select_cancel')}
            onClick={exitSelection}
          >
            <X width={ICON_SIZE.sm} height={ICON_SIZE.sm} />
          </button>
        </div>
      )}

      {/* List */}
      {bookmarks.length === 0 ? (
        <EmptyState
          icon={<BookmarkIcon width={ICON_SIZE.lg} height={ICON_SIZE.lg} />}
          title={t('bm.empty')}
          help={t('bm.add_here')}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<BookmarkIcon width={ICON_SIZE.lg} height={ICON_SIZE.lg} />}
          title={searching ? t('bm.search_no_results') : t('bm.blank')}
        />
      ) : (
        <div className="flex flex-col gap-1.5">
          {filtered.map((b) => {
            const cat = categoryMap.get(b.category_id || '')
            const catName = cat?.name || ''
            const catColor = cat ? getCategoryColor(catName) : 'var(--color-text-3)'
            const checked = selectedIds.has(b.id)
            const isInlineEditing = inlineEditId === b.id

            const leading = (
              <>
                {selectionMode ? (
                  <span
                    aria-hidden="true"
                    className="w-4 h-4 rounded-[4px] border flex items-center justify-center"
                    style={{
                      borderColor: checked ? 'var(--color-accent)' : 'var(--color-border-strong)',
                      background: checked ? 'var(--color-accent)' : 'transparent',
                    }}
                  >
                    {checked && <Check width={ICON_SIZE.xs} height={ICON_SIZE.xs} className="text-white" />}
                  </span>
                ) : (
                  <>
                    <span
                      aria-hidden="true"
                      style={{ width: 8, height: 8, borderRadius: '50%', background: catColor }}
                    />
                    {b.country_code && (
                      <img
                        src={`https://flagcdn.com/w40/${b.country_code}.png`}
                        alt={b.country_code.toUpperCase()}
                        width={14}
                        height={10}
                        className="rounded-[2px] shadow-[0_0_0_1px_rgba(255,255,255,0.08)]"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                      />
                    )}
                  </>
                )}
              </>
            )

            const titleNode = isInlineEditing ? (
              <input
                autoFocus
                type="text"
                className="search-input w-full"
                value={inlineEditName}
                onChange={(e) => setInlineEditName(e.target.value)}
                onBlur={() => commitInlineRename(b.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitInlineRename(b.id)
                  else if (e.key === 'Escape') setInlineEditId(null)
                }}
                onClick={(e) => e.stopPropagation()}
                style={{ paddingLeft: 8, height: 28 }}
              />
            ) : (
              <>
                <span className="truncate">{b.name}</span>
                {copiedId === b.id && (
                  <span className="text-[10px] text-[var(--color-success-text)]">
                    <Check width={ICON_SIZE.xs} height={ICON_SIZE.xs} />
                  </span>
                )}
                {b.note && (
                  <StickyNote
                    width={ICON_SIZE.xs}
                    height={ICON_SIZE.xs}
                    className="text-[var(--color-text-3)] opacity-60 shrink-0"
                    aria-label={t('bm.has_note')}
                  />
                )}
              </>
            )

            const meta = cat ? (
              <span className="opacity-75 truncate max-w-[80px]">
                {displayCat(catName)}
              </span>
            ) : undefined

            const trailing = selectionMode ? undefined : (
              <KebabMenu
                items={() => rowMenuItems(b)}
                ariaLabel={t('bm.bookmark_actions')}
              />
            )

            return (
              <ListRow
                key={b.id}
                as="button"
                density="compact"
                selected={selectionMode && checked}
                onClick={() => {
                  if (selectionMode) toggleSelected(b.id)
                  else if (!isInlineEditing) onBookmarkClick(b.lat, b.lng)
                }}
                onDoubleClick={(e) => {
                  if (selectionMode) return
                  e.preventDefault()
                  setInlineEditId(b.id)
                  setInlineEditName(b.name)
                }}
                onContextMenu={(e) => {
                  // Keep muscle-memory: right-click surfaces the same kebab
                  // menu without requiring users to find the small ⋮ trigger.
                  if (selectionMode || isInlineEditing) return
                  e.preventDefault()
                  const kebab = (e.currentTarget as HTMLElement)
                    .querySelector<HTMLButtonElement>('.list-row-trailing .kebab-btn')
                  kebab?.click()
                }}
                aria-label={b.name}
                aria-pressed={selectionMode ? checked : undefined}
                leading={leading}
                title={titleNode}
                subtitle={`${b.lat.toFixed(5)}, ${b.lng.toFixed(5)}`}
                monoSubtitle
                meta={meta}
                trailing={trailing}
              />
            )
          })}
        </div>
      )}

      {/* Edit dialog (create + edit share one component) */}
      {editing && (
        editing.mode === 'create' ? (
          <BookmarkEditDialog
            open
            mode="create"
            currentPosition={currentPosition}
            categories={categories}
            onClose={() => setEditing(null)}
            onSubmit={handleCreate}
          />
        ) : editing.bookmark ? (
          <BookmarkEditDialog
            open
            mode="edit"
            currentPosition={currentPosition}
            categories={categories}
            initial={{
              id: editing.bookmark.id,
              name: editing.bookmark.name,
              lat: editing.bookmark.lat,
              lng: editing.bookmark.lng,
              categoryId: editing.bookmark.category_id || categories[0]?.id || 'default',
              note: editing.bookmark.note,
            }}
            onClose={() => setEditing(null)}
            onSubmit={(values) => handleUpdate(editing.bookmark!.id, values)}
          />
        ) : null
      )}

      {/* Category manager */}
      <CategoryManagerDialog
        open={categoryMgrOpen}
        onClose={() => setCategoryMgrOpen(false)}
        categories={categories}
        onAdd={async (name) => { await bm.createCategory({ name }) }}
        onDelete={(id) => bm.deleteCategory(id)}
      />

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!confirm}
        title={t('generic.delete')}
        description={
          confirm?.kind === 'batch'
            ? t('bm.confirm_batch_delete', { n: confirm.ids.length })
            : confirm?.kind === 'single'
              ? t('bm.confirm_delete', { name: confirm.name })
              : undefined
        }
        confirmLabel={t('generic.delete')}
        cancelLabel={t('generic.cancel')}
        tone="danger"
        onConfirm={runConfirm}
        onCancel={() => setConfirm(null)}
      />
    </div>
  )
}
