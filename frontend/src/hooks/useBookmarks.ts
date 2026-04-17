import { useState, useCallback, useEffect, useRef } from 'react'
import * as api from '../services/api'

export interface Bookmark {
  id: string
  name: string
  lat: number
  lng: number
  category_id?: string
  note?: string
  created_at?: string
  // Auto-filled by the backend on create/update via reverse geocoding.
  // Empty string for legacy rows until /backfill-flags runs.
  country_code?: string
  country?: string
}

export interface BookmarkCategory {
  id: string
  name: string
  color?: string
  sort_order?: number
}

export function useBookmarks() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [categories, setCategories] = useState<BookmarkCategory[]>([])
  const [loading, setLoading] = useState(false)
  const mountedRef = useRef(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [bms, cats] = await Promise.all([
        api.getBookmarks(),
        api.getCategories(),
      ])
      if (!mountedRef.current) return
      setBookmarks(Array.isArray(bms) ? bms : bms.bookmarks ?? [])
      setCategories(Array.isArray(cats) ? cats : [])
    } catch (err) {
      console.error('Failed to load bookmarks:', err)
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [])

  const backfilledRef = useRef(false)

  // Load on mount. After the first fetch, lazily enrich legacy rows that
  // were created before country_code/country existed — runs at most once
  // per session so we don't hammer Nominatim.
  useEffect(() => {
    mountedRef.current = true
    refresh()
    return () => {
      mountedRef.current = false
    }
  }, [refresh])

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

  const createBookmark = useCallback(
    async (bm: Omit<Bookmark, 'id'>) => {
      const created = await api.createBookmark(bm)
      await refresh()
      return created
    },
    [refresh],
  )

  const deleteBookmark = useCallback(
    async (id: string) => {
      await api.deleteBookmark(id)
      setBookmarks((prev) => prev.filter((b) => b.id !== id))
    },
    [],
  )

  const deleteBookmarksBatch = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return 0
      const res = await api.deleteBookmarksBatch(ids)
      const doomed = new Set(ids)
      setBookmarks((prev) => prev.filter((b) => !doomed.has(b.id)))
      return res?.deleted ?? ids.length
    },
    [],
  )

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
    async (ids: string[], categoryId: string) => {
      await api.moveBookmarks(ids, categoryId)
      await refresh()
    },
    [refresh],
  )

  const createCategory = useCallback(
    async (cat: Omit<BookmarkCategory, 'id'>) => {
      const created = await api.createCategory(cat)
      await refresh()
      return created
    },
    [refresh],
  )

  const deleteCategory = useCallback(
    async (id: string) => {
      await api.deleteCategory(id)
      await refresh()
    },
    [refresh],
  )

  const updateCategory = useCallback(
    async (id: string, data: Partial<BookmarkCategory>) => {
      const updated = await api.updateCategory(id, data)
      await refresh()
      return updated
    },
    [refresh],
  )

  return {
    bookmarks,
    categories,
    loading,
    createBookmark,
    updateBookmark,
    deleteBookmark,
    deleteBookmarksBatch,
    backfillFlags,
    moveBookmarks,
    createCategory,
    deleteCategory,
    updateCategory,
    refresh,
  }
}
