import { useMemo, useState } from 'react'
import {
  Play, Square, Footprints, Rabbit, Car, ChevronDown, ArrowRight, Navigation,
} from 'lucide-react'
import { useSimContext } from '../../contexts/SimContext'
import { SimMode, MoveMode } from '../../hooks/useSimulation'
import { useT, type StringKey } from '../../i18n'
import WaypointChain, { type ChainPoint } from '../WaypointChain'
import { haversineM, polylineDistanceM } from '../../lib/geo'

// Speed preset rail shown in the dock-panel controls column.
// Reuses the same semantic mapping as the old SpeedControls, but
// renders compactly inside a pill toggle.
const SPEED_PRESETS: Array<{ mode: MoveMode; Icon: typeof Footprints; labelKey: StringKey; value: number }> = [
  { mode: MoveMode.Walking, Icon: Footprints, labelKey: 'move.walking', value: 5 },
  { mode: MoveMode.Running, Icon: Rabbit,     labelKey: 'move.running', value: 10 },
  { mode: MoveMode.Driving, Icon: Car,        labelKey: 'move.driving', value: 40 },
]

interface BottomDockProps {
  // Rendered in the expand area when the user opens the "Details" chevron.
  // Owner supplies the existing per-mode panel so no controls are lost.
  details: React.ReactNode
}

