/** Device slot labels and colors for dual-device mode (max 2). */
export const DEVICE_LETTERS = ['A', 'B'] as const
export const DEVICE_COLORS = ['var(--color-device-a)', 'var(--color-device-b)'] as const

/**
 * Raw hex values for contexts that cannot use CSS variables
 * (e.g., Leaflet map markers, SVG inline attributes).
 *
 * These mirror the `--color-*` tokens in `styles/tokens.css`.
 * Keep the two in sync — see DESIGN.md §2 for the canonical names.
 */
export const DEVICE_COLORS_HEX = ['#4285f4', '#ff9800'] as const

/** Waypoint marker palette — mirrors `--color-marker-*` in tokens.css. */
export const MARKER_HEX = {
  start: '#43a047',
  startInner: '#2e7d32',
  end: '#fb8c00',
  endInner: '#ef6c00',
} as const

/** Primary accent — mirrors `--color-accent`. Used for Leaflet polyline
 *  strokes that bypass CSS. */
export const ACCENT_HEX = '#6c8cff'

export type DeviceLetter = (typeof DEVICE_LETTERS)[number]

/** Network defaults — no imports to avoid circular dependency chains. */
export const API_HOST = '127.0.0.1:8777'
export const API_BASE = `http://${API_HOST}`
export const WS_BASE = `ws://${API_HOST}/ws/status`
export const DEFAULT_TUNNEL_PORT = 49152

/** Simulation defaults. */
export const DEFAULT_PAUSE = { enabled: true, min: 5, max: 20 } as const
export const DEFAULT_RANDOM_WALK_RADIUS = 500
export const DEFAULT_WP_GEN_RADIUS = 300

/** Random-walk radius preset rail (metres). Shared by BottomDock and RandomWalkPanel. */
export const RADIUS_PRESETS = [200, 500, 1000, 2000] as const

/**
 * Retry backoff for `fetchWithRetry` in `services/api.ts`.
 * Used only when the connection itself fails (e.g. backend not yet up).
 * Schedule per attempt `i`: min(INITIAL + i * STEP, MAX).
 */
export const RETRY_BACKOFF_INITIAL_MS = 500
export const RETRY_BACKOFF_STEP_MS = 300
export const RETRY_BACKOFF_MAX_MS = 2000

/**
 * Minimum on-screen time for the "Clearing virtual location…" toast in
 * `SimContext.handleRestore`. Restore can complete in <100ms on a healthy
 * USB link; the user wouldn't see the toast at all otherwise.
 */
export const RESTORE_MIN_DISPLAY_MS = 1200

/**
 * Settle delay between the group-mode pre-sync teleport fan-out and the
 * follow-up action (navigate / loop / etc.). Lets each engine finalise the
 * teleport before the next command arrives. See `useSimulation.preSyncStart`.
 */
export const PRE_SYNC_SETTLE_MS = 150
