import React, { useCallback, useState } from 'react'
import { Copy, Check, Smartphone, Usb, Wifi, MapPinOff } from 'lucide-react'
import { useSimContext } from '../../contexts/SimContext'
import { useSimDerived } from '../../contexts/SimDerivedContext'
import { useDeviceContext } from '../../contexts/DeviceContext'
import { useConnectionHealth } from '../../contexts/ConnectionHealthContext'
import { useI18n, useT } from '../../i18n'
import { useReverseGeocode } from '../../hooks/useReverseGeocode'
import { useWeather } from '../../hooks/useWeather'
import WeatherChip from './WeatherChip'
import { DEVICE_COLORS, DEVICE_LETTERS } from '../../lib/constants'
import type { DeviceInfo } from '../../hooks/useDevice'
import { copyToClipboard } from '../../lib/clipboard'

// Status pair — top-left stack matching redesign/Home:
//   1. Device pill(s)       glass-pill-medium, 0.82 alpha
//   2. Live-position card   feature card with LAT/LNG rows + SIM badge
//   3. Location + weather   glass-chip with flag + country + temp
// Dual-device mode hides the live-pos card and stacks two device pills,
// each carrying its own inline coordinate.
export default function MiniStatusBar() {
  const t = useT()
  const { lang } = useI18n()
  const { sim } = useSimContext()
  const { currentPos, isRunning } = useSimDerived()
  const device = useDeviceContext()
  const health = useConnectionHealth()
  const { countryCode, country } = useReverseGeocode(currentPos, lang, { paused: isRunning })
  const weather = useWeather(currentPos, { paused: isRunning })

  // The dot indicator should reflect "is the iPhone currently showing a
  // virtual location" — true after any teleport / navigate / loop / etc.
  // push, not only while a continuous mode is actively moving. `isRunning`
  // alone covers continuous modes (Loop / MultiStop / RandomWalk /
  // Navigate / Joystick), so a stationary teleport would leave the dot
  // grey even though the phone is showing a fake coord. backendPositionSynced
  // is the right signal: set true on any successful push, set false only
  // when the user explicitly hits Restore (real GPS restored).
  const isSimulating = sim.backendPositionSynced

  const isDual = device.connectedDevices.length >= 2
  const isConnected = device.connectedDevices.length > 0
  // Device state we render is only as fresh as the WS stream. When the
  // transport is down, we still show the last-known pill (so the user
  // isn't yanked out of context on a flap) — but dimmed and annotated
  // so they don't act on it.
  const isStale = health.device === 'stale'

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
        <DualDevicePills devices={device.connectedDevices.slice(0, 2)} stale={isStale} />
      ) : (
        <DevicePill
          dev={device.connectedDevices[0]}
          letter={DEVICE_LETTERS[0]}
          color={DEVICE_COLORS[0]}
          stale={isStale}
          degraded={!!sim.runtimes[device.connectedDevices[0]?.udid ?? '']?.tunnelDegraded}
        />
      )}

      {/* Live-position card — suppressed in dual-device mode because
          each pill already carries its own coord. Marked stale when
          the WS transport is down: the displayed lat/lng is no fresher
          than the device pill's "stale" annotation, so dimming both
          keeps the user's mental model consistent. */}
      {!isDual && <LivePosCard currentPos={currentPos} isSimulating={isSimulating} stale={isStale} />}

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
  stale?: boolean
  /** True while a `tunnel_degraded` is outstanding for this device — the
   *  DVT channel is reconnecting. Orthogonal to `stale` (which is about
   *  the WS transport between renderer and backend, not the renderer-
   *  to-iPhone tunnel). Both can be true simultaneously; the tooltip
   *  prefers `degraded` because that's the user-actionable state. */
  degraded?: boolean
}

function DevicePill({ dev, letter, color, coord, stale, degraded }: DevicePillProps) {
  const t = useT()
  if (!dev) return null
  const isNetwork = dev.connection_type === 'Network'
  const titleText = degraded
    ? `${dev.name} · ${t('device.chip_state_reconnecting')}`
    : stale
      ? `${dev.name} · ${t('conn.stale_tooltip')}`
      : dev.name
  return (
    <div
      className="glass-pill-medium inline-flex items-center gap-2.5 h-10 pl-2 pr-4 text-[12px] font-medium transition-opacity"
      title={titleText}
      data-stale={stale ? 'true' : undefined}
      data-degraded={degraded ? 'true' : undefined}
      style={stale ? { opacity: 0.55 } : undefined}
    >
      <span
        className="w-6 h-6 rounded-full grid place-items-center text-[11px] font-semibold"
        style={{
          background: color,
          color: 'var(--color-surface-0)',
          boxShadow: 'var(--shadow-avatar-ring-dark)',
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
      <span
        className="inline-flex items-center gap-1.5 font-mono text-[10px] shrink-0"
        style={{
          color: degraded ? 'var(--color-device-paused)' : 'var(--color-success-text)',
        }}
      >
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{
            background: degraded ? 'var(--color-device-paused)' : 'var(--color-success-text)',
            boxShadow: degraded
              ? '0 0 6px var(--color-device-paused)'
              : '0 0 6px var(--color-success-text)',
            animation: degraded ? 'chip-pulse 1.6s ease-in-out infinite' : undefined,
          }}
          aria-hidden="true"
        />
        {degraded
          ? t('device.chip_state_reconnecting')
          : isNetwork
            ? <><Wifi className="w-2.5 h-2.5" />Wi-Fi</>
            : <><Usb className="w-2.5 h-2.5" />USB</>}
      </span>
    </div>
  )
}

function DualDevicePills({ devices, stale }: { devices: DeviceInfo[]; stale?: boolean }) {
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
          stale={stale}
          degraded={!!sim.runtimes[dev.udid]?.tunnelDegraded}
        />
      ))}
    </>
  )
}

// ─── Live-position card ───────────────────────────────────────

interface LivePosCardProps {
  currentPos: { lat: number; lng: number } | null
  /** Whether the iPhone is currently showing a virtual location — true
   *  after any teleport / navigate / loop / etc. push, false only after
   *  the user hits Restore. Drives the green dot indicator. */
  isSimulating: boolean
  stale?: boolean
}

function LivePosCard({ currentPos, isSimulating, stale }: LivePosCardProps) {
  const t = useT()
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    if (!currentPos) return
    const txt = `${currentPos.lat.toFixed(6)}, ${currentPos.lng.toFixed(6)}`
    void copyToClipboard(txt).then((ok) => {
      if (!ok) return
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [currentPos])

  const hasPos = currentPos != null
  // CSS contract: `data-sim="running"` lights the dot green + pulses;
  // `"idle"` greys it out. See styles/components/glass.css:79, 118.
  const simState = isSimulating ? 'running' : 'idle'

  return (
    <div
      data-fc="status.live-pos"
      className="live-pos w-full transition-opacity"
      data-has-pos={hasPos ? 'true' : 'false'}
      data-sim={simState}
      data-stale={stale ? 'true' : undefined}
      style={stale ? { opacity: 0.55 } : undefined}
      title={stale ? t('conn.stale_tooltip') : undefined}
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
