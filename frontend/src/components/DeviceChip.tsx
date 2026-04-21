import { useRef } from 'react'
import { useT } from '../i18n'
import { DEVICE_COLORS } from '../lib/constants'
import type { DeviceLetter } from '../lib/constants'
import type { DeviceInfo } from '../hooks/useDevice'
import type { DeviceRuntime } from '../hooks/useSimulation'
import StatusPill from './shell/StatusPill'
import KebabMenu, { type KebabMenuItem } from './ui/KebabMenu'

interface Props {
  letter: DeviceLetter
  device: DeviceInfo
  runtime?: DeviceRuntime
  onDisconnect: () => void
  onRestoreOne: () => void
  onEnableDev?: () => void
}

function stateKind(state?: string): 'idle' | 'running' | 'reconnecting' | 'paused' | 'error' | 'disconnected' {
  if (!state) return 'idle'
  if (state === 'paused') return 'paused'
  if (state === 'disconnected') return 'disconnected'
  if (state === 'reconnecting') return 'reconnecting'
  if (state === 'idle') return 'idle'
  return 'running'
}

export function DeviceChip({ letter, device, runtime, onDisconnect, onRestoreOne, onEnableDev }: Props) {
  const t = useT()
  const ref = useRef<HTMLButtonElement | null>(null)
  const kind = stateKind(runtime?.state)

  const dotColor = {
    idle: 'var(--color-device-idle)',
    running: 'var(--color-accent)',
    reconnecting: 'var(--color-device-paused)',
    paused: 'var(--color-device-paused)',
    error: 'var(--color-device-error)',
    disconnected: 'var(--color-device-error)',
  }[kind]

  const label = {
    idle: t('device.chip_state_idle'),
    running: t('device.chip_state_running'),
    reconnecting: t('device.chip_state_reconnecting'),
    paused: t('device.chip_state_paused'),
    error: t('device.chip_state_error'),
    disconnected: t('device.chip_state_disconnected'),
  }[kind]

  const accent = DEVICE_COLORS[letter === 'A' ? 0 : 1]
  const shortName = (device.name || 'iPhone').slice(0, 14)
  const ariaLabel = `Device ${letter}: ${shortName}, ${label}`

  const menuItems: KebabMenuItem[] = [
    {
      id: 'restore',
      label: t('device.chip_restore'),
      onSelect: onRestoreOne,
    },
    ...(onEnableDev ? [{
      id: 'enable-dev',
      label: t('device.chip_enable_dev'),
      onSelect: onEnableDev,
    } satisfies KebabMenuItem] : []),
    {
      id: 'disconnect',
      label: t('device.chip_disconnect'),
      kind: 'danger' as const,
      onSelect: onDisconnect,
    },
  ]

  return (
    <KebabMenu
      items={menuItems}
      ariaLabel={ariaLabel}
      openOnContextMenu
      trigger={
        <StatusPill
          as="button"
          ref={ref}
          type="button"
          aria-label={ariaLabel}
          title={`${letter} · ${device.name}`}
          className="max-w-[220px] overflow-hidden"
        >
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{
              background: dotColor,
              boxShadow: (kind === 'running' || kind === 'reconnecting') ? `0 0 6px ${dotColor}` : 'none',
              animation: kind === 'running'
                ? 'chip-pulse 1.6s ease-in-out infinite'
                : kind === 'reconnecting'
                  ? 'chip-pulse 2.4s ease-in-out infinite'
                  : undefined,
            }}
          />
          <span className="font-semibold" style={{ color: accent }}>{letter}</span>
          <span className="opacity-85 overflow-hidden text-ellipsis">· {shortName}</span>
          <span className="opacity-60 ml-0.5">· {label}</span>
        </StatusPill>
      }
    />
  )
}
