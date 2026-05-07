import { useCallback, useMemo, useState } from 'react'
import {
  Plus, Bookmark as BookmarkIcon, Pencil, Trash2, Copy,
  FolderInput, ClipboardList, ClipboardPaste,
} from 'lucide-react'
import { useBookmarkContext } from '../../contexts/BookmarkContext'
import { useToastContext } from '../../contexts/ToastContext'
import type { Bookmark, BookmarkPlace, BookmarkTag } from '../../hooks/useBookmarks'
import { useT } from '../../i18n'
import { ICON_SIZE } from '../../lib/icons'
import { isDefaultPlace } from '../../lib/bookmarks'
import { copyToClipboard } from '../../lib/clipboard'
import { type Chip } from '../ui/ChipFilterBar'
import { type KebabMenuItem } from '../ui/KebabMenu'
import EmptyState from '../ui/EmptyState'
import ConfirmDialog from '../ui/ConfirmDialog'
import BookmarkEditDialog, { type BookmarkEditValues } from './BookmarkEditDialog'
import PlaceManagerDialog, { getPlaceColor } from './PlaceManagerDialog'
import TagManagerDialog from './TagManagerDialog'
import BulkCoordsDialog from './BulkCoordsDialog'
import BookmarksFooter from './BookmarksFooter'
import BookmarksToolbar, { type SortMode } from './BookmarksToolbar'
import BookmarkRow from './BookmarkRow'

interface BookmarksPanelProps {
  onBookmarkClick: (lat: number, lng: number) => void
  currentPosition: { lat: number; lng: number } | null
}

const ALL_ID = '__all__' as const

/** Lat/lng tolerance for flagging a bookmark as the current location.
 *  ~1.1 m at the equator — tighter than any user-perceptible jitter. */
const BOOKMARK_MATCH_EPSILON = 1e-5

/** "Copied" toast/icon flash duration (ms) after the copy-coords action. */
const COPIED_FLASH_MS = 1200

/** Number of place chips kept visible before the bar collapses into a "+N" overflow. */
const PLACE_CHIPS_VISIBLE_CAP = 5

