import React, { useState } from 'react'
import { MapPin } from 'lucide-react'
import { useSimContext } from '../../contexts/SimContext'
import { useT } from '../../i18n'
import AddressSearch from '../AddressSearch'

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
    <div className="space-y-3">
      {/* Coordinate input */}
      <div className="space-y-2">
        <div className="flex gap-2">
          <input
            type="number"
            placeholder="Latitude"
            value={coordLat}
            onChange={e => setCoordLat(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCoordGo()}
            className="flex-1 px-3 py-2 rounded-lg bg-[var(--color-bg-elevated)] border border-[var(--color-border)] text-[var(--color-text-1)] text-xs placeholder:text-[var(--color-text-3)] focus:border-[var(--color-accent)] focus:outline-none transition-colors"
            step="any"
          />
          <input
            type="number"
            placeholder="Longitude"
            value={coordLng}
            onChange={e => setCoordLng(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCoordGo()}
            className="flex-1 px-3 py-2 rounded-lg bg-[var(--color-bg-elevated)] border border-[var(--color-border)] text-[var(--color-text-1)] text-xs placeholder:text-[var(--color-text-3)] focus:border-[var(--color-accent)] focus:outline-none transition-colors"
            step="any"
          />
        </div>
        <button
          onClick={handleCoordGo}
          disabled={!coordLat || !coordLng}
          className="w-full py-2.5 rounded-xl bg-[var(--color-accent)] text-white font-medium text-sm flex items-center justify-center gap-2 hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer active:scale-[0.97]"
        >
          <MapPin className="w-4 h-4" />
          {t('generic.go' as any)}
        </button>
      </div>

      {/* Divider */}
      <div className="flex items-center gap-3 text-[var(--color-text-3)] text-xs">
        <div className="flex-1 h-px bg-[var(--color-border)]" />
        <span>{t('panel.or_search' as any)}</span>
        <div className="flex-1 h-px bg-[var(--color-border)]" />
      </div>

      {/* Address search */}
      <AddressSearch onSelect={(lat, lng) => handleTeleport(lat, lng)} />
    </div>
  )
}
