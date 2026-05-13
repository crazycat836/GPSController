import { useMemo } from 'react'
import { useSimContext } from '../../contexts/SimContext'
import { useSimDerived } from '../../contexts/SimDerivedContext'
import { SimMode } from '../../hooks/useSimulation'
import { useT } from '../../i18n'
import WaypointChain from '../WaypointChain'
import Eyebrow from './dock/Eyebrow'
import DockRouteCard from './dock/DockRouteCard'
import RadiusRow from './dock/RadiusRow'
import JoyPreview from './dock/JoyPreview'
import SpeedToggle from './dock/SpeedToggle'
import ActionGroup from './dock/ActionGroup'
import { buildDockContext } from './dock/buildDockContext'

// Bottom dock-panel — renders the redesign/Home anatomy verbatim:
// glass `.dock-panel` with a `panel-body` two-column grid containing
// `panel-meta` (eyebrow + title + subtitle + mode-specific content)
// and `panel-controls` (speed toggle + action group). Per-mode inline
// content flips between RouteCard (teleport/navigate), WaypointChain
// (loop/multi-stop), RadiusRow (random) and JoyPreview (joystick).
export default function BottomDock() {
  const t = useT()
  const simCtx = useSimContext()
  const {
    sim,
    handleRemoveWaypoint, handleGenerateRandomWaypoints,
  } = simCtx
  const { currentPos, destPos } = useSimDerived()

  const ctx = useMemo(
    () => buildDockContext(sim.mode, sim, currentPos, destPos, t),
    [sim.mode, sim.waypoints, currentPos, destPos, t],
  )

  const speedToggleDisabled = sim.mode === SimMode.Teleport || sim.mode === SimMode.Joystick

  return (
    // Single flattened layer: positioning + glass chrome + grid layout
    // are co-located. Horizontal centring is baked into the
    // `fade-slide-up-centered` keyframe (every frame carries
    // `translate(-50%, …)`) so there's no parent wrapper and no
    // translate-clobbering with the entrance animation.
    // `glass-panel-strong` supplies the canonical 0.82 glass + radius-xl
    // matching redesign/Home.html — no inline background/blur/shadow
    // overrides here so the dock stays in lockstep with the mode bar.
    <div
      data-fc="bottom.dock"
      aria-label={t('shell.dock_aria')}
      className={[
        'glass-panel-strong',
        'fixed bottom-[72px] left-1/2 z-[var(--z-ui)]',
        'max-w-[min(920px,calc(100vw-48px))] w-max',
        'grid items-center gap-8 px-7 py-6',
        'overflow-hidden',
        'anim-fade-slide-up-centered',
      ].join(' ')}
      style={{ gridTemplateColumns: 'minmax(260px,1fr) auto' }}
    >
      {/* panel-meta */}
      <div className="min-w-0 flex flex-col">
        <Eyebrow mode={sim.mode} />
        <div className="text-[22px] font-semibold tracking-[-0.02em] text-[var(--color-text-1)] leading-[1.2] truncate">
          {ctx.title}
        </div>
        <div className="text-[13px] text-[var(--color-text-2)] leading-[1.55] mt-1 max-w-[420px]">
          {ctx.subtitle}
        </div>

        {/* Mode-specific inline content */}
        {(sim.mode === SimMode.Teleport || sim.mode === SimMode.Navigate) && (
          <DockRouteCard mode={sim.mode} />
        )}

        {(sim.mode === SimMode.Loop || sim.mode === SimMode.MultiStop) && (
          <div className="mt-3.5">
            <WaypointChain
              points={ctx.chainPoints}
              loop={ctx.loop}
              onRemove={(id) => {
                const i = parseInt(id.replace('wp-', ''), 10)
                if (!Number.isNaN(i)) handleRemoveWaypoint(i)
              }}
              onAdd={() => { /* map right-click handles adding — this is a visual affordance only */ }}
              onRandom={handleGenerateRandomWaypoints}
            />
          </div>
        )}

        {sim.mode === SimMode.RandomWalk && <RadiusRow />}

        {sim.mode === SimMode.Joystick && <JoyPreview />}
      </div>

      {/* panel-controls */}
      <div className="flex items-center gap-2.5 shrink-0">
        {/* SpeedToggle is hidden (not dimmed) for Teleport — the action
            is instant — and for Joystick, where speed comes from the
            preset chosen in the side panel. Keeps the dock uncluttered. */}
        {!speedToggleDisabled && <SpeedToggle />}
        <ActionGroup />
      </div>
    </div>
  )
}

