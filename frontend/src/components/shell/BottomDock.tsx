import React, { useMemo } from 'react'
import {
  Play, Square, Pause, Footprints, Rabbit, Car, ArrowRight,
  Repeat, Star, MapPin, Crosshair, Plus, Dices,
  Navigation, Route, Shuffle, Gamepad2,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useSimContext, type MoveMode as _MoveMode } from '../../contexts/SimContext'
import { SimMode, MoveMode } from '../../hooks/useSimulation'
import { useBookmarkContext } from '../../contexts/BookmarkContext'
import { useT, type StringKey } from '../../i18n'
import WaypointChain, { type ChainPoint } from '../WaypointChain'
import { haversineM, polylineDistanceM } from '../../lib/geo'

// Silence the unused _MoveMode import — kept for potential prop typing.
void (undefined as _MoveMode | undefined)

// Speed preset rail. Icons map to design's Walk/Run/Drive glyphs;
// lucide's Footprints / Rabbit / Car are the closest analogues.
// Values in km/h. Must match `SimContext.SPEED_MAP` and backend
// `SPEED_PROFILES` (m/s equivalents 3.0 / 5.5 / 16.667).
const SPEED_PRESETS: Array<{ mode: MoveMode; Icon: typeof Footprints; labelKey: StringKey; value: number }> = [
  { mode: MoveMode.Walking, Icon: Footprints, labelKey: 'move.walking', value: 10.8 },
  { mode: MoveMode.Running, Icon: Rabbit,     labelKey: 'move.running', value: 19.8 },
  { mode: MoveMode.Driving, Icon: Car,        labelKey: 'move.driving', value: 60 },
]

