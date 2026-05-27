import { useMemo, useState } from 'react'
import { Repeat, Route, Shuffle, Crosshair, Navigation, Gamepad2, SquareCheckBig, X, Check } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ChainPoint } from '../WaypointChain'
import { useSimContext } from '../../contexts/SimContext'
import { useSimDerived } from '../../contexts/SimDerivedContext'
import { useSimSettings } from '../../contexts/SimSettingsContext'
import { SimMode } from '../../hooks/useSimulation'
import { useT } from '../../i18n'
import { RADIUS_PRESETS } from '../../lib/constants'
import DockRouteCard from './dock/DockRouteCard'
import WaypointList from './dock/WaypointList'
import JoyPreview from './dock/JoyPreview'
import ModeStatsCard from './dock/ModeStatsCard'
import SpeedToggle from './dock/SpeedToggle'
import ActionGroup from './dock/ActionGroup'
import { buildDockContext } from './dock/buildDockContext'

const MODE_ICON: Record<string, LucideIcon> = {
  [SimMode.Teleport]:   Crosshair,
  [SimMode.Navigate]:   Navigation,
  [SimMode.Loop]:       Repeat,
  [SimMode.MultiStop]:  Route,
  [SimMode.RandomWalk]: Shuffle,
  [SimMode.Joystick]:   Gamepad2,
}

