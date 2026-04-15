import React, { useState, useCallback } from 'react'
import { Copy, Check } from 'lucide-react'
import { SimMode } from '../../hooks/useSimulation'
import { useSimContext } from '../../contexts/SimContext'
import { useDeviceContext } from '../../contexts/DeviceContext'
import { useT } from '../../i18n'
import type { StringKey } from '../../i18n'

const modeLabelKeys: Record<SimMode, StringKey> = {
  [SimMode.Teleport]: 'mode.teleport',
  [SimMode.Navigate]: 'mode.navigate',
  [SimMode.Loop]: 'mode.loop',
  [SimMode.MultiStop]: 'mode.multi_stop',
  [SimMode.RandomWalk]: 'mode.random_walk',
  [SimMode.Joystick]: 'mode.joystick',
}

const DEVICE_COLORS = ['#4285f4', '#ff9800', '#4ecdc4', '#e040fb'] as const
const DEVICE_LETTERS = ['A', 'B', 'C', 'D'] as const

function stateToMode(state: string): SimMode | null {
  switch (state) {
    case 'navigating': return SimMode.Navigate
    case 'looping': return SimMode.Loop
    case 'multi_stop': return SimMode.MultiStop
    case 'random_walk': return SimMode.RandomWalk
    case 'joystick': return SimMode.Joystick
    default: return null
  }
}

export default function MiniStatusBar() {
  const t = useT()
  const { currentPos, displaySpeed, sim } = useSimContext()
  const device = useDeviceContext()
  const [copied, setCopied] = useState(false)

  const isDual = device.connectedDevices.length >= 2
  const isConnected = device.connectedDevices.length > 0

  const handleCopy = useCallback(() => {
    if (!currentPos) return
    const txt = `${currentPos.lat.toFixed(6)}, ${currentPos.lng.toFixed(6)}`
    navigator.clipboard.writeText(txt).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [currentPos])

  if (!isConnected) return null

  return (
    <div
      className={[
        'absolute bottom-3 left-1/2 -translate-x-1/2 z-[850]',
        'flex items-center gap-2 px-4 py-1.5',
        'bg-[var(--color-glass)] backdrop-blur-2xl backdrop-saturate-[1.6]',
        'border border-[var(--color-border)] rounded-full',
        'text-xs text-[var(--color-text-2)]',
        'shadow-[0_14px_36px_rgba(12,18,40,0.48),0_2px_8px_rgba(12,18,40,0.3)]',
      ].join(' ')}
    >
      {isDual ? (
        device.connectedDevices.slice(0, 2).map((dev, i) => {
          const rt = sim.runtimes[dev.udid]
          const coord = rt?.currentPos
            ? `${rt.currentPos.lat.toFixed(3)},${rt.currentPos.lng.toFixed(3)}`
            : '\u2014'
          const spd = rt?.currentSpeedKmh ? rt.currentSpeedKmh.toFixed(0) : String(displaySpeed)
          const dMode = rt ? stateToMode(rt.state) : null
          const modeLabel = dMode ? t(modeLabelKeys[dMode]) : t(modeLabelKeys[sim.mode])
          return (
            <React.Fragment key={dev.udid}>
              {i > 0 && <div className="w-px h-3.5 bg-[var(--color-border)]" />}
              <div className="flex items-center gap-1.5 font-mono text-[11px]" title={dev.name}>
                <span className="font-bold" style={{ color: DEVICE_COLORS[i] }}>{DEVICE_LETTERS[i]}</span>
                <span>{coord}</span>
                <span className="opacity-40">&middot;</span>
                <span>{spd}km/h</span>
                <span className="opacity-40">&middot;</span>
                <span className="opacity-75">{modeLabel}</span>
              </div>
            </React.Fragment>
          )
        })
      ) : (
        <>
          {currentPos && (
            <>
              <span className="font-mono text-[11px]">
                {currentPos.lat.toFixed(5)}, {currentPos.lng.toFixed(5)}
              </span>
              <button
                onClick={handleCopy}
                className="p-0.5 text-[var(--color-text-3)] hover:text-[var(--color-accent)] transition-colors cursor-pointer"
                title={t('status.copy_coord')}
              >
                {copied
                  ? <Check className="w-3 h-3 text-green-400" />
                  : <Copy className="w-3 h-3" />}
              </button>
              <div className="w-px h-3.5 bg-[var(--color-border)]" />
            </>
          )}
          <span className="text-[11px]">{displaySpeed} km/h</span>
          <div className="w-px h-3.5 bg-[var(--color-border)]" />
          <span className="text-[11px] opacity-75">{t(modeLabelKeys[sim.mode])}</span>
        </>
      )}
    </div>
  )
}
