import { useMemo, useState } from 'react'
import { useSimActions, useSimState } from '../../../contexts/SimContext'
import { useSimDerived } from '../../../contexts/SimDerivedContext'
import {
  useSimSettings,
  JOYSTICK_SENSITIVITY_MIN,
  JOYSTICK_SENSITIVITY_MAX,
} from '../../../contexts/SimSettingsContext'
import { SimMode } from '../../../hooks/useSimulation'
import { useT } from '../../../i18n'
import { haversineM } from '../../../lib/geo'
import { RADIUS_PRESETS, SPEED_MAP, cooldownForDistM, type SpeedPresetMode } from '../../../lib/constants'

// ── Shared visual primitives ──────────────────────────────────────────

function AccentHairline() {
  return (
    <div
      className="absolute left-4 right-4 top-0 h-px"
      style={{
        background:
          'linear-gradient(90deg, transparent, var(--color-accent-strong), transparent)',
        opacity: 0.5,
      }}
      aria-hidden="true"
    />
  )
}

function ColDivider() {
  return (
    <span
      className="absolute left-0 top-[18%] bottom-[18%] w-px"
      style={{
        background:
          'linear-gradient(180deg, transparent, var(--color-border) 25%, var(--color-border) 75%, transparent)',
      }}
      aria-hidden="true"
    />
  )
}

function RowDivider() {
  return (
    <div
      className="absolute left-[18px] right-[18px] bottom-0 h-px"
      style={{
        background:
          'linear-gradient(90deg, transparent, var(--color-border) 20%, var(--color-border) 80%, transparent)',
      }}
      aria-hidden="true"
    />
  )
}

// ── Stat cell ─────────────────────────────────────────────────────────

interface StatCellProps {
  label: string
  value: string
  accent?: boolean
  divider?: boolean
}

function StatCell({ label, value, accent = false, divider = false }: StatCellProps) {
  return (
    <div
      className={[
        'flex flex-col gap-2 p-4 hover:bg-white/[0.025] transition-colors',
        divider ? 'relative' : '',
      ].join(' ')}
    >
      {divider && <ColDivider />}
      <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.10em] text-[var(--color-text-3)]">
        <span
          className="w-1 h-1 rounded-full bg-[var(--color-accent)] shadow-[0_0_6px_var(--color-accent)] opacity-70"
          aria-hidden="true"
        />
        {label}
      </span>
      <span
        className={[
          'font-mono text-[24px] font-semibold tabular-nums leading-none tracking-[-0.02em]',
          accent
            ? 'text-[var(--color-accent-strong)]'
            : 'text-[var(--color-text-1)]',
        ].join(' ')}
      >
        {value}
      </span>
    </div>
  )
}

// ── Control cell ──────────────────────────────────────────────────────

interface ControlCellProps {
  label: string
  divider?: boolean
  children: React.ReactNode
}

function ControlCell({ label, divider = false, children }: ControlCellProps) {
  return (
    <div
      className={[
        'flex items-center justify-between gap-3 px-[18px] py-3.5',
        divider ? 'relative' : '',
      ].join(' ')}
    >
      {divider && <ColDivider />}
      <span className="text-[13px] font-medium text-[var(--color-text-2)]">
        {label}
      </span>
      {children}
    </div>
  )
}

// ── Toggle switch ────────────────────────────────────────────────────

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange?: (v: boolean) => void }) {
  const [localOn, setLocalOn] = useState(checked)
  const on = onChange ? checked : localOn
  const toggle = () => {
    if (onChange) { onChange(!checked) }
    else { setLocalOn((v) => !v) }
  }
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={toggle}
      className="w-11 h-6 rounded-xl relative cursor-pointer transition-colors"
      style={{ background: on ? 'var(--color-accent)' : 'rgba(255,255,255,0.12)' }}
    >
      <div
        className="absolute top-[2px] w-5 h-5 rounded-full bg-white shadow-sm transition-transform"
        style={{
          left: '2px',
          transform: on ? 'translateX(20px)' : 'translateX(0)',
        }}
      />
    </button>
  )
}

