import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../i18n'
import { DEVICE_COLORS } from '../lib/constants'
import type { DeviceLetter } from '../lib/constants'
import type { DeviceInfo } from '../hooks/useDevice'
import type { DeviceRuntime } from '../hooks/useSimulation'
import StatusPill from './shell/StatusPill'

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
  const ref = useRef<HTMLButtonElement | null>(null)
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
  const ariaLabel = `Device ${letter}: ${shortName}, ${label}`

  return (
    <>
      <StatusPill
        as="button"
        ref={ref}
        type="button"
        aria-haspopup="menu"
        aria-label={ariaLabel}
        title={`${letter} · ${device.name}`}
        className="max-w-[220px] overflow-hidden"
        onContextMenu={(e: React.MouseEvent<HTMLButtonElement>) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY })
        }}
      >
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{
            background: dotColor,
            boxShadow: kind === 'running' ? `0 0 6px ${dotColor}` : 'none',
            animation: kind === 'running' ? 'chip-pulse 1.6s ease-in-out infinite' : undefined,
          }}
        />
        <span className="font-semibold" style={{ color: accent }}>{letter}</span>
        <span className="opacity-85 overflow-hidden text-ellipsis">· {shortName}</span>
        <span className="opacity-60 ml-0.5">· {label}</span>
      </StatusPill>
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
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="context-menu-item w-full text-left"
    >
      {children}
    </button>
  )
}
