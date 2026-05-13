import React, { useState, useRef, useEffect, useMemo } from 'react'
import { X, Star, Dices, Locate, MapPin, Flag, ChevronDown, Save, FolderOpen, Check, ClipboardPaste, Wand2 } from 'lucide-react'
import { useSimContext } from '../../contexts/SimContext'
import { useSimDerived } from '../../contexts/SimDerivedContext'
import { useSimSettings } from '../../contexts/SimSettingsContext'
import { useBookmarkContext } from '../../contexts/BookmarkContext'
import { useToastContext } from '../../contexts/ToastContext'
import { useT } from '../../i18n'
import PauseControl from '../PauseControl'
import RouteCard, { type RoutePoint } from '../RouteCard'
import KebabMenu, { type KebabMenuItem } from '../ui/KebabMenu'
import BulkCoordsDialog from '../library/BulkCoordsDialog'
import { ICON_SIZE } from '../../lib/icons'
import * as api from '../../services/api'

interface WaypointListProps {
  mode: 'loop' | 'multistop'
}

export default function WaypointList({ mode }: WaypointListProps) {
  const {
    sim,
    handleGenerateRandomWaypoints,
    handleGenerateAllRandom,
    handleRemoveWaypoint,
    handleClearWaypoints,
    handleTeleport,
  } = useSimContext()
  const { wpGenRadius, setWpGenRadius, wpGenCount, setWpGenCount } = useSimSettings()
  const { isRunning } = useSimDerived()
  const { handleAddBookmark, savedRoutes, handleRouteSave, handleRouteLoad } = useBookmarkContext()
  const { showToast } = useToastContext()
  const t = useT()
  const [genOpen, setGenOpen] = useState(false)
  const [savingMode, setSavingMode] = useState(false)
  const [routeName, setRouteName] = useState('')
  const [loadOpen, setLoadOpen] = useState(false)
  const loadRef = useRef<HTMLDivElement>(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [optimizing, setOptimizing] = useState(false)

  const handleOptimizeOrder = async () => {
    if (optimizing || sim.waypoints.length < 2) return
    setOptimizing(true)
    try {
      // Send the current waypoints + selected move mode. The first
      // index is anchored server-side, so dragging the list afterwards
      // still works from the user's perspective.
      const result = await api.optimizeRoute(sim.waypoints, sim.moveMode)
      sim.setWaypoints(result.waypoints)
      showToast(t('toast.route_optimized'))
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : ''
      showToast(t('toast.route_optimize_failed', { msg: message }))
    } finally {
      setOptimizing(false)
    }
  }

  useEffect(() => {
    if (!loadOpen) return
    const handler = (e: MouseEvent) => {
      if (loadRef.current && !loadRef.current.contains(e.target as Node)) setLoadOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [loadOpen])

  const typedRoutes = savedRoutes as { id: string; name: string; waypoints: { lat: number; lng: number }[] }[]

  const doSaveRoute = () => {
    const name = routeName.trim()
    if (!name || sim.waypoints.length === 0) return
    handleRouteSave(name, sim.waypoints, sim.moveMode)
    setRouteName('')
    setSavingMode(false)
  }

  const doLoadRoute = (id: string) => {
    const waypoints = handleRouteLoad(id)
    if (waypoints) sim.setWaypoints(waypoints)
    setLoadOpen(false)
  }

  const pauseValue = mode === 'loop' ? sim.pauseLoop : sim.pauseMultiStop
  const pauseOnChange = mode === 'loop' ? sim.setPauseLoop : sim.setPauseMultiStop
  const pauseLabelKey = mode === 'loop' ? 'pause.loop' as const : 'pause.multi_stop' as const

  /* ── Build route points from waypoints ── */
  const seg = sim.waypointProgress?.current
  const points: RoutePoint[] = sim.waypoints.map((wp: { lat: number; lng: number }, i: number) => {
    const approaching = seg != null && i === seg + 1
    const passed = seg != null && i <= seg
    const isStart = i === 0
    const isLast = i === sim.waypoints.length - 1

    let label: string
    let iconColor: string
    let icon: React.ReactNode

    if (isStart) {
      label = t('panel.waypoint_start')
      iconColor = passed ? 'var(--color-text-3)' : 'var(--color-success)'
      icon = <Locate className="w-3 h-3" style={{ color: iconColor }} />
    } else if (isLast && mode === 'multistop') {
      label = `#${i}`
      iconColor = approaching ? 'var(--color-device-b)' : passed ? 'var(--color-text-3)' : 'var(--color-danger)'
      icon = <Flag className="w-3 h-3" style={{ color: iconColor }} />
    } else {
      label = `#${i}`
      iconColor = approaching ? 'var(--color-device-b)' : passed ? 'var(--color-text-3)' : 'var(--color-device-b)'
      icon = <MapPin className="w-3 h-3" style={{ color: iconColor }} />
    }

    return {
      id: `wp-${i}`,
      label,
      position: wp,
      icon,
      labelColor: approaching ? 'var(--color-device-b)' : passed ? 'var(--color-text-3)' : undefined,
      coordColor: passed ? 'var(--color-text-3)' : undefined,
      // Click the coord / label to fly to this waypoint while
      // keeping the active Loop / MultiStop mode intact.
      onPointClick: () => handleTeleport(wp.lat, wp.lng),
      clickTitle: t('panel.waypoint_fly_to'),
      actions: (
        <div className="flex items-center gap-0.5">
          <button
            className="shrink-0 p-2.5 rounded-md transition-colors hover:opacity-80 cursor-pointer"
            style={{ color: 'var(--color-warning, #f5a623)' }}
            onClick={() => handleAddBookmark(wp.lat, wp.lng)}
            title={t('map.add_bookmark')}
          >
            <Star size={12} />
          </button>
          <button
            className="p-2.5 rounded-md text-[var(--color-text-3)] hover:text-[var(--color-danger)]
                       hover:bg-[var(--color-danger-dim)] transition-colors cursor-pointer"
            onClick={() => handleRemoveWaypoint(i)}
            title={t('panel.waypoints_remove')}
          >
            <X size={12} />
          </button>
        </div>
      ),
    } satisfies RoutePoint
  })

  /* ── Collapsible generation controls ── */
  const genHeader = (
    <>
      {/* Toggle button */}
      <button
        className="seg-row seg-row-compact w-full justify-center gap-1 cursor-pointer bg-transparent"
        style={{ border: 'none', borderTop: '1px solid var(--color-border-subtle)' }}
        onClick={() => setGenOpen(prev => !prev)}
      >
        <Dices size={11} style={{ color: 'var(--color-text-3)' }} />
        <span className="seg-unit">{t('panel.waypoints_generate')}</span>
        <ChevronDown
          size={12}
          style={{
            color: 'var(--color-text-3)',
            transform: genOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 150ms',
          }}
        />
      </button>

      {genOpen && (
        <>
          {/* Radius + Count */}
          <div className="seg-row border-t border-[var(--color-border-subtle)]">
            <span className="seg-label">{t('panel.waypoints_radius')}</span>
            <input
              type="number"
              min={10}
              value={wpGenRadius}
              onChange={(e) => setWpGenRadius(Math.max(1, parseInt(e.target.value) || 0))}
              className="seg-input w-16 text-right"
            />
            <span className="seg-unit">m</span>
            <span className="mx-1" />
            <span className="seg-label">{t('panel.waypoints_count')}</span>
            <input
              type="number"
              min={1}
              max={50}
              value={wpGenCount}
              onChange={(e) => setWpGenCount(Math.max(1, parseInt(e.target.value) || 0))}
              className="seg-input w-14 text-right"
            />
            <span className="seg-unit">{t('panel.points')}</span>
          </div>

          {/* Generate buttons */}
          <div className="seg-row seg-row-compact" style={{ justifyContent: 'center', gap: '4px' }}>
            <button
              className="seg-text-btn"
              onClick={handleGenerateRandomWaypoints}
              title={t('panel.waypoints_gen_tooltip')}
            >
              <Dices size={11} />
              {t('panel.waypoints_generate')}
            </button>
            <button
              className="seg-text-btn"
              onClick={handleGenerateAllRandom}
              title={t('panel.waypoints_gen_all_tooltip')}
            >
              <Dices size={11} />
              {t('panel.waypoints_generate_all')}
            </button>
          </div>
        </>
      )}
    </>
  )

  /* ── Header overflow menu (bulk paste + future actions) ── */
  const headerMenuItems: KebabMenuItem[] = useMemo(() => [
    {
      id: 'bulk',
      label: t('panel.waypoints_bulk_paste'),
      icon: <ClipboardPaste width={ICON_SIZE.sm} height={ICON_SIZE.sm} />,
      disabled: isRunning,
      onSelect: () => setBulkOpen(true),
    },
    {
      id: 'optimize',
      label: t('panel.waypoints_optimize'),
      icon: <Wand2 width={ICON_SIZE.sm} height={ICON_SIZE.sm} />,
      // Refuse mid-run (sort_order shouldn't shuffle while the engine
      // is walking the list) and when there's nothing to reorder.
      disabled: isRunning || optimizing || sim.waypoints.length < 2,
      onSelect: () => { void handleOptimizeOrder() },
    },
  ], [t, isRunning, optimizing, sim.waypoints.length])

  /* ── Header extra: save / load icon buttons ── */
  const titleExtra = (
    <div className="flex items-center gap-0.5 ml-auto">
      {savingMode ? (
        <>
          <input
            className="seg-input text-xs w-24"
            placeholder={t('panel.route_name')}
            value={routeName}
            onChange={(e) => setRouteName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) doSaveRoute(); if (e.key === 'Escape') { setSavingMode(false); setRouteName('') } }}
            autoFocus
          />
          <button
            className="p-2.5 rounded-md text-[var(--color-success)] hover:bg-[var(--color-success-dim)] transition-colors cursor-pointer"
            onClick={doSaveRoute}
            disabled={!routeName.trim()}
          >
            <Check size={12} />
          </button>
          <button
            className="p-2.5 rounded-md text-[var(--color-text-3)] hover:text-[var(--color-text-1)] transition-colors cursor-pointer"
            onClick={() => { setSavingMode(false); setRouteName('') }}
          >
            <X size={12} />
          </button>
        </>
      ) : (
        <>
          <button
            className="p-2.5 rounded-md text-[var(--color-text-3)] hover:text-[var(--color-accent-strong)] hover:bg-[var(--color-accent-dim)] transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            onClick={() => setSavingMode(true)}
            disabled={points.length === 0}
            title={t('route.quick_save')}
          >
            <Save size={12} />
          </button>
          <div ref={loadRef} style={{ position: 'relative' }}>
            <button
              className="p-2.5 rounded-md text-[var(--color-text-3)] hover:text-[var(--color-accent-strong)] hover:bg-[var(--color-accent-dim)] transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              onClick={() => setLoadOpen((prev) => !prev)}
              disabled={typedRoutes.length === 0}
              title={t('route.quick_load')}
            >
              <FolderOpen size={12} />
            </button>
            {loadOpen && (
              <div className="route-quick-load-dropdown">
                {typedRoutes.map((r) => (
                  <button key={r.id} className="route-quick-load-item" onClick={() => doLoadRoute(r.id)}>
                    <span className="truncate">{r.name}</span>
                    <span className="seg-unit shrink-0">{r.waypoints.length} pts</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <KebabMenu
            triggerSize={12}
            items={headerMenuItems}
            ariaLabel={t('panel.waypoints_menu')}
          />
        </>
      )}
    </div>
  )

  /* ── Footer: empty hint or clear button ── */
  const listFooter = points.length === 0 ? (
    <div className="seg-row seg-row-compact" style={{ justifyContent: 'center' }}>
      <span className="seg-unit">{t('panel.waypoints_empty')}</span>
    </div>
  ) : (
    <div className="seg-row seg-row-compact" style={{ justifyContent: 'center' }}>
      <button
        className="seg-text-btn text-[var(--color-text-3)] hover:text-[var(--color-danger)]"
        onClick={handleClearWaypoints}
        disabled={isRunning}
      >
        {t('generic.clear')}
      </button>
    </div>
  )

  return (
    <>
      <RouteCard
        title={`${t('panel.waypoints')} (${sim.waypoints.length})`}
        titleExtra={titleExtra}
        header={genHeader}
        points={points}
        maxVisible={5}
        compact
        footer={listFooter}
      />

      {/* Pause control */}
      <PauseControl
        labelKey={pauseLabelKey}
        value={pauseValue}
        onChange={pauseOnChange}
      />

      {/* Bulk paste waypoints (v0.2.53) — same dialog as bookmark bulk
          import but in waypoint mode (no category picker). Parsed
          coords append to the current waypoint list. */}
      <BulkCoordsDialog
        open={bulkOpen}
        mode="waypoints"
        onCancel={() => setBulkOpen(false)}
        onConfirm={(items) => {
          sim.setWaypoints((prev: { lat: number; lng: number }[]) => [
            ...prev,
            ...items.map(({ lat, lng }) => ({ lat, lng })),
          ])
          setBulkOpen(false)
        }}
      />
    </>
  )
}
