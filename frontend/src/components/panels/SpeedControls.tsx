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
    <div className="seg-row seg-row-flush">
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
    <div className="seg">
      {/* Compact section header */}
      <div className="seg-row seg-row-header">
        <span className="seg-label">{t('panel.speed' as any)}</span>
      </div>

      {/* Preset speed buttons */}
      <div className="seg-row seg-row-flush">
        <div className="flex gap-1 w-full">
          {SPEED_PRESETS.map((opt) => {
            const active = isPresetActive(opt.mode)
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

      {/* Custom speed */}
      <div className="seg-row">
        <span className="seg-label flex-1">{t('panel.custom_speed')}</span>
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            className="seg-input w-20 text-right"
            placeholder="Ex: 15"
            value={sim.customSpeedKmh ?? ''}
            onChange={(e) => {
              const v = e.target.value
              if (v === '') { sim.setCustomSpeedKmh(null) }
              else {
                const n = parseFloat(v)
                if (!isNaN(n) && n > 0) sim.setCustomSpeedKmh(n)
              }
            }}
            min="0.1"
            step="0.5"
          />
          <span className="seg-unit">km/h</span>
        </div>
      </div>

      {/* Speed range */}
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

      {/* Speed range active indicator */}
      {sim.speedMinKmh != null && sim.speedMaxKmh != null && (
        <div className="seg-row seg-row-compact">
          <p className="text-[10px] text-amber-400/80">
            {t('panel.speed_range_active')}: {Math.min(sim.speedMinKmh, sim.speedMaxKmh)}~{Math.max(sim.speedMinKmh, sim.speedMaxKmh)} km/h ({t('panel.speed_range_hint')})
          </p>
        </div>
      )}

      {isRunning && <ApplySpeedButton onApply={handleApplySpeed} />}
    </div>
  )
}
