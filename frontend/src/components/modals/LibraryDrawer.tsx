import React, { useState, useCallback } from 'react'
import {
  BookOpen,
  Upload,
  Download,
  Pencil,
  Trash2,
  FileUp,
  X,
} from 'lucide-react'
import BookmarkList from '../BookmarkList'
import { useBookmarkContext } from '../../contexts/BookmarkContext'
import { useSimContext } from '../../contexts/SimContext'
import { useT } from '../../i18n'

interface LibraryDrawerProps {
  open: boolean
  onClose: () => void
}

type Tab = 'bookmarks' | 'routes'

const LibraryDrawer: React.FC<LibraryDrawerProps> = ({ open, onClose }) => {
  const t = useT()
  const bm = useBookmarkContext()
  const sim = useSimContext()

  const [activeTab, setActiveTab] = useState<Tab>('bookmarks')
  const [routeName, setRouteName] = useState('')
  const [editingRouteId, setEditingRouteId] = useState<string | null>(null)
  const [editingRouteName, setEditingRouteName] = useState('')

  const handleBookmarkClick = useCallback(
    (b: { lat: number; lng: number }) => {
      sim.handleTeleport(b.lat, b.lng)
      onClose()
    },
    [sim, onClose],
  )

  const handleRouteLoad = useCallback(
    (id: string) => {
      const waypoints = bm.handleRouteLoad(id)
      if (waypoints) {
        sim.sim.setWaypoints(waypoints)
      }
      onClose()
    },
    [bm, sim, onClose],
  )

  const handleRouteSaveClick = useCallback(() => {
    const name = routeName.trim()
    if (!name || sim.sim.waypoints.length === 0) return
    bm.handleRouteSave(name, sim.sim.waypoints, sim.sim.moveMode)
    setRouteName('')
  }, [routeName, bm, sim])

  const commitRename = useCallback(
    (routeId: string, currentName: string) => {
      const trimmed = editingRouteName.trim()
      if (trimmed && trimmed !== currentName) {
        bm.handleRouteRename(routeId, trimmed)
      }
      setEditingRouteId(null)
    },
    [editingRouteName, bm],
  )

  const savedRoutes = bm.savedRoutes as {
    id: string
    name: string
    waypoints: { lat: number; lng: number }[]
  }[]

  const bookmarkCategories = bm.categories.map((c) => c.name)
  const currentPosition = sim.sim.currentPosition
    ? { lat: sim.sim.currentPosition.lat, lng: sim.sim.currentPosition.lng }
    : null

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-[999] bg-black/30 transition-opacity duration-200 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className={`fixed inset-y-0 right-0 w-[min(420px,90vw)] z-[1000] bg-[var(--color-glass-heavy)] backdrop-blur-2xl border-l border-[var(--color-border)] shadow-2xl flex flex-col transform transition-transform duration-[280ms] ease-[var(--ease-out-expo)] ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-[var(--color-accent)]" />
            <span className="text-sm font-semibold text-[var(--color-text-1)]">
              Library
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-white/10 text-[var(--color-text-3)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab switcher */}
        <div className="flex border-b border-[var(--color-border)]">
          <button
            className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
              activeTab === 'bookmarks'
                ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
                : 'text-[var(--color-text-3)] hover:text-[var(--color-text-2)]'
            }`}
            onClick={() => setActiveTab('bookmarks')}
          >
            {t('panel.bookmarks_count')} ({bm.bookmarks.length})
          </button>
          <button
            className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
              activeTab === 'routes'
                ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
                : 'text-[var(--color-text-3)] hover:text-[var(--color-text-2)]'
            }`}
            onClick={() => setActiveTab('routes')}
          >
            {t('panel.routes_count')} ({savedRoutes.length})
          </button>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-3">
          {activeTab === 'bookmarks' ? (
            <BookmarkList
              bookmarks={bm.bookmarks.map((b) => ({
                id: b.id,
                name: b.name,
                lat: b.lat,
                lng: b.lng,
                category: bm.categories.find((c) => c.id === b.category_id)?.name || 'Default',
              }))}
              categories={bookmarkCategories}
              currentPosition={currentPosition}
              onBookmarkClick={handleBookmarkClick}
              onBookmarkAdd={(b) => {
                const cat = bm.categories.find((c) => c.name === b.category)
                bm.createBookmark({
                  name: b.name,
                  lat: b.lat,
                  lng: b.lng,
                  category_id: cat?.id || 'default',
                })
              }}
              onBookmarkDelete={(id) => bm.deleteBookmark(id)}
              onBookmarkEdit={(id, data) => bm.updateBookmark(id, data)}
              onCategoryAdd={(name) => bm.createCategory({ name })}
              onCategoryDelete={(name) => {
                const cat = bm.categories.find((c) => c.name === name)
                if (cat) bm.deleteCategory(cat.id)
              }}
              onImport={bm.handleBookmarkImport}
              exportUrl={bm.bookmarkExportUrl}
            />
          ) : (
            <div className="space-y-3">
              {/* Route save */}
              <div>
                <p className="text-[10px] text-[var(--color-text-3)] mb-1.5">
                  {t('panel.route_save_hint', { n: sim.sim.waypoints.length })}
                </p>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    className="search-input flex-1"
                    placeholder={t('panel.route_name')}
                    value={routeName}
                    onChange={(e) => setRouteName(e.target.value)}
                  />
                  <button
                    className="action-btn primary"
                    disabled={!routeName.trim() || sim.sim.waypoints.length === 0}
                    onClick={handleRouteSaveClick}
                  >
                    {t('generic.save')}
                  </button>
                </div>
              </div>

              {/* Import / Export buttons */}
              <div className="flex flex-wrap gap-1.5">
                <label className="action-btn inline-flex items-center gap-1 px-2.5 py-1 text-[11px] cursor-pointer">
                  <FileUp className="w-3 h-3" />
                  {t('panel.route_gpx_import')}
                  <input
                    type="file"
                    accept=".gpx,application/gpx+xml"
                    className="hidden"
                    onChange={async (e) => {
                      const f = e.target.files?.[0]
                      if (f) await bm.handleGpxImport(f)
                      e.target.value = ''
                    }}
                  />
                </label>

                <label className="action-btn inline-flex items-center gap-1 px-2.5 py-1 text-[11px] cursor-pointer">
                  <Upload className="w-3 h-3" />
                  {t('panel.routes_import_all')}
                  <input
                    type="file"
                    accept=".json,application/json"
                    className="hidden"
                    onChange={async (e) => {
                      const f = e.target.files?.[0]
                      if (f) await bm.handleRoutesImportAll(f)
                      e.target.value = ''
                    }}
                  />
                </label>

                {savedRoutes.length > 0 ? (
                  <a
                    className="action-btn inline-flex items-center gap-1 px-2.5 py-1 text-[11px] no-underline text-[var(--color-accent)]"
                    href={bm.routesExportAllUrl}
                    download="locwarp-routes.json"
                    title={t('panel.routes_export_all_tooltip')}
                  >
                    <Download className="w-3 h-3" />
                    {t('panel.routes_export_all')}
                  </a>
                ) : (
                  <button
                    className="action-btn inline-flex items-center gap-1 px-2.5 py-1 text-[11px] opacity-50"
                    disabled
                    title={t('panel.routes_export_all_disabled')}
                  >
                    <Download className="w-3 h-3" />
                    {t('panel.routes_export_all')}
                  </button>
                )}
              </div>

              {/* Route list */}
              {savedRoutes.length === 0 && (
                <p className="text-xs text-[var(--color-text-3)] py-2">
                  {t('panel.route_empty')}
                </p>
              )}

              {savedRoutes.map((route) => {
                const isEditing = editingRouteId === route.id
                const doCommitRename = () => commitRename(route.id, route.name)
                return (
                  <div
                    key={route.id}
                    className="flex items-center gap-1.5 p-2 rounded-lg hover:bg-white/5 transition-colors"
                  >
                    {isEditing ? (
                      <input
                        type="text"
                        autoFocus
                        value={editingRouteName}
                        onChange={(e) => setEditingRouteName(e.target.value)}
                        onBlur={doCommitRename}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') doCommitRename()
                          else if (e.key === 'Escape') setEditingRouteId(null)
                        }}
                        className="search-input flex-1 text-[13px] py-0.5 px-1"
                      />
                    ) : (
                      <span
                        className="flex-1 text-[13px] text-[var(--color-text-1)] cursor-pointer truncate"
                        onClick={() => handleRouteLoad(route.id)}
                        title={t('panel.route_load_tooltip')}
                      >
                        {route.name}
                      </span>
                    )}

                    <span className="text-[11px] text-[var(--color-text-3)] whitespace-nowrap">
                      {route.waypoints.length} pts
                    </span>

                    {!isEditing && (
                      <button
                        className="action-btn p-1 text-[var(--color-text-3)] hover:text-[var(--color-text-1)]"
                        title={t('generic.rename')}
                        onClick={(e) => {
                          e.stopPropagation()
                          setEditingRouteId(route.id)
                          setEditingRouteName(route.name)
                        }}
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                    )}

                    <button
                      className="action-btn p-1 text-[var(--color-accent)]"
                      title={t('panel.route_gpx_export_tooltip')}
                      onClick={(e) => {
                        e.stopPropagation()
                        bm.handleGpxExport(route.id)
                      }}
                    >
                      <Download className="w-3 h-3" />
                    </button>

                    <button
                      className="action-btn p-1 text-red-400 hover:text-red-300"
                      title={t('generic.delete')}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (confirm(t('panel.route_delete_confirm', { name: route.name }))) {
                          bm.handleRouteDelete(route.id)
                        }
                      }}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

export default LibraryDrawer
