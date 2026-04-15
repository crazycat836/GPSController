import React from 'react'
import SpeedControls from './SpeedControls'
import ActionButtons from './ActionButtons'
import WaypointList from './WaypointList'

export default function MultiStopPanel() {
  return (
    <>
      <div className="seg-stack">
        <WaypointList mode="multistop" />
        <SpeedControls />
      </div>
      <ActionButtons />
    </>
  )
}
