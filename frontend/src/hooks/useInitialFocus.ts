import { useEffect, type RefObject } from 'react'
import { FOCUSABLE_SELECTOR } from './useFocusTrap'

// Small delay so the surface has painted (and any enter animation has
// started) before focus moves — focusing a not-yet-laid-out node is a no-op.
const FOCUS_DELAY_MS = 50

/**
 * Move keyboard focus into a modal-style surface when it opens, so the
 * focus trap engages and focus doesn't stay on the trigger behind it.
 *
 * Target resolution: *targetRef* when given (e.g. a specific button),
 * else the first focusable descendant of *containerRef*, else the
 * container itself. Focus restoration on close is `useModalDismiss`'s job.
 */
export function useInitialFocus(
  open: boolean,
  containerRef: RefObject<HTMLElement | null>,
  targetRef?: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => {
      const explicit = targetRef?.current
      if (explicit) { explicit.focus(); return }
      const container = containerRef.current
      if (!container) return
      ;(container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ?? container).focus()
    }, FOCUS_DELAY_MS)
    return () => clearTimeout(timer)
  }, [open, containerRef, targetRef])
}