// ── Stepper ──────────────────────────────────────────────────────────

function Stepper({ value, onDec, onInc }: { value: string; onDec?: () => void; onInc?: () => void }) {
  const btnCls = 'w-7 h-7 rounded-lg grid place-items-center text-[14px] text-[var(--color-text-2)] bg-white/[0.06] hover:bg-[rgba(167,139,250,0.18)] hover:text-[var(--color-text-1)] transition-colors cursor-pointer'
  return (
    <div
      className="inline-flex items-center gap-0.5 h-6 px-0.5 rounded-xl"
      style={{ background: 'rgba(255,255,255,0.12)' }}
    >
      <button type="button" className={btnCls} onClick={onDec}>−</button>
      <span className="font-mono text-[13px] font-semibold text-[var(--color-text-1)] min-w-[28px] text-center tabular-nums">
        {value}
      </span>
      <button type="button" className={btnCls} onClick={onInc}>+</button>
    </div>
  )
}

// ── Card shell ────────────────────────────────────────────────────────

export function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-[14px] border border-[var(--color-border)] overflow-hidden relative"
      style={{
        background: `radial-gradient(120% 100% at 0% 0%, rgba(108,140,255,0.10) 0%, transparent 55%),
                     linear-gradient(180deg, rgba(255,255,255,0.045) 0%, rgba(255,255,255,0.02) 100%)`,
        boxShadow:
          'inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 16px rgba(0,0,0,0.25)',
      }}
    >
      <AccentHairline />
      {children}
    </div>
  )
}

// ── Formatting helpers ────────────────────────────────────────────────

const KM_THRESHOLD_M = 1000

function formatDist(m: number): string {
  if (m >= KM_THRESHOLD_M) return `${(m / KM_THRESHOLD_M).toFixed(2)} km`
  return `${Math.round(m)} m`
}

function useActiveSpeedKmh(): number {
  const { customSpeedKmh, moveMode } = useSimState()
  if (customSpeedKmh != null) return customSpeedKmh
  return SPEED_MAP[moveMode as SpeedPresetMode] ?? 10.8
}

