import React from 'react'
import { MapPin, Star, Locate } from 'lucide-react'
import { useSimContext } from '../../contexts/SimContext'
import { useBookmarkContext } from '../../contexts/BookmarkContext'
import { useT } from '../../i18n'
import RouteCard, { type RoutePoint } from '../RouteCard'
import SpeedControls from './SpeedControls'
import ActionButtons from './ActionButtons'

export default function NavigatePanel() {
  const {
    currentPos,
    destPos,
    handleClearTeleportDest,
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

      <ActionButtons
        canStart={!!destPos}
        trailing={destPos ? (
          <button
            className="seg-cta seg-cta-outline flex-1"
            onClick={handleClearTeleportDest}
          >
            {t('teleport.clear')}
          </button>
        ) : null}
      />
    </div>
  )
}
