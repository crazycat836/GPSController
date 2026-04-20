import React, { useCallback, useState } from 'react'
import { Copy, Check, Smartphone, Usb, Wifi, MapPinOff } from 'lucide-react'
import { useSimContext } from '../../contexts/SimContext'
import { useDeviceContext } from '../../contexts/DeviceContext'
import { useI18n, useT } from '../../i18n'
import { useReverseGeocode } from '../../hooks/useReverseGeocode'
import { useWeather } from '../../hooks/useWeather'
import WeatherChip from './WeatherChip'
import { DEVICE_COLORS, DEVICE_LETTERS } from '../../lib/constants'
import type { DeviceInfo } from '../../hooks/useDevice'

// Status pair — top-left stack matching redesign/Home:
//   1. Device pill(s)       glass-pill-medium, 0.82 alpha
//   2. Live-position card   feature card with LAT/LNG rows + SIM badge
//   3. Location + weather   glass-chip with flag + country + temp
// Dual-device mode hides the live-pos card and stacks two device pills,
// each carrying its own inline coordinate.
export default function MiniStatusBar() {
  const t = useT()
  const { lang } = useI18n()
  const { currentPos, isRunning } = useSimContext()
  const device = useDeviceContext()
  const { countryCode, country } = useReverseGeocode(currentPos, lang, { paused: isRunning })
  const weather = useWeather(currentPos, { paused: isRunning })

  const isDual = device.connectedDevices.length >= 2
  const isConnected = device.connectedDevices.length > 0

  return (
    <div
      data-fc="status.mini-bar"
      // `fixed` + `top: 76px; left: 16px` per redesign/Home spec;
      // max-width keeps the live-pos card from stretching arbitrarily
      // wide on large viewports.
      className="fixed top-[76px] left-4 z-[var(--z-ui)] flex flex-col items-start gap-2 max-w-[288px] w-[288px]"
      aria-label={t('shell.status_aria')}
    >
      {/* Device pill(s) — placeholder when none connected */}
      {!isConnected ? (
        <div
          className="glass-pill-medium inline-flex items-center gap-2.5 h-10 px-4 text-[12px] font-medium"
          title={t('status.disconnected')}
        >
          <Smartphone className="w-4 h-4 text-[var(--color-text-3)] shrink-0" />
          <span className="text-[var(--color-text-2)]">{t('device.no_device')}</span>
        </div>
      ) : isDual ? (
        <DualDevicePills devices={device.connectedDevices.slice(0, 2)} />
      ) : (
        <DevicePill dev={device.connectedDevices[0]} letter={DEVICE_LETTERS[0]} color={DEVICE_COLORS[0]} />
      )}

      {/* Live-position card — suppressed in dual-device mode because
          each pill already carries its own coord. */}
      {!isDual && <LivePosCard currentPos={currentPos} isRunning={isRunning} />}

      {/* Location + weather chip — slim, secondary info. Hidden entirely
          when we have no position and no country data to show. */}
      {!isDual && (currentPos || countryCode || weather) && (
        <LocationWeatherChip
          hasPos={currentPos != null}
          countryCode={countryCode}
          country={country}
          weather={weather}
        />
      )}
    </div>
  )
}

// ─── Device pill ──────────────────────────────────────────────

interface DevicePillProps {
  dev: DeviceInfo | undefined
  letter: typeof DEVICE_LETTERS[number]
  color: string
  coord?: { lat: number; lng: number } | null
}

function DevicePill({ dev, letter, color, coord }: DevicePillProps) {
  if (!dev) return null
  const isNetwork = dev.connection_type === 'Network'
  return (
    <div
      className="glass-pill-medium inline-flex items-center gap-2.5 h-10 pl-2 pr-4 text-[12px] font-medium"
      title={dev.name}
    >
      <span
        className="w-6 h-6 rounded-full grid place-items-center text-[11px] font-bold"
        style={{
          background: color,
          color: 'var(--color-surface-0)',
          boxShadow: 'inset 0 0 0 2px rgba(0,0,0,0.15)',
        }}
        aria-hidden="true"
      >
        {letter}
      </span>
      <div className="flex flex-col leading-tight min-w-0">
        <span className="text-[12px] font-medium text-[var(--color-text-1)] truncate max-w-[150px]">
          {dev.name}
        </span>
        {coord && (
          <span className="font-mono text-[10px] text-[var(--color-text-3)]">
            {coord.lat.toFixed(4)}, {coord.lng.toFixed(4)}
          </span>
        )}
      </div>
      <span className="w-px h-4 bg-[var(--color-border-strong)] shrink-0" aria-hidden="true" />
      <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-[var(--color-success-text)] shrink-0">
        <span
          className="w-1.5 h-1.5 rounded-full bg-[var(--color-success-text)]"
          style={{ boxShadow: '0 0 6px var(--color-success-text)' }}
          aria-hidden="true"
        />
        {isNetwork
          ? <><Wifi className="w-2.5 h-2.5" />Wi-Fi</>
          : <><Usb className="w-2.5 h-2.5" />USB</>}
      </span>
    </div>
  )
}

