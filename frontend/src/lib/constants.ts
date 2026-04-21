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