const RADIUS_PRESETS = [200, 500, 1000, 2000] as const

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
    randomWalkRadius, setRandomWalkRadius,
  } = simCtx
  const { handleAddBookmark } = useBookmarkContext()

  const ctx = useMemo(
    () => buildDockContext(sim.mode, sim, currentPos, destPos, t),
    [sim.mode, sim.waypoints, currentPos, destPos, t],
  )

  const presetActive = (mode: MoveMode) =>
    sim.moveMode === mode && sim.customSpeedKmh == null && sim.speedMinKmh == null && sim.speedMaxKmh == null

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
        <Eyebrow mode={sim.mode} t={t} />
        <div className="text-[22px] font-semibold tracking-[-0.02em] text-[var(--color-text-1)] leading-[1.2] truncate">
          {ctx.title}
        </div>
        <div className="text-[13px] text-[var(--color-text-2)] leading-[1.55] mt-1 max-w-[420px]">
          {ctx.subtitle}
        </div>

        {/* Mode-specific inline content */}
        {(sim.mode === SimMode.Teleport || sim.mode === SimMode.Navigate) && (
          <RouteCard
            mode={sim.mode}
            currentPos={currentPos}
            destPos={destPos}
            onBookmark={handleAddBookmark}
            t={t}
          />
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

        {sim.mode === SimMode.RandomWalk && (
          <RadiusRow
            value={randomWalkRadius}
            onChange={setRandomWalkRadius}
            t={t}
          />
        )}

        {sim.mode === SimMode.Joystick && <JoyPreview t={t} />}
      </div>

      {/* panel-controls */}
      <div className="flex items-center gap-2.5 shrink-0">
        {/* Speed is irrelevant in Teleport (instant) and Joystick
            (direction-driven) modes — hide rather than dim so the
            dock reads cleanly. */}
        {!speedToggleDisabled && (
          <SpeedToggle
            presetActive={presetActive}
            onPreset={(mode) => {
              sim.setMoveMode(mode)
              sim.setCustomSpeedKmh(null)
              sim.setSpeedMinKmh(null)
              sim.setSpeedMaxKmh(null)
            }}
            disabled={false}
            t={t}
          />
        )}
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

// ─── Eyebrow (mode icon + label) ──────────────────────────────

// Mirror the BottomModeBar icon mapping so the dock header and the mode
// selector read as the same mode at a glance.
const modeIconMap: Record<SimMode, LucideIcon> = {
  [SimMode.Teleport]:   Crosshair,
  [SimMode.Navigate]:   Navigation,
  [SimMode.Loop]:       Repeat,
  [SimMode.MultiStop]:  Route,
  [SimMode.RandomWalk]: Shuffle,
  [SimMode.Joystick]:   Gamepad2,
}

function Eyebrow({ mode, t }: { mode: SimMode; t: ReturnType<typeof useT> }) {
  // Multi-stop gets a warning tint in the design to visually distinguish
  // it from the otherwise-accent eyebrow family.
  const accentColor = mode === SimMode.MultiStop
    ? 'var(--color-warning-text)'
    : 'var(--color-accent)'
  const labelKey: StringKey = ({
    [SimMode.Teleport]:   'mode.teleport',
    [SimMode.Navigate]:   'mode.navigate',
    [SimMode.Loop]:       'mode.loop',
    [SimMode.MultiStop]:  'mode.multi_stop',
    [SimMode.RandomWalk]: 'mode.random_walk',
    [SimMode.Joystick]:   'mode.joystick',
  } as const)[mode]
  const Icon = modeIconMap[mode]
  return (
    <div
      className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] mb-2"
      style={{ color: accentColor }}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      {t(labelKey)}
    </div>
  )
}

// ─── Route card (Teleport / Navigate) ─────────────────────────

interface RouteCardProps {
  mode: SimMode
  currentPos: { lat: number; lng: number } | null
  destPos: { lat: number; lng: number } | null
  onBookmark: (lat: number, lng: number) => void
  t: ReturnType<typeof useT>
}

function RouteCard({ mode, currentPos, destPos, onBookmark, t }: RouteCardProps) {
  const showOrigin = mode === SimMode.Navigate
  return (
    <div
      className={[
        'mt-3.5 flex flex-col overflow-hidden',
        'bg-white/[0.03] border border-[var(--color-border)] rounded-xl',
      ].join(' ')}
    >
      {showOrigin && (
        <RoutePoint
          tone="origin"
          label={t('teleport.my_location')}
          coord={currentPos}
          placeholder={t('teleport.no_position')}
          onBookmark={onBookmark}
        />
      )}
      <RoutePoint
        tone="dest"
        label={t('teleport.destination')}
        coord={destPos}
        placeholder={t('teleport.add_destination')}
        onBookmark={onBookmark}
      />
    </div>
  )
}

interface RoutePointProps {
  tone: 'origin' | 'dest'
  label: string
  coord: { lat: number; lng: number } | null
  placeholder: string
  onBookmark: (lat: number, lng: number) => void
}

function RoutePoint({ tone, label, coord, placeholder, onBookmark }: RoutePointProps) {
  const t = useT()
  const empty = !coord
  const icPalette = tone === 'origin'
    ? { bg: 'rgba(52,211,153,0.14)', bd: 'rgba(52,211,153,0.25)', fg: '#6ee5b5' }
    : empty
      ? { bg: 'var(--color-surface-ghost)', bd: 'var(--color-border-strong)', fg: 'var(--color-text-3)' }
      : { bg: 'rgba(108,140,255,0.14)', bd: 'rgba(108,140,255,0.25)', fg: 'var(--color-accent-strong)' }

  return (
    <div
      className="grid items-center gap-3 px-3.5 py-2.5 relative"
      style={{ gridTemplateColumns: '28px 1fr auto' }}
    >
      {/* Dotted connector between origin and dest */}
      <span
        aria-hidden="true"
        className="absolute left-[27px] -top-[9px] w-[2px] h-[18px] pointer-events-none"
        style={{
          background: 'repeating-linear-gradient(to bottom, var(--color-border-strong) 0 3px, transparent 3px 6px)',
          display: tone === 'dest' ? 'block' : 'none',
        }}
      />
      <span
        className="w-7 h-7 rounded-lg grid place-items-center shrink-0"
        style={{
          background: icPalette.bg,
          border: `1px ${empty && tone === 'dest' ? 'dashed' : 'solid'} ${icPalette.bd}`,
          color: icPalette.fg,
        }}
        aria-hidden="true"
      >
        {tone === 'origin'
          ? <Crosshair className="w-3.5 h-3.5" />
          : <MapPin className="w-3.5 h-3.5" />}
      </span>

      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-[0.04em] font-medium text-[var(--color-text-3)]">
          {label}
        </div>
        <div
          className={[
            'mt-0.5 text-[12px]',
            empty
              ? 'text-[var(--color-text-3)] italic'
              : 'font-mono text-[var(--color-text-1)]',
          ].join(' ')}
        >
          {empty
            ? placeholder
            : `${coord.lat.toFixed(5)}°N · ${coord.lng.toFixed(5)}°E`}
        </div>
      </div>

      {coord && (
        <button
          type="button"
          onClick={() => onBookmark(coord.lat, coord.lng)}
          className={[
            'w-7 h-7 rounded-[7px] grid place-items-center',
            'text-[var(--color-text-3)]',
            'hover:text-[#ffb627] hover:bg-[rgba(255,182,39,0.08)]',
            'transition-colors duration-150 cursor-pointer',
          ].join(' ')}
          aria-label={t('shell.bookmark_save')}
          title={t('shell.bookmark_save')}
        >
          <Star className="w-[13px] h-[13px]" />
        </button>
      )}
    </div>
  )
}

// ─── Radius row (Random Walk) ─────────────────────────────────

function RadiusRow({
  value,
  onChange,
  t,
}: {
  value: number
  onChange: (v: number) => void
  t: ReturnType<typeof useT>
}) {
  const valText = value >= 1000 ? `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)} km` : `${value} m`
  return (
    <div className="mt-3.5 flex items-center gap-2.5 flex-wrap">
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-3)]">
        {t('panel.waypoints_radius')}
      </span>
      <div
        className="flex gap-1 p-[3px] rounded-[10px] border border-[var(--color-border)]"
        style={{ background: 'var(--color-surface-ghost)' }}
      >
        {RADIUS_PRESETS.map((r) => {
          const active = r === value
          const label = r >= 1000 ? `${r / 1000}km` : `${r}m`
          return (
            <button
              key={r}
              type="button"
              onClick={() => onChange(r)}
              aria-pressed={active}
              className={[
                'h-8 px-3 rounded-[7px] font-mono text-[12px] font-medium',
                'transition-colors duration-120 cursor-pointer',
                active
                  ? 'text-[var(--color-accent-strong)]'
                  : 'text-[var(--color-text-2)] hover:text-[var(--color-text-1)]',
              ].join(' ')}
              style={active ? {
                background: 'var(--color-accent-dim)',
                boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06)',
              } : undefined}
            >
              {label}
            </button>
          )
        })}
      </div>
      <span className="ml-auto font-mono text-[13px] text-[var(--color-text-1)] font-semibold">
        {valText}
      </span>
    </div>
  )
}