export default function BottomDock() {
  const t = useT()
  const simCtx = useSimContext()
  const { sim, handleRemoveWaypoint, handleGenerateRandomWaypoints } = simCtx
  const { currentPos, destPos } = useSimDerived()
  const [showRandomConfig, setShowRandomConfig] = useState(false)

  const ctx = useMemo(
    () => buildDockContext(sim.mode, sim, currentPos, destPos, t),
    [sim.mode, sim.waypoints, currentPos, destPos, t],
  )

  const speedToggleDisabled = sim.mode === SimMode.Teleport || sim.mode === SimMode.Joystick
  const Icon = MODE_ICON[sim.mode] ?? SquareCheckBig

  const handleRandomGenerate = () => {
    handleGenerateRandomWaypoints()
    setShowRandomConfig(false)
  }

  return (
    <div
      data-fc="bottom.dock"
      aria-label={t('shell.dock_aria')}
      className={[
        'glass-panel-strong',
        'fixed bottom-[72px] left-1/2 z-[var(--z-ui)]',
        'w-[min(920px,calc(100vw-48px))]',
        'flex flex-col',
        'overflow-hidden',
        'anim-fade-slide-up-centered',
      ].join(' ')}
    >
      {/* Panel body — padding matches design: 14px 16px, gap 12px; fixed height for consistency */}
      <div className="flex flex-col gap-3" style={{ padding: '14px 16px', minHeight: '320px' }}>
        {/* Header: icon + title + subtitle */}
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-[10px] grid place-items-center shrink-0 border"
            style={{
              background: 'var(--color-accent-dim)',
              color: 'var(--color-accent-strong)',
              borderColor: 'color-mix(in oklab, var(--color-accent) 28%, transparent)',
            }}
          >
            <Icon className="w-[18px] h-[18px]" />
          </div>
          <div className="flex flex-col gap-0.5 min-w-0 flex-1">
            <div className="text-[20px] font-semibold tracking-[-0.02em] text-[var(--color-text-1)] leading-[1.2] truncate">
              {ctx.title}
            </div>
            <div className="text-[12.5px] text-[var(--color-text-3)] leading-[1.5] max-w-[520px] truncate">
              {ctx.subtitle}
            </div>
          </div>
        </div>

        {/* Main row: always 2-column (left content + right controls) */}
        <div className="grid gap-3 items-start" style={{ gridTemplateColumns: '1fr 1fr' }}>
          {/* Left column */}
          <div className="flex flex-col gap-2 min-w-0">
            <LeftColumn
              mode={sim.mode}
              chainPoints={ctx.chainPoints}
              loop={ctx.loop}
              onRemoveWaypoint={handleRemoveWaypoint}
              onGenerateRandom={() => setShowRandomConfig(true)}
            />
          </div>

          {/* Right column: random config OR stats card + speed + action */}
          <div className="flex flex-col gap-2">
            {showRandomConfig ? (
              <RandomConfigPanel
                onCancel={() => setShowRandomConfig(false)}
                onGenerate={handleRandomGenerate}
              />
            ) : (
              <>
                <ModeStatsCard />
                {!speedToggleDisabled && <SpeedToggle />}
                <ActionGroup fullWidth />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Left column content ──────────────────────────────────────────────

interface LeftColumnProps {
  mode: SimMode
  chainPoints: readonly ChainPoint[]
  loop: boolean
  onRemoveWaypoint: (index: number) => void
  onGenerateRandom: () => void
}

function LeftColumn({ mode, chainPoints, loop, onRemoveWaypoint, onGenerateRandom }: LeftColumnProps) {
  switch (mode) {
    case SimMode.Teleport:
    case SimMode.Navigate:
      return <DockRouteCard mode={mode} />
    case SimMode.Loop:
    case SimMode.MultiStop:
      return (
        <WaypointList
          points={chainPoints}
          loop={loop}
          onRemove={(id) => {
            const i = parseInt(id.replace('wp-', ''), 10)
            if (!Number.isNaN(i)) onRemoveWaypoint(i)
          }}
          onAdd={() => { /* map right-click */ }}
          onRandom={onGenerateRandom}
        />
      )
    case SimMode.RandomWalk:
      return <RandomPreview />
    case SimMode.Joystick:
      return <JoyPreview />
    default:
      return null
  }
}

// ── Random config panel (right column swap) ─────────────────────────

function RandomConfigPanel({ onCancel, onGenerate }: { onCancel: () => void; onGenerate: () => void }) {
  const t = useT()
  const { wpGenRadius, setWpGenRadius, wpGenCount, setWpGenCount } = useSimSettings()
  const KM = 1000
  return (
    <>
      <div
        className="rounded-[14px] border border-[var(--color-border)] overflow-hidden relative"
        style={{
          background: 'linear-gradient(180deg, rgba(255,255,255,0.045) 0%, rgba(255,255,255,0.02) 100%)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 16px rgba(0,0,0,0.25)',
        }}
      >
        <div className="grid grid-cols-2">
          {/* Radius */}
          <div className="flex flex-col gap-2 p-4">
            <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.10em] text-[var(--color-text-3)]">
              <span className="w-1 h-1 rounded-full bg-[var(--color-accent)] shadow-[0_0_6px_var(--color-accent)] opacity-70" aria-hidden="true" />
              {t('dock.radius')}
            </span>
            <div className="flex gap-1 flex-wrap">
              {RADIUS_PRESETS.map((r) => {
                const active = r === wpGenRadius
                const label = r >= KM ? `${r / KM} km` : `${r} m`
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setWpGenRadius(r)}
                    className={[
                      'h-7 px-2.5 rounded-[7px] font-mono text-[12px] font-medium',
                      'transition-colors cursor-pointer',
                      active
                        ? 'text-[var(--color-accent-strong)]'
                        : 'text-[var(--color-text-2)] hover:text-[var(--color-text-1)]',
                    ].join(' ')}
                    style={active ? { background: 'var(--color-accent-dim)' } : undefined}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>
          {/* Waypoint count */}
          <div className="flex flex-col gap-2 p-4 relative">
            <span
              className="absolute left-0 top-[18%] bottom-[18%] w-px"
              style={{ background: 'linear-gradient(180deg, transparent, var(--color-border) 25%, var(--color-border) 75%, transparent)' }}
              aria-hidden="true"
            />
            <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.10em] text-[var(--color-text-3)]">
              <span className="w-1 h-1 rounded-full bg-[var(--color-accent)] shadow-[0_0_6px_var(--color-accent)] opacity-70" aria-hidden="true" />
              {t('dock.waypoints')}
            </span>
            <div
              className="flex items-center gap-1 p-[3px] rounded-[10px] border border-[var(--color-border)]"
              style={{ background: 'rgba(0,0,0,0.25)' }}
            >
              <button
                type="button"
                onClick={() => setWpGenCount(Math.max(2, wpGenCount - 1))}
                className="w-[30px] h-[30px] rounded-[7px] grid place-items-center text-[16px] text-[var(--color-text-2)] bg-white/[0.04] hover:bg-[rgba(108,140,255,0.18)] transition-colors cursor-pointer"
              >−</button>
              <span className="font-mono text-[17px] font-semibold text-[var(--color-text-1)] min-w-[36px] text-center tabular-nums">
                {wpGenCount}
              </span>
              <button
                type="button"
                onClick={() => setWpGenCount(Math.min(20, wpGenCount + 1))}
                className="w-[30px] h-[30px] rounded-[7px] grid place-items-center text-[16px] text-[var(--color-text-2)] bg-white/[0.04] hover:bg-[rgba(108,140,255,0.18)] transition-colors cursor-pointer"
              >+</button>
            </div>
          </div>
        </div>
      </div>
      {/* Cancel / Generate buttons */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center justify-center gap-2 h-11 rounded-xl text-[13px] font-medium cursor-pointer transition-colors text-[var(--color-text-2)] hover:text-[var(--color-text-1)]"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--color-border)' }}
        >
          <X className="w-3.5 h-3.5" />
          {t('action.cancel')}
        </button>
        <button
          type="button"
          onClick={onGenerate}
          className="inline-flex items-center justify-center gap-2 h-11 rounded-xl text-[13px] font-semibold cursor-pointer transition-colors text-[var(--color-surface-0)]"
          style={{ background: 'var(--color-accent)', boxShadow: 'var(--shadow-glow)' }}
        >
          <Check className="w-3.5 h-3.5" />
          {t('dock.generate_waypoints')}
        </button>
      </div>
    </>
  )
}

// ── Random walk preview (left column) ────────────────────────────────

function RandomPreview() {
  const t = useT()
  return (
    <div
      className="rounded-xl border border-[var(--color-border)] overflow-hidden"
      style={{ background: 'rgba(255,255,255,0.03)' }}
    >
      <div className="flex items-center justify-between px-3.5 py-2.5">
        <span className="text-[12px] font-medium text-[var(--color-text-2)]">
          {t('dock.wander_zone')}
        </span>
        <span className="inline-flex items-center gap-1.5 text-[10px] font-mono text-[var(--color-text-3)]">
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: '#34d399', boxShadow: '0 0 6px #34d399' }}
            aria-hidden="true"
          />
          {t('dock.wandering')}
        </span>
      </div>
      <div className="px-3.5 pb-3">
        <svg viewBox="0 0 200 100" className="w-full h-auto opacity-60" preserveAspectRatio="xMidYMid meet">
          <circle cx="100" cy="50" r="40" fill="none" stroke="var(--color-accent)" strokeWidth="1" strokeDasharray="4 3" opacity="0.3" />
          <path
            d="M100 50 L88 44 L82 56 L94 66 L108 60 L118 50 L112 36 L96 30"
            fill="none" stroke="var(--color-accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.5"
          />
          <circle cx="100" cy="50" r="3" fill="var(--color-accent)" opacity="0.4" />
          <circle cx="96" cy="30" r="3.5" fill="var(--color-accent)" />
        </svg>
      </div>
    </div>
  )
}
