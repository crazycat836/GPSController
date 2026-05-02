import React, { useMemo } from 'react'
import { Play, Square, Pause, ArrowRight } from 'lucide-react'
import { useSimContext } from '../../contexts/SimContext'
import { SimMode } from '../../hooks/useSimulation'
import { useBookmarkContext } from '../../contexts/BookmarkContext'
import { useT } from '../../i18n'
import WaypointChain, { type ChainPoint } from '../WaypointChain'
import { haversineM, polylineDistanceM } from '../../lib/geo'
import Eyebrow from './dock/Eyebrow'
import DockRouteCard from './dock/DockRouteCard'
import RadiusRow from './dock/RadiusRow'
import JoyPreview from './dock/JoyPreview'
import SpeedToggle from './dock/SpeedToggle'

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
    sim, handleStart, handleStop, handlePause, handleResume, handleTeleport,
    isRunning, isPaused, currentPos, destPos,
    handleRemoveWaypoint, handleGenerateRandomWaypoints,
  } = simCtx
  const { handleAddBookmark } = useBookmarkContext()

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
        {/* Speed is irrelevant in Teleport (instant) and Joystick
            (direction-driven) modes — hide rather than dim so the
            dock reads cleanly. */}
        {!speedToggleDisabled && <SpeedToggle />}
        <ActionGroup
          mode={sim.mode}
          isRunning={isRunning}
          isPaused={isPaused}
          destPos={destPos}
          waypointCount={sim.waypoints.length}
          onStart={handleStart}
          onStop={handleStop}
          onPause={handlePause}
          onResume={handleResume}
          onTeleport={handleTeleport}
          t={t}
        />
      </div>
    </div>
  )
}

// ─── Action group (Start / Stop / Pause / Resume cluster) ─────

interface ActionGroupProps {
  mode: SimMode
  isRunning: boolean
  isPaused: boolean
  destPos: { lat: number; lng: number } | null
  waypointCount: number
  onStart: () => void
  onStop: () => void
  onPause: () => void
  onResume: () => void
  onTeleport: (lat: number, lng: number) => void
  t: ReturnType<typeof useT>
}

function ActionGroup(p: ActionGroupProps) {
  // Teleport = one-shot "Move", disabled without dest.
  if (p.mode === SimMode.Teleport) {
    return (
      <div className="flex gap-1.5">
        <ActionBtn
          tone="accent"
          disabled={!p.destPos}
          onClick={() => { if (p.destPos) p.onTeleport(p.destPos.lat, p.destPos.lng) }}
        >
          <ArrowRight className="w-3 h-3" strokeWidth={3} />
          {p.t('teleport.move')}
        </ActionBtn>
      </div>
    )
  }

  // Running — Pause/Resume + Stop cluster (design order: Pause first, Stop last).
  if (p.isRunning) {
    return (
      <div className="flex gap-1.5">
        {p.isPaused ? (
          <ActionBtn tone="accent" onClick={p.onResume}>
            <Play className="w-3 h-3" fill="currentColor" />
            {p.t('generic.resume')}
          </ActionBtn>
        ) : (
          <ActionBtn tone="ghost" onClick={p.onPause}>
            <Pause className="w-3 h-3" fill="currentColor" />
            {p.t('generic.pause')}
          </ActionBtn>
        )}
        <ActionBtn tone="danger" onClick={p.onStop}>
          <Square className="w-[10px] h-[10px]" fill="currentColor" />
          {p.t('generic.stop')}
        </ActionBtn>
      </div>
    )
  }

  // Idle — Start (disabled until setup is valid).
  let disabled = false
  if (p.mode === SimMode.Navigate) disabled = !p.destPos
  if (p.mode === SimMode.Loop || p.mode === SimMode.MultiStop) disabled = p.waypointCount < 2
  return (
    <div className="flex gap-1.5">
      <ActionBtn tone="accent" disabled={disabled} onClick={p.onStart}>
        <Play className="w-3 h-3" fill="currentColor" />
        {p.t('generic.start')}
      </ActionBtn>
    </div>
  )
}

interface ActionBtnProps {
  tone: 'accent' | 'danger' | 'ghost'
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}

