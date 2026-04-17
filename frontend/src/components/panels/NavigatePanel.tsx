import React from 'react'
import { MapPin, Star, Locate, Play, Square, Pause } from 'lucide-react'
import { useSimContext } from '../../contexts/SimContext'
import { useBookmarkContext } from '../../contexts/BookmarkContext'
import { useT } from '../../i18n'
import RouteCard, { type RoutePoint } from '../RouteCard'
import SpeedControls from './SpeedControls'

export default function NavigatePanel() {
  const {
    currentPos,
    destPos,
    handleStart,
    handleStop,
    handlePause,
    handleResume,
    handleClearTeleportDest,
    isRunning,
    isPaused,
  } = useSimContext()
  const { handleAddBookmark } = useBookmarkContext()
  const t = useT()

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

      <SpeedControls />

      {/* Action buttons */}
      {isRunning ? (
        <div className="flex gap-2 mt-1">
          <button className="seg-cta seg-cta-danger flex-1" onClick={handleStop}>
            <Square size={12} fill="currentColor" />
            {t('generic.stop')}
          </button>
          {!isPaused ? (
            <button className="seg-cta seg-cta-ghost flex-1" onClick={handlePause}>
              <Pause size={12} fill="currentColor" />
              {t('generic.pause')}
            </button>
          ) : (
            <button className="seg-cta seg-cta-accent flex-1" onClick={handleResume}>
              <Play size={12} fill="currentColor" />
              {t('generic.resume')}
            </button>
          )}
          {destPos && (
            <button
              className="seg-cta flex-1"
              onClick={handleClearTeleportDest}
              style={{
                background: 'transparent',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-2)',
              }}
            >
              {t('teleport.clear')}
            </button>
          )}
        </div>
      ) : (
        <div className="flex gap-2 mt-1">
          <button
            className="seg-cta seg-cta-accent flex-1"
            onClick={handleStart}
            disabled={!destPos}
          >
            <Play size={14} fill="currentColor" />
            {t('generic.start')}
          </button>
          {destPos && (
            <button
              className="seg-cta flex-1"
              onClick={handleClearTeleportDest}
              style={{
                background: 'transparent',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-2)',
              }}
            >
              {t('teleport.clear')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
