import React, { useState, useCallback, useRef } from 'react'
import { Copy, Check } from 'lucide-react'
import { stateToMode, MODE_LABEL_KEYS } from '../../hooks/useSimulation'
import { useSimContext } from '../../contexts/SimContext'
import { useDeviceContext } from '../../contexts/DeviceContext'
import { useAvatarContext } from '../../contexts/AvatarContext'
import { useI18n, useT } from '../../i18n'
import { useReverseGeocode } from '../../hooks/useReverseGeocode'
import { useWeather } from '../../hooks/useWeather'
import WeatherChip from './WeatherChip'
import AvatarPicker from './AvatarPicker'
import StatusPill from './StatusPill'
import { AVATAR_PRESETS } from '../../lib/avatars'
import { DEVICE_COLORS, DEVICE_LETTERS } from '../../lib/constants'

// Muted-tone helper. The base font size + colors come from .status-pill.
const STATUS_TEXT_MUTED = 'opacity-75'

export default function MiniStatusBar() {
  const t = useT()
  const { lang } = useI18n()
  const { currentPos, displaySpeed, sim, isRunning } = useSimContext()
  const device = useDeviceContext()
  // Hold the flag while moving. Reverse-geocode resumes once simulation
  // returns to idle so the country flag reflects the final location.
  const { countryCode, country } = useReverseGeocode(currentPos, lang, {
    paused: isRunning,
  })
  // Pull current-location weather for the single-device chip. Same
  // paused-while-running gate as reverse geocode so we don't hammer
  // Open-Meteo mid-simulation; module-scoped cache keeps a warm value.
  const weather = useWeather(currentPos, { paused: isRunning })
  const avatar = useAvatarContext()
  const [copied, setCopied] = useState(false)
  const [pickerAnchor, setPickerAnchor] = useState<DOMRect | null>(null)
  const avatarBtnRef = useRef<HTMLButtonElement>(null)

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

  if (!isConnected) return null

  const presetKey = avatar.current.kind === 'preset' ? avatar.current.key : null
  const avatarPreset = presetKey
    ? AVATAR_PRESETS.find((p) => p.key === presetKey) ?? AVATAR_PRESETS[0]
    : null
  const AvatarIcon = avatarPreset?.Icon

  return (
    <StatusPill
      // Sits above the BottomModeBar (bottom-3 + 48px pill + gap).
      // Phase 3 will move this stack to the top-left status pair.
      className="absolute bottom-[76px] left-1/2 -translate-x-1/2 z-[var(--z-ui)]"
    >
      {isDual ? (
        device.connectedDevices.slice(0, 2).map((dev, i) => {
          const rt = sim.runtimes[dev.udid]
          const coord = rt?.currentPos
            ? `${rt.currentPos.lat.toFixed(3)},${rt.currentPos.lng.toFixed(3)}`
            : '\u2014'
          const spd = rt?.currentSpeedKmh ? rt.currentSpeedKmh.toFixed(0) : String(displaySpeed)
          const dMode = rt ? stateToMode(rt.state) : null
          const modeLabel = dMode ? t(MODE_LABEL_KEYS[dMode]) : t(MODE_LABEL_KEYS[sim.mode])
          return (
            <React.Fragment key={dev.udid}>
              {i > 0 && <div className="w-px h-4 bg-[var(--color-border)]" />}
              <div className="flex items-center gap-2 font-mono" title={dev.name}>
                <span className="font-bold" style={{ color: DEVICE_COLORS[i] }}>{DEVICE_LETTERS[i]}</span>
                <span>{coord}</span>
                <span className="opacity-40">&middot;</span>
                <span>{spd}km/h</span>
                <span className="opacity-40">&middot;</span>
                <span className="opacity-75">{modeLabel}</span>
              </div>
            </React.Fragment>
          )
        })
      ) : (
        <>
          {countryCode && (
            <>
              <img
                src={`https://flagcdn.com/w40/${countryCode}.png`}
                alt={countryCode.toUpperCase()}
                width={22}
                height={15}
                className="rounded-[3px] shadow-[0_0_0_1px_rgba(255,255,255,0.15)]"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
              />
              {country && <span>{country}</span>}
              <div className="w-px h-4 bg-[var(--color-border)]" />
            </>
          )}
          {weather && (
            <>
              <WeatherChip snapshot={weather} size={16} />
              <div className="w-px h-4 bg-[var(--color-border)]" />
            </>
          )}
          {currentPos && (
            <>
              <span className="font-mono">
                {currentPos.lat.toFixed(5)}, {currentPos.lng.toFixed(5)}
              </span>
              <button
                onClick={handleCopy}
                className="min-h-[32px] min-w-[32px] inline-flex items-center justify-center text-[var(--color-text-3)] hover:text-[var(--color-accent)] transition-colors cursor-pointer"
                aria-label={t('status.copy_coord')}
                title={t('status.copy_coord')}
              >
                {copied
                  ? <Check className="w-4 h-4 text-[var(--color-success-text)]" />
                  : <Copy className="w-4 h-4" />}
              </button>
              <div className="w-px h-4 bg-[var(--color-border)]" />
            </>
          )}
          <span>{displaySpeed} km/h</span>
          <div className="w-px h-4 bg-[var(--color-border)]" />
          <span className={STATUS_TEXT_MUTED}>{t(MODE_LABEL_KEYS[sim.mode])}</span>
          <div className="w-px h-4 bg-[var(--color-border)]" />
          <button
            ref={avatarBtnRef}
            onClick={() => {
              if (pickerAnchor) { setPickerAnchor(null); return }
              const r = avatarBtnRef.current?.getBoundingClientRect()
              if (r) setPickerAnchor(r)
            }}
            className="min-h-[32px] min-w-[32px] inline-flex items-center justify-center rounded-full text-[var(--color-text-2)] hover:text-[var(--color-accent)] hover:bg-white/5 transition-colors cursor-pointer"
            aria-label={t('avatar.picker_title')}
            title={t('avatar.picker_tooltip')}
          >
            {avatar.current.kind === 'custom' && avatar.customDataUrl ? (
              <img src={avatar.customDataUrl} alt="" width={20} height={20} style={{ borderRadius: '50%', objectFit: 'cover' }} />
            ) : AvatarIcon ? (
              <AvatarIcon className="w-[18px] h-[18px]" strokeWidth={2} />
            ) : null}
          </button>
        </>
      )}
      {pickerAnchor && (
        <AvatarPicker anchor={pickerAnchor} onClose={() => setPickerAnchor(null)} />
      )}
    </StatusPill>
  )
}
