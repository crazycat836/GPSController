/**
 * Dev-only console helpers. Production (packaged Electron) has no
 * attached DevTools, so these short-circuit outside `import.meta.env.DEV`.
 *
 * Two flavours:
 *   - `devLog`  → `console.error` for genuine faults / unexpected state.
 *   - `devWarn` → `console.warn`  for recoverable / informational lines
 *                 (failed scans, transient connect retries) so they don't
 *                 light up red + trigger the DevTools error overlay.
 */
export function devLog(...args: unknown[]): void {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.error(...args)
  }
}

export function devWarn(...args: unknown[]): void {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.warn(...args)
  }
}
