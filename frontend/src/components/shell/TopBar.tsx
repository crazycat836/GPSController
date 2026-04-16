import React from 'react'
import { Search, Bookmark, Settings } from 'lucide-react'
import { useT } from '../../i18n'

interface TopBarProps {
  leftContent?: React.ReactNode
  onSearchClick?: () => void
  onLibraryClick?: () => void
  onSettingsClick?: () => void
}

export default function TopBar({ leftContent, onSearchClick, onLibraryClick, onSettingsClick }: TopBarProps) {
  const t = useT()

  return (
    <div className="fixed top-3 left-3 right-3 z-[1001] flex items-center justify-between pointer-events-none">
      {/* Left: device chips */}
      <div className="pointer-events-auto">
        {leftContent}
      </div>

      {/* Right: tool buttons */}
      <div className="pointer-events-auto flex items-center gap-1.5">
        <ToolButton icon={Search} label={t('panel.address_search')} shortcut="⌘K" onClick={onSearchClick} />
        <ToolButton icon={Bookmark} label={t('panel.library')} shortcut="⌘B" onClick={onLibraryClick} />
        <ToolButton icon={Settings} label={t('settings.title')} onClick={onSettingsClick} data-settings-trigger />
      </div>
    </div>
  )
}

interface ToolButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.FC<{ className?: string }>
  label: string
  shortcut?: string
}

function ToolButton({ icon: Icon, label, shortcut, ...rest }: ToolButtonProps) {
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
      ].join(' ')}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={label}
    >
      <Icon className="w-4 h-4" />
    </button>
  )
}