function ActionBtn({ tone, onClick, disabled, children }: ActionBtnProps) {
  const palette = tone === 'danger'
    ? { bg: 'var(--color-danger-dim)', border: '1px solid rgba(255,71,87,0.35)', color: 'var(--color-danger-text)', hover: 'rgba(255,71,87,0.22)' }
    : tone === 'ghost'
      ? { bg: 'var(--color-surface-ghost)', border: '1px solid var(--color-border)', color: 'var(--color-text-1)', hover: 'rgba(255,255,255,0.08)' }
      : { bg: 'var(--color-accent)', border: 'none', color: 'var(--color-surface-0)', hover: 'var(--color-accent-hover)' }

  // Hover lives in `.dock-action-btn:hover` (legacy.css), driven by the
  // `--dock-bg` / `--dock-hover-bg` custom properties below — keeps tone
  // palettes per-instance while keeping the hover transition in CSS.
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        'dock-action-btn',
        'inline-flex items-center justify-center gap-2 h-11 px-[18px] rounded-xl',
        'text-[13px] font-semibold whitespace-nowrap',
        'transition-[background,opacity,box-shadow] duration-150 cursor-pointer',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] focus-visible:outline-offset-2',
      ].join(' ')}
      style={{
        ['--dock-bg' as string]: palette.bg,
        ['--dock-hover-bg' as string]: palette.hover,
        border: palette.border,
        color: palette.color,
        boxShadow: tone === 'accent' && !disabled ? 'var(--shadow-glow)' : undefined,
      } as React.CSSProperties}
    >
      {children}
    </button>
  )
}

// ─── Mode-specific meta derivation (title + subtitle) ─────────

interface DockCtx {
  title: string
  subtitle: string
  chainPoints: ChainPoint[]
  loop: boolean
}

function buildDockContext(
  mode: SimMode,
  sim: ReturnType<typeof useSimContext>['sim'],
  currentPos: { lat: number; lng: number } | null,
  destPos: { lat: number; lng: number } | null,
  t: ReturnType<typeof useT>,
): DockCtx {
  const wp = sim.waypoints
  const toChain = (pts: { lat: number; lng: number }[]): ChainPoint[] =>
    pts.map((p, i) => ({
      id: `wp-${i}`,
      label: i === 0 ? t('teleport.my_location') : t('panel.waypoint_num', { n: i + 1 }),
      position: p,
    }))

  switch (mode) {
    case SimMode.Teleport:
      return {
        title: destPos
          ? `${destPos.lat.toFixed(5)}°N · ${destPos.lng.toFixed(5)}°E`
          : t('teleport.add_destination'),
        subtitle: t('panel.teleport_hint'),
        chainPoints: [], loop: false,
      }
    case SimMode.Navigate: {
      if (!destPos) {
        return {
          title: t('teleport.add_destination'),
          subtitle: t('panel.navigate_hint'),
          chainPoints: [], loop: false,
        }
      }
      const distM = currentPos ? haversineM(currentPos, destPos) : 0
      const distLabel = distM >= 1000 ? `${(distM / 1000).toFixed(2)} km` : `${Math.round(distM)} m`
      return {
        title: `${t('teleport.destination')} · ${distLabel}`,
        subtitle: t('panel.navigate_hint'),
        chainPoints: [], loop: false,
      }
    }
    case SimMode.Loop: {
      const count = wp.length
      const totalDist = count >= 2 ? polylineDistanceM(wp) + haversineM(wp[count - 1], wp[0]) : 0
      const distLabel = totalDist > 0
        ? (totalDist >= 1000 ? ` · ${(totalDist / 1000).toFixed(1)} km` : ` · ${Math.round(totalDist)} m`)
        : ''
      return {
        title: count === 0
          ? t('panel.waypoints_none')
          : `${t('mode.loop')} · ${count} ${t('panel.pts_short')}${distLabel}`,
        subtitle: count === 0 ? t('panel.waypoints_empty') : t('pause.loop'),
        chainPoints: toChain(wp),
        loop: true,
      }
    }
    case SimMode.MultiStop: {
      const count = wp.length
      const totalDist = count >= 2 ? polylineDistanceM(wp) : 0
      const distLabel = totalDist > 0
        ? (totalDist >= 1000 ? ` · ${(totalDist / 1000).toFixed(1)} km` : ` · ${Math.round(totalDist)} m`)
        : ''
      return {
        title: count === 0
          ? t('panel.waypoints_none')
          : `${t('mode.multi_stop')} · ${count} ${t('panel.pts_short')}${distLabel}`,
        subtitle: count === 0 ? t('panel.waypoints_empty') : t('pause.multi_stop'),
        chainPoints: toChain(wp),
        loop: false,
      }
    }
    case SimMode.RandomWalk:
      return {
        title: t('mode.random_walk'),
        subtitle: t('pause.random_walk'),
        chainPoints: [], loop: false,
      }
    case SimMode.Joystick:
      return {
        title: t('mode.joystick'),
        subtitle: t('panel.joystick_hint'),
        chainPoints: [], loop: false,
      }
  }
}

