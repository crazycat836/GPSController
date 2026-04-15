import React from 'react'
import { Timer } from 'lucide-react'
import { useSimContext } from '../../contexts/SimContext'

export default function CooldownBadge() {
  const { cooldown, cooldownEnabled } = useSimContext()

  if (!cooldownEnabled || cooldown <= 0) return null

  const mins = Math.floor(cooldown / 60)
  const secs = cooldown % 60
  const display = mins > 0 ? `${mins}:${secs.toString().padStart(2, '0')}` : `${secs}s`

  return (
    <div
      className={[
        'absolute top-14 left-1/2 -translate-x-1/2 z-[901]',
        'flex items-center gap-2',
        'px-4 py-1.5 rounded-full',
        'bg-[rgba(255,152,0,0.95)] text-[#1a1a1a]',
        'text-xs font-semibold',
        'shadow-[0_2px_8px_rgba(0,0,0,0.35)]',
        'anim-fade-slide-down',
      ].join(' ')}
    >
      <Timer className="w-3.5 h-3.5" />
      <span>Cooldown {display}</span>
    </div>
  )
}
