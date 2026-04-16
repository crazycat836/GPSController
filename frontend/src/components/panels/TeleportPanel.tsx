import React, { useState } from 'react'
import { MapPin } from 'lucide-react'
import { useSimContext } from '../../contexts/SimContext'
import { useT } from '../../i18n'

export default function TeleportPanel() {
  const { handleTeleport } = useSimContext()
  const t = useT()
  const [coordLat, setCoordLat] = useState('')
  const [coordLng, setCoordLng] = useState('')

  const handleCoordGo = () => {
    const lat = parseFloat(coordLat)
    const lng = parseFloat(coordLng)
    if (!isNaN(lat) && !isNaN(lng)) {
      handleTeleport(lat, lng)
    }
  }

  return (
    <div className="seg-stack">
      <div className="seg">
        <div className="seg-row seg-row-header">
          <span className="seg-label">{t('panel.coordinates')}</span>
        </div>
        <div className="seg-row seg-row-flush">
          <div className="flex gap-2 w-full">
            <input
              type="number"
              placeholder="Latitude"
              aria-label="Latitude"
              value={coordLat}
              onChange={e => setCoordLat(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCoordGo()}
              className="seg-input flex-1"
              step="any"
            />
            <input
              type="number"
              placeholder="Longitude"
              aria-label="Longitude"
              value={coordLng}
              onChange={e => setCoordLng(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCoordGo()}
              className="seg-input flex-1"
              step="any"
            />
          </div>
        </div>
      </div>

      <button
        onClick={handleCoordGo}
        disabled={!coordLat || !coordLng}
        className="seg-cta seg-cta-accent"
      >
        <MapPin className="w-3.5 h-3.5" />
        {t('generic.go')}
      </button>

    </div>
  )
}
