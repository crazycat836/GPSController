import { MapPin } from 'lucide-react'

// Glass-pill brand chip shown in the top-left. Logo badge + product name.
// Mirrors the redesign/Home aesthetic — translucent surface that reads
// against any map tile beneath it.
export default function Brand() {
  return (
    <div className="glass-pill inline-flex items-center gap-2.5 h-11 pl-2 pr-4">
      <div
        className="w-[22px] h-[22px] rounded-md grid place-items-center text-[var(--color-surface-0)]"
        style={{
          background: 'linear-gradient(135deg, var(--color-accent) 0%, var(--color-accent-strong) 100%)',
          boxShadow: 'var(--shadow-glow)',
        }}
        aria-hidden="true"
      >
        <MapPin className="w-[13px] h-[13px]" strokeWidth={2.5} />
      </div>
      <span className="text-[13px] font-semibold tracking-[-0.01em]">
        GPSController
      </span>
    </div>
  )
}
