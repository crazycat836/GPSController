import React from 'react'
import { Pause, Play } from 'lucide-react'
import { useT } from '../i18n'
import { useSimContext } from '../contexts/SimContext'
import type { RuntimesMap } from '../hooks/useSimulation'

interface EtaBarProps {
  // Live simulation state
  state: string
  progress: number
  remainingDistance: number
  traveledDistance: number
  eta: number
  runtimes?: RuntimesMap
  // Static preview (shown before starting). Not displayed with the
  // new top-center ETA pill — dock panel carries pre-run info now.
  plannedDistanceM?: number
  plannedEtaSeconds?: number
}

// Keep `paused` here — the pause/resume button lives inside this pill,
// so hiding it on pause would trap the user with no visible way to resume.
const ACTIVE_STATES = ['navigating', 'looping', 'multi_stop', 'random_walk', 'paused']

// Format ETA as HH:MM:SS to match the redesign/Home treatment
// (mono, accent-coloured, always 2-digit HH prefix even for < 1h).
function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(sec)}`
}

function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`
  return `${Math.round(meters)} m`
}

// Top-centre ETA pill — mirrors `.eta` from redesign/Home exactly:
// glass-pill-strong surface, 160×4 progress bar with accent gradient,
// stat columns for ETA / Remaining / Speed, vertical separators,
// and a 32px pause/resume button on the right. Fades in when a
// simulation is actively running.
function EtaBar({
  state,
  progress,
  remainingDistance,
  eta,
  runtimes,
}: EtaBarProps) {
  const t = useT()
  const { displaySpeed, isPaused, handlePause, handleResume } = useSimContext()

  const activeRuntimes = runtimes
    ? Object.values(runtimes).filter((r) => ACTIVE_STATES.includes(r.state))
    : []
  const isGroup = activeRuntimes.length >= 2
  const isLive = isGroup || ACTIVE_STATES.includes(state)

  // Design pins the bar on-screen only while something is running;
  // before start the dock panel already carries planned distance/ETA.
  if (!isLive) return null

  const aggProgress = isGroup
    ? activeRuntimes.reduce((s, r) => s + (r.progress || 0), 0) / activeRuntimes.length
    : progress
  const aggEta = isGroup
    ? Math.max(...activeRuntimes.map((r) => r.eta || 0))
    : eta
  const aggRemaining = isGroup
    ? Math.max(...activeRuntimes.map((r) => r.distanceRemaining || 0))
    : remainingDistance

  const percent = Math.max(0, Math.min(aggProgress * 100, 100))

  return (
    <div
      role="status"
      aria-live="polite"
      className={[
        // No Tailwind `-translate-x-1/2` here: Tailwind v4 emits it as
        // the CSS `translate:` longhand, which *stacks* with the
        // animation's `transform: translate(-50%, …)` and double-shifts
        // the pill off-canvas. The `eta-bar-enter` keyframe bakes the
        // horizontal translate into every frame (with fill-mode `both`),
        // so it's centred before / during / after the animation.
        // `--z-map-ui` (1000) sits above every Leaflet pane (map-pane 400,
        // marker-pane 600, popup-pane 700). `--z-bar` (200) loses to
        // map-pane in the cascade so the pill renders behind tiles and
        // only flickers into view while Leaflet is mid-zoom.
        'fixed top-[76px] left-1/2 z-[var(--z-map-ui)]',
        'border border-[var(--color-border)] rounded-full',
        'shadow-[var(--shadow-md)]',
        'pl-5 pr-4 py-2.5 flex items-center gap-[18px]',
        'eta-bar-enter',
      ].join(' ')}
      // Inline backdrop-filter so blur + saturate compose into a
      // single declaration (Tailwind v4 arbitrary utility split them
      // into two `backdrop-filter` rules, only the last survived).
      style={{
        background: 'rgba(19,20,22,0.88)',
        backdropFilter: 'blur(20px) saturate(1.3)',
        WebkitBackdropFilter: 'blur(20px) saturate(1.3)',
        transformOrigin: 'top center',
      }}
    >
      {/* ETA — accent mono value */}
      <Stat label={t('eta.eta')} value={formatClock(aggEta)} accent />

      {/* Progress bar (160×4) with gradient fill + glow */}
      <div
        className="w-40 h-1 rounded-[2px] bg-white/[0.08] overflow-hidden relative shrink-0"
        aria-label="Progress"
      >
        <div
          className="absolute inset-y-0 left-0 rounded-[2px] transition-[width] duration-500 ease-out"
          style={{
            width: `${percent}%`,
            background: 'linear-gradient(90deg, var(--color-accent) 0%, var(--color-accent-strong) 100%)',
            boxShadow: 'var(--shadow-glow)',
          }}
        />
      </div>

      <Stat label={t('eta.remaining')} value={formatDistance(aggRemaining)} />

      <Sep />

      <Stat label={t('panel.speed')} value={`${displaySpeed} km/h`} />

      <Sep />

      {/* Pause / Resume — 32px circle matching design `.eta .pause-btn` */}
      <button
        type="button"
        onClick={() => { if (isPaused) handleResume(); else handlePause() }}
        className={[
          'w-8 h-8 rounded-full grid place-items-center',
          'text-[var(--color-text-1)] bg-white/[0.05] hover:bg-white/[0.08]',
          'transition-colors duration-150 cursor-pointer',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]',
        ].join(' ')}
        aria-label={isPaused ? t('generic.resume') : t('generic.pause')}
        title={isPaused ? t('generic.resume') : t('generic.pause')}
      >
        {isPaused
          ? <Play className="w-3 h-3" fill="currentColor" />
          : <Pause className="w-3 h-3" fill="currentColor" />}
      </button>
    </div>
  )
}

interface StatProps {
  label: string
  value: string
  accent?: boolean
}

function Stat({ label, value, accent }: StatProps) {
  return (
    <div className="flex flex-col gap-0.5 text-left">
      <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-text-3)] font-semibold leading-none">
        {label}
      </span>
      <span
        className={[
          'font-mono text-[14px] font-medium leading-none tabular-nums',
          accent ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-1)]',
        ].join(' ')}
      >
        {value}
      </span>
    </div>
  )
}

function Sep() {
  return (
    <span
      className="w-px h-[26px] bg-[var(--color-border-strong)] shrink-0"
      aria-hidden="true"
    />
  )
}

export default EtaBar
