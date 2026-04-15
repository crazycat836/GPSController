import React from 'react'
import SpeedControls from './SpeedControls'
import ActionButtons from './ActionButtons'
import WaypointList from './WaypointList'

export default function LoopPanel() {
  return (
    <div className="seg-stack">
      <WaypointList mode="loop" />
      <SpeedControls />
      <ActionButtons />
    </div>
  )
}
