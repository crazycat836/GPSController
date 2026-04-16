import React from 'react'
import SpeedControls from './SpeedControls'
import ActionButtons from './ActionButtons'

export default function NavigatePanel() {
  return (
    <div className="seg-stack">
      <SpeedControls />
      <ActionButtons />
    </div>
  )
}
