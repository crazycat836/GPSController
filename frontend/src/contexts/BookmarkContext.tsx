import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import { useBookmarks, type Bookmark, type BookmarkPlace, type BookmarkTag } from '../hooks/useBookmarks'
import * as api from '../services/api'
import type { SavedRoute, RouteCategory, RouteConflictPolicy } from '../services/api'
import { useToastContext } from './ToastContext'
import { useT } from '../i18n'
import { devLog } from '../lib/dev-log'

interface AddBmDialog {
  lat: number
  lng: number
  name: string
  place: string
}

/** Outcome of `handleRouteSave`. The panel uses this to decide whether
 *  to surface the "overwrite / save as new / cancel" dialog. */
export type SaveRouteResult =
  | { kind: 'created'; route: SavedRoute }
  | { kind: 'overwritten'; route: SavedRoute }
  | {
      kind: 'conflict'
      existingId: string | null
      existingCreatedAt: string | null
    }
  | { kind: 'error'; message: string }

interface BookmarkContextValue {
  // From useBookmarks
  bookmarks: Bookmark[]
  places: BookmarkPlace[]
  tags: BookmarkTag[]
  createBookmark: (bm: Omit<Bookmark, 'id'>) => Promise<Bookmark>
  createBookmarksBulk: (
    items: Array<{ lat: number; lng: number; name?: string }>,
    placeId?: string,
  ) => Promise<{ created: number; failed: number }>
  updateBookmark: (id: string, data: Partial<Bookmark>) => Promise<Bookmark>
  touchBookmark: (id: string) => void
  deleteBookmark: (id: string) => Promise<void>
  deleteBookmarksBatch: (ids: string[]) => Promise<number>
  moveBookmarks: (ids: string[], placeId: string) => Promise<void>
  tagBookmarks: (ids: string[], add?: string[], remove?: string[]) => Promise<void>
  createPlace: (place: Omit<BookmarkPlace, 'id'>) => Promise<BookmarkPlace>
  updatePlace: (id: string, data: Partial<BookmarkPlace>) => Promise<BookmarkPlace>
  deletePlace: (id: string) => Promise<void>
  reorderPlaces: (orderedIds: string[]) => Promise<void>
  createTag: (tag: Omit<BookmarkTag, 'id'>) => Promise<BookmarkTag>
  updateTag: (id: string, data: Partial<BookmarkTag>) => Promise<BookmarkTag>
  deleteTag: (id: string) => Promise<void>
  reorderTags: (orderedIds: string[]) => Promise<void>
  refresh: () => Promise<void>

  // Add bookmark dialog
  addBmDialog: AddBmDialog | null
  setAddBmDialog: React.Dispatch<React.SetStateAction<AddBmDialog | null>>
  handleAddBookmark: (lat: number, lng: number) => void
  submitAddBookmark: () => Promise<void>

  // Bookmark import/export
  handleBookmarkImport: (file: File) => Promise<void>
  handleBookmarkExport: () => Promise<void>

  // Saved routes
  savedRoutes: readonly SavedRoute[]
  handleRouteLoad: (id: string) => { lat: number; lng: number }[] | null
  handleRouteSave: (
    name: string,
    waypoints: { lat: number; lng: number }[],
    moveMode: string,
    options?: {
      categoryId?: string
      onConflict?: RouteConflictPolicy
    },
  ) => Promise<SaveRouteResult>
  handleRouteRename: (id: string, name: string) => Promise<void>
  handleRouteDelete: (id: string) => Promise<void>
  handleRoutesBatchDelete: (ids: string[]) => Promise<void>
  handleRoutesMoveToCategory: (ids: string[], targetCategoryId: string) => Promise<void>
  handleRoutesReorder: (orderedIds: string[]) => Promise<void>
  handleBookmarksReorder: (orderedIds: string[]) => Promise<void>

  // Route categories
  routeCategories: readonly RouteCategory[]
  handleRouteCategoryCreate: (name: string, color: string) => Promise<RouteCategory | null>
  handleRouteCategoryUpdate: (id: string, patch: { name?: string; color?: string }) => Promise<void>
  handleRouteCategoryDelete: (id: string) => Promise<void>
  handleRouteCategoriesReorder: (orderedIds: string[]) => Promise<void>

