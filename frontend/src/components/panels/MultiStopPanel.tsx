import React from 'react'
import SpeedControls from './SpeedControls'
import ActionButtons from './ActionButtons'
import WaypointList from './WaypointList'

export default function MultiStopPanel() {
  return (
    <div className="space-y-3">
      <WaypointList mode="multistop" />
      <SpeedControls />
      <ActionButtons />
    </div>
  )
}
