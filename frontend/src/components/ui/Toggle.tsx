interface ToggleProps {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  ariaLabel?: string
  /** Optional DOM id used by a sibling `<label for>` so clicking the
   *  label also flips the switch. */
  id?: string
}

/**
 * Shared `role="switch"` toggle. Used by SettingsMenu preference rows
 * and PauseControl. 32×18 pill with a sliding dot; `--color-accent`
 * when on, `white/10` when off.
 *
 * Rendered as a real `<button>` so keyboard Enter/Space activation
 * comes for free; aria-checked reflects the bound state.
 */
export default function Toggle({ checked, onChange, disabled, ariaLabel, id }: ToggleProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        'relative w-8 h-[18px] rounded-[9px] shrink-0 transition-colors',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        checked ? 'bg-[var(--color-accent)]' : 'bg-white/10',
      ].join(' ')}
    >
      <span
        className={[
          'absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-transform',
          checked ? 'translate-x-[16px]' : 'translate-x-[2px]',
        ].join(' ')}
      />
    </button>
  )
}
