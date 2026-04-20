import React from 'react'
import { Smartphone, Bookmark, Settings } from 'lucide-react'
import { useT } from '../../i18n'
import LocatePcButton from './LocatePcButton'

interface TopBarActionsProps {
  /** Receives the triggering button element so the popover can anchor to it. */
  onDeviceClick?: (anchor: HTMLElement) => void
  addDeviceDisabled?: boolean
  onLibraryClick?: () => void
  onSettingsClick?: () => void
  /** Imperative map camera pan — required for the "Locate PC" feature. */
  onFlyToCoordinate?: (lat: number, lng: number, zoom?: number) => void
  /** Raised after the user fires a fly/teleport-to-PC action (with the
   *  coord the map was sent to) or when the cached location is cleared
   *  (null). Parent is responsible for surfacing the PC marker on the map. */
  onPcLocated?: (coord: { lat: number; lng: number } | null) => void
}

export default function TopBarActions({
  onDeviceClick,
  addDeviceDisabled,
  onLibraryClick,
  onSettingsClick,
  onFlyToCoordinate,
  onPcLocated,
}: TopBarActionsProps) {
  const t = useT()

  return (
    <div data-fc="topbar.actions" className="flex items-center gap-2">
      {onFlyToCoordinate && (
        <LocatePcButton onFlyToCoordinate={onFlyToCoordinate} onPcLocated={onPcLocated} />
      )}
      <ActionButton
        icon={Smartphone}
        label={t('device.add_device')}
        onClick={(e) => onDeviceClick?.(e.currentTarget)}
        disabled={addDeviceDisabled}
      />
      <ActionButton
        icon={Bookmark}
        label={t('panel.library')}
        shortcut="\u2318B"
        onClick={onLibraryClick}
      />
      <ActionButton
        icon={Settings}
        label={t('settings.title')}
        onClick={onSettingsClick}
        data-settings-trigger
      />
    </div>
  )
}

interface ActionButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ComponentType<{ className?: string }>
  label: string
  shortcut?: string
}

function ActionButton({ icon: Icon, label, shortcut, ...rest }: ActionButtonProps) {
  return (
    <button
      {...rest}
      className={[
        'glass-pill w-11 h-11 grid place-items-center',
        'text-[var(--color-text-1)]',
        'hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-border-strong)]',
        'active:scale-95',
        'transition-[transform,background,border-color] duration-150 cursor-pointer',
        'focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] outline-none',
        'disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100',
      ].join(' ')}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={label}
    >
      <Icon className="w-[18px] h-[18px]" />
    </button>
  )
}
