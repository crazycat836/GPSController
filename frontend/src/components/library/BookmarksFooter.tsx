import { Layers, Plus, Tag as TagIconLucide } from 'lucide-react'
import { useT } from '../../i18n'
import { ICON_SIZE } from '../../lib/icons'

interface BookmarksFooterProps {
  /** Disable all CTAs while batch-selection mode is active. */
  disabled: boolean
  onManagePlaces: () => void
  onManageTags: () => void
  onAdd: () => void
}

const SECONDARY_BTN_CLASS = [
  'inline-flex items-center justify-center gap-1.5 h-11 px-3 rounded-[12px]',
  'text-[12px] font-semibold shrink-0',
  'bg-white/[0.04] border border-[var(--color-border)]',
  'hover:bg-white/[0.08]',
  'disabled:opacity-40 disabled:cursor-not-allowed',
  'transition-colors duration-150 cursor-pointer',
].join(' ')

const PRIMARY_BTN_CLASS = [
  'flex-1 inline-flex items-center justify-center gap-2 h-11 rounded-[12px]',
  'text-[13px] font-semibold',
  'transition-[transform,box-shadow,opacity] duration-150',
  'hover:-translate-y-px',
  'disabled:opacity-40 disabled:cursor-not-allowed disabled:translate-y-0',
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] focus-visible:outline-offset-2',
].join(' ')

const FOOTER_BG = 'linear-gradient(180deg, rgba(15,16,20,0) 0%, rgba(15,16,20,0.96) 30%)'

/**
 * Sticky footer for the bookmarks panel: manage-places, manage-tags, and the
 * primary "Add bookmark" CTA. All actions disable while batch-selection is
 * active so the user finishes/exits selection before changing structure.
 */
export default function BookmarksFooter({
  disabled,
  onManagePlaces,
  onManageTags,
  onAdd,
}: BookmarksFooterProps) {
  const t = useT()
  return (
    <div
      className="sticky bottom-0 left-0 right-0 -mx-4 px-4 pt-4 pb-4 flex gap-2 items-center"
      style={{ background: FOOTER_BG }}
    >
      <button
        type="button"
        onClick={onManagePlaces}
        disabled={disabled}
        className={SECONDARY_BTN_CLASS}
        style={{ color: 'var(--color-text-1)' }}
        title={t('bm.manage_places')}
      >
        <Layers width={ICON_SIZE.sm} height={ICON_SIZE.sm} />
        <span>{t('bm.manage_places')}</span>
      </button>
      <button
        type="button"
        onClick={onManageTags}
        disabled={disabled}
        className={SECONDARY_BTN_CLASS}
        style={{ color: 'var(--color-text-1)' }}
        title={t('bm.manage_tags')}
      >
        <TagIconLucide width={ICON_SIZE.sm} height={ICON_SIZE.sm} />
        <span>{t('bm.manage_tags')}</span>
      </button>
      <button
        type="button"
        onClick={onAdd}
        disabled={disabled}
        className={PRIMARY_BTN_CLASS}
        style={{
          background: 'var(--color-accent)',
          color: 'white',
          boxShadow: 'var(--shadow-glow)',
        }}
      >
        <Plus width={ICON_SIZE.sm} height={ICON_SIZE.sm} strokeWidth={2.5} />
        {t('bm.add')}
      </button>
    </div>
  )
}
