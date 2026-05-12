import { useState, useCallback, useEffect, useRef } from 'react'
import * as api from '../services/api'
import { devLog } from '../lib/dev-log'

// Dual-axis model:
//   place_id — single "where" (富士山, 寺廟, default)
//   tags     — multi "what"  (掃描器, 菇, 花)
export interface Bookmark {
  id: string
  name: string
  lat: number
  lng: number
  place_id: string
  tags: string[]
  note?: string
  created_at?: string
  last_used_at?: string
  // Auto-filled by the backend on create/update via reverse geocoding.
  // Empty string for legacy rows until /backfill-flags runs.
  country_code?: string
  country?: string
  // Explicit drag-reorder position; back-fills to 0 on legacy rows.
  sort_order?: number
}

export interface BookmarkPlace {
  id: string
  name: string
  color?: string
  sort_order?: number
}

export interface BookmarkTag {
  id: string
  name: string
  color?: string
  sort_order?: number
}

export function useBookmarks() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [places, setPlaces] = useState<BookmarkPlace[]>([])
  const [tags, setTags] = useState<BookmarkTag[]>([])
  const [loading, setLoading] = useState(false)
  const mountedRef = useRef(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [store, ps, ts] = await Promise.all([
        api.getBookmarks(),
        api.getPlaces(),
        api.getTags(),
      ])
      if (!mountedRef.current) return
      // /api/bookmarks now returns the full store envelope; older shape
      // support kept only for resilience against transient stale backends.
      const bms = Array.isArray(store) ? store : store.bookmarks ?? []
      setBookmarks(bms)
      setPlaces(Array.isArray(ps) ? ps : [])
      setTags(Array.isArray(ts) ? ts : [])
    } catch (err) {
      devLog('Failed to load bookmarks:', err)
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [])

  const backfilledRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    refresh()
    return () => {
      mountedRef.current = false
    }
  }, [refresh])

  // Lazily enrich legacy rows that were created before country_code/country
  // existed. Runs at most once per session so we don't hammer Nominatim.
  useEffect(() => {
    if (backfilledRef.current) return
    if (loading) return
    if (bookmarks.length === 0) return
    const hasMissingFlag = bookmarks.some((b) => !b.country_code)
    if (!hasMissingFlag) return
    backfilledRef.current = true
    api.backfillBookmarkFlags()
      .then((res) => {
        if (!mountedRef.current) return
        if (res?.filled && res.filled > 0) refresh()
      })
      .catch(() => {
        // Swallow — backfill is best-effort and not user-facing.
      })
  }, [bookmarks, loading, refresh])

  // ── Bookmark mutations ────────────────────────────────
  const createBookmark = useCallback(
    async (bm: Omit<Bookmark, 'id'>) => {
      const created = await api.createBookmark(bm)
      await refresh()
      return created
    },
    [refresh],
  )

  const deleteBookmark = useCallback(async (id: string) => {
    await api.deleteBookmark(id)
    setBookmarks((prev) => prev.filter((b) => b.id !== id))
  }, [])

  const deleteBookmarksBatch = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return 0
    const res = await api.deleteBookmarksBatch(ids)
    const doomed = new Set(ids)
    setBookmarks((prev) => prev.filter((b) => !doomed.has(b.id)))
    return res?.deleted ?? ids.length
  }, [])

  const backfillFlags = useCallback(async () => {
    try {
      const res = await api.backfillBookmarkFlags()
      if (res?.filled && res.filled > 0) {
        await refresh()
      }
      return res?.filled ?? 0
    } catch {
      return 0
    }
  }, [refresh])

  const updateBookmark = useCallback(
    async (id: string, data: Partial<Bookmark>) => {
      const updated = await api.updateBookmark(id, data)
      await refresh()
      return updated
    },
    [refresh],
  )

  const moveBookmarks = useCallback(
    async (ids: string[], placeId: string) => {
      await api.moveBookmarks(ids, placeId)
      await refresh()
    },
    [refresh],
  )

  const tagBookmarks = useCallback(
    async (ids: string[], add: string[] = [], remove: string[] = []) => {
      await api.tagBookmarks(ids, add, remove)
      await refresh()
    },
    [refresh],
  )

  // ── Place mutations ───────────────────────────────────
  const createPlace = useCallback(
    async (place: Omit<BookmarkPlace, 'id'>) => {
      const created = await api.createPlace(place)
      await refresh()
      return created
    },
    [refresh],
  )

  const deletePlace = useCallback(
    async (id: string) => {
      await api.deletePlace(id)
      await refresh()
    },
    [refresh],
  )

  const updatePlace = useCallback(
    async (id: string, data: Partial<BookmarkPlace>) => {
      const updated = await api.updatePlace(id, data)
      await refresh()
      return updated
    },
    [refresh],
  )

  const reorderPlaces = useCallback(
    async (orderedIds: string[]) => {
      await api.reorderPlaces(orderedIds)
      await refresh()
    },
    [refresh],
  )

  // ── Tag mutations ─────────────────────────────────────
  const createTag = useCallback(
    async (tag: Omit<BookmarkTag, 'id'>) => {
      const created = await api.createTag(tag)
      await refresh()
      return created
    },
    [refresh],
  )

  const deleteTag = useCallback(
    async (id: string) => {
      await api.deleteTag(id)
      await refresh()
    },
    [refresh],
  )

  const updateTag = useCallback(
    async (id: string, data: Partial<BookmarkTag>) => {
      const updated = await api.updateTag(id, data)
      await refresh()
      return updated
    },
    [refresh],
  )

  const reorderTags = useCallback(
    async (orderedIds: string[]) => {
      await api.reorderTags(orderedIds)
      await refresh()
    },
    [refresh],
  )

  return {
    bookmarks,
    places,
    tags,
    loading,
    createBookmark,
    updateBookmark,
    deleteBookmark,
    deleteBookmarksBatch,
    backfillFlags,
    moveBookmarks,
    tagBookmarks,
    createPlace,
    updatePlace,
    deletePlace,
    reorderPlaces,
    createTag,
    updateTag,
    deleteTag,
    reorderTags,
    refresh,
  }
}
