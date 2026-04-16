import React from 'react'
import { Smartphone, Bookmark, Settings } from 'lucide-react'
import { useT } from '../../i18n'

interface TopBarActionsProps {
  onAddDevice?: () => void
  addDeviceDisabled?: boolean
  onLibraryClick?: () => void
  onSettingsClick?: () => void
}

export default function TopBarActions({ onAddDevice, addDeviceDisabled, onLibraryClick, onSettingsClick }: TopBarActionsProps) {
  const t = useT()

  return (
    <div className="flex items-center gap-1.5">
      <ActionButton icon={Smartphone} label={t('device.add_device')} onClick={onAddDevice} disabled={addDeviceDisabled} />
      <ActionButton icon={Bookmark} label={t('panel.library')} shortcut="\u2318B" onClick={onLibraryClick} />
      <ActionButton icon={Settings} label={t('settings.title')} onClick={onSettingsClick} data-settings-trigger />
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
        'w-11 h-11 rounded-full flex items-center justify-center',
        'surface-control',
        'text-[var(--color-text-2)] hover:text-[var(--color-text-1)]',
        'hover:bg-[var(--color-surface-hover)] active:scale-95',
        'transition-all duration-150 cursor-pointer',
        'focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] outline-none',
        'disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100',
      ].join(' ')}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={label}
    >
      <Icon className="w-4 h-4" />
    </button>
  )
}
