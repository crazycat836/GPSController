/**
 * Copy `text` to the OS clipboard. Returns `true` on success.
 *
 * Tries the modern async Clipboard API first; falls back to a
 * hidden-textarea + `execCommand('copy')` shim for older browsers
 * (and for non-secure contexts where `navigator.clipboard` is gated).
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // fall through to legacy textarea path
  }

  try {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
