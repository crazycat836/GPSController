import { useSimContext } from '../../contexts/SimContext'
import { useSimDerived } from '../../contexts/SimDerivedContext'
import { useT } from '../../i18n'
import { useOriginDestPoints } from '../../hooks/useOriginDestPoints'
import RouteCard from '../RouteCard'
import SpeedControls from './SpeedControls'
import ActionButtons from './ActionButtons'

export default function NavigatePanel() {
  const { handleClearTeleportDest } = useSimContext()
  const { currentPos, destPos } = useSimDerived()
  const t = useT()
  const points = useOriginDestPoints(currentPos, destPos)

  return (
    <div className="seg-stack">
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