function DualDevicePills({ devices }: { devices: DeviceInfo[] }) {
  const { sim } = useSimContext()
  return (
    <>
      {devices.map((dev, i) => (
        <DevicePill
          key={dev.udid}
          dev={dev}
          letter={DEVICE_LETTERS[i]}
          color={DEVICE_COLORS[i]}
          coord={sim.runtimes[dev.udid]?.currentPos ?? null}
        />
      ))}
    </>
  )
}

// ─── Live-position card ───────────────────────────────────────

interface LivePosCardProps {
  currentPos: { lat: number; lng: number } | null
  isRunning: boolean
}

function LivePosCard({ currentPos, isRunning }: LivePosCardProps) {
  const t = useT()
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    if (!currentPos) return
    const txt = `${currentPos.lat.toFixed(6)}, ${currentPos.lng.toFixed(6)}`
    navigator.clipboard.writeText(txt).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [currentPos])

  const hasPos = currentPos != null
  const simState = isRunning ? 'running' : 'idle'

  return (
    <div
      data-fc="status.live-pos"
      className="live-pos w-full"
      data-has-pos={hasPos ? 'true' : 'false'}
      data-sim={simState}
      aria-label={t('status.virtual_position')}
    >
      <div className="lp-head">
        <span className="lp-eyebrow">
          <span className="dot" aria-hidden="true" />
          <span>{t('status.virtual_position')}</span>
        </span>
        <span className="lp-sim">SIM</span>
        <button
          type="button"
          onClick={handleCopy}
          className="lp-copy cursor-pointer disabled:cursor-not-allowed"
          aria-label={t('status.copy_coord')}
          title={t('status.copy_coord')}
          disabled={!hasPos}
        >
          {copied
            ? <Check className="w-3 h-3" strokeWidth={2.5} />
            : <Copy className="w-3 h-3" strokeWidth={2} />}
        </button>
      </div>

      {hasPos ? (
        <div className="lp-coords">
          <div className="lp-coord-row">
            <span className="axis">LAT</span>
            <span className="val tabular-nums">{currentPos!.lat.toFixed(6)}</span>
            <span className="unit">°N</span>
          </div>
          <div className="lp-coord-row">
            <span className="axis">LNG</span>
            <span className="val tabular-nums">{currentPos!.lng.toFixed(6)}</span>
            <span className="unit">°E</span>
          </div>
        </div>
      ) : (
        <div className="lp-no-pos">
          <MapPinOff className="shrink-0" strokeWidth={1.5} />
          <div className="hint">
            <strong>{t('status.no_position_title')}</strong>
            <span>{t('status.no_position_hint')}</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Location + weather chip ──────────────────────────────────

interface LocationWeatherChipProps {
  hasPos: boolean
  countryCode: string | null
  country: string | null
  weather: ReturnType<typeof useWeather>
}

function LocationWeatherChip({ hasPos, countryCode, country, weather }: LocationWeatherChipProps) {
  const t = useT()

  // "No location" fallback when we have a position but the geocoder hasn't
  // returned a country yet (or has failed) — mirrors the design empty state.
  if (!hasPos || (!countryCode && !weather)) {
    return (
      <div className="glass-chip w-full justify-start inline-flex items-center gap-2 h-8 px-3 text-[11px] italic">
        <MapPinOff className="w-3 h-3 shrink-0" strokeWidth={1.5} />
        <span>{t('status.no_location')}</span>
      </div>
    )
  }

  return (
    <div className="glass-chip w-full justify-start inline-flex items-center gap-2.5 h-8 px-3 text-[11px]">
      {countryCode && (
        <>
          <img
            src={`https://flagcdn.com/w40/${countryCode}.png`}
            alt={countryCode.toUpperCase()}
            width={16}
            height={12}
            className="rounded-[2px] shadow-[0_0_0_1px_rgba(255,255,255,0.08)] shrink-0"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
          />
          {country && (
            <span className="text-[var(--color-text-1)] font-medium truncate max-w-[120px]">
              {country}
            </span>
          )}
        </>
      )}
      {countryCode && weather && (
        <span
          className="w-[3px] h-[3px] rounded-full bg-[var(--color-text-3)] shrink-0"
          aria-hidden="true"
        />
      )}
      {weather && <WeatherChip snapshot={weather} size={14} />}
    </div>
  )
}
