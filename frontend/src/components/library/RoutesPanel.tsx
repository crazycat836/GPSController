import { useCallback, useMemo, useState } from 'react'
import {
  Route as RouteIcon, Save, Pencil, Trash2, FileUp, Upload, Download,
} from 'lucide-react'
import { useBookmarkContext } from '../../contexts/BookmarkContext'
import { useSimContext } from '../../contexts/SimContext'
import { useToastContext } from '../../contexts/ToastContext'
import { useT } from '../../i18n'
import { ICON_SIZE } from '../../lib/icons'
import { pickFile } from '../../lib/fileIo'
import ListRow from '../ui/ListRow'
import KebabMenu, { type KebabMenuItem } from '../ui/KebabMenu'
import EmptyState from '../ui/EmptyState'
import ConfirmDialog from '../ui/ConfirmDialog'
import type { SavedRoute } from '../../services/api'

interface RoutesPanelProps {
  onRouteLoaded: () => void
}

export default function RoutesPanel({ onRouteLoaded }: RoutesPanelProps) {
  const t = useT()
  const bm = useBookmarkContext()
  const sim = useSimContext()
  const { showToast } = useToastContext()

  const savedRoutes = bm.savedRoutes
  const waypointsCount = sim.sim.waypoints.length

  const [routeName, setRouteName] = useState('')
  const [editingRouteId, setEditingRouteId] = useState<string | null>(null)
  const [editingRouteName, setEditingRouteName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<SavedRoute | null>(null)

  // ─── Actions ────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    const name = routeName.trim()
    if (!name || waypointsCount === 0) return
    setRouteName('')
    try {
      await bm.handleRouteSave(name, sim.sim.waypoints, sim.sim.moveMode)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : ''
      showToast(t('toast.save_failed', { msg: message }))
    }
  }, [routeName, waypointsCount, bm, sim, showToast, t])

  const handleLoad = useCallback((id: string) => {
    const waypoints = bm.handleRouteLoad(id)
    if (waypoints) {
      sim.sim.setWaypoints(waypoints)
      onRouteLoaded()
    }
  }, [bm, sim, onRouteLoaded])

  const commitRename = useCallback((routeId: string, currentName: string) => {
    const next = editingRouteName.trim()
    if (next && next !== currentName) {
      void bm.handleRouteRename(routeId, next)
    }
    setEditingRouteId(null)
  }, [editingRouteName, bm])

  // ─── Header kebab — bulk import/export ──────────────────────
  const headerMenuItems: KebabMenuItem[] = useMemo(() => [
    {
      id: 'gpx-import',
      label: t('panel.route_gpx_import'),
      icon: <FileUp width={ICON_SIZE.sm} height={ICON_SIZE.sm} />,
      onSelect: async () => {
        const f = await pickFile('.gpx,application/gpx+xml')
        if (f) void bm.handleGpxImport(f)
      },
    },
    {
      id: 'import-all',
      label: t('panel.routes_import_all'),
      icon: <Upload width={ICON_SIZE.sm} height={ICON_SIZE.sm} />,
      onSelect: async () => {
        const f = await pickFile('.json,application/json')
        if (f) void bm.handleRoutesImportAll(f)
      },
    },
    {
      id: 'export-all',
      label: t('panel.routes_export_all'),
      icon: <Download width={ICON_SIZE.sm} height={ICON_SIZE.sm} />,
      disabled: savedRoutes.length === 0,
      onSelect: () => { void bm.handleRoutesExportAll() },
    },
  ], [t, bm, savedRoutes.length])

  // ─── Row kebab — per-route actions ──────────────────────────
  const rowMenuItems = useCallback((route: SavedRoute): KebabMenuItem[] => [
    {
      id: 'rename',
      label: t('generic.rename'),
      icon: <Pencil width={ICON_SIZE.sm} height={ICON_SIZE.sm} />,
      onSelect: () => { setEditingRouteId(route.id); setEditingRouteName(route.name) },
    },
    {
      id: 'gpx-export',
      label: t('route.gpx_export'),
      icon: <Download width={ICON_SIZE.sm} height={ICON_SIZE.sm} />,
      onSelect: () => { void bm.handleGpxExport(route.id) },
    },
    {
      id: 'delete',
      label: t('generic.delete'),
      icon: <Trash2 width={ICON_SIZE.sm} height={ICON_SIZE.sm} />,
      kind: 'danger',
      onSelect: () => setConfirmDelete(route),
    },
  ], [t, bm])

  const saveDisabled = !routeName.trim() || waypointsCount === 0

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* Save current route — primary action surface */}
      <div className="seg">
        <div className="seg-row">
          <input
            type="text"
            className="seg-input flex-1 text-xs"
            placeholder={t('panel.route_name')}
            value={routeName}
            onChange={(e) => setRouteName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) handleSave() }}
          />
          <button
            type="button"
            className="action-btn primary text-[11px]"
            disabled={saveDisabled}
            onClick={handleSave}
            title={saveDisabled ? t('toast.route_need_waypoint') : t('route.quick_save')}
          >
            <Save width={ICON_SIZE.xs} height={ICON_SIZE.xs} />
            {t('generic.save')}
          </button>
          <KebabMenu items={headerMenuItems} ariaLabel={t('route.actions_aria')} />
        </div>
        <div className="seg-row seg-row-compact">
          <span className="text-[10px] text-[var(--color-text-3)]">
            {t('panel.route_save_hint', { n: waypointsCount })}
          </span>
        </div>
      </div>

      {/* Route list */}
      {savedRoutes.length === 0 ? (
        <EmptyState
          icon={<RouteIcon width={ICON_SIZE.lg} height={ICON_SIZE.lg} />}
          title={t('panel.route_empty')}
        />
      ) : (
        <div className="flex flex-col gap-1.5">
          {savedRoutes.map((route) => {
            const isEditing = editingRouteId === route.id

            const titleNode = isEditing ? (
              <input
                autoFocus
                type="text"
                className="search-input w-full"
                value={editingRouteName}
                onChange={(e) => setEditingRouteName(e.target.value)}
                onBlur={() => commitRename(route.id, route.name)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) commitRename(route.id, route.name)
                  else if (e.key === 'Escape') setEditingRouteId(null)
                }}
                onClick={(e) => e.stopPropagation()}
                style={{ paddingLeft: 8, height: 28 }}
              />
            ) : (
              <span className="truncate">{route.name}</span>
            )

            return (
              <ListRow
                key={route.id}
                as="button"
                density="compact"
                onClick={() => { if (!isEditing) handleLoad(route.id) }}
                title={titleNode}
                aria-label={route.name}
                leading={
                  <RouteIcon
                    width={ICON_SIZE.md}
                    height={ICON_SIZE.md}
                    className="text-[var(--color-accent)]"
                  />
                }
                meta={
                  <span className="font-mono opacity-75">
                    {t('route.pts_count', { n: route.waypoints.length })}
                  </span>
                }
                trailing={
                  <KebabMenu
                    items={() => rowMenuItems(route)}
                    ariaLabel={t('route.row_actions_aria')}
                  />
                }
              />
            )
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title={t('route.delete_title')}
        description={confirmDelete ? t('panel.route_delete_confirm', { name: confirmDelete.name }) : undefined}
        confirmLabel={t('generic.delete')}
        cancelLabel={t('generic.cancel')}
        tone="danger"
        onConfirm={async () => {
          if (confirmDelete) await bm.handleRouteDelete(confirmDelete.id)
          setConfirmDelete(null)
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  )
}
