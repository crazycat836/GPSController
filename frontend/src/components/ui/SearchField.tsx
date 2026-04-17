import { Search, X } from 'lucide-react'
import { ICON_SIZE } from '../../lib/icons'

interface SearchFieldProps {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  ariaLabel?: string
  clearLabel?: string
  autoFocus?: boolean
  className?: string
}

// Pill-shaped search field with left icon + inline clear button.
// Uses the same surface + border as ListRow so they sit together visually.
export default function SearchField({
  value,
  onChange,
  placeholder,
  ariaLabel,
  clearLabel = 'Clear',
  autoFocus,
  className,
}: SearchFieldProps) {
  return (
    <div className={['search-field', className].filter(Boolean).join(' ')}>
      <Search
        className="search-field-icon"
        width={ICON_SIZE.sm}
        height={ICON_SIZE.sm}
        aria-hidden="true"
      />
      <input
        type="text"
        className="search-field-input"
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
      />
      {value && (
        <button
          type="button"
          className="search-field-clear"
          onClick={() => onChange('')}
          aria-label={clearLabel}
          title={clearLabel}
        >
          <X width={ICON_SIZE.xs} height={ICON_SIZE.xs} />
        </button>
      )}
    </div>
  )
}