  // GPX
  handleGpxImport: (file: File) => Promise<void>
  handleGpxExport: (id: string) => Promise<void>

  // Bulk route import/export
  handleRoutesImportAll: (file: File) => Promise<void>
  handleRoutesExportAll: () => Promise<void>
}

const BookmarkContext = createContext<BookmarkContextValue | null>(null)

export function BookmarkProvider({ children }: { children: React.ReactNode }) {
  const t = useT()
  const { showToast } = useToastContext()
  const bm = useBookmarks()

  const [savedRoutes, setSavedRoutes] = useState<SavedRoute[]>([])
  const [routeCategories, setRouteCategories] = useState<RouteCategory[]>([])
  const [addBmDialog, setAddBmDialog] = useState<AddBmDialog | null>(null)

  useEffect(() => {
    api.getSavedRoutes().then(setSavedRoutes).catch((err) => devLog('Failed to load saved routes', err))
    api.getRouteCategories().then(setRouteCategories).catch((err) => devLog('Failed to load route categories', err))
  }, [])

  const handleAddBookmark = useCallback((lat: number, lng: number) => {
    setAddBmDialog({
      lat,
      lng,
      name: '',
      place: bm.places[0]?.name || t('bm.default'),
    })
  }, [bm.places, t])

  const submitAddBookmark = useCallback(async () => {
    if (!addBmDialog || !addBmDialog.name.trim()) return
    const place = bm.places.find((p) => p.name === addBmDialog.place)
    const payload = {
      name: addBmDialog.name.trim(),
      lat: addBmDialog.lat,
      lng: addBmDialog.lng,
      place_id: place?.id || 'default',
      tags: [],
    }
    setAddBmDialog(null)
    try {
      await bm.createBookmark(payload)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : ''
      showToast(t('toast.save_failed', { msg: message }))
    }
  }, [addBmDialog, bm, showToast, t])

  const handleBookmarkImport = useCallback(async (file: File) => {
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      if (
        !data ||
        typeof data !== 'object' ||
        !Array.isArray(data.places) ||
        !Array.isArray(data.bookmarks)
      ) {
        throw new Error('invalid file: missing places or bookmarks array')
      }
      const res = await api.importBookmarks(data)
      await bm.refresh()
      showToast(t('bm.import_success', { n: res.imported }))
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown'
      showToast(t('bm.import_failed', { error: message }))
    }
  }, [bm, showToast, t])

  const handleRouteLoad = useCallback((id: string): { lat: number; lng: number }[] | null => {
    const route = savedRoutes.find((r) => r.id === id)
    if (!route || !Array.isArray(route.waypoints)) return null
    return (route.waypoints as { lat: number; lng: number }[]).map((w) => ({
      lat: w.lat,
      lng: w.lng,
    }))
  }, [savedRoutes])

  // Re-fetch the saved-route list and push it through state. Every
  // mutation handler below funnels through here so the cache shape +
  // sort order is identical regardless of which path triggered the
  // refresh. Errors are logged and re-thrown so callers' existing
  // try/catch blocks can surface the right toast.
  const refreshRoutes = useCallback(async () => {
    try {
      const routes = await api.getSavedRoutes()
      setSavedRoutes(routes)
    } catch (err) {
      devLog('Failed to refresh saved routes', err)
      throw err
    }
  }, [])

  // Pull the {existing_id, existing_created_at} fields out of the 409
  // response body so the conflict dialog can show "saved YYYY-MM-DD"
  // without a follow-up GET. Defensive against shape drift — every field
  // is independently checked.
  const parseConflictExtras = useCallback((err: unknown): {
    existingId: string | null
    existingCreatedAt: string | null
  } => {
    const fallback = { existingId: null, existingCreatedAt: null }
    if (typeof err !== 'object' || err === null) return fallback
    const detail = (err as { detail?: unknown }).detail
    if (typeof detail !== 'object' || detail === null) return fallback
    const eid = (detail as Record<string, unknown>).existing_id
    const ets = (detail as Record<string, unknown>).existing_created_at
    return {
      existingId: typeof eid === 'string' ? eid : null,
      existingCreatedAt: typeof ets === 'string' ? ets : null,
    }
  }, [])

  const handleRouteSave = useCallback(async (
    name: string,
    waypoints: { lat: number; lng: number }[],
    moveMode: string,
    options?: { categoryId?: string; onConflict?: RouteConflictPolicy },
  ): Promise<SaveRouteResult> => {
    if (waypoints.length === 0) {
      showToast(t('toast.route_need_waypoint'))
      return { kind: 'error', message: t('toast.route_need_waypoint') }
    }
    const policy = options?.onConflict ?? 'new'
    try {
      const saved = await api.saveRoute(
        {
          name,
          waypoints,
          profile: moveMode,
          category_id: options?.categoryId ?? 'default',
        },
        policy,
      )
      await refreshRoutes()
      // "overwritten" is inferred when the caller asked for that policy
      // and the request succeeded — the backend doesn't ship the action
      // separately to keep the response shape `SavedRoute`.
      const kind = policy === 'overwrite' ? 'overwritten' : 'created'
      if (kind === 'created') showToast(t('toast.route_saved', { name }))
      return { kind, route: saved }
    } catch (err: unknown) {
      // The /api endpoint returns 409 + route_name_conflict when policy
      // is "reject" and a duplicate exists. The error is surfaced as an
      // Error whose `.cause` carries the raw envelope; the api.ts
      // request helper attaches it. Detect by code first.
      const code = (err as { code?: string })?.code
        ?? ((err as { detail?: { code?: string } })?.detail?.code)
      if (code === 'route_name_conflict') {
        const { existingId, existingCreatedAt } = parseConflictExtras(err)
        return { kind: 'conflict', existingId, existingCreatedAt }
      }
      const message = err instanceof Error ? err.message : ''
      showToast(t('toast.save_failed', { msg: message }))
      return { kind: 'error', message }
    }
  }, [refreshRoutes, showToast, t, parseConflictExtras])

  const handleRouteRename = useCallback(async (id: string, name: string) => {
    try {
      await api.renameRoute(id, name)
      await refreshRoutes()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('toast.rename_failed')
      showToast(message)
    }
  }, [refreshRoutes, showToast, t])

  const handleRouteDelete = useCallback(async (id: string) => {
    try {
      await api.deleteRoute(id)
      await refreshRoutes()
      showToast(t('toast.route_deleted'))
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('toast.route_delete_failed')
      showToast(message)
    }
  }, [refreshRoutes, showToast, t])

  const handleRoutesBatchDelete = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return
    try {
      const res = await api.batchDeleteRoutes(ids)
      await refreshRoutes()
      showToast(t('toast.routes_batch_deleted', { n: res.deleted }))
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : ''
      showToast(t('toast.routes_batch_delete_failed', { msg: message }))
    }
  }, [refreshRoutes, showToast, t])

  const handleRoutesMoveToCategory = useCallback(async (ids: string[], targetCategoryId: string) => {
    if (ids.length === 0) return
    try {
      const res = await api.moveRoutesToCategory(ids, targetCategoryId)
      await refreshRoutes()
      showToast(t('toast.routes_moved', { n: res.moved }))
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : ''
      showToast(t('toast.routes_move_failed', { msg: message }))
    }
  }, [refreshRoutes, showToast, t])

  // Optimistic reorder with an in-flight guard: a rapid second drag
  // while the first reorder POST is still landing would otherwise race
  // — the second drag's id list is computed from the stale pre-refresh
  // local order, both POSTs hit the server back-to-back, and whichever
  // refresh lands second wins. We instead serialise the POST and queue
  // the *latest* ordering on top, so a burst of N drags collapses into
  // one in-flight call plus one tail call carrying the final order.
  const routeReorderInflightRef = useRef(false)
  const routeReorderPendingRef = useRef<string[] | null>(null)
  const handleRoutesReorder = useCallback(async (orderedIds: string[]) => {
    if (routeReorderInflightRef.current) {
      routeReorderPendingRef.current = orderedIds
      return
    }
    routeReorderInflightRef.current = true
    try {
      await api.reorderRoutes(orderedIds)
    } catch (err) {
      devLog('reorderRoutes failed', err)
    } finally {
      await refreshRoutes()
      routeReorderInflightRef.current = false
      const queued = routeReorderPendingRef.current
      routeReorderPendingRef.current = null
      if (queued) void handleRoutesReorderRef.current(queued)
    }
  }, [refreshRoutes])
  // Self-ref pattern lets the finally block re-enter without a forward
  // reference; the ref is updated in an effect below.
  const handleRoutesReorderRef = useRef(handleRoutesReorder)
  useEffect(() => { handleRoutesReorderRef.current = handleRoutesReorder }, [handleRoutesReorder])

  const bookmarkReorderInflightRef = useRef(false)
  const bookmarkReorderPendingRef = useRef<string[] | null>(null)
  const handleBookmarksReorder = useCallback(async (orderedIds: string[]) => {
    if (bookmarkReorderInflightRef.current) {
      bookmarkReorderPendingRef.current = orderedIds
      return
    }
    bookmarkReorderInflightRef.current = true
    try {
      await api.reorderBookmarks(orderedIds)
    } catch (err) {
      devLog('reorderBookmarks failed', err)
    } finally {
      await bm.refresh()
      bookmarkReorderInflightRef.current = false
      const queued = bookmarkReorderPendingRef.current
      bookmarkReorderPendingRef.current = null
      if (queued) void handleBookmarksReorderRef.current(queued)
    }
  }, [bm])
  const handleBookmarksReorderRef = useRef(handleBookmarksReorder)
  useEffect(() => { handleBookmarksReorderRef.current = handleBookmarksReorder }, [handleBookmarksReorder])

  // ── Route categories ────────────────────────────────────
  const refreshRouteCategories = useCallback(async () => {
    try {
      const cats = await api.getRouteCategories()
      setRouteCategories(cats)
    } catch (err) {
      devLog('Failed to refresh route categories', err)
    }
  }, [])

  const handleRouteCategoryCreate = useCallback(
    async (name: string, color: string): Promise<RouteCategory | null> => {
      const trimmed = name.trim()
      if (!trimmed) return null
      try {
        const cat = await api.createRouteCategory(trimmed, color)
        await refreshRouteCategories()
        return cat
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : ''
        showToast(t('toast.save_failed', { msg: message }))
        return null
      }
    },
    [refreshRouteCategories, showToast, t],
  )

  const handleRouteCategoryUpdate = useCallback(
    async (id: string, patch: { name?: string; color?: string }) => {
      try {
        await api.updateRouteCategory(id, patch)
        await refreshRouteCategories()
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : ''
        showToast(t('toast.save_failed', { msg: message }))
      }
    },
    [refreshRouteCategories, showToast, t],
  )

  const handleRouteCategoryDelete = useCallback(async (id: string) => {
    try {
      await api.deleteRouteCategory(id)
      // Routes pointing at the deleted category server-side fall back to
      // "default" — re-fetch both so the UI's local view matches.
      await Promise.all([refreshRouteCategories(), refreshRoutes()])
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : ''
      showToast(t('toast.save_failed', { msg: message }))
    }
  }, [refreshRouteCategories, refreshRoutes, showToast, t])

  const handleRouteCategoriesReorder = useCallback(async (orderedIds: string[]) => {
    try {
      await api.reorderRouteCategories(orderedIds)
      await refreshRouteCategories()
    } catch (err) {
      devLog('reorderRouteCategories failed', err)
      await refreshRouteCategories()
    }
  }, [refreshRouteCategories])

  const handleGpxImport = useCallback(async (file: File) => {
    try {
      const res = await api.importGpx(file)
      await refreshRoutes()
      showToast(t('toast.gpx_imported', { n: res.points }))
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : ''
      showToast(t('toast.gpx_import_failed', { msg: message }))
    }
  }, [refreshRoutes, showToast, t])

  // Slugify a route name into a filename-safe stem. Falls back to the
  // route id when the name has no usable characters left.
  // (Replaces the prior window.open(url, '_blank', 'noopener,noreferrer')
  // approach: the new Blob-download path through api.downloadGpx supersedes
  // it entirely — auth-required exports can't be done via window.open
  // anyway because the browser's GET wouldn't carry the X-GPS-Token header.)
  const safeStem = useCallback((name: string, fallback: string) => {
    const cleaned = name.trim().replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_')
    return cleaned || fallback
  }, [])

  const handleGpxExport = useCallback(async (id: string) => {
    const route = savedRoutes.find((r) => r.id === id)
    const stem = safeStem(route?.name ?? '', id)
    try {
      await api.downloadGpx(id, `${stem}.gpx`)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : ''
      showToast(t('toast.export_failed', { msg: message }))
    }
  }, [savedRoutes, safeStem, showToast, t])

  const handleBookmarkExport = useCallback(async () => {
    try {
      await api.downloadBookmarksExport('bookmarks.json')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : ''
      showToast(t('toast.export_failed', { msg: message }))
    }
  }, [showToast, t])

  const handleRoutesExportAll = useCallback(async () => {
    try {
      await api.downloadAllRoutes('gpscontroller-routes.json')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : ''
      showToast(t('toast.export_failed', { msg: message }))
    }
  }, [showToast, t])

  const handleRoutesImportAll = useCallback(async (file: File) => {
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      if (!Array.isArray(data?.routes)) {
        throw new Error('invalid file: missing routes array')
      }
      const res = await api.importAllRoutes({ routes: data.routes })
      const routes = await api.getSavedRoutes()
      setSavedRoutes(routes)
      showToast(t('toast.routes_imported', { n: res.imported }))
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : ''
      showToast(t('toast.routes_import_failed', { msg: message }))
    }
  }, [showToast, t])

  const createBookmarksBulk = useCallback(
    async (
      items: Array<{ lat: number; lng: number; name?: string }>,
      placeId?: string,
    ): Promise<{ created: number; failed: number }> => {
      if (items.length === 0) return { created: 0, failed: 0 }
      const targetPlace = (placeId && bm.places.some((p) => p.id === placeId))
        ? placeId
        : 'default'
      const defaultName = t('bm.default_name')
      // Call `api.createBookmark` directly (not `bm.createBookmark`) so
      // each POST doesn't trigger its own `refresh()` — a 50-row
      // import would otherwise fire 50 full GET /bookmarks round-trips.
      const results = await Promise.allSettled(
        items.map((it, idx) => api.createBookmark({
          name: (it.name || '').trim() || `${defaultName} ${idx + 1}`,
          lat: it.lat,
          lng: it.lng,
          place_id: targetPlace,
          tags: [],
        })),
      )
      let created = 0
      let failed = 0
      for (const r of results) {
        if (r.status === 'fulfilled') created++
        else failed++
      }
      if (created > 0) {
        await bm.refresh()
        showToast(t('toast.bookmarks_bulk_ok', { n: created }))
      }
      if (failed > 0) showToast(t('toast.bookmarks_bulk_partial', { n: failed }))
      return { created, failed }
    },
    [bm, showToast, t],
  )

  const value: BookmarkContextValue = {
    bookmarks: bm.bookmarks,
    places: bm.places,
    tags: bm.tags,
    createBookmark: bm.createBookmark,
    createBookmarksBulk,
    updateBookmark: bm.updateBookmark,
    touchBookmark: bm.touchBookmark,
    deleteBookmark: bm.deleteBookmark,
    deleteBookmarksBatch: bm.deleteBookmarksBatch,
    moveBookmarks: bm.moveBookmarks,
    tagBookmarks: bm.tagBookmarks,
    createPlace: bm.createPlace,
    updatePlace: bm.updatePlace,
    deletePlace: bm.deletePlace,
    reorderPlaces: bm.reorderPlaces,
    createTag: bm.createTag,
    updateTag: bm.updateTag,
    deleteTag: bm.deleteTag,
    reorderTags: bm.reorderTags,
    refresh: bm.refresh,

    addBmDialog,
    setAddBmDialog,
    handleAddBookmark,
    submitAddBookmark,

    handleBookmarkImport,
    handleBookmarkExport,

    savedRoutes,
    handleRouteLoad,
    handleRouteSave,
    handleRouteRename,
    handleRouteDelete,
    handleRoutesBatchDelete,
    handleRoutesMoveToCategory,
    handleRoutesReorder,
    handleBookmarksReorder,

    routeCategories,
    handleRouteCategoryCreate,
    handleRouteCategoryUpdate,
    handleRouteCategoryDelete,
    handleRouteCategoriesReorder,

    handleGpxImport,
    handleGpxExport,

    handleRoutesImportAll,
    handleRoutesExportAll,
  }

  return (
    <BookmarkContext.Provider value={value}>
      {children}
    </BookmarkContext.Provider>
  )
}

export function useBookmarkContext() {
  const ctx = useContext(BookmarkContext)
  if (!ctx) throw new Error('useBookmarkContext must be used within BookmarkProvider')
  return ctx
}
