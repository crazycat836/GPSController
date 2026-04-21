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
 * and PauseControl. 36×20 pill with a 16×16 sliding thumb — matches
 * `.toggle-switch` in DESIGN.md §4. `--color-accent` when on, `white/10`
 * when off.
 *
 * Thumb is anchored at `left-[2px]` rather than relying on the default
 * auto-position so `translate-x-[16px]` lands cleanly at (18, 2) in the
 * checked state (2px inset on each side of the 36px track).
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
        'relative w-9 h-5 rounded-full shrink-0 transition-colors',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        checked ? 'bg-[var(--color-accent)]' : 'bg-white/10',
      ].join(' ')}
    >
      <span
        className={[
          'absolute top-[2px] left-[2px] w-4 h-4 rounded-full bg-white transition-transform',
          checked ? 'translate-x-[16px]' : 'translate-x-0',
        ].join(' ')}
      />
    </button>
  )
}
