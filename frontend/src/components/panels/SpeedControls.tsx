import React, { useState } from 'react'
import { Footprints, Rabbit, Car, Check } from 'lucide-react'
import { useSimContext, MoveMode } from '../../contexts/SimContext'
import { useT } from '../../i18n'

const SPEED_PRESETS = [
  { labelKey: 'move.walking' as const, value: 5, mode: 'walking' as MoveMode, Icon: Footprints },
  { labelKey: 'move.running' as const, value: 10, mode: 'running' as MoveMode, Icon: Rabbit },
  { labelKey: 'move.driving' as const, value: 40, mode: 'driving' as MoveMode, Icon: Car },
] as const

function ApplySpeedButton({ onApply }: { onApply: () => Promise<void> | void }) {
  const t = useT()
  const [busy, setBusy] = useState(false)

  return (
    <div className="mt-2">
      <button
        className="w-full py-1.5 rounded-lg bg-[var(--color-accent)] text-white text-xs font-medium
                   flex items-center justify-center gap-1.5 transition-opacity
                   disabled:bg-[var(--color-bg-surface-hover)] disabled:text-[var(--color-text-3)] disabled:cursor-not-allowed"
        disabled={busy}
        onClick={async () => {
          if (busy) return
          setBusy(true)
          try {
            await onApply()
          } finally {
            setTimeout(() => setBusy(false), 1500)
          }
        }}
        title={t('panel.apply_speed_tooltip')}
      >
        <Check size={12} />
        {t('panel.apply_speed')}
      </button>
    </div>
  )
}

export default function SpeedControls() {
  const { sim, handleApplySpeed, isRunning } = useSimContext()
  const t = useT()

  const isPresetActive = (mode: MoveMode) =>
    sim.moveMode === mode &&
    sim.customSpeedKmh == null &&
    sim.speedMinKmh == null &&
    sim.speedMaxKmh == null

  return (
    <div className="flex flex-col gap-3">
      {/* Preset speed buttons */}
      <div className="grid grid-cols-3 gap-2">
        {SPEED_PRESETS.map((opt) => {
          const active = isPresetActive(opt.mode)
          return (
            <button
              key={opt.mode}
              className={`flex flex-col items-center gap-1 rounded-xl px-2 py-2.5 text-xs font-medium
                         transition-colors cursor-pointer border
                         ${active
                           ? 'bg-[var(--color-accent-dim)] text-[var(--color-accent)] border-[var(--color-accent)]/30'
                           : 'bg-[var(--color-bg-elevated)] text-[var(--color-text-2)] border-transparent hover:text-[var(--color-text-1)] hover:bg-white/5'
                         }`}
              onClick={() => {
                sim.setMoveMode(opt.mode)
                sim.setCustomSpeedKmh(null)
              }}
            >
              <opt.Icon size={16} />
              <span>{t(opt.labelKey)}</span>
              <span className="text-[10px] opacity-60">{opt.value} km/h</span>
            </button>
          )
        })}
      </div>

      {/* Custom speed input */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-[var(--color-text-2)] whitespace-nowrap">{t('panel.custom_speed')}:</span>
        <input
          type="number"
          className="flex-1 max-w-[80px] rounded-lg bg-[var(--color-bg-elevated)] border border-white/10
                     px-2 py-1 text-xs text-[var(--color-text-1)] placeholder:text-[var(--color-text-3)]
                     outline-none focus:border-[var(--color-accent)]/40 focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
          placeholder="km/h"
          value={sim.customSpeedKmh ?? ''}
          onChange={(e) => {
            const v = e.target.value
            if (v === '') {
              sim.setCustomSpeedKmh(null)
            } else {
              const n = parseFloat(v)
              if (!isNaN(n) && n > 0) sim.setCustomSpeedKmh(n)
            }
          }}
          min="0.1"
          step="0.5"
        />
        <span className="text-[11px] text-[var(--color-text-3)]">km/h</span>
        {sim.customSpeedKmh != null && (
          <button
            className="px-2 py-0.5 rounded-md text-[11px] bg-white/5 text-[var(--color-text-2)]
                       hover:bg-white/10 transition-colors"
            onClick={() => sim.setCustomSpeedKmh(null)}
          >
            {t('generic.clear')}
          </button>
        )}
      </div>

      {/* Speed range inputs */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-[var(--color-text-2)]">{t('panel.speed_range')}:</span>
          {(sim.speedMinKmh != null || sim.speedMaxKmh != null) && (
            <button
              className="px-2 py-0.5 rounded-md text-[11px] bg-white/5 text-[var(--color-text-2)]
                         hover:bg-white/10 transition-colors"
              onClick={() => {
                sim.setSpeedMinKmh(null)
                sim.setSpeedMaxKmh(null)
              }}
            >
              {t('generic.clear')}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            className="flex-1 rounded-lg bg-[var(--color-bg-elevated)] border border-white/10
                       px-2 py-1 text-xs text-[var(--color-text-1)] placeholder:text-[var(--color-text-3)]
                       outline-none focus:border-[var(--color-accent)]/40 focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
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
          <span className="text-xs text-[var(--color-text-3)]">~</span>
          <input
            type="number"
            className="flex-1 rounded-lg bg-[var(--color-bg-elevated)] border border-white/10
                       px-2 py-1 text-xs text-[var(--color-text-1)] placeholder:text-[var(--color-text-3)]
                       outline-none focus:border-[var(--color-accent)]/40 focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
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
        {sim.speedMinKmh != null && sim.speedMaxKmh != null && (
          <p className="text-[11px] text-amber-400 mt-1">
            {t('panel.speed_range_active')}: {Math.min(sim.speedMinKmh, sim.speedMaxKmh)}~{Math.max(sim.speedMinKmh, sim.speedMaxKmh)} km/h ({t('panel.speed_range_hint')})
          </p>
        )}
      </div>

      {/* Apply speed button while running */}
      {isRunning && <ApplySpeedButton onApply={handleApplySpeed} />}
    </div>
  )
}
