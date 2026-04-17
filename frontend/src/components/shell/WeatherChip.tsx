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

interface WeatherChipProps {
  snapshot: WeatherSnapshot | null
  size?: number
}

const ICON_MAP: Record<WeatherIcon, React.ComponentType<{ className?: string }>> = {
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

const WeatherChip: React.FC<WeatherChipProps> = ({ snapshot, size = 14 }) => {
  if (!snapshot) return null
  const Icon = ICON_MAP[snapshot.icon] ?? Cloud
  const motionCls = ICON_MOTION[snapshot.icon] ?? ''
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] text-[var(--color-text-2)]"
      title={`${Math.round(snapshot.temperatureC)}°C`}
      aria-label={`Weather ${Math.round(snapshot.temperatureC)} degrees Celsius`}
    >
      <Icon className={`weather-chip-icon ${motionCls}`} />
      <span className="font-mono">{Math.round(snapshot.temperatureC)}°</span>
      <style>{`.weather-chip-icon { width: ${size}px; height: ${size}px; }`}</style>
    </span>
  )
}

export default WeatherChip
