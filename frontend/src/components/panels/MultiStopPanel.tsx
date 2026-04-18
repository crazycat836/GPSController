import React, { useMemo } from 'react'
import SpeedControls from './SpeedControls'
import ActionButtons from './ActionButtons'
import WaypointList from './WaypointList'
import WaypointChain, { type ChainPoint } from '../WaypointChain'
import { useSimContext } from '../../contexts/SimContext'
import { useT } from '../../i18n'

export default function MultiStopPanel() {
  const { sim, handleRemoveWaypoint } = useSimContext()
  const t = useT()

  const chainPoints = useMemo<ChainPoint[]>(() =>
    sim.waypoints.map((wp, i) => ({
      id: `wp-${i}`,
      label: i === 0 ? t('teleport.my_location') : t('panel.waypoint_num', { n: i + 1 }),
      position: wp,
    })),
    [sim.waypoints, t],
  )

  return (
    <div className="seg-stack">
      {chainPoints.length > 0 && (
        <WaypointChain
          points={chainPoints}
          onRemove={(id) => {
            const i = parseInt(id.replace('wp-', ''), 10)
            if (!Number.isNaN(i)) handleRemoveWaypoint(i)
          }}
        />
      )}
      <WaypointList mode="multistop" />
      <SpeedControls />
      <ActionButtons />
    </div>
  )
}