function formatEta(distM: number, speedKmh: number, laps: number | null): string {
  if (distM <= 0 || speedKmh <= 0) return '--'
  if (laps === null) return '∞'
  const totalM = distM * laps
  const hours = totalM / 1000 / speedKmh
  const mins = Math.round(hours * 60)
  if (mins < 1) return '< 1 min'
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h} h` : `${h} h ${m} m`
}

function formatRadius(m: number): string {
  if (m >= KM_THRESHOLD_M) {
    const km = m / KM_THRESHOLD_M
    return m % KM_THRESHOLD_M === 0 ? `${km} km` : `${km.toFixed(1)} km`
  }
  return `${m} m`
}

// ── Per-mode card content ─────────────────────────────────────────────

function useTotalWaypointDist(loop: boolean): number {
  const { waypoints } = useSimState()
  return useMemo(() => {
    if (waypoints.length < 2) return 0
    let d = 0
    for (let i = 1; i < waypoints.length; i++) {
      d += haversineM(waypoints[i - 1], waypoints[i])
    }
    if (loop && waypoints.length >= 2) {
      d += haversineM(
        waypoints[waypoints.length - 1],
        waypoints[0],
      )
    }
    return d
  }, [waypoints, loop])
}

function useNavDist(): number {
  const { currentPos, destPos } = useSimDerived()
  return useMemo(() => {
    if (!currentPos || !destPos) return 0
    return haversineM(currentPos, destPos)
  }, [currentPos, destPos])
}

// ── Teleport card ─────────────────────────────────────────────────────

function formatCooldown(secs: number): string {
  if (secs <= 0) return '0 s'
  if (secs < 60) return `${secs} s`
  const m = Math.floor(secs / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return rm === 0 ? `${h} h` : `${h} h ${rm} m`
}

function TeleportCard() {
  const t = useT()
  const distM = useNavDist()
  const cdSecs = cooldownForDistM(distM)
  const cdDisplay = distM > 0 ? formatCooldown(cdSecs) : '--'
  const { autoJitter, setAutoJitter } = useSimSettings()
  return (
    <CardShell>
      <div className="grid grid-cols-2 relative">
        <StatCell label={t('dock.distance')} value={formatDist(distM)} />
        <StatCell
          label={t('dock.cooldown')}
          value={cdDisplay}
          accent
          divider
        />
        <RowDivider />
      </div>
      <ControlCell label={t('dock.auto_jitter')}>
        <ToggleSwitch checked={autoJitter} onChange={setAutoJitter} />
      </ControlCell>
    </CardShell>
  )
}

// ── Navigate card ─────────────────────────────────────────────────────

function NavigateCard() {
  const t = useT()
  const distM = useNavDist()
  const speedKmh = useActiveSpeedKmh()
  const eta = formatEta(distM, speedKmh, 1)
  return (
    <CardShell>
      <div className="grid grid-cols-2 relative">
        <StatCell label={t('dock.distance')} value={formatDist(distM)} />
        <StatCell
          label={t('dock.est_time')}
          value={eta}
          accent
          divider
        />
      </div>
    </CardShell>
  )
}

// ── Loop card ─────────────────────────────────────────────────────────

function LoopCard() {
  const t = useT()
  const { loopLapCount } = useSimState()
  const { setLoopLapCount } = useSimActions()
  const loopEnabled = loopLapCount !== 1
  const totalDist = useTotalWaypointDist(loopEnabled)
  const speedKmh = useActiveSpeedKmh()
  const eta = formatEta(totalDist, speedKmh, loopLapCount)
  const displayCount = loopLapCount === null ? '∞' : String(loopLapCount)

  const handleToggle = (on: boolean) => {
    setLoopLapCount(on ? null : 1)
  }
  const handleDec = () => {
    if (loopLapCount === null) { setLoopLapCount(10) }
    else if (loopLapCount > 2) { setLoopLapCount(loopLapCount - 1) }
  }
  const handleInc = () => {
    if (loopLapCount === null) return
    if (loopLapCount >= 99) { setLoopLapCount(null) }
    else { setLoopLapCount(loopLapCount + 1) }
  }

  return (
    <CardShell>
      <div className="grid grid-cols-2 relative">
        <StatCell label={t('dock.distance')} value={formatDist(totalDist)} />
        <StatCell
          label={t('dock.est_time')}
          value={eta}
          accent
          divider
        />
        <RowDivider />
      </div>
      <div className="grid grid-cols-2">
        <ControlCell label={t('dock.loop')}>
          <ToggleSwitch checked={loopEnabled} onChange={handleToggle} />
        </ControlCell>
        <ControlCell label={t('dock.count')} divider>
          <Stepper value={displayCount} onDec={handleDec} onInc={handleInc} />
        </ControlCell>
      </div>
    </CardShell>
  )
}

// ── Multi-Stop card ───────────────────────────────────────────────────

function MultiStopCard() {
  const t = useT()
  const { waypoints } = useSimState()
  const totalDist = useTotalWaypointDist(false)
  return (
    <CardShell>
      <div className="grid grid-cols-2 relative">
        <StatCell
          label={t('dock.total_distance')}
          value={formatDist(totalDist)}
        />
        <StatCell
          label={t('dock.est_time')}
          value="--"
          accent
          divider
        />
        <RowDivider />
      </div>
      <div className="grid grid-cols-2">
        <ControlCell label={t('dock.pause_toggle')}>
          <ToggleSwitch checked={true} />
        </ControlCell>
        <ControlCell label={t('dock.stops')} divider>
          <Stepper value={String(waypoints.length)} />
        </ControlCell>
      </div>
    </CardShell>
  )
}

// ── Random Walk card ──────────────────────────────────────────────────

function RandomWalkCard() {
  const t = useT()
  const { randomWalkRadius, setRandomWalkRadius } = useSimSettings()
  return (
    <CardShell>
      <div className="grid grid-cols-2 relative">
        {/* Radius with preset chips */}
        <div className="flex flex-col gap-2 p-4 hover:bg-white/[0.025] transition-colors">
          <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.10em] text-[var(--color-text-3)]">
            <span
              className="w-1 h-1 rounded-full bg-[var(--color-accent)] shadow-[0_0_6px_var(--color-accent)] opacity-70"
              aria-hidden="true"
            />
            {t('dock.radius')}
          </span>
          <div className="flex gap-1 flex-wrap">
            {RADIUS_PRESETS.map((r) => {
              const active = r === randomWalkRadius
              const label =
                r >= KM_THRESHOLD_M ? `${r / KM_THRESHOLD_M}km` : `${r}m`
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRandomWalkRadius(r)}
                  aria-pressed={active}
                  className={[
                    'h-7 px-2.5 rounded-[7px] font-mono text-[12px] font-medium',
                    'transition-colors duration-120 cursor-pointer',
                    active
                      ? 'text-[var(--color-accent-strong)]'
                      : 'text-[var(--color-text-2)] hover:text-[var(--color-text-1)]',
                  ].join(' ')}
                  style={
                    active
                      ? {
                          background: 'var(--color-accent-dim)',
                          boxShadow:
                            'var(--shadow-avatar-ring-subtle)',
                        }
                      : undefined
                  }
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Waypoints stepper */}
        <div className="flex flex-col gap-2 p-4 hover:bg-white/[0.025] transition-colors relative">
          <ColDivider />
          <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.10em] text-[var(--color-text-3)]">
            <span
              className="w-1 h-1 rounded-full bg-[var(--color-accent)] shadow-[0_0_6px_var(--color-accent)] opacity-70"
              aria-hidden="true"
            />
            {t('dock.waypoints')}
          </span>
          <span className="font-mono text-[24px] font-semibold text-[var(--color-accent-strong)] tabular-nums leading-none tracking-[-0.02em]">
            {formatRadius(randomWalkRadius)}
          </span>
        </div>
      </div>
    </CardShell>
  )
}

// ── Joystick card ─────────────────────────────────────────────────────

function JoystickCard() {
  const t = useT()
  const { joystickSensitivity, setJoystickSensitivity } = useSimSettings()
  return (
    <CardShell>
      <div className="grid grid-cols-2 relative">
        <StatCell label={t('dock.speed')} value="0.0 m/s" />
        <StatCell
          label={t('dock.heading')}
          value="—"
          accent
          divider
        />
        <RowDivider />
      </div>
      <ControlCell label={t('dock.sensitivity')}>
        <Stepper
          value={String(joystickSensitivity)}
          onDec={() => setJoystickSensitivity(Math.max(JOYSTICK_SENSITIVITY_MIN, joystickSensitivity - 1))}
          onInc={() => setJoystickSensitivity(Math.min(JOYSTICK_SENSITIVITY_MAX, joystickSensitivity + 1))}
        />
      </ControlCell>
    </CardShell>
  )
}

// ── Public component ──────────────────────────────────────────────────

export default function ModeStatsCard() {
  const { mode } = useSimState()

  switch (mode) {
    case SimMode.Teleport:
      return <TeleportCard />
    case SimMode.Navigate:
      return <NavigateCard />
    case SimMode.Loop:
      return <LoopCard />
    case SimMode.MultiStop:
      return <MultiStopCard />
    case SimMode.RandomWalk:
      return <RandomWalkCard />
    case SimMode.Joystick:
      return <JoystickCard />
  }
}
