import React, { useCallback, useState } from 'react'
import { Copy, Check, Smartphone, Usb, Wifi, MapPin } from 'lucide-react'
import { useSimContext } from '../../contexts/SimContext'
import { useDeviceContext } from '../../contexts/DeviceContext'
import { useI18n, useT } from '../../i18n'
import { useReverseGeocode } from '../../hooks/useReverseGeocode'
import { useWeather } from '../../hooks/useWeather'
import WeatherChip from './WeatherChip'
import { DEVICE_COLORS, DEVICE_LETTERS } from '../../lib/constants'
import type { DeviceInfo } from '../../hooks/useDevice'

// Status pair — stacked glass-pill chips at the top-left.
// Rows top-to-bottom: device pill(s) → coord chip → flag+weather chip.
// The avatar picker (previously a 4th chip here) now lives inside the
// Settings popover — keeps the status pair focused on passive status
// and moves configuration where users already look for it.
//
// Dual-device mode stacks two device pills A/B, each carrying its own
// live coordinate.
export default function MiniStatusBar() {
  const t = useT()
  const { lang } = useI18n()
  const { currentPos, sim, isRunning } = useSimContext()
  const device = useDeviceContext()
  const { countryCode, country } = useReverseGeocode(currentPos, lang, { paused: isRunning })
  const weather = useWeather(currentPos, { paused: isRunning })

  const [copied, setCopied] = useState(false)

  const isDual = device.connectedDevices.length >= 2
  const isConnected = device.connectedDevices.length > 0

  const handleCopy = useCallback(() => {
    if (!currentPos) return
    const txt = `${currentPos.lat.toFixed(6)}, ${currentPos.lng.toFixed(6)}`
    navigator.clipboard.writeText(txt).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [currentPos])

  // Even when no device is connected we still render a placeholder chip so
  // the top-left "status pair" doesn't appear to vanish. The old bar used
  // an early-return-null; users found it confusing in the redesigned
  // layout because the whole corner went empty on launch.

  return (
    <div
      className="absolute top-[4.25rem] left-3 z-[var(--z-ui)] flex flex-col items-start gap-2 max-w-[300px]"
      aria-label="Status"
    >
      {/* Device pill(s) — placeholder when none connected */}
      {!isConnected ? (
        <div
          className="status-device-pill inline-flex items-center gap-2.5 h-10 px-4 text-[12px] font-medium"
          title={t('status.disconnected')}
        >
          <Smartphone className="w-4 h-4 text-[var(--color-text-3)] shrink-0" />
          <span className="text-[var(--color-text-2)]">{t('device.no_device')}</span>
        </div>
      ) : isDual ? (
        device.connectedDevices.slice(0, 2).map((dev, i) => (
          <DevicePill
            key={dev.udid}
            dev={dev}
            letter={DEVICE_LETTERS[i]}
            color={DEVICE_COLORS[i]}
            coord={sim.runtimes[dev.udid]?.currentPos ?? null}
          />
        ))
      ) : (
        <DevicePill dev={device.connectedDevices[0]} letter={DEVICE_LETTERS[0]} color={DEVICE_COLORS[0]} />
      )}

      {/* Coord chip — lighter weight than device pill, mono for numerics.
          Single-device only (dual-device mode shows coords inline per pill). */}
      {!isDual && currentPos && (
        <div className="status-coord-chip inline-flex items-center gap-2.5 h-8 px-3 text-[11px] font-mono">
          <MapPin className="w-3 h-3 text-[var(--color-text-3)] shrink-0" />
          <span>
            {currentPos.lat.toFixed(5)}°, {currentPos.lng.toFixed(5)}°
          </span>
          <button
            onClick={handleCopy}
            className="w-5 h-5 grid place-items-center rounded text-[var(--color-text-3)] hover:text-[var(--color-accent)] transition-colors cursor-pointer"
            aria-label={t('status.copy_coord')}
            title={t('status.copy_coord')}
          >
            {copied
              ? <Check className="w-3 h-3 text-[var(--color-success-text)]" />
              : <Copy className="w-3 h-3" />}
          </button>
        </div>
      )}

      {/* Location + weather chip — same lighter treatment as the coord chip */}
      {!isDual && (countryCode || weather) && (
        <div className="status-coord-chip inline-flex items-center gap-2.5 h-8 px-3 text-[11px]">
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
              {country && <span className="text-[var(--color-text-1)] font-medium truncate max-w-[120px]">{country}</span>}
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
      )}

    </div>
  )
}

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
      className="status-device-pill inline-flex items-center gap-2.5 h-10 pl-2 pr-4 text-[12px] font-medium"
      title={dev.name}
    >
      {/* Letter avatar */}
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
      {/* Name + (optional inline coord when in dual mode) */}
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
      {/* Connection status */}
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
