import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import { Rabbit, Dog, Cat, Bird, User, UserRound, type LucideIcon } from 'lucide-react'

export type AvatarPresetKey = 'rabbit' | 'dog' | 'cat' | 'bird' | 'boy' | 'girl'

export interface AvatarPreset {
  key: AvatarPresetKey
  labelKey: string  // i18n key
  Icon: LucideIcon
  /** Pre-rendered SVG string with stroke currentColor at 28px, used for
   *  Leaflet divIcon HTML. The consumer sets the wrapper's text color. */
  svg28: string
}

const SIZE = 28

function renderIcon(Icon: LucideIcon): string {
  // currentColor lets the outer CSS pick the tint; strokeWidth 2 matches
  // lucide's default which reads cleanly at this size.
  return renderToStaticMarkup(
    React.createElement(Icon, { size: SIZE, color: 'currentColor', strokeWidth: 2 }),
  )
}

export const AVATAR_PRESETS: readonly AvatarPreset[] = [
  { key: 'rabbit', labelKey: 'avatar.rabbit', Icon: Rabbit, svg28: renderIcon(Rabbit) },
  { key: 'dog', labelKey: 'avatar.dog', Icon: Dog, svg28: renderIcon(Dog) },
  { key: 'cat', labelKey: 'avatar.cat', Icon: Cat, svg28: renderIcon(Cat) },
  { key: 'bird', labelKey: 'avatar.bird', Icon: Bird, svg28: renderIcon(Bird) },
  { key: 'boy', labelKey: 'avatar.boy', Icon: User, svg28: renderIcon(User) },
  { key: 'girl', labelKey: 'avatar.girl', Icon: UserRound, svg28: renderIcon(UserRound) },
]

export const DEFAULT_AVATAR_KEY: AvatarPresetKey = 'boy'

export function getPresetSvg(key: AvatarPresetKey): string {
  return AVATAR_PRESETS.find((p) => p.key === key)?.svg28 ?? AVATAR_PRESETS[0].svg28
}
