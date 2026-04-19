import SpeedControls from './SpeedControls'
import ActionButtons from './ActionButtons'
import WaypointList from './WaypointList'
import LapCountControl from './LapCountControl'

export default function LoopPanel() {
  // WaypointChain preview is rendered by BottomDock at the parent level,
  // so the panel body stays focused on deep editing controls.
  return (
    <div className="seg-stack">
      <WaypointList mode="loop" />
      <LapCountControl mode="loop" />
      <SpeedControls />
      <ActionButtons />
    </div>
  )
}
