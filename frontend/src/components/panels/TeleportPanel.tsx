import React from 'react'
import { MapPin, Star, Locate } from 'lucide-react'
import { useSimContext } from '../../contexts/SimContext'
import { useBookmarkContext } from '../../contexts/BookmarkContext'
import { useT } from '../../i18n'
import { haversineM } from '../../lib/geo'
import { predictCooldown, formatCooldown } from '../../lib/cooldown'

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

  return (
    <div className="seg-stack">
      {/* Route card */}
      <div className="seg">
        <div className="seg-row seg-row-header">
          <span className="seg-label">{t('teleport.route')}</span>
        </div>

        {/* My location */}
        <div className="seg-row" style={{ alignItems: 'flex-start', gap: 10, paddingTop: 4, paddingBottom: 4 }}>
          <Locate
            className="w-4 h-4 shrink-0 mt-0.5"
            style={{ color: 'var(--color-accent)' }}
          />
          <div className="flex-1 min-w-0">
            <div
              className="text-xs font-semibold"
              style={{ color: 'var(--color-text-1)' }}
            >
              {t('teleport.my_location')}
            </div>
            <div
              className="font-mono text-[11px] mt-0.5 truncate"
              style={{ color: 'var(--color-accent)' }}
            >
              {currentPos
                ? `${currentPos.lat.toFixed(6)}, ${currentPos.lng.toFixed(6)}`
                : t('teleport.no_position')}
            </div>
          </div>
          {currentPos && (
            <button
              onClick={() => handleAddBookmark(currentPos.lat, currentPos.lng)}
              className="shrink-0 p-1 rounded-md transition-colors hover:opacity-80"
              style={{ color: 'var(--color-warning, #f5a623)' }}
              title={t('map.add_bookmark')}
            >
              <Star className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Separator */}
        <div style={{ height: 1, background: 'var(--color-border)', margin: '2px 0' }} />

        {/* Destination */}
        {destPos ? (
          <div className="seg-row" style={{ alignItems: 'flex-start', gap: 10, paddingTop: 4, paddingBottom: 4 }}>
            <MapPin
              className="w-4 h-4 shrink-0 mt-0.5"
              style={{ color: 'var(--color-danger, #e53935)' }}
            />
            <div className="flex-1 min-w-0">
              <div
                className="text-xs font-semibold"
                style={{ color: 'var(--color-text-1)' }}
              >
                {t('teleport.destination')}
              </div>
              <div
                className="font-mono text-[11px] mt-0.5 truncate"
                style={{ color: 'var(--color-accent)' }}
              >
                {`${destPos.lat.toFixed(6)}, ${destPos.lng.toFixed(6)}`}
              </div>
            </div>
            <button
              onClick={() => handleAddBookmark(destPos.lat, destPos.lng)}
              className="shrink-0 p-1 rounded-md transition-colors hover:opacity-80"
              style={{ color: 'var(--color-warning, #f5a623)' }}
              title={t('map.add_bookmark')}
            >
              <Star className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="seg-row" style={{ gap: 10, paddingTop: 6, paddingBottom: 6 }}>
            <MapPin
              className="w-4 h-4 shrink-0"
              style={{ color: 'var(--color-text-3)' }}
            />
            <span className="text-xs" style={{ color: 'var(--color-text-3)' }}>
              {t('teleport.add_destination')}
            </span>
          </div>
        )}
      </div>

      {/* Distance + Cooldown */}
      <div className="seg">
        <div className="seg-row" style={{ gap: 8 }}>
          <Locate className="w-4 h-4 shrink-0" style={{ color: 'var(--color-accent)' }} />
          <span className="text-xs font-semibold" style={{ color: 'var(--color-text-1)' }}>
            {t('teleport.distance')}:
          </span>
          <span className="text-xs" style={{ color: 'var(--color-text-2)' }}>
            {fmtDistance(distanceM)}
          </span>
        </div>
        <div className="seg-row" style={{ gap: 8 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <span className="text-xs font-semibold" style={{ color: 'var(--color-text-1)' }}>
            {t('teleport.cooldown_time')}:
          </span>
          <span className="text-xs" style={{ color: 'var(--color-text-2)' }}>
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
