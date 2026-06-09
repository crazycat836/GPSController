// Electron preload exposes a `gpsController.openExternal` bridge so links
// open in the system browser rather than inside the webview. Web builds
// don't define it; callers fall back to the native `<a target="_blank">`
// navigation (hence the `e.preventDefault()` only on the bridge path).
interface ElectronBridge {
  gpsController?: { openExternal?: (url: string) => void }
}

// Only ever hand http(s) URLs to the Electron shell. `shell.openExternal`
// will happily launch `file:`, `javascript:`, or other handler schemes, so
// an allowlist keeps a future caller that forwards untrusted input (e.g. a
// link from an API response) from turning this into a local-code-execution
// vector. All current callers pass compile-time https constants.
const ALLOWED_SCHEMES = new Set(['http:', 'https:'])

function isSafeExternalUrl(url: string): boolean {
  try {
    return ALLOWED_SCHEMES.has(new URL(url).protocol)
  } catch {
    return false
  }
}

/**
 * Open `url` in the system browser when running under Electron, otherwise
 * let the default anchor navigation proceed. Pass the click event so the
 * default navigation can be suppressed only when the bridge handles it.
 * Non-http(s) URLs are never forwarded to the shell bridge.
 */
export function openExternalOrDefault(url: string, e: React.MouseEvent): void {
  if (!isSafeExternalUrl(url)) return
  const bridge = (window as unknown as ElectronBridge).gpsController
  if (bridge?.openExternal) {
    e.preventDefault()
    bridge.openExternal(url)
  }
}
