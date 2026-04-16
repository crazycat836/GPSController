import { SimMode } from '../hooks/useSimulation'
import type { StringKey } from '../i18n'

/** Device slot labels and colors for dual-device mode (max 2). */
export const DEVICE_LETTERS = ['A', 'B'] as const
export const DEVICE_COLORS = ['var(--color-device-a)', 'var(--color-device-b)'] as const

/**
 * Raw hex values for contexts that cannot use CSS variables
 * (e.g., Leaflet map markers, SVG inline attributes).
 */
export const DEVICE_COLORS_HEX = ['#4285f4', '#ff9800'] as const

export type DeviceLetter = (typeof DEVICE_LETTERS)[number]

/** SimMode → i18n label key mapping (used by FloatingPanel, MiniStatusBar, StatusBar). */
export const MODE_LABEL_KEYS: Record<SimMode, StringKey> = {
  [SimMode.Teleport]: 'mode.teleport',
  [SimMode.Navigate]: 'mode.navigate',
  [SimMode.Loop]: 'mode.loop',
  [SimMode.MultiStop]: 'mode.multi_stop',
  [SimMode.RandomWalk]: 'mode.random_walk',
  [SimMode.Joystick]: 'mode.joystick',
}

/** Network defaults. */
export const API_HOST = '127.0.0.1:8777'
export const API_BASE = `http://${API_HOST}`
export const WS_BASE = `ws://${API_HOST}/ws/status`
export const DEFAULT_TUNNEL_PORT = 49152

/** Simulation defaults. */
export const DEFAULT_PAUSE = { enabled: true, min: 5, max: 20 } as const
export const DEFAULT_RANDOM_WALK_RADIUS = 500
export const DEFAULT_WP_GEN_RADIUS = 300
