import React from 'react'
import { Smartphone, Bookmark, Settings } from 'lucide-react'
import { useT } from '../../i18n'

interface TopBarActionsProps {
  /** Receives the triggering button element so the popover can anchor to it. */
  onDeviceClick?: (anchor: HTMLElement) => void
  addDeviceDisabled?: boolean
  onLibraryClick?: () => void
  onSettingsClick?: () => void
}

export default function TopBarActions({
  onDeviceClick,
  addDeviceDisabled,
  onLibraryClick,
  onSettingsClick,
}: TopBarActionsProps) {
  const t = useT()

  return (
    <div className="flex items-center gap-2">
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
  icon: React.FC<{ className?: string }>
  label: string
  shortcut?: string
}

function ActionButton({ icon: Icon, label, shortcut, ...rest }: ActionButtonProps) {
  return (
    <button
      {...rest}
      className={[
        'glass-pill w-11 h-11 grid place-items-center',
        'text-[var(--color-text-1)] hover:bg-[var(--color-surface-hover)]',
        'active:scale-95',
        'transition-[transform,background] duration-150 cursor-pointer',
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
