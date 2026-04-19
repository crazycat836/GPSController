import React from 'react'
import { MapPin, Star, Locate } from 'lucide-react'
import { useBookmarkContext } from '../contexts/BookmarkContext'
import { useT } from '../i18n'
import type { RoutePoint } from '../components/RouteCard'

type LatLng = { lat: number; lng: number }

/**
 * Shared origin + destination `RoutePoint[]` builder used by
 * `NavigatePanel` and `TeleportPanel`. Both panels rendered the same
 * "current location" origin row and a "destination (or placeholder)"
 * row with identical icons, a shared bookmark-star action, and
 * identical i18n keys — just enough variation across the two files
 * that accidental drift was inevitable.
 *
 * Returns a 2-element `RoutePoint[]` ready to hand to `RouteCard`.
 */
export function useOriginDestPoints(currentPos: LatLng | null, destPos: LatLng | null): RoutePoint[] {
  const { handleAddBookmark } = useBookmarkContext()
  const t = useT()

  const bookmarkBtn = (pos: LatLng) => (
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
      icon: <Locate className="w-4 h-4" style={{ color: 'var(--color-accent)' }} />,
      actions: currentPos ? bookmarkBtn(currentPos) : undefined,
    },
  ]

  if (destPos) {
    points.push({
      id: 'dest',
      label: t('teleport.destination'),
      position: destPos,
      icon: <MapPin className="w-4 h-4" style={{ color: 'var(--color-danger, #e53935)' }} />,
      actions: bookmarkBtn(destPos),
    })
  } else {
    points.push({
      id: 'dest-placeholder',
      label: t('teleport.add_destination'),
      position: null,
      icon: <MapPin className="w-4 h-4" style={{ color: 'var(--color-text-3)' }} />,
      labelColor: 'var(--color-text-3)',
    })
  }

  return points
}
