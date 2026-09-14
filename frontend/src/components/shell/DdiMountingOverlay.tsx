import { useT } from '../../i18n'

interface DdiMountingOverlayProps {
  /** Which step the backend reported via `ddi_mounting`. */
  stage: 'downloading' | 'mounting'
  /** True when this mount began with a download, so mounting reads as step 2. */
  afterDownload: boolean
  takingLong: boolean
  onCancel: () => void
}

// Full-screen "preparing device" overlay shown while the Developer Disk
// Image is downloaded (first use / after an update) and mounted. The two
// stages get their own copy: a slow download is a network problem, a slow
// mount is a phone/link problem, and the user can act on each differently.
export default function DdiMountingOverlay({ stage, afterDownload, takingLong, onCancel }: DdiMountingOverlayProps) {
  const t = useT()
  const downloading = stage === 'downloading'
  const step = downloading ? 1 : afterDownload ? 2 : null

  return (
    <div
      role="status"
      aria-live="polite"
      className="absolute inset-0 z-[var(--z-overlay)] bg-[rgba(20,22,32,0.85)] backdrop-blur-[3px] flex items-center justify-center"
    >
      <div className="surface-popup rounded-2xl px-7 py-5 max-w-[420px] text-center">
        <svg
          width="32" height="32" viewBox="0 0 24 24" fill="none"
          stroke="#a78bfa" strokeWidth="2"
          className="animate-spin mx-auto mb-2.5"
          aria-hidden
        >
          <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="16" />
        </svg>
        {step != null && (
          <div className="text-[11px] text-[var(--color-text-3)] mb-1">
            {t('ddi.step', { n: step })}
          </div>
        )}
        <div className="text-sm font-semibold mb-1.5 text-[var(--color-text-1)]">
          {t(downloading ? 'ddi.downloading_title' : 'ddi.mounting_title')}
        </div>
        <div className="text-xs text-[var(--color-text-2)] leading-relaxed">
          {t(downloading ? 'ddi.downloading_hint' : 'ddi.mounting_hint')}
        </div>
        {takingLong && (
          <>
            <div className="text-xs text-[var(--color-text-3)] leading-relaxed mt-2.5">
              {t(downloading ? 'ddi.taking_long_download' : 'ddi.taking_long')}
            </div>
            <button
              type="button"
              onClick={onCancel}
              className="mt-3 inline-flex items-center justify-center h-8 px-4 rounded-lg text-[12px] font-medium text-[var(--color-text-2)] hover:text-[var(--color-text-1)] cursor-pointer transition-colors"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid var(--color-border)' }}
            >
              {t('ddi.cancel')}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
