import React, { useCallback, useState } from 'react'
import {
  BookOpen, Upload, Download, Pencil, Trash2, FileUp,
} from 'lucide-react'
import { useBookmarkContext } from '../../contexts/BookmarkContext'
import { useSimContext } from '../../contexts/SimContext'
import { useT } from '../../i18n'
import Drawer from '../shell/Drawer'
import PanelTabs, { panelPropsForTab, type PanelTab } from '../ui/PanelTabs'
import BookmarksPanel from '../library/BookmarksPanel'

interface LibraryDrawerProps {
  open: boolean
  onClose: () => void
}

type TabId = 'bookmarks' | 'routes'

const LibraryDrawer: React.FC<LibraryDrawerProps> = ({ open, onClose }) => {
  const t = useT()
  const bm = useBookmarkContext()
  const sim = useSimContext()

  const [activeTab, setActiveTab] = useState<TabId>('bookmarks')
  const [routeName, setRouteName] = useState('')
  const [editingRouteId, setEditingRouteId] = useState<string | null>(null)
  const [editingRouteName, setEditingRouteName] = useState('')
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  const handleBookmarkTeleport = useCallback(
    (lat: number, lng: number) => { sim.handleTeleport(lat, lng); onClose() },
    [sim, onClose],
  )

  const handleRouteLoad = useCallback(
    (id: string) => {
      const waypoints = bm.handleRouteLoad(id)
      if (waypoints) sim.sim.setWaypoints(waypoints)
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
      if (trimmed && trimmed !== currentName) bm.handleRouteRename(routeId, trimmed)
      setEditingRouteId(null)
    },
    [editingRouteName, bm],
  )

  const savedRoutes = bm.savedRoutes as { id: string; name: string; waypoints: { lat: number; lng: number }[] }[]
  const currentPosition = sim.sim.currentPosition
    ? { lat: sim.sim.currentPosition.lat, lng: sim.sim.currentPosition.lng }
    : null

  const tabs: PanelTab<TabId>[] = [
    { id: 'bookmarks', label: t('panel.bookmarks_count'), count: bm.bookmarks.length },
    { id: 'routes', label: t('panel.routes_count'), count: savedRoutes.length },
  ]

  return (
    <Drawer open={open} onClose={onClose} title="Library" icon={<BookOpen className="w-4 h-4" />} width="w-[min(440px,92vw)]">
      {/* Tab switcher */}
      <div className="px-4 pt-3 pb-1">
        <PanelTabs tabs={tabs} activeId={activeTab} onChange={setActiveTab} ariaLabel={t('panel.library')} />
      </div>

      {/* Tab content */}
      {activeTab === 'bookmarks' ? (
        <div {...panelPropsForTab('bookmarks')}>
          <BookmarksPanel
            onBookmarkClick={handleBookmarkTeleport}
            currentPosition={currentPosition}
          />
        </div>
      ) : (
        <div {...panelPropsForTab('routes')} className="p-4 flex flex-col gap-3">
          {/* Route save */}
          <div className="seg">
            <div className="seg-row">
              <input
                type="text"
                className="seg-input flex-1 text-xs"
                placeholder={t('panel.route_name')}
                value={routeName}
                onChange={(e) => setRouteName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleRouteSaveClick() }}
              />
              <button className="action-btn primary text-[11px]" disabled={!routeName.trim() || sim.sim.waypoints.length === 0} onClick={handleRouteSaveClick}>
                {t('generic.save')}
              </button>
            </div>
            <div className="seg-row seg-row-compact">
              <span className="text-[10px] text-[var(--color-text-3)]">
                {t('panel.route_save_hint', { n: sim.sim.waypoints.length })}
              </span>
            </div>
          </div>

          {/* Import / Export */}
          <div className="flex flex-wrap gap-1.5">
            <label className="action-btn text-[11px] cursor-pointer">
              <FileUp className="w-3 h-3" />
              {t('panel.route_gpx_import')}
              <input type="file" accept=".gpx,application/gpx+xml" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) await bm.handleGpxImport(f); e.target.value = '' }} />
            </label>
            <label className="action-btn text-[11px] cursor-pointer">
              <Upload className="w-3 h-3" />
              {t('panel.routes_import_all')}
              <input type="file" accept=".json,application/json" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) await bm.handleRoutesImportAll(f); e.target.value = '' }} />
            </label>
            {savedRoutes.length > 0 ? (
              <a className="action-btn text-[11px] no-underline text-[var(--color-accent)]" href={bm.routesExportAllUrl} download="gpscontroller-routes.json" title={t('panel.routes_export_all_tooltip')}>
                <Download className="w-3 h-3" />
                {t('panel.routes_export_all')}
              </a>
            ) : (
              <button className="action-btn text-[11px] opacity-40" disabled title={t('panel.routes_export_all_disabled')}>
                <Download className="w-3 h-3" />
                {t('panel.routes_export_all')}
              </button>
            )}
          </div>

          {/* Route list */}
          {savedRoutes.length === 0 ? (
            <p className="text-xs text-[var(--color-text-3)] text-center py-6">{t('panel.route_empty')}</p>
          ) : (
            <div className="flex flex-col gap-1">
              {savedRoutes.map((route) => {
                const isEditing = editingRouteId === route.id
                const doCommitRename = () => commitRename(route.id, route.name)
                return (
                  <div key={route.id} className="flex items-center gap-1.5 px-2 py-2 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] transition-colors">
                    {isEditing ? (
                      <input type="text" autoFocus value={editingRouteName} onChange={(e) => setEditingRouteName(e.target.value)} onBlur={doCommitRename} onKeyDown={(e) => { if (e.key === 'Enter') doCommitRename(); else if (e.key === 'Escape') setEditingRouteId(null) }} className="seg-input flex-1 text-[12px] py-0.5" />
                    ) : (
                      <span className="flex-1 text-[12px] text-[var(--color-text-1)] cursor-pointer truncate" onClick={() => handleRouteLoad(route.id)} title={t('panel.route_load_tooltip')}>
                        {route.name}
                      </span>
                    )}
                    <span className="text-[10px] text-[var(--color-text-3)] whitespace-nowrap shrink-0">{route.waypoints.length} pts</span>
                    {!isEditing && (
                      <button className="p-1 rounded-md text-[var(--color-text-3)] hover:text-[var(--color-text-1)] hover:bg-white/[0.06] transition-colors cursor-pointer" title={t('generic.rename')} onClick={(e) => { e.stopPropagation(); setEditingRouteId(route.id); setEditingRouteName(route.name) }}>
                        <Pencil className="w-3 h-3" />
                      </button>
                    )}
                    <button className="p-1 rounded-md text-[var(--color-accent)] hover:bg-[var(--color-accent-dim)] transition-colors cursor-pointer" title={t('panel.route_gpx_export_tooltip')} onClick={(e) => { e.stopPropagation(); bm.handleGpxExport(route.id) }}>
                      <Download className="w-3 h-3" />
                    </button>
                    {pendingDeleteId === route.id ? (
                      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        <button className="px-1.5 py-0.5 text-[10px] rounded-md bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors cursor-pointer" onClick={() => { bm.handleRouteDelete(route.id); setPendingDeleteId(null) }}>{t('generic.delete')}</button>
                        <button className="px-1.5 py-0.5 text-[10px] rounded-md bg-white/5 text-[var(--color-text-3)] hover:bg-white/10 transition-colors cursor-pointer" onClick={() => setPendingDeleteId(null)}>{t('generic.cancel')}</button>
                      </div>
                    ) : (
                      <button className="p-1 rounded-md text-red-400 hover:bg-red-400/10 transition-colors cursor-pointer" title={t('generic.delete')} onClick={(e) => { e.stopPropagation(); setPendingDeleteId(route.id) }}>
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </Drawer>
  )
}

export default LibraryDrawer
