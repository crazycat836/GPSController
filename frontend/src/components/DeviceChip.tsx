import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../i18n'
import { DEVICE_COLORS } from '../lib/constants'
import type { DeviceLetter } from '../lib/constants'
import type { DeviceInfo } from '../hooks/useDevice'
import type { DeviceRuntime } from '../hooks/useSimulation'

interface Props {
  letter: DeviceLetter
  device: DeviceInfo
  runtime?: DeviceRuntime
  onDisconnect: () => void
  onRestoreOne: () => void
  onEnableDev?: () => void
}

function stateKind(state?: string): 'idle' | 'running' | 'paused' | 'error' | 'disconnected' {
  if (!state) return 'idle'
  if (state === 'paused') return 'paused'
  if (state === 'disconnected') return 'disconnected'
  if (state === 'idle') return 'idle'
  return 'running'
}

export function DeviceChip({ letter, device, runtime, onDisconnect, onRestoreOne, onEnableDev }: Props) {
  const t = useT()
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const ref = useRef<HTMLDivElement | null>(null)
  const kind = stateKind(runtime?.state)

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [menu])

  const dotColor = {
    idle: 'var(--color-device-idle)',
    running: 'var(--color-accent)',
    paused: 'var(--color-device-paused)',
    error: 'var(--color-device-error)',
    disconnected: 'var(--color-device-error)',
  }[kind]

  const label = {
    idle: t('device.chip_state_idle'),
    running: t('device.chip_state_running'),
    paused: t('device.chip_state_paused'),
    error: t('device.chip_state_error'),
    disconnected: t('device.chip_state_disconnected'),
  }[kind]

  const accent = DEVICE_COLORS[letter === 'A' ? 0 : 1]
  const shortName = (device.name || 'iPhone').slice(0, 14)

  return (
    <>
      <div
        ref={ref}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY })
        }}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          height: 32, padding: '0 10px',
          borderRadius: 'var(--radius-full)',
          background: 'var(--color-surface-2)',
          border: '1px solid var(--color-border)',
          fontSize: 12,
          color: 'rgba(255,255,255,0.9)',
          cursor: 'context-menu',
          maxWidth: 160,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        title={`${letter} · ${device.name}`}
      >
        <span
          style={{
            width: 8, height: 8, borderRadius: '50%',
            background: dotColor,
            boxShadow: kind === 'running' ? `0 0 6px ${dotColor}` : 'none',
            animation: kind === 'running' ? 'chip-pulse 1.6s ease-in-out infinite' : undefined,
            flexShrink: 0,
          }}
        />
        <span style={{ fontWeight: 600, color: accent }}>{letter}</span>
        <span style={{ opacity: 0.85, overflow: 'hidden', textOverflow: 'ellipsis' }}>· {shortName}</span>
        <span style={{ opacity: 0.6, marginLeft: 2 }}>· {label}</span>
      </div>
      {menu && createPortal(
        <div
          onClick={(e) => e.stopPropagation()}
          className="surface-popup"
          style={{
            position: 'fixed', left: menu.x, top: menu.y,
            borderRadius: 'var(--radius-md)', padding: 4, minWidth: 160,
            zIndex: 'var(--z-dropdown)', fontSize: 12, color: 'var(--color-text-1)',
          }}
        >
          <MenuItem onClick={() => { setMenu(null); onRestoreOne() }}>{t('device.chip_restore')}</MenuItem>
          {onEnableDev && <MenuItem onClick={() => { setMenu(null); onEnableDev() }}>{t('device.chip_enable_dev')}</MenuItem>}
          <MenuItem onClick={() => { setMenu(null); onDisconnect() }}>{t('device.chip_disconnect')}</MenuItem>
        </div>,
        document.body,
      )}
    </>
  )
}

function MenuItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  const [hover, setHover] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: '6px 10px',
        borderRadius: 6,
        cursor: 'pointer',
        background: hover ? 'var(--color-surface-hover)' : 'transparent',
      }}
    >
      {children}
    </div>
  )
}
