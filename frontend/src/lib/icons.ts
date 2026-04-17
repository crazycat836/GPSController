// Canonical icon size tokens. Use these instead of ad-hoc w-3.5 h-3.5.
// Sizes match the pill typography scale: 12px for micro, 14px for inline,
// 16px for standard row/leading slots, 20px for empty-state / hero.
export const ICON_SIZE = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
} as const

export type IconSize = keyof typeof ICON_SIZE
