import React, { useState, useCallback } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Footprints, Rabbit, Car, Check, Gauge } from 'lucide-react'
import { useSimContext, MoveMode } from '../../contexts/SimContext'
import { useT, type StringKey } from '../../i18n'
import {
  SPEED_PRESETS as BASE_SPEED_PRESETS,
  isSpeedPresetActive,
  type SpeedPresetMode,
} from '../../lib/constants'

// Per-preset UI metadata (icon + i18n label key) layered on top of the
// canonical km/h presets in `lib/constants`. Keeping the icon/label table
// here means `lib/constants` does not need to depend on `lucide-react`.
const PRESET_UI: Record<SpeedPresetMode, { Icon: LucideIcon; labelKey: StringKey }> = {
  walking: { Icon: Footprints, labelKey: 'move.walking' },
  running: { Icon: Rabbit,     labelKey: 'move.running' },
  driving: { Icon: Car,        labelKey: 'move.driving' },
}

const SPEED_PRESETS = BASE_SPEED_PRESETS.map((p) => ({
  mode: p.mode as MoveMode,
  value: p.kmh,
  ...PRESET_UI[p.mode],
}))

// Logarithmic slider mapping for 0.36 – 120 km/h.
// Low speeds (walking) need more resolution than high speeds (driving).
const SPEED_MIN = 0.36
const SPEED_MAX = 120
const LOG_MIN = Math.log(SPEED_MIN)
const LOG_MAX = Math.log(SPEED_MAX)

const sliderToSpeed = (pct: number): number => {
  const raw = Math.exp(LOG_MIN + pct * (LOG_MAX - LOG_MIN))
  // Round to sensible precision
  if (raw < 1) return Math.round(raw * 100) / 100   // 0.36, 0.50, ...
  if (raw < 10) return Math.round(raw * 10) / 10     // 1.0, 2.5, ...
  return Math.round(raw)                              // 10, 40, 120
}

const speedToSlider = (kmh: number): number => {
  const clamped = Math.max(SPEED_MIN, Math.min(SPEED_MAX, kmh))
  return (Math.log(clamped) - LOG_MIN) / (LOG_MAX - LOG_MIN)
}

const fmtSpeed = (v: number): string =>
  v < 1 ? v.toFixed(2) : v < 10 ? v.toFixed(1) : String(Math.round(v))

