import React, { useCallback, useMemo, useState } from 'react'
import {
  Plus, Bookmark as BookmarkIcon, Pencil, Trash2, Copy,
  FolderInput, Layers, Check, X, ClipboardList, StickyNote,
  ClipboardPaste,
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
import BulkCoordsDialog from './BulkCoordsDialog'

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
  const [bulkOpen, setBulkOpen] = useState(false)

  const displayCat = useCallback((name: string) => (
    name === '預設' || name === 'Default' ? t('bm.default') :
    name === 'Uncategorized' ? t('bm.uncategorized') :
    name
  ), [t])

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

  // Sections for the "All" chip view — design/Home renders library as
  // grouped sections (Pinned / Recents / …). We group by category so
  // users see structure without needing new backend fields.
  const sections = useMemo(() => {
    const searching = search.trim().length > 0
    if (searching || activeCategoryId !== ALL_ID) return null
    const buckets = new Map<string, Bookmark[]>()
    for (const b of filtered) {
      const key = b.category_id || '__uncategorized__'
      if (!buckets.has(key)) buckets.set(key, [])
      buckets.get(key)!.push(b)
    }
    const ordered = categories
      .map((c) => ({
        id: c.id,
        label: displayCat(c.name),
        list: buckets.get(c.id) ?? [],
      }))
      .filter((s) => s.list.length > 0)
    const orphans = buckets.get('__uncategorized__')
    if (orphans && orphans.length > 0) {
      ordered.push({ id: '__uncategorized__', label: displayCat('Uncategorized'), list: orphans })
    }
    return ordered
  }, [filtered, activeCategoryId, search, categories, displayCat])

  // Match by coordinate to flag the currently-loaded bookmark — mirrors
  // the design's `.bm.active` left accent bar. Float epsilon accounts
  // for round-trip through SimContext (stores as number, not string).
  const isBookmarkActive = useCallback((b: Bookmark): boolean => {
    if (!currentPosition) return false
    return Math.abs(b.lat - currentPosition.lat) < 1e-5
      && Math.abs(b.lng - currentPosition.lng) < 1e-5
  }, [currentPosition])

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

  // ─── Header kebab items ─────────────────────────────────────
  const headerMenuItems: KebabMenuItem[] = useMemo(() => [
    {
      id: 'custom',
      label: t('bm.add_custom'),
      icon: <Plus width={ICON_SIZE.sm} height={ICON_SIZE.sm} />,
      onSelect: () => setEditing({ mode: 'create' }),
    },
    {
      id: 'bulk',
      label: t('bm.bulk_import'),
      icon: <ClipboardPaste width={ICON_SIZE.sm} height={ICON_SIZE.sm} />,
      onSelect: () => setBulkOpen(true),
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
    // Import / Export moved to the Drawer's headerActions slot.
    // Manage categories moved to the fixed footer button.
  ], [t, selectionMode, exitSelection])

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

  // Shared row renderer — used by both the flat filtered view and the
  // sectioned (chip="All") grouped view, so both paths stay in lockstep.
  const renderBookmarkRow = (b: Bookmark) => {
    const cat = categoryMap.get(b.category_id || '')
    const catName = cat?.name || ''
    const catColor = cat ? getCategoryColor(catName) : 'var(--color-text-3)'
    const checked = selectedIds.has(b.id)
    const isInlineEditing = inlineEditId === b.id
    const isActive = isBookmarkActive(b)

    // Gradient icon tile per category, derived from the redesign/Home
    // library rows. Selection mode swaps the tile for a checkbox.
    const leading = selectionMode ? (
      <span
        aria-hidden="true"
        className="w-9 h-9 rounded-[10px] border flex items-center justify-center shrink-0"
        style={{
          borderColor: checked ? 'var(--color-accent)' : 'var(--color-border-strong)',
          background: checked ? 'var(--color-accent)' : 'rgba(255,255,255,0.02)',
        }}
      >
        {checked && <Check width={ICON_SIZE.sm} height={ICON_SIZE.sm} className="text-white" strokeWidth={3} />}
      </span>
    ) : (
      <span
        aria-hidden="true"
        className="w-9 h-9 rounded-[10px] grid place-items-center shrink-0"
        style={{
          background: `linear-gradient(135deg, color-mix(in srgb, ${catColor} 22%, transparent), color-mix(in srgb, ${catColor} 6%, transparent))`,
          border: `1px solid color-mix(in srgb, ${catColor} 32%, transparent)`,
          color: catColor,
        }}
      >
        <BookmarkIcon width={ICON_SIZE.md} height={ICON_SIZE.md} strokeWidth={2} />
      </span>
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
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) commitInlineRename(b.id)
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

    const subtitleNode = (
      <span className="inline-flex items-center gap-1.5 min-w-0">
        {cat && (
          <span
            className="inline-block uppercase"
            style={{
              padding: '1px 5px',
              background: 'rgba(255,255,255,0.05)',
              borderRadius: '3px',
              fontFamily: 'Inter, sans-serif',
              fontSize: '9.5px',
              color: 'var(--color-text-2)',
              fontWeight: 500,
              letterSpacing: '0.03em',
              lineHeight: 1.4,
            }}
          >
            {displayCat(catName)}
          </span>
        )}
        <span className="font-mono truncate">
          {b.lat.toFixed(6)}°, {b.lng.toFixed(6)}°
        </span>
        {b.country_code && (
          <>
            <span className="text-[var(--color-text-3)] opacity-50">·</span>
            <img
              src={`https://flagcdn.com/w40/${b.country_code}.png`}
              alt={b.country_code.toUpperCase()}
              width={14}
              height={10}
              className="rounded-[2px] shadow-[0_0_0_1px_rgba(255,255,255,0.08)] shrink-0"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
            />
            {b.country && <span className="truncate max-w-[80px]">{b.country}</span>}
          </>
        )}
      </span>
    )

    const trailing = selectionMode ? undefined : (
      <span className="inline-flex items-center gap-1">
        <HoverAction
          onClick={(e) => { e.stopPropagation(); setEditing({ mode: 'edit', bookmark: b }) }}
          label={t('bm.edit')}
        >
          <Pencil width={ICON_SIZE.xs} height={ICON_SIZE.xs} />
        </HoverAction>
        <HoverAction
          onClick={(e) => { e.stopPropagation(); confirmDeleteOne(b) }}
          label={t('generic.delete')}
          danger
        >
          <Trash2 width={ICON_SIZE.xs} height={ICON_SIZE.xs} />
        </HoverAction>
        <KebabMenu
          items={() => rowMenuItems(b)}
          ariaLabel={t('bm.bookmark_actions')}
        />
      </span>
    )

    return (
      <div key={b.id} className="relative">
        {/* Design's .bm.active left accent bar — rendered only when the
            bookmark's coords match the current simulated position. */}
        {isActive && (
          <span
            aria-hidden="true"
            className="absolute left-[2px] top-[14px] bottom-[14px] w-[2px] rounded-[2px]"
            style={{ background: 'var(--color-accent)' }}
          />
        )}
        <ListRow
          as="button"
          density="compact"
          className={['group', isActive ? 'pl-4' : ''].join(' ')}
          selected={(selectionMode && checked) || isActive}
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
          subtitle={subtitleNode}
          trailing={trailing}
        />
      </div>
    )
  }

  return (
    <div className="relative flex flex-col gap-3 p-4 pb-[92px]">
      {/* Top row: search occupies main width, kebab tucks to the right.
          Primary Add CTA lives in the fixed footer at panel bottom
          (matches redesign/Home library structure). */}
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder={t('bm.search_placeholder')}
            clearLabel={t('bm.search_clear')}
          />
        </div>
        <KebabMenu items={headerMenuItems} ariaLabel={t('bm.bookmark_actions_aria')} />
      </div>

      {/* Category chip filter — hidden while searching */}
      {!searching && categories.length > 0 && (
        <ChipFilterBar
          chips={chips}
          activeId={activeCategoryId}
          onChange={setActiveCategoryId}
          ariaLabel={t('bm.category_filter_aria')}
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

      {/* List — sectioned when chip is "All" (no search), flat otherwise. */}
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
      ) : sections ? (
        <div className="flex flex-col gap-4">
          {sections.map((section) => (
            <div key={section.id} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between px-1 pt-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-3)]">
                  {section.label}
                </span>
                <span className="font-mono text-[10px] text-[var(--color-text-3)] opacity-70">
                  {section.list.length}
                </span>
              </div>
              {section.list.map((b) => renderBookmarkRow(b))}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {filtered.map((b) => renderBookmarkRow(b))}
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

      {/* Bulk import via pasted coords (v0.2.52) */}
      <BulkCoordsDialog
        open={bulkOpen}
        mode="bookmarks"
        onCancel={() => setBulkOpen(false)}
        onConfirm={async (items, categoryId) => {
          await bm.createBookmarksBulk(items, categoryId)
          setBulkOpen(false)
        }}
      />

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!confirm}
        title={t('bm.delete_title')}
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

      {/* Fixed footer — primary Add CTA + Manage-categories ghost.
          Mirrors the redesign/Home .lib-footer: absolute at the bottom
          of the scroll area with a gradient fade so list content
          doesn't collide with the buttons. */}
      <div
        className="sticky bottom-0 left-0 right-0 -mx-4 px-4 pt-4 pb-4 flex gap-2.5 items-center"
        style={{
          background: 'linear-gradient(180deg, rgba(15,16,20,0) 0%, rgba(15,16,20,0.96) 30%)',
        }}
      >
        <button
          type="button"
          onClick={() => setCategoryMgrOpen(true)}
          disabled={selectionMode}
          className={[
            'inline-flex items-center justify-center gap-2 h-11 px-4 rounded-[12px]',
            'text-[13px] font-semibold shrink-0',
            'bg-white/[0.04] border border-[var(--color-border)]',
            'hover:bg-white/[0.08]',
            'disabled:opacity-40 disabled:cursor-not-allowed',
            'transition-colors duration-150 cursor-pointer',
          ].join(' ')}
          style={{ color: 'var(--color-text-1)' }}
          title={t('bm.manage_categories')}
        >
          <Layers width={ICON_SIZE.sm} height={ICON_SIZE.sm} />
          <span>{t('bm.manage_categories')}</span>
        </button>
        <button
          type="button"
          onClick={() => setEditing({ mode: 'create' })}
          disabled={selectionMode}
          className={[
            'flex-1 inline-flex items-center justify-center gap-2 h-11 rounded-[12px]',
            'text-[13px] font-semibold',
            'transition-[transform,box-shadow,opacity] duration-150',
            'hover:-translate-y-px',
            'disabled:opacity-40 disabled:cursor-not-allowed disabled:translate-y-0',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] focus-visible:outline-offset-2',
          ].join(' ')}
          style={{
            background: 'var(--color-accent)',
            color: 'white',
            boxShadow: 'var(--shadow-glow)',
          }}
        >
          <Plus width={ICON_SIZE.sm} height={ICON_SIZE.sm} strokeWidth={2.5} />
          {t('bm.add')}
        </button>
      </div>
    </div>
  )
}

// ─── Hover-reveal quick action button ──────────────────────────────
// Matches the redesign/Home .bm-actions button: 28px rounded-7 tile
// that fades in on row hover and red-tints when `danger`.

interface HoverActionProps {
  onClick: (e: React.MouseEvent) => void
  label: string
  danger?: boolean
  children: React.ReactNode
}

function HoverAction({ onClick, label, danger, children }: HoverActionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={[
        'w-7 h-7 rounded-[7px] grid place-items-center shrink-0',
        'border border-[var(--color-border)] bg-white/[0.04]',
        'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
        'translate-x-1 group-hover:translate-x-0 focus-visible:translate-x-0',
        'transition-[opacity,transform,background,color,border-color] duration-150',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]',
        danger
          ? 'text-[var(--color-text-3)] hover:text-[var(--color-danger-text)] hover:bg-[var(--color-danger-dim)] hover:border-[rgba(255,71,87,0.3)]'
          : 'text-[var(--color-text-3)] hover:text-[var(--color-text-1)] hover:bg-white/[0.1]',
      ].join(' ')}
    >
      {children}
    </button>
  )
}
