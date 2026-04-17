import React from 'react'
import { MapPin, Star, Locate } from 'lucide-react'
import { useSimContext } from '../../contexts/SimContext'
import { useBookmarkContext } from '../../contexts/BookmarkContext'
import { useT } from '../../i18n'
import { haversineM } from '../../lib/geo'
import { predictCooldown, formatCooldown } from '../../lib/cooldown'
import RouteCard, { type RoutePoint } from '../RouteCard'

export default function TeleportPanel() {
  const {
    currentPos,
    destPos,
    handleTeleport,
    handleClearTeleportDest,
  } = useSimContext()
  const { handleAddBookmark } = useBookmarkContext()
  const t = useT()

  const handleMove = () => {
    if (!destPos) return
    handleTeleport(destPos.lat, destPos.lng)
  }

  const distanceM = currentPos && destPos ? haversineM(currentPos, destPos) : 0
  const distanceKm = distanceM / 1000
  const cooldownSec = predictCooldown(distanceKm)

  const fmtDistance = (m: number) => {
    if (m < 1000) return `${m.toFixed(2)} m`
    return `${(m / 1000).toFixed(2)} km`
  }

  /* ── Build route points ── */
  const bookmarkBtn = (pos: { lat: number; lng: number }) => (
    <button
      onClick={() => handleAddBookmark(pos.lat, pos.lng)}
      className="shrink-0 p-1 rounded-md transition-colors hover:opacity-80"
      style={{ color: 'var(--color-warning, #f5a623)' }}
      title={t('map.add_bookmark')}
    >
      <Star className="w-4 h-4" />
    </button>
  )

  const points: RoutePoint[] = [
    {
      id: 'origin',
      label: t('teleport.my_location'),
      position: currentPos,
      placeholder: t('teleport.no_position'),
      icon: (
        <Locate
          className="w-4 h-4"
          style={{ color: 'var(--color-accent)' }}
        />
      ),
      actions: currentPos ? bookmarkBtn(currentPos) : undefined,
    },
  ]

  if (destPos) {
    points.push({
      id: 'dest',
      label: t('teleport.destination'),
      position: destPos,
      icon: (
        <MapPin
          className="w-4 h-4"
          style={{ color: 'var(--color-danger, #e53935)' }}
        />
      ),
      actions: bookmarkBtn(destPos),
    })
  } else {
    points.push({
      id: 'dest-placeholder',
      label: t('teleport.add_destination'),
      position: null,
      icon: (
        <MapPin
          className="w-4 h-4"
          style={{ color: 'var(--color-text-3)' }}
        />
      ),
      labelColor: 'var(--color-text-3)',
    })
  }

  return (
    <div className="seg-stack">
      {/* Route card */}
      <RouteCard
        title={t('teleport.route')}
        points={points}
      />

      {/* Distance + Cooldown */}
      <div className="seg">
        <div className="seg-row" style={{ gap: 8 }}>
          <Locate className="w-4 h-4 shrink-0" style={{ color: 'var(--color-accent)' }} />
          <span className="text-[13px] font-semibold" style={{ color: 'var(--color-text-1)' }}>
            {t('teleport.distance')}:
          </span>
          <span className="text-[13px]" style={{ color: 'var(--color-text-2)' }}>
            {fmtDistance(distanceM)}
          </span>
        </div>
        <div className="seg-row" style={{ gap: 8 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <span className="text-[13px] font-semibold" style={{ color: 'var(--color-text-1)' }}>
            {t('teleport.cooldown_time')}:
          </span>
          <span className="text-[13px]" style={{ color: 'var(--color-text-2)' }}>
            {formatCooldown(cooldownSec)}
          </span>
        </div>
      </div>

      {/* Move / Clear buttons */}
      <div className="flex gap-2">
        <button
          onClick={handleMove}
          disabled={!destPos}
          className="seg-cta seg-cta-accent flex-1"
        >
          {t('teleport.move')}
        </button>
        <button
          onClick={handleClearTeleportDest}
          disabled={!destPos}
          className="seg-cta flex-1"
          style={{
            background: 'transparent',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-2)',
          }}
        >
          {t('teleport.clear')}
        </button>
      </div>
    </div>
  )
}
