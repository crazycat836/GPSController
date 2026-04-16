/** Device slot labels and colors for dual-device mode (max 2). */
export const DEVICE_LETTERS = ['A', 'B'] as const
export const DEVICE_COLORS = ['var(--color-device-a)', 'var(--color-device-b)'] as const

/**
 * Raw hex values for contexts that cannot use CSS variables
 * (e.g., Leaflet map markers, SVG inline attributes).
 */
export const DEVICE_COLORS_HEX = ['#4285f4', '#ff9800'] as const

export type DeviceLetter = (typeof DEVICE_LETTERS)[number]
