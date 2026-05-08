import { type RefObject, useEffect } from 'react'

/**
 * Calls `onOutside` when a `pointerdown` lands outside the referenced
 * element. Standardised on `pointerdown` (rather than `mousedown`) so the
 * dismissal also fires for touch and pen input — Electron windows on a
 * touchscreen wouldn't close otherwise. Same `event.target` semantics
 * across all input types.
 *
 * Pass `when = false` to temporarily detach the listener (e.g. for popovers
 * that are conditionally mounted but want to suspend dismissal during a
 * modal handover).
 */
export function useOutsideClick(
  ref: RefObject<HTMLElement | null>,
  onOutside: () => void,
  when = true,
): void {
  useEffect(() => {
    if (!when) return
    const handler = (e: PointerEvent) => {
      const el = ref.current
      if (el && !el.contains(e.target as Node)) onOutside()
    }
    document.addEventListener('pointerdown', handler)
    return () => document.removeEventListener('pointerdown', handler)
  }, [ref, onOutside, when])
}
