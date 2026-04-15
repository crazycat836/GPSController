import React, { useState } from 'react'
import { MapPin, Search } from 'lucide-react'
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
          <span className="seg-label">{t('panel.coordinates' as any)}</span>
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
        {t('generic.go' as any)}
      </button>

      <div className="seg-hint">
        <Search className="w-3.5 h-3.5 shrink-0" />
        <span className="flex-1">{t('panel.search_hint' as any)}</span>
        <kbd className="px-1.5 py-0.5 rounded-md bg-white/[0.06] text-[10px] font-mono text-[var(--color-text-3)] border border-[var(--color-border)]">⌘K</kbd>
      </div>
    </div>
  )
}
