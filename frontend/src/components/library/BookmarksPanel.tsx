import React, { useCallback, useMemo, useState } from 'react'
import {
  Plus, Bookmark as BookmarkIcon, Pencil, Trash2, Copy,
  FolderInput, Tag as TagIconLucide, Check, X, ClipboardList, StickyNote,
  ClipboardPaste, Clock, ListTree,
} from 'lucide-react'
import { useBookmarkContext } from '../../contexts/BookmarkContext'
import type { Bookmark, BookmarkPlace, BookmarkTag } from '../../hooks/useBookmarks'
import { useT } from '../../i18n'
import { ICON_SIZE } from '../../lib/icons'
import { isDefaultPlace } from '../../lib/bookmarks'
import { copyToClipboard } from '../../lib/clipboard'
import ListRow from '../ui/ListRow'
import SearchField from '../ui/SearchField'
import ChipFilterBar, { type Chip } from '../ui/ChipFilterBar'
import KebabMenu, { type KebabMenuItem } from '../ui/KebabMenu'
import EmptyState from '../ui/EmptyState'
import ConfirmDialog from '../ui/ConfirmDialog'
import BookmarkEditDialog, { type BookmarkEditValues } from './BookmarkEditDialog'
import PlaceManagerDialog, { getPlaceColor } from './PlaceManagerDialog'
import TagManagerDialog, { getTagColor } from './TagManagerDialog'
import BulkCoordsDialog from './BulkCoordsDialog'
import BookmarksFooter from './BookmarksFooter'

interface BookmarksPanelProps {
  onBookmarkClick: (lat: number, lng: number) => void
  currentPosition: { lat: number; lng: number } | null
}

const ALL_ID = '__all__' as const
type SortMode = 'recent' | 'by_place'

/** Lat/lng tolerance for flagging a bookmark as the current location.
 *  ~1.1 m at the equator — tighter than any user-perceptible jitter. */
const BOOKMARK_MATCH_EPSILON = 1e-5

/** "Copied" toast/icon flash duration (ms) after the copy-coords action. */
const COPIED_FLASH_MS = 1200

/** Number of place chips kept visible before the bar collapses into a "+N" overflow. */
const PLACE_CHIPS_VISIBLE_CAP = 5

/** Width / left-offset (px) of the accent stripe marking the active bookmark row. */
const ACTIVE_INDICATOR_STRIPE_PX = 2

