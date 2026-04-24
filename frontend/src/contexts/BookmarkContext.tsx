import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { useBookmarks, type Bookmark, type BookmarkPlace, type BookmarkTag } from '../hooks/useBookmarks'
import * as api from '../services/api'
import type { SavedRoute } from '../services/api'
import { useToastContext } from './ToastContext'
import { useT } from '../i18n'

interface AddBmDialog {
  lat: number
  lng: number
  name: string
  place: string
}

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
  submitAddBookmark: () => void

  // Bookmark import/export
  handleBookmarkImport: (file: File) => Promise<void>
  bookmarkExportUrl: string

  // Saved routes
  savedRoutes: readonly SavedRoute[]
  handleRouteLoad: (id: string) => { lat: number; lng: number }[] | null
  handleRouteSave: (name: string, waypoints: { lat: number; lng: number }[], moveMode: string) => Promise<void>
  handleRouteRename: (id: string, name: string) => Promise<void>
  handleRouteDelete: (id: string) => Promise<void>

  // GPX
  handleGpxImport: (file: File) => Promise<void>
  handleGpxExport: (id: string) => void

  // Bulk route import/export
  handleRoutesImportAll: (file: File) => Promise<void>
  routesExportAllUrl: string
}

const BookmarkContext = createContext<BookmarkContextValue | null>(null)

export function BookmarkProvider({ children }: { children: React.ReactNode }) {
  const t = useT()
  const { showToast } = useToastContext()
  const bm = useBookmarks()

  const [savedRoutes, setSavedRoutes] = useState<SavedRoute[]>([])
  const [addBmDialog, setAddBmDialog] = useState<AddBmDialog | null>(null)

  useEffect(() => {
    api.getSavedRoutes().then(setSavedRoutes).catch(() => {})
  }, [])

  const handleAddBookmark = useCallback((lat: number, lng: number) => {
    setAddBmDialog({
      lat,
      lng,
      name: '',
      place: bm.places[0]?.name || t('bm.default'),
    })
  }, [bm.places, t])

  const submitAddBookmark = useCallback(() => {
    if (!addBmDialog || !addBmDialog.name.trim()) return
    const place = bm.places.find((p) => p.name === addBmDialog.place)
    bm.createBookmark({
      name: addBmDialog.name.trim(),
      lat: addBmDialog.lat,
      lng: addBmDialog.lng,
      place_id: place?.id || 'default',
      tags: [],
    })
    setAddBmDialog(null)
  }, [addBmDialog, bm])

  const handleBookmarkImport = useCallback(async (file: File) => {
    try {
      const text = await file.text()
      const data = JSON.parse(text)
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

  const handleRouteSave = useCallback(async (
    name: string,
    waypoints: { lat: number; lng: number }[],
    moveMode: string,
  ) => {
    if (waypoints.length === 0) {
      showToast(t('toast.route_need_waypoint'))
      return
    }
    try {
      await api.saveRoute({ name, waypoints, profile: moveMode })
      const routes = await api.getSavedRoutes()
      setSavedRoutes(routes)
      showToast(t('toast.route_saved', { name }))
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : ''
      showToast(t('toast.route_save_failed', { msg: message }))
    }
  }, [showToast, t])

  const handleRouteRename = useCallback(async (id: string, name: string) => {
    try {
      await api.renameRoute(id, name)
      const routes = await api.getSavedRoutes()
      setSavedRoutes(routes)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('toast.route_rename_failed')
      showToast(message)
    }
  }, [showToast, t])

  const handleRouteDelete = useCallback(async (id: string) => {
    try {
      await api.deleteRoute(id)
      const routes = await api.getSavedRoutes()
      setSavedRoutes(routes)
      showToast(t('toast.route_deleted'))
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('toast.route_delete_failed')
      showToast(message)
    }
  }, [showToast, t])

  const handleGpxImport = useCallback(async (file: File) => {
    try {
      const res = await api.importGpx(file)
      const routes = await api.getSavedRoutes()
      setSavedRoutes(routes)
      showToast(t('toast.gpx_imported', { n: res.points }))
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : ''
      showToast(t('toast.gpx_import_failed', { msg: message }))
    }
  }, [showToast, t])

  const handleGpxExport = useCallback((id: string) => {
    const url = api.exportGpxUrl(id)
    window.open(url, '_blank')
  }, [])

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
    bookmarkExportUrl: api.bookmarksExportUrl(),

    savedRoutes,
    handleRouteLoad,
    handleRouteSave,
    handleRouteRename,
    handleRouteDelete,

    handleGpxImport,
    handleGpxExport,

    handleRoutesImportAll,
    routesExportAllUrl: api.exportAllRoutesUrl(),
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
