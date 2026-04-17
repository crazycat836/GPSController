import React from 'react'

/**
 * StatusPill — shared shell for status-bar family chips.
 *
 * All visual treatment (height, padding, radius, border, shadow, font size)
 * lives on the `.status-pill` CSS class so MiniStatusBar, DeviceChip, and
 * any future chip stay in lockstep without each re-declaring the tokens.
 *
 * Renders a `<div>` by default. Pass `as="button"` for clickable chips.
 * All standard HTML attributes forward to the underlying element.
 */
type PillElement = 'div' | 'button'

type PillPropsFor<T extends PillElement> = {
  as?: T
  className?: string
  children: React.ReactNode
} & Omit<React.ComponentPropsWithoutRef<T>, 'className' | 'children'>

function StatusPillInner<T extends PillElement = 'div'>(
  { as, className, children, ...rest }: PillPropsFor<T>,
  ref: React.Ref<HTMLElement>,
): React.ReactElement {
  const Tag = (as ?? 'div') as React.ElementType
  const isInteractive = as === 'button'
  const classes = [
    'status-pill',
    isInteractive ? 'status-pill-interactive' : '',
    className ?? '',
  ].filter(Boolean).join(' ')
  return (
    <Tag ref={ref} className={classes} {...rest}>
      {children}
    </Tag>
  )
}

const StatusPill = React.forwardRef(StatusPillInner) as <T extends PillElement = 'div'>(
  props: PillPropsFor<T> & { ref?: React.Ref<HTMLElement> },
) => React.ReactElement

export default StatusPill
