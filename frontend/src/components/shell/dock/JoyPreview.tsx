import { useT } from '../../../i18n'

const KEY_HINTS = ['W', 'A', 'S', 'D', 'Shift'] as const

// Decorative joystick preview shown in the dock when Joystick mode
// is active. The live, interactive pad is `JoystickPad` rendered over
// the map; this is a static visual cue plus keyboard hints.
export default function JoyPreview() {
  const t = useT()
  return (
    <div
      className="mt-3.5 flex gap-3.5 items-center p-3.5 rounded-xl border border-[var(--color-border)]"
      style={{ background: 'rgba(255,255,255,0.03)' }}
    >
      <div
        className="w-[84px] h-[84px] shrink-0 rounded-full relative"
        style={{
          background: 'var(--gradient-joystick-base)',
          border: '1px solid var(--color-border-strong)',
          boxShadow: 'var(--shadow-joystick-base)',
        }}
        aria-hidden="true"
      >
        <span
          className="absolute inset-[14px] rounded-full"
          style={{
            background: 'var(--gradient-joystick-knob)',
            boxShadow: 'var(--shadow-joystick-knob)',
          }}
        />
        <span
          className="absolute left-1/2 top-1/2 w-1.5 h-1.5 rounded-full"
          style={{
            transform: 'translate(-50%,-50%)',
            background: 'var(--color-accent)',
            boxShadow: '0 0 10px var(--color-accent)',
          }}
        />
      </div>
      <div className="flex-1">
        <div className="text-[13px] font-medium text-[var(--color-text-1)]">
          {t('joy.drag_or_keys')}
        </div>
        <div className="text-[12px] text-[var(--color-text-3)] mt-1 leading-[1.5]">
          {t('panel.joystick_hint')}
        </div>
        <div className="inline-flex gap-[3px] mt-2">
          {KEY_HINTS.map((k) => (
            <kbd
              key={k}
              className={[
                'font-mono text-[10px] px-[6px] py-[2px] rounded',
                'border border-[var(--color-border)]',
                'text-[var(--color-text-2)]',
              ].join(' ')}
              style={{ background: 'rgba(255,255,255,0.05)' }}
            >
              {k}
            </kbd>
          ))}
        </div>
      </div>
    </div>
  )
}
