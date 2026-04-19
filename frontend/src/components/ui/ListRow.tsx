import React, { forwardRef } from 'react'

export type ListRowDensity = 'md' | 'compact'
export type ListRowVariant = 'card' | 'flat'

interface ListRowBaseProps {
  leading?: React.ReactNode
  title: React.ReactNode
  subtitle?: React.ReactNode
  meta?: React.ReactNode
  trailing?: React.ReactNode
  density?: ListRowDensity
  variant?: ListRowVariant
  selected?: boolean
  disabled?: boolean
  monoSubtitle?: boolean
  className?: string
}

type AsButton = ListRowBaseProps & {
  as: 'button'
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'title'>

type AsDiv = ListRowBaseProps & {
  as?: 'div'
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'title'>

type ListRowProps = AsButton | AsDiv

// Composed row used by Bookmark / Route / Device lists.
// Anatomy (left → right):
//   [leading] [body: title/subtitle] [meta (w/ pill divider)] [trailing]
// Styling lives in .list-row* classes — visual tokens stay in one place.
const ListRow = forwardRef<HTMLElement, ListRowProps>(function ListRow(props, ref) {
  const {
    leading,
    title,
    subtitle,
    meta,
    trailing,
    density = 'md',
    variant = 'card',
    selected,
    disabled,
    monoSubtitle,
    className,
    as,
    ...rest
  } = props as ListRowBaseProps & { as?: 'div' | 'button' } & Record<string, unknown>

  const classes = [
    'list-row',
    variant === 'flat' ? 'list-row--flat' : '',
    density === 'compact' ? 'list-row--compact' : '',
    as === 'button' ? 'list-row--button' : '',
    selected ? 'list-row--selected' : '',
    disabled ? 'list-row--disabled' : '',
    className ?? '',
  ].filter(Boolean).join(' ')

  const content = (
    <>
      {leading && <span className="list-row-leading">{leading}</span>}
      <div className="list-row-body">
        <div className="list-row-title">{title}</div>
        {subtitle != null && (
          <div className={[
            'list-row-subtitle',
            monoSubtitle ? 'list-row-subtitle-mono' : '',
          ].filter(Boolean).join(' ')}>{subtitle}</div>
        )}
      </div>
      {meta != null && <span className="list-row-meta">{meta}</span>}
      {trailing != null && <span className="list-row-trailing">{trailing}</span>}
    </>
  )

  if (as === 'button') {
    // Render as div + role="button" instead of a real <button> so the
    // trailing slot can host real interactive controls (kebab menus,
    // hover-reveal action buttons) without triggering React's
    // `validateDOMNesting(<button> cannot appear as a descendant of
    // <button>)` warning. Keyboard activation (Enter / Space) is
    // preserved with onKeyDown so AT users keep the "click the row"
    // affordance.
    const { onKeyDown: userKeyDown, onClick: userClick, ...restNoKeys } =
      rest as React.HTMLAttributes<HTMLDivElement> & { onClick?: React.MouseEventHandler<HTMLElement> }
    return (
      <div
        ref={ref as React.Ref<HTMLDivElement>}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || undefined}
        className={classes}
        onClick={(e) => {
          if (disabled) return
          userClick?.(e as unknown as React.MouseEvent<HTMLElement>)
        }}
        onKeyDown={(e) => {
          (userKeyDown as React.KeyboardEventHandler<HTMLDivElement> | undefined)?.(e)
          if (disabled || e.defaultPrevented) return
          if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
            e.preventDefault()
            userClick?.(e as unknown as React.MouseEvent<HTMLElement>)
          }
        }}
        {...(restNoKeys as React.HTMLAttributes<HTMLDivElement>)}
      >
        {content}
      </div>
    )
  }
  return (
    <div
      ref={ref as React.Ref<HTMLDivElement>}
      className={classes}
      aria-disabled={disabled || undefined}
      {...(rest as React.HTMLAttributes<HTMLDivElement>)}
    >
      {content}
    </div>
  )
})

export default ListRow