export default function SpeedControls() {
  const { sim, handleApplySpeed, isRunning } = useSimContext()
  const t = useT()

  const hasCustom = sim.customSpeedKmh != null
  const hasRange = sim.speedMinKmh != null && sim.speedMaxKmh != null

  // Compare current UI speed settings against what's actually running
  const eff = sim.effectiveSpeed
  const speedDirty = eff != null && (
    sim.moveMode !== eff.mode ||
    sim.customSpeedKmh !== eff.kmh ||
    sim.speedMinKmh !== eff.min ||
    sim.speedMaxKmh !== eff.max
  )

  return (
    <div className="seg">
      {/* Header */}
      <div className="seg-row seg-row-header">
        <Gauge size={13} className="text-[var(--color-accent)]" />
        <span className="seg-label">{t('panel.speed')}</span>
      </div>

      {/* Preset chips */}
      <div className="seg-row seg-row-flush">
        <div className="flex gap-1 w-full">
          {SPEED_PRESETS.map((opt) => {
            const active = isSpeedPresetActive(opt.mode, sim)
            return (
              <button
                key={opt.mode}
                className={`seg-chip ${active ? 'seg-chip-on' : 'seg-chip-off'}`}
                onClick={() => {
                  sim.setMoveMode(opt.mode)
                  sim.setCustomSpeedKmh(null)
                }}
              >
                <opt.Icon size={14} />
                <span>{t(opt.labelKey)}</span>
                <span className="text-[9px] opacity-50">{opt.value} km/h</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Custom speed slider */}
      <CustomSpeedSlider
        value={sim.customSpeedKmh}
        onChange={sim.setCustomSpeedKmh}
        active={hasCustom}
      />

      {/* Random speed range */}
      <div className="seg-row">
        <span className="seg-label flex-1">{t('panel.speed_range')}</span>
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            className="seg-input w-16 text-center"
            placeholder={t('panel.speed_range_min')}
            value={sim.speedMinKmh ?? ''}
            onChange={(e) => {
              const v = e.target.value
              if (v === '') return sim.setSpeedMinKmh(null)
              const n = parseFloat(v)
              if (!isNaN(n) && n > 0) sim.setSpeedMinKmh(n)
            }}
            min="0.1"
            step="1"
          />
          <span className="seg-unit">~</span>
          <input
            type="number"
            className="seg-input w-16 text-center"
            placeholder={t('panel.speed_range_max')}
            value={sim.speedMaxKmh ?? ''}
            onChange={(e) => {
              const v = e.target.value
              if (v === '') return sim.setSpeedMaxKmh(null)
              const n = parseFloat(v)
              if (!isNaN(n) && n > 0) sim.setSpeedMaxKmh(n)
            }}
            min="0.1"
            step="1"
          />
        </div>
      </div>

      {/* Range active hint */}
      {hasRange && (
        <div className="seg-row seg-row-compact">
          <p className="text-[10px] text-[var(--color-amber-text)] opacity-80">
            {t('panel.speed_range_active')}: {Math.min(sim.speedMinKmh!, sim.speedMaxKmh!)}~{Math.max(sim.speedMinKmh!, sim.speedMaxKmh!)} km/h ({t('panel.speed_range_hint')})
          </p>
        </div>
      )}

      {/* Apply button — only when running AND speed changed */}
      {isRunning && speedDirty && <ApplySpeedButton onApply={handleApplySpeed} />}
    </div>
  )
}

/** Walk / Run / Drive preset chips. Renders just the chips row — caller
 *  wraps in `<div className="seg">` with its own header. Reused by
 *  JoystickPanel, which only wants the presets and not the slider/range. */
export function SpeedPresets() {
  const { sim } = useSimContext()
  const t = useT()

  return (
    <div className="seg-row seg-row-flush">
      <div className="flex gap-1 w-full">
        {SPEED_PRESETS.map((opt) => {
          const active = isSpeedPresetActive(opt.mode, sim)
          return (
            <button
              key={opt.mode}
              className={`seg-chip ${active ? 'seg-chip-on' : 'seg-chip-off'}`}
              onClick={() => {
                sim.setMoveMode(opt.mode)
                sim.setCustomSpeedKmh(null)
              }}
            >
              <opt.Icon size={14} />
              <span>{t(opt.labelKey)}</span>
              <span className="text-[9px] opacity-50">{opt.value} km/h</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function CustomSpeedSlider({
  value,
  onChange,
  active,
}: {
  value: number | null
  onChange: (v: number | null) => void
  active: boolean
}) {
  const t = useT()
  const sliderPct = value != null ? speedToSlider(value) : 0

  const handleSlider = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const pct = parseFloat(e.target.value)
    onChange(sliderToSpeed(pct))
  }, [onChange])

  const handleReset = useCallback(() => {
    onChange(null)
  }, [onChange])

  return (
    <div className="seg-row flex-col !items-stretch gap-2">
      <div className="flex items-center justify-between">
        <span className="seg-label">{t('panel.custom_speed')}</span>
        {active ? (
          <button
            onClick={handleReset}
            className="text-[10px] text-[var(--color-text-3)] hover:text-[var(--color-accent)] transition-colors cursor-pointer"
          >
            {t('generic.clear')}
          </button>
        ) : (
          <span className="text-[10px] text-[var(--color-text-3)]">
            {SPEED_MIN}–{SPEED_MAX} km/h
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={active ? sliderPct : 0}
          onChange={handleSlider}
          className="speed-slider flex-1"
        />
        <span
          className={[
            'text-xs font-mono w-[4.5rem] text-right shrink-0 tabular-nums',
            active ? 'text-[var(--color-accent)] font-semibold' : 'text-[var(--color-text-3)]',
          ].join(' ')}
        >
          {active ? `${fmtSpeed(value!)} km/h` : '— km/h'}
        </span>
      </div>
    </div>
  )
}

function ApplySpeedButton({ onApply }: { onApply: () => Promise<void> | void }) {
  const t = useT()
  const [busy, setBusy] = useState(false)

  return (
    <div className="seg-row seg-row-flush" style={{ padding: 0 }}>
      <button
        className="seg-cta seg-cta-accent seg-cta-sm w-full"
        disabled={busy}
        onClick={async () => {
          if (busy) return
          setBusy(true)
          try { await onApply() }
          finally { setTimeout(() => setBusy(false), 1500) }
        }}
        title={t('panel.apply_speed_tooltip')}
        style={{ borderRadius: 0 }}
      >
        <Check size={12} />
        {t('panel.apply_speed')}
      </button>
    </div>
  )
}