export default function BookmarksPanel({ onBookmarkClick, currentPosition }: BookmarksPanelProps) {
  const t = useT()
  const bm = useBookmarkContext()
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
      if (!buckets.has(key)) buckets.set(key, [])
      buckets.get(key)!.push(b)
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

  const renderBookmarkRow = (b: Bookmark) => {
    const place = placeMap.get(b.place_id || '')
    const placeName = place?.name || ''
    const placeColor = place ? getPlaceColor(placeName) : 'var(--color-text-3)'
    const checked = selectedIds.has(b.id)
    const isInlineEditing = inlineEditId === b.id
    const isActive = isBookmarkActive(b)
    const bookmarkTags = (b.tags ?? [])
      .map((id) => tagMap.get(id))
      .filter((tg): tg is BookmarkTag => !!tg)

    // Gradient icon tile coloured by the bookmark's place. Selection mode
    // swaps the tile for a checkbox.
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
          background: `linear-gradient(135deg, color-mix(in srgb, ${placeColor} 22%, transparent), color-mix(in srgb, ${placeColor} 6%, transparent))`,
          border: `1px solid color-mix(in srgb, ${placeColor} 32%, transparent)`,
          color: placeColor,
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
      <span className="inline-flex items-center gap-1.5 min-w-0 flex-wrap">
        {place && (
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
            {displayPlace(placeName)}
          </span>
        )}
        {bookmarkTags.map((tag) => (
          <span
            key={tag.id}
            style={{
              padding: '1px 6px',
              background: `color-mix(in srgb, ${getTagColor(tag)} 22%, transparent)`,
              borderRadius: '3px',
              fontSize: '10px',
              color: 'var(--color-text-1)',
              fontWeight: 500,
              lineHeight: 1.4,
              border: `1px solid color-mix(in srgb, ${getTagColor(tag)} 40%, transparent)`,
            }}
          >
            {tag.name}
          </span>
        ))}
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
        {isActive && (
          <span
            aria-hidden="true"
            className="absolute top-[14px] bottom-[14px] rounded-[2px]"
            style={{
              left: ACTIVE_INDICATOR_STRIPE_PX,
              width: ACTIVE_INDICATOR_STRIPE_PX,
              background: 'var(--color-accent)',
            }}
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

      {/* Place chip filter — hidden while searching. Primary axis. */}
      {!searching && places.length > 0 && (
        <ChipFilterBar
          chips={placeChips}
          activeId={activePlaceId}
          onChange={setActivePlaceId}
          ariaLabel={t('bm.place_filter_aria')}
          visibleCap={PLACE_CHIPS_VISIBLE_CAP}
        />
      )}

      {/* Tag chip filter — secondary axis, multi-select, AND. Hidden while
          searching (search already looks inside tag names). */}
      {!searching && tags.length > 0 && (
        <div
          role="toolbar"
          aria-label={t('bm.tag_filter_aria')}
          className="flex items-center gap-1.5 overflow-x-auto scrollbar-thin"
          style={{ paddingBottom: 2 }}
        >
          <TagIconLucide width={12} height={12} className="text-[var(--color-text-3)] shrink-0" />
          {tags.map((tag) => {
            const selected = activeTagIds.has(tag.id)
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => toggleTagFilter(tag.id)}
                aria-pressed={selected}
                style={{
                  fontSize: 10.5,
                  padding: '2px 8px',
                  borderRadius: 999,
                  border: '1px solid var(--color-border)',
                  background: selected ? getTagColor(tag) : 'transparent',
                  color: selected ? '#fff' : 'var(--color-text-2)',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                  transition: 'all var(--duration-fast, 150ms) ease',
                }}
              >
                {tag.name}
              </button>
            )
          })}
          {activeTagIds.size > 0 && (
            <button
              type="button"
              onClick={() => setActiveTagIds(new Set())}
              className="kebab-btn"
              aria-label={t('bm.search_clear')}
              title={t('bm.search_clear')}
              style={{ flexShrink: 0 }}
            >
              <X width={12} height={12} />
            </button>
          )}
        </div>
      )}

      {/* Sort toggle. `by_place` preserves the sectioned view when no filter
          is applied; `recent` always flattens the list. Hidden for empty. */}
      {bookmarks.length > 0 && !searching && (
        <div className="flex items-center gap-1 text-[11px]">
          <span className="text-[var(--color-text-3)] mr-1">{t('generic.sort')}:</span>
          <SortChip
            active={sortMode === 'by_place'}
            onClick={() => setSortMode('by_place')}
            icon={<ListTree width={12} height={12} />}
            label={t('bm.sort_by_place')}
          />
          <SortChip
            active={sortMode === 'recent'}
            onClick={() => setSortMode('recent')}
            icon={<Clock width={12} height={12} />}
            label={t('bm.sort_recent')}
          />
        </div>
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
          <BookmarkEditDialog
            open
            mode="edit"
            currentPosition={currentPosition}
            places={places}
            tags={tags}
            initial={{
              id: editing.bookmark.id,
              name: editing.bookmark.name,
              lat: editing.bookmark.lat,
              lng: editing.bookmark.lng,
              placeId: editing.bookmark.place_id || places[0]?.id || 'default',
              tagIds: [...(editing.bookmark.tags ?? [])],
              note: editing.bookmark.note,
            }}
            onClose={() => setEditing(null)}
            onSubmit={(values) => handleUpdate(editing.bookmark!.id, values)}
          />
        ) : null
      )}

      <PlaceManagerDialog
        open={placeMgrOpen}
        onClose={() => setPlaceMgrOpen(false)}
        places={places}
        onAdd={async (name) => { await bm.createPlace({ name }) }}
        onDelete={(id) => bm.deletePlace(id)}
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

// ─── Hover-reveal quick action button ──────────────────────────────

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

interface SortChipProps {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}

function SortChip({ active, onClick, icon, label }: SortChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="inline-flex items-center gap-1"
      style={{
        padding: '2px 8px',
        borderRadius: 999,
        border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`,
        background: active ? 'color-mix(in srgb, var(--color-accent) 20%, transparent)' : 'transparent',
        color: active ? 'var(--color-text-1)' : 'var(--color-text-3)',
        fontSize: 10.5,
        cursor: 'pointer',
        transition: 'all var(--duration-fast, 150ms) ease',
      }}
    >
      {icon}
      {label}
    </button>
  )
}