// Bottom dock-panel derived from redesign/Home. Anchors to bottom-center
// above the BottomModeBar. Compact row by default: eyebrow + title +
// subtitle + chain preview on the left, speed toggle + Go on the right.
// Expands downward to reveal the full per-mode panel when the user asks
// for deeper configuration.
export default function BottomDock({ details }: BottomDockProps) {
  const t = useT()
  const simCtx = useSimContext()
  const { sim, handleStart, handleStop, handleTeleport, isRunning, isPaused, currentPos, destPos, handleRemoveWaypoint } = simCtx
  const [expanded, setExpanded] = useState(false)

  // Per-mode presentation (eyebrow / title / subtitle / chain / loop).
  const ctx = useMemo(() => buildDockContext(sim.mode, sim, currentPos, destPos, t), [sim.mode, sim.waypoints, currentPos, destPos, t])

  // Per-mode Go button semantics. Teleport is a one-shot action;
  // everything else is a run-toggle.
  const go = useMemo(() => buildGoContext(sim.mode, isRunning, isPaused, destPos, sim.waypoints.length, handleStart, handleStop, handleTeleport, t), [sim.mode, isRunning, isPaused, destPos, sim.waypoints.length, handleStart, handleStop, handleTeleport, t])

  const presetActive = (mode: MoveMode) =>
    sim.moveMode === mode && sim.customSpeedKmh == null && sim.speedMinKmh == null && sim.speedMaxKmh == null

  return (
    <div
      className="fixed bottom-[72px] left-1/2 -translate-x-1/2 z-[var(--z-ui)] w-[min(920px,calc(100vw-24px))] flex flex-col items-stretch gap-2"
      aria-label="Simulation dock"
    >
      <div
        className={[
          'glass-pill-strong overflow-hidden',
          // Drop the full-round pill radius — the dock is a wide card, not a chip.
          '!rounded-[20px]',
        ].join(' ')}
      >
        {/* Compact top row: meta | controls */}
        <div
          className="grid items-center px-6 py-4 gap-8"
          style={{ gridTemplateColumns: 'minmax(240px,1fr) auto' }}
        >
          <DockMeta ctx={ctx} onRemoveWaypoint={handleRemoveWaypoint} />
          <div className="flex items-center gap-2.5 shrink-0">
            <DockSpeedToggle
              presetActive={presetActive}
              onPreset={(mode) => { sim.setMoveMode(mode); sim.setCustomSpeedKmh(null); sim.setSpeedMinKmh(null); sim.setSpeedMaxKmh(null) }}
            />
            <DockGoButton {...go} />
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              aria-label={expanded ? 'Collapse details' : 'Expand details'}
              title={expanded ? 'Collapse details' : 'Expand details'}
              className={[
                'w-10 h-10 grid place-items-center rounded-full',
                'text-[var(--color-text-2)] hover:text-[var(--color-text-1)] hover:bg-white/[0.06]',
                'transition-[transform,color,background] duration-150 cursor-pointer',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]',
              ].join(' ')}
            >
              <ChevronDown
                className={`w-4 h-4 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
              />
            </button>
          </div>
        </div>

        {/* Expanded details — renders the existing per-mode panel. */}
        {expanded && (
          <div className="border-t border-[var(--color-border-subtle)] px-5 pt-4 pb-5 max-h-[50vh] overflow-y-auto scrollbar-thin">
            {details}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Meta column ────────────────────────────────────────────────────

interface DockCtx {
  eyebrowKey: StringKey
  title: string
  subtitle: string
  chainPoints: ChainPoint[]
  loop: boolean
}

function DockMeta({
  ctx,
  onRemoveWaypoint,
}: {
  ctx: DockCtx
  onRemoveWaypoint: (i: number) => void
}) {
  const t = useT()
  return (
    <div className="min-w-0 flex flex-col gap-1.5">
      <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-accent)]">
        <span className="inline-block w-5 h-[1.5px] rounded-[2px] bg-[var(--color-accent)]" />
        {t(ctx.eyebrowKey)}
      </div>
      <div className="text-[20px] font-semibold text-[var(--color-text-1)] tracking-[-0.02em] leading-[1.2] truncate">
        {ctx.title}
      </div>
      <div className="text-[12px] text-[var(--color-text-2)] leading-[1.5] line-clamp-2 max-w-[520px]">
        {ctx.subtitle}
      </div>
      {ctx.chainPoints.length > 0 && (
        <div className="mt-2">
          <WaypointChain
            points={ctx.chainPoints}
            loop={ctx.loop}
            onRemove={(id) => {
              const i = parseInt(id.replace('wp-', ''), 10)
              if (!Number.isNaN(i)) onRemoveWaypoint(i)
            }}
          />
        </div>
      )}
    </div>
  )
}

// ─── Speed toggle ───────────────────────────────────────────────────

interface DockSpeedToggleProps {
  presetActive: (mode: MoveMode) => boolean
  onPreset: (mode: MoveMode) => void
}

function DockSpeedToggle({ presetActive, onPreset }: DockSpeedToggleProps) {
  const t = useT()
  return (
    <div
      className="flex items-stretch gap-0.5 p-[3px] h-11 rounded-[12px] border border-[var(--color-border)]"
      style={{ background: 'rgba(255,255,255,0.04)' }}
      role="group"
      aria-label={t('panel.speed')}
    >
      {SPEED_PRESETS.map(({ mode, Icon, labelKey, value }) => {
        const on = presetActive(mode)
        return (
          <button
            key={mode}
            type="button"
            onClick={() => onPreset(mode)}
            aria-pressed={on}
            className={[
              'inline-flex items-center gap-1.5 px-3 rounded-[9px] text-[12px] font-medium transition-colors duration-150',
              on
                ? 'bg-[var(--color-accent-dim)] text-[var(--color-accent-strong)] border border-[rgba(255,255,255,0.06)]'
                : 'text-[var(--color-text-2)] hover:text-[var(--color-text-1)]',
            ].join(' ')}
            title={`${t(labelKey)} · ${value} km/h`}
          >
            <Icon className="w-3.5 h-3.5" />
            <span className="hidden md:inline">{t(labelKey)}</span>
            <span className="font-mono text-[10px] opacity-65 tabular-nums">{value}</span>
          </button>
        )
      })}
    </div>
  )
}

// ─── Go button ──────────────────────────────────────────────────────

interface DockGoContext {
  label: string
  tone: 'accent' | 'danger'
  onClick: () => void
  disabled?: boolean
  icon: React.ReactNode
}

function DockGoButton({ label, tone, onClick, disabled, icon }: DockGoContext) {
  const palette = tone === 'danger'
    ? { bg: 'var(--color-danger)', fg: '#ffffff', glow: '0 0 20px rgba(255,71,87,0.35), 0 4px 20px rgba(0,0,0,0.3)' }
    : { bg: 'var(--color-accent)', fg: 'var(--color-surface-0)', glow: 'var(--shadow-glow), 0 4px 20px rgba(0,0,0,0.3)' }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        'inline-flex items-center gap-2.5 h-12 pl-6 pr-5 rounded-full',
        'text-[13.5px] font-semibold cursor-pointer',
        'transition-[transform,box-shadow,opacity] duration-150',
        'hover:-translate-y-px active:translate-y-0',
        'disabled:opacity-40 disabled:cursor-not-allowed disabled:translate-y-0',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] focus-visible:outline-offset-4',
      ].join(' ')}
      style={{
        background: palette.bg,
        color: palette.fg,
        boxShadow: palette.glow,
      }}
    >
      {label}
      <span
        className="grid place-items-center w-[22px] h-[22px] rounded-full"
        style={{ background: 'rgba(0,0,0,0.18)' }}
        aria-hidden="true"
      >
        {icon}
      </span>
    </button>
  )
}

function buildGoContext(
  mode: SimMode,
  isRunning: boolean,
  isPaused: boolean,
  destPos: { lat: number; lng: number } | null,
  waypointCount: number,
  handleStart: () => void,
  handleStop: () => void,
  handleTeleport: (lat: number, lng: number) => void,
  t: ReturnType<typeof useT>,
): DockGoContext {
  // Teleport mode: one-shot action — "Move to destination".
  if (mode === SimMode.Teleport) {
    return {
      label: t('teleport.move'),
      tone: 'accent',
      disabled: !destPos,
      icon: <ArrowRight size={12} strokeWidth={3} />,
      onClick: () => { if (destPos) handleTeleport(destPos.lat, destPos.lng) },
    }
  }

  // Every other mode: run-toggle.
  if (isRunning) {
    return {
      label: isPaused ? t('generic.resume') : t('generic.stop'),
      tone: isPaused ? 'accent' : 'danger',
      icon: isPaused
        ? <Play size={12} fill="currentColor" />
        : <Square size={10} fill="currentColor" />,
      onClick: handleStop,
    }
  }

  // Disabled-start conditions per mode.
  let disabled = false
  if (mode === SimMode.Navigate) disabled = !destPos
  if (mode === SimMode.Loop || mode === SimMode.MultiStop) disabled = waypointCount < 2

  return {
    label: t('generic.start'),
    tone: 'accent',
    disabled,
    icon: <Play size={12} fill="currentColor" />,
    onClick: handleStart,
  }
}

// ─── Meta builder ──────────────────────────────────────────────────

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
    case SimMode.Teleport: {
      const hasDest = !!destPos
      return {
        eyebrowKey: 'mode.teleport',
        title: hasDest
          ? `${destPos!.lat.toFixed(5)}, ${destPos!.lng.toFixed(5)}`
          : t('teleport.add_destination'),
        subtitle: t('teleport.add_destination'),
        chainPoints: [],
        loop: false,
      }
    }
    case SimMode.Navigate: {
      if (!destPos) {
        return {
          eyebrowKey: 'mode.navigate',
          title: t('teleport.add_destination'),
          subtitle: t('panel.navigate_hint'),
          chainPoints: [],
          loop: false,
        }
      }
      const distM = currentPos ? haversineM(currentPos, destPos) : 0
      const distLabel = distM >= 1000 ? `${(distM / 1000).toFixed(2)} km` : `${Math.round(distM)} m`
      const chain: ChainPoint[] = [
        currentPos
          ? { id: 'wp-0', label: t('teleport.my_location'), position: currentPos, kind: 'start' }
          : { id: 'wp-0', label: t('teleport.my_location'), position: null, kind: 'start' },
        { id: 'dest', label: t('teleport.destination'), position: destPos, kind: 'accent' },
      ]
      return {
        eyebrowKey: 'mode.navigate',
        title: `${t('teleport.destination')} · ${distLabel}`,
        subtitle: t('panel.navigate_hint'),
        chainPoints: chain,
        loop: false,
      }
    }
    case SimMode.Loop: {
      const count = wp.length
      const totalDist = count >= 2 ? polylineDistanceM(wp) + haversineM(wp[count - 1], wp[0]) : 0
      const distLabel = totalDist > 0
        ? (totalDist >= 1000 ? ` · ${(totalDist / 1000).toFixed(1)} km` : ` · ${Math.round(totalDist)} m`)
        : ''
      return {
        eyebrowKey: 'mode.loop',
        title: count === 0
          ? t('panel.waypoints_empty')
          : `${t('mode.loop')} · ${count} ${t('panel.pts_short')}${distLabel}`,
        subtitle: t('pause.loop'),
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
        eyebrowKey: 'mode.multi_stop',
        title: count === 0
          ? t('panel.waypoints_empty')
          : `${t('mode.multi_stop')} · ${count} ${t('panel.pts_short')}${distLabel}`,
        subtitle: t('pause.multi_stop'),
        chainPoints: toChain(wp),
        loop: false,
      }
    }
    case SimMode.RandomWalk: {
      return {
        eyebrowKey: 'mode.random_walk',
        title: t('panel.random_walk_range'),
        subtitle: t('pause.random_walk'),
        chainPoints: [],
        loop: false,
      }
    }
    case SimMode.Joystick: {
      return {
        eyebrowKey: 'mode.joystick',
        title: t('joy.drag_or_keys'),
        subtitle: t('panel.joystick_hint'),
        chainPoints: [],
        loop: false,
      }
    }
  }
}

// Silence the unused-import warnings when Navigation isn't referenced
// directly (kept in case the Go icon wants a Navigate variant later).
void Navigation
