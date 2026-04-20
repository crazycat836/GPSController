import React, { useCallback, useMemo, useState } from 'react'
import { Locate, LocateFixed, MapPin, Navigation, Compass, Loader2, AlertTriangle } from 'lucide-react'
import KebabMenu, { type KebabMenuItem } from '../ui/KebabMenu'
import ConfirmDialog from '../ui/ConfirmDialog'
import { usePcLocation, type PcLocationErrorCode } from '../../hooks/usePcLocation'
import { useSimContext } from '../../contexts/SimContext'
import { useT } from '../../i18n'

interface LocatePcButtonProps {
  /** Pan the map camera to a coordinate without touching the virtual GPS. */
  onFlyToCoordinate: (lat: number, lng: number, zoom?: number) => void
  /** Signals the parent that a PC location is (or no longer is) active so
   *  a map marker can be drawn. Fired with the coord after every fly and
   *  with null on Refresh (pre-fetch) to wipe the stale pin. */
  onPcLocated?: (coord: { lat: number; lng: number } | null) => void
}

const LOCATE_ZOOM = 16

function errorLabelKey(code: PcLocationErrorCode): string {
  switch (code) {
    case 'permission_denied': return 'locate.error_permission'
    case 'unavailable':       return 'locate.error_unavailable'
    case 'timeout':           return 'locate.error_timeout'
    case 'insecure':          return 'locate.error_insecure'
    case 'unsupported':       return 'locate.error_unsupported'
  }
}

export default function LocatePcButton({ onFlyToCoordinate, onPcLocated }: LocatePcButtonProps) {
  const t = useT()
  const simCtx = useSimContext()
  const { coord, loading, error, request, clear } = usePcLocation()

  const needsConfirm = simCtx.isRunning || simCtx.isPaused
  const [pendingTeleport, setPendingTeleport] = useState<{ lat: number; lng: number } | null>(null)

  const handleTriggerClick = useCallback(() => {
    // Kick off a fetch the first time the popover opens. If cached, reopening
    // just shows the cached coord — the user can explicitly "Refresh" to
    // re-fetch. Dedups via the hook's in-flight singleton.
    if (!coord && !loading && !error) {
      void request()
    }
  }, [coord, loading, error, request])

  const handleFlyOnly = useCallback(() => {
    if (!coord) return
    onFlyToCoordinate(coord.lat, coord.lng, LOCATE_ZOOM)
    onPcLocated?.({ lat: coord.lat, lng: coord.lng })
  }, [coord, onFlyToCoordinate, onPcLocated])

  const handleFlyAndTeleport = useCallback(() => {
    if (!coord) return
    if (needsConfirm) {
      setPendingTeleport({ lat: coord.lat, lng: coord.lng })
      return
    }
    onFlyToCoordinate(coord.lat, coord.lng, LOCATE_ZOOM)
    onPcLocated?.({ lat: coord.lat, lng: coord.lng })
    simCtx.handleTeleport(coord.lat, coord.lng)
  }, [coord, needsConfirm, onFlyToCoordinate, onPcLocated, simCtx])

  const handleRefresh = useCallback(() => {
    clear()
    onPcLocated?.(null)
    void request()
  }, [clear, onPcLocated, request])

  const handleConfirmTeleport = useCallback(() => {
    if (!pendingTeleport) return
    const { lat, lng } = pendingTeleport
    onFlyToCoordinate(lat, lng, LOCATE_ZOOM)
    onPcLocated?.({ lat, lng })
    simCtx.handleTeleport(lat, lng)
    setPendingTeleport(null)
  }, [pendingTeleport, onFlyToCoordinate, onPcLocated, simCtx])

  const items = useCallback((): KebabMenuItem[] => {
    const list: KebabMenuItem[] = [
      { id: 'section', kind: 'section', label: t('locate.section') },
    ]

    if (loading) {
      list.push({
        id: 'loading',
        icon: <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />,
        label: t('locate.loading'),
        disabled: true,
      })
      return list
    }

    if (error) {
      const labelKey = errorLabelKey(error.code) as Parameters<typeof t>[0]
      list.push({
        id: 'error',
        kind: 'danger',
        icon: <AlertTriangle className="w-4 h-4" aria-hidden="true" />,
        label: t(labelKey),
        hint: error.code === 'permission_denied' ? t('locate.error_permission_hint') : undefined,
        disabled: true,
      })
      list.push({
        id: 'retry',
        icon: <Compass className="w-4 h-4" aria-hidden="true" />,
        label: t('generic.retry'),
        onSelect: () => { void request() },
      })
      return list
    }

    if (!coord) {
      // Not-yet-fetched (first open before request fires or silent no-op)
      list.push({
        id: 'fetch',
        icon: <Compass className="w-4 h-4" aria-hidden="true" />,
        label: t('locate.fetch'),
        onSelect: () => { void request() },
      })
      return list
    }

    list.push({
      id: 'fly_only',
      icon: <MapPin className="w-4 h-4" aria-hidden="true" />,
      label: t('locate.fly_only'),
      hint: t('locate.fly_only_hint'),
      onSelect: handleFlyOnly,
    })
    list.push({
      id: 'fly_and_teleport',
      icon: <Navigation className="w-4 h-4" aria-hidden="true" />,
      label: t('locate.fly_and_teleport'),
      hint: t('locate.fly_and_teleport_hint'),
      onSelect: handleFlyAndTeleport,
    })

    const ageSeconds = Math.max(0, Math.round((Date.now() - coord.timestamp) / 1000))
    list.push({
      id: 'accuracy',
      kind: 'section',
      label: t('locate.accuracy', { m: Math.round(coord.accuracy), s: ageSeconds }),
    })
    list.push({
      id: 'refresh',
      icon: <Compass className="w-4 h-4" aria-hidden="true" />,
      label: t('locate.refresh'),
      onSelect: handleRefresh,
    })

    return list
  }, [coord, loading, error, t, request, handleFlyOnly, handleFlyAndTeleport, handleRefresh])

  const TriggerIcon = coord ? LocateFixed : Locate
  const label = t('locate.button_label')

  const trigger = useMemo(() => (
    <button
      type="button"
      onClick={handleTriggerClick}
      aria-label={label}
      title={label}
      className={[
        'glass-pill w-11 h-11 grid place-items-center relative',
        'text-[var(--color-text-1)]',
        'hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-border-strong)]',
        'active:scale-95',
        'transition-[transform,background,border-color] duration-150 cursor-pointer',
        'focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] outline-none',
      ].join(' ')}
    >
      {loading ? (
        <Loader2 className="w-[18px] h-[18px] animate-spin" aria-hidden="true" />
      ) : (
        <TriggerIcon className="w-[18px] h-[18px]" aria-hidden="true" />
      )}
    </button>
  ), [TriggerIcon, handleTriggerClick, label, loading])

  const confirmBody = pendingTeleport
    ? t('locate.confirm_teleport_body', {
        state: simCtx.sim.status?.state ?? '-',
        lat: pendingTeleport.lat.toFixed(5),
        lng: pendingTeleport.lng.toFixed(5),
      })
    : ''

  return (
    <>
      <KebabMenu
        trigger={trigger}
        ariaLabel={label}
        items={items}
        align="start"
        side="bottom"
      />
      <ConfirmDialog
        open={pendingTeleport != null}
        tone="danger"
        title={t('locate.confirm_teleport_title')}
        description={confirmBody}
        confirmLabel={t('locate.confirm_teleport')}
        cancelLabel={t('generic.cancel')}
        onConfirm={handleConfirmTeleport}
        onCancel={() => setPendingTeleport(null)}
      />
    </>
  )
}
