import React from 'react'
import { useT } from '../i18n'
import type { StringKey } from '../i18n'
import Toggle from './ui/Toggle'

interface PauseSetting {
  enabled: boolean
  min: number
  max: number
}

interface PauseControlProps {
  labelKey: StringKey
  value: PauseSetting
  onChange: (next: PauseSetting) => void
}

export default function PauseControl({ labelKey, value, onChange }: PauseControlProps) {
  const t = useT()
  const update = (patch: Partial<PauseSetting>) => onChange({ ...value, ...patch })

  return (
    <div className="seg">
      <div className="seg-row">
        <span className="seg-label flex-1">{t(labelKey)}</span>
        <Toggle
          checked={value.enabled}
          onChange={(next) => update({ enabled: next })}
          ariaLabel={t(labelKey)}
        />
      </div>
      {value.enabled && (
        <div className="seg-row">
          <span className="text-[var(--text-xs)] text-[var(--color-text-3)]">{t('pause.min')}</span>
          <input
            type="number"
            min={0}
            max={300}
            step={1}
            value={value.min}
            onChange={(e) => {
              const n = parseFloat(e.target.value)
              if (!isNaN(n) && n >= 0) update({ min: n })
            }}
            className="seg-input w-14 text-center"
          />
          <span className="text-[var(--text-xs)] text-[var(--color-text-3)]">~</span>
          <span className="text-[var(--text-xs)] text-[var(--color-text-3)]">{t('pause.max')}</span>
          <input
            type="number"
            min={0}
            max={300}
            step={1}
            value={value.max}
            onChange={(e) => {
              const n = parseFloat(e.target.value)
              if (!isNaN(n) && n >= 0) update({ max: n })
            }}
            className="seg-input w-14 text-center"
          />
          <span className="text-[var(--text-xs)] text-[var(--color-text-3)]">{t('pause.seconds')}</span>
        </div>
      )}
    </div>
  )
}