// ─── Joystick preview ─────────────────────────────────────────

function JoyPreview({ t }: { t: ReturnType<typeof useT> }) {
  return (
    <div
      className="mt-3.5 flex gap-3.5 items-center p-3.5 rounded-xl border border-[var(--color-border)]"
      style={{ background: 'rgba(255,255,255,0.03)' }}
    >
      {/* Decorative pad — static visual cue; the live pad is JoystickPad over the map */}
      <div
        className="w-[84px] h-[84px] shrink-0 rounded-full relative"
        style={{
          background: 'var(--gradient-joystick-base)',
          border: '1px solid var(--color-border-strong)',
          boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.4), inset 0 -1px 1px rgba(255,255,255,0.05)',
        }}
        aria-hidden="true"
      >
        <span
          className="absolute inset-[14px] rounded-full"
          style={{
            background: 'var(--gradient-joystick-knob)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5), inset 0 1px 1px rgba(255,255,255,0.08)',
          }}
        />
        <span
          className="absolute left-1/2 top-1/2 w-1.5 h-1.5 rounded-full"
          style={{
            transform: 'translate(-50%,-50%)',
            background: 'var(--color-accent)',
            boxShadow: '0 0 10px var(--color-accent)',
          }}
        />
      </div>
      <div className="flex-1">
        <div className="text-[13px] font-medium text-[var(--color-text-1)]">
          {t('joy.drag_or_keys')}
        </div>
        <div className="text-[12px] text-[var(--color-text-3)] mt-1 leading-[1.5]">
          {t('panel.joystick_hint')}
        </div>
        <div className="inline-flex gap-[3px] mt-2">
          {['W', 'A', 'S', 'D', 'Shift'].map((k) => (
            <kbd
              key={k}
              className={[
                'font-mono text-[10px] px-[6px] py-[2px] rounded',
                'border border-[var(--color-border)]',
                'text-[var(--color-text-2)]',
              ].join(' ')}
              style={{ background: 'rgba(255,255,255,0.05)' }}
            >
              {k}
            </kbd>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Speed toggle ─────────────────────────────────────────────

interface SpeedToggleProps {
  presetActive: (mode: MoveMode) => boolean
  onPreset: (mode: MoveMode) => void
  disabled: boolean
  t: ReturnType<typeof useT>
}

function SpeedToggle({ presetActive, onPreset, disabled, t }: SpeedToggleProps) {
  return (
    <div
      role="group"
      aria-label={t('panel.speed')}
      className={[
        'flex gap-0.5 p-[3px] h-11 rounded-xl border border-[var(--color-border)]',
        disabled ? 'opacity-40 pointer-events-none' : '',
      ].join(' ')}
      style={{ background: 'var(--color-surface-ghost)' }}
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
              'inline-flex items-center gap-1.5 px-3.5 rounded-[9px] text-[13px] font-medium',
              'transition-colors duration-150',
              on ? 'text-[var(--color-accent-strong)]' : 'text-[var(--color-text-2)] hover:text-[var(--color-text-1)]',
            ].join(' ')}
            style={on ? {
              background: 'var(--color-accent-dim)',
              border: '1px solid rgba(255,255,255,0.06)',
            } : undefined}
          >
            <Icon className="w-3.5 h-3.5" />
            <span className="hidden md:inline">{t(labelKey)}</span>
            <span className="font-mono text-[11px] opacity-65 tabular-nums">{value}</span>
          </button>
        )
      })}
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
    ? { bg: 'rgba(255,71,87,0.14)', border: '1px solid rgba(255,71,87,0.35)', color: '#ff8b95', hover: 'rgba(255,71,87,0.22)' }
    : tone === 'ghost'
      ? { bg: 'var(--color-surface-ghost)', border: '1px solid var(--color-border)', color: 'var(--color-text-1)', hover: 'rgba(255,255,255,0.08)' }
      : { bg: 'var(--color-accent)', border: 'none', color: '#0a0a0c', hover: 'var(--color-accent-hover)' }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        'inline-flex items-center justify-center gap-2 h-11 px-[18px] rounded-xl',
        'text-[13px] font-semibold whitespace-nowrap',
        'transition-[background,opacity,box-shadow] duration-150 cursor-pointer',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] focus-visible:outline-offset-2',
      ].join(' ')}
      style={{
        background: palette.bg,
        border: palette.border,
        color: palette.color,
        boxShadow: tone === 'accent' && !disabled ? 'var(--shadow-glow)' : undefined,
      }}
      onMouseEnter={(e) => { if (!disabled) (e.currentTarget as HTMLElement).style.background = palette.hover }}
      onMouseLeave={(e) => { if (!disabled) (e.currentTarget as HTMLElement).style.background = palette.bg }}
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

// Silence unused imports retained for future variants.
void Repeat
void Dices
void Plus
