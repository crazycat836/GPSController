import { Locate, Clock } from 'lucide-react'
import { useSimContext } from '../../contexts/SimContext'
import { useDisabledByConnection } from '../../hooks/useDisabledByConnection'
import { useT } from '../../i18n'
import { haversineM } from '../../lib/geo'
import { predictCooldown, formatCooldown } from '../../lib/cooldown'
import { useOriginDestPoints } from '../../hooks/useOriginDestPoints'
import RouteCard from '../RouteCard'

export default function TeleportPanel() {
  const {
    currentPos,
    destPos,
    handleTeleport,
    handleClearTeleportDest,
  } = useSimContext()
  const conn = useDisabledByConnection()
  const t = useT()
  const points = useOriginDestPoints(currentPos, destPos)

  const handleMove = () => {
    if (!destPos) return
    handleTeleport(destPos.lat, destPos.lng)
  }

  const distanceM = currentPos && destPos ? haversineM(currentPos, destPos) : 0
  const cooldownSec = predictCooldown(distanceM / 1000)

  const fmtDistance = (m: number) => {
    if (m < 1000) return `${m.toFixed(2)} m`
    return `${(m / 1000).toFixed(2)} km`
  }

  return (
    <div className="seg-stack">
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
          <Clock className="w-4 h-4 shrink-0" style={{ color: 'var(--color-accent)' }} />
          <span className="text-[13px] font-semibold" style={{ color: 'var(--color-text-1)' }}>
            {t('teleport.cooldown_time')}:
          </span>
          <span className="text-[13px]" style={{ color: 'var(--color-text-2)' }}>
            {formatCooldown(cooldownSec)}
          </span>
        </div>
      </div>

      {/* Move / Clear buttons. Move is gated on both a destination
          and backend readiness — Clear only cares about the dest. */}
      <div className="flex gap-2">
        <button
          onClick={handleMove}
          disabled={!destPos || conn.disabled}
          title={conn.title}
          className="seg-cta seg-cta-accent flex-1"
        >
          {t('teleport.move')}
        </button>
        <button
          onClick={handleClearTeleportDest}
          disabled={!destPos}
          className="seg-cta seg-cta-outline flex-1"
        >
          {t('teleport.clear')}
        </button>
      </div>
    </div>
  )
}