export default function BookmarksPanel({ onBookmarkClick, currentPosition }: BookmarksPanelProps) {
  const t = useT()
  const bm = useBookmarkContext()
  const { showToast } = useToastContext()
  const { bookmarks, places, tags } = bm

  const [search, setSearch] = useState('')
  const [activePlaceId, setActivePlaceId] = useState<string>(ALL_ID)
  const [activeTagIds, setActiveTagIds] = useState<Set<string>>(new Set())
  const [sortMode, setSortMode] = useState<SortMode>('by_place')
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<{ mode: 'create' | 'edit'; bookmark?: Bookmark } | null>(null)
  const [placeMgrOpen, setPlaceMgrOpen] = useState(false)
  const [tagMgrOpen, setTagMgrOpen] = useState(false)
  const [confirm, setConfirm] = useState<null | { kind: 'single'; id: string; name: string } | { kind: 'batch'; ids: string[] }>(null)
  const [inlineEditId, setInlineEditId] = useState<string | null>(null)
  const [inlineEditName, setInlineEditName] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)

  const displayPlace = useCallback((name: string) => {
    if (!isDefaultPlace(name)) return name
    return name === 'Uncategorized' ? t('bm.uncategorized') : t('bm.default')
  }, [t])

  const placeMap = useMemo(() => {
    const m = new Map<string, BookmarkPlace>()
    places.forEach((p) => m.set(p.id, p))
    return m
  }, [places])

  const tagMap = useMemo(() => {
    const m = new Map<string, BookmarkTag>()
    tags.forEach((tg) => m.set(tg.id, tg))
    return m
  }, [tags])

  // ─── Filtering pipeline ─────────────────────────────
  // Order: search → place chip → tag chips (AND across selected tags).
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const searching = q.length > 0
    return bookmarks.filter((b) => {
      const place = placeMap.get(b.place_id || '')
      const placeName = place?.name || ''
      if (searching) {
        const name = (b.name ?? '').toLowerCase()
        const placeLower = placeName.toLowerCase()
        const coord = `${b.lat.toFixed(5)}, ${b.lng.toFixed(5)}`
        const tagHit = (b.tags ?? []).some((id) => {
          const tg = tagMap.get(id)
          return tg ? tg.name.toLowerCase().includes(q) : false
        })
        if (!(name.includes(q) || placeLower.includes(q) || coord.includes(q) || tagHit)) {
          return false
        }
      } else if (activePlaceId !== ALL_ID && b.place_id !== activePlaceId) {
        return false
      }
      if (activeTagIds.size > 0) {
        const bookmarkTags = new Set(b.tags ?? [])
        for (const t of activeTagIds) {
          if (!bookmarkTags.has(t)) return false
        }
      }
      return true
    })
  }, [bookmarks, search, activePlaceId, activeTagIds, placeMap, tagMap])

  // Sections grouping (only when sort=by_place + no search + chip="All" + no tag filter).
  const sections = useMemo(() => {
    const searching = search.trim().length > 0
    if (sortMode !== 'by_place') return null
    if (searching || activePlaceId !== ALL_ID) return null
    if (activeTagIds.size > 0) return null
    const buckets = new Map<string, Bookmark[]>()
    for (const b of filtered) {
      const key = b.place_id || '__uncategorized__'
      buckets.set(key, [...(buckets.get(key) ?? []), b])
    }
    const ordered = places
      .map((p) => ({
        id: p.id,
        label: displayPlace(p.name),
        list: buckets.get(p.id) ?? [],
      }))
      .filter((s) => s.list.length > 0)
    const orphans = buckets.get('__uncategorized__')
    if (orphans && orphans.length > 0) {
      ordered.push({ id: '__uncategorized__', label: displayPlace('Uncategorized'), list: orphans })
    }
    return ordered
  }, [filtered, activePlaceId, activeTagIds, search, sortMode, places, displayPlace])

  // Flat list with recent-first sorting when `sortMode === 'recent'` or any
  // filter is active. Uses `last_used_at` (ISO string) desc with `created_at`
  // fallback so never-used bookmarks still sort consistently.
  const flatList = useMemo(() => {
    if (sections) return null
    if (sortMode === 'recent') {
      return [...filtered].sort((a, b) => {
        const ka = a.last_used_at || a.created_at || ''
        const kb = b.last_used_at || b.created_at || ''
        if (ka === kb) return 0
        return ka < kb ? 1 : -1
      })
    }
    return filtered
  }, [filtered, sortMode, sections])

  // Match by coordinate to flag the currently-loaded bookmark.
  const isBookmarkActive = useCallback((b: Bookmark): boolean => {
    if (!currentPosition) return false
    return Math.abs(b.lat - currentPosition.lat) < BOOKMARK_MATCH_EPSILON
      && Math.abs(b.lng - currentPosition.lng) < BOOKMARK_MATCH_EPSILON
  }, [currentPosition])

  const placeChips = useMemo<Chip<string>[]>(() => {
    const list: Chip<string>[] = [{ id: ALL_ID, label: t('bm.filter_all'), count: bookmarks.length }]
    for (const place of places) {
      list.push({
        id: place.id,
        label: displayPlace(place.name),
        color: getPlaceColor(place.name),
        count: bookmarks.filter((b) => b.place_id === place.id).length,
      })
    }
    return list
  }, [bookmarks, places, displayPlace, t])

  // ─── Selection mode ─────────────────────────────────
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

  const toggleTagFilter = useCallback((tagId: string) => {
    setActiveTagIds((prev) => {
      const next = new Set(prev)
      if (next.has(tagId)) next.delete(tagId)
      else next.add(tagId)
      return next
    })
  }, [])

  // ─── Mutations ──────────────────────────────────────
  const handleCreate = useCallback((values: BookmarkEditValues) => {
    void bm.createBookmark({
      name: values.name,
      lat: values.lat,
      lng: values.lng,
      place_id: values.placeId,
      tags: values.tagIds,
      note: values.note,
    })
    setEditing(null)
  }, [bm])

  const handleUpdate = useCallback((id: string, values: BookmarkEditValues) => {
    void bm.updateBookmark(id, {
      name: values.name,
      lat: values.lat,
      lng: values.lng,
      place_id: values.placeId,
      tags: values.tagIds,
      note: values.note,
    })
    setEditing(null)
  }, [bm])

  const handleCopy = useCallback(async (b: Bookmark) => {
    const text = `${b.name} ${b.lat.toFixed(6)}, ${b.lng.toFixed(6)}`
    await copyToClipboard(text)
    setCopiedId(b.id)
    setTimeout(() => setCopiedId((prev) => (prev === b.id ? null : prev)), COPIED_FLASH_MS)
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

  // ─── Header kebab items ─────────────────────────────
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
  ], [t, selectionMode, exitSelection])

  // ─── Row kebab ──────────────────────────────────────
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
    const others = places.filter((p) => p.id !== b.place_id)
    if (others.length > 0) {
      items.push({ id: 'move-section', kind: 'section', label: t('bm.move_to') })
      others.forEach((place) => {
        items.push({
          id: `move-${place.id}`,
          label: displayPlace(place.name),
          icon: <FolderInput width={ICON_SIZE.sm} height={ICON_SIZE.sm} />,
          colorDot: getPlaceColor(place.name),
          onSelect: () => void bm.updateBookmark(b.id, { place_id: place.id }),
        })
      })
    }
    return items
  }, [t, places, bm, handleCopy, confirmDeleteOne, displayPlace])

  // ─── Render ─────────────────────────────────────────
  const searching = search.trim().length > 0
  const anyFilter = searching || activePlaceId !== ALL_ID || activeTagIds.size > 0

  const startInlineEdit = useCallback((b: Bookmark) => {
    setInlineEditId(b.id)
    setInlineEditName(b.name)
  }, [])

  const renderBookmarkRow = (b: Bookmark) => (
    <BookmarkRow
      key={b.id}
      bookmark={b}
      placeMap={placeMap}
      tagMap={tagMap}
      displayPlace={displayPlace}
      selectionMode={selectionMode}
      checked={selectedIds.has(b.id)}
      onToggleSelected={toggleSelected}
      isInlineEditing={inlineEditId === b.id}
      inlineEditName={inlineEditName}
      onInlineEditChange={setInlineEditName}
      onInlineEditCommit={commitInlineRename}
      onInlineEditCancel={() => setInlineEditId(null)}
      onStartInlineEdit={startInlineEdit}
      isActive={isBookmarkActive(b)}
      isCopied={copiedId === b.id}
      onActivate={onBookmarkClick}
      onEdit={(bk) => setEditing({ mode: 'edit', bookmark: bk })}
      onDelete={confirmDeleteOne}
      rowMenuItems={rowMenuItems}
    />
  )

  return (
    <div className="relative flex flex-col gap-3 p-4 pb-[92px]">
      <BookmarksToolbar
        search={search}
        onSearchChange={setSearch}
        placeChips={placeChips}
        activePlaceId={activePlaceId}
        onActivePlaceChange={setActivePlaceId}
        placeChipsVisibleCap={PLACE_CHIPS_VISIBLE_CAP}
        hasPlaces={places.length > 0}
        tags={tags}
        activeTagIds={activeTagIds}
        onToggleTag={toggleTagFilter}
        onClearTags={() => setActiveTagIds(new Set())}
        sortMode={sortMode}
        onSortModeChange={setSortMode}
        hasBookmarks={bookmarks.length > 0}
        selectionMode={selectionMode}
        selectedCount={selectedIds.size}
        onClearSelection={() => setSelectedIds(new Set())}
        onConfirmBatchDelete={confirmBatchDelete}
        onExitSelection={exitSelection}
        headerMenuItems={headerMenuItems}
      />

      {bookmarks.length === 0 ? (
        <EmptyState
          icon={<BookmarkIcon width={ICON_SIZE.lg} height={ICON_SIZE.lg} />}
          title={t('bm.empty')}
          help={t('bm.add_here')}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<BookmarkIcon width={ICON_SIZE.lg} height={ICON_SIZE.lg} />}
          title={anyFilter ? t('bm.search_no_results') : t('bm.blank')}
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
          {(flatList ?? filtered).map((b) => renderBookmarkRow(b))}
        </div>
      )}

      {/* Edit dialog (create + edit share one component) */}
      {editing && (
        editing.mode === 'create' ? (
          <BookmarkEditDialog
            open
            mode="create"
            currentPosition={currentPosition}
            places={places}
            tags={tags}
            onClose={() => setEditing(null)}
            onSubmit={handleCreate}
          />
        ) : editing.bookmark ? (
          (() => {
            const bk = editing.bookmark
            return (
              <BookmarkEditDialog
                open
                mode="edit"
                currentPosition={currentPosition}
                places={places}
                tags={tags}
                initial={{
                  id: bk.id,
                  name: bk.name,
                  lat: bk.lat,
                  lng: bk.lng,
                  placeId: bk.place_id || places[0]?.id || 'default',
                  tagIds: [...(bk.tags ?? [])],
                  note: bk.note,
                }}
                onClose={() => setEditing(null)}
                onSubmit={(values) => handleUpdate(bk.id, values)}
              />
            )
          })()
        ) : null
      )}

      <PlaceManagerDialog
        open={placeMgrOpen}
        onClose={() => setPlaceMgrOpen(false)}
        places={places}
        onAdd={async (name) => { await bm.createPlace({ name }) }}
        onDelete={async (id) => {
          try {
            await bm.deletePlace(id)
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : t('toast.route_delete_failed')
            showToast(message)
          }
        }}
        onRename={async (id, name) => { await bm.updatePlace(id, { name }) }}
        onReorder={(ids) => bm.reorderPlaces(ids)}
      />

      <TagManagerDialog
        open={tagMgrOpen}
        onClose={() => setTagMgrOpen(false)}
        tags={tags}
        onRename={async (id, name) => { await bm.updateTag(id, { name }) }}
        onReorder={(ids) => bm.reorderTags(ids)}
      />

      <BulkCoordsDialog
        open={bulkOpen}
        mode="bookmarks"
        onCancel={() => setBulkOpen(false)}
        onConfirm={async (items, placeId) => {
          await bm.createBookmarksBulk(items, placeId)
          setBulkOpen(false)
        }}
      />

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

      <BookmarksFooter
        disabled={selectionMode}
        onManagePlaces={() => setPlaceMgrOpen(true)}
        onManageTags={() => setTagMgrOpen(true)}
        onAdd={() => setEditing({ mode: 'create' })}
      />
    </div>
  )
}

