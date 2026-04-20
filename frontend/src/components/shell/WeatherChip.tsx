import React from 'react'
import {
  Sun,
  Cloud,
  CloudSun,
  CloudFog,
  CloudRain,
  CloudSnow,
  CloudLightning,
} from 'lucide-react'
import type { WeatherIcon, WeatherSnapshot } from '../../hooks/useWeather'
import { useT } from '../../i18n'

interface WeatherChipProps {
  snapshot: WeatherSnapshot | null
  size?: number
}

const ICON_MAP: Record<WeatherIcon, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  sun: Sun,
  cloud: Cloud,
  'cloud-sun': CloudSun,
  fog: CloudFog,
  rain: CloudRain,
  snow: CloudSnow,
  thunder: CloudLightning,
}

// Motion hint class — paired with the CSS keyframes in index.css so each
// icon gets a subtle idle animation without any JS per-frame work.
const ICON_MOTION: Record<WeatherIcon, string> = {
  sun: 'weather-anim-spin',
  cloud: 'weather-anim-drift',
  'cloud-sun': 'weather-anim-drift',
  fog: 'weather-anim-drift',
  rain: 'weather-anim-bob',
  snow: 'weather-anim-spin-slow',
  thunder: 'weather-anim-flash',
}

export default function WeatherChip({ snapshot, size = 14 }: WeatherChipProps) {
  const t = useT()
  if (!snapshot) return null
  const Icon = ICON_MAP[snapshot.icon] ?? Cloud
  const motionCls = ICON_MOTION[snapshot.icon] ?? ''
  const temp = Math.round(snapshot.temperatureC)
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] text-[var(--color-text-2)]"
      title={`${temp}°C`}
      aria-label={t('weather.temperature_aria', { t: temp })}
    >
      <Icon className={`weather-chip-icon ${motionCls}`} style={{ width: size, height: size }} />
      <span className="font-mono">{temp}°</span>
    </span>
  )
}
