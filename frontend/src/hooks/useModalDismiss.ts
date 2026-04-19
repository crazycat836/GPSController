import { useEffect, useRef } from 'react'

interface UseModalDismissOptions {
  /** Whether the dialog / drawer is currently open. */
  open: boolean
  /** Called when Esc is pressed while open. */
  onDismiss: () => void
  /** When true, swallow Esc (don't dismiss). Use while a blocking
   *  async action is mid-flight — e.g. a Confirm's "busy" state. */
  busy?: boolean
}

/**
 * Shared keyboard-dismiss + focus-restore plumbing for modal-shaped
 * surfaces (drawers, dialogs).
 *
 * - Captures the `document.activeElement` on open so focus returns
 *   to the previous control on close.
 * - Binds Escape → `onDismiss` while open.
 *
 * Focus placement inside the dialog is *not* handled here — callers
 * decide where to move focus (first tab, textarea, confirm button).
 */
export function useModalDismiss({ open, onDismiss, busy = false }: UseModalDismissOptions): void {
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    previousFocusRef.current = document.activeElement as HTMLElement | null
    return () => {
      previousFocusRef.current?.focus?.()
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        e.preventDefault()
        onDismiss()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, busy, onDismiss])
}
