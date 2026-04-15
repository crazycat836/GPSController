import React, { useEffect } from 'react'
import { Search } from 'lucide-react'
import AddressSearch from '../AddressSearch'
import { useSimContext } from '../../contexts/SimContext'

interface SearchModalProps {
  open: boolean
  onClose: () => void
}

const SearchModal: React.FC<SearchModalProps> = ({ open, onClose }) => {
  const { handleTeleport } = useSimContext()

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[1000] bg-black/40 backdrop-blur-sm flex justify-center"
      onClick={onClose}
    >
      <div
        className="mt-[15vh] w-[min(600px,85vw)] h-fit bg-[var(--color-glass-heavy)] backdrop-blur-2xl border border-[var(--color-border)] rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--color-border)]">
          <Search className="w-4 h-4 text-[var(--color-text-3)]" />
          <span className="text-sm text-[var(--color-text-3)]">Search address...</span>
        </div>
        <div className="p-4">
          <AddressSearch
            onSelect={(lat, lng) => {
              handleTeleport(lat, lng)
              onClose()
            }}
          />
        </div>
      </div>
    </div>
  )
}

export default SearchModal
