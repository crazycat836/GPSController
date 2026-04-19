import React, { useMemo, useState } from 'react'
import { BookOpen, Upload, Download, FileUp } from 'lucide-react'
import { useBookmarkContext } from '../../contexts/BookmarkContext'
import { useSimContext } from '../../contexts/SimContext'
import { useT } from '../../i18n'
import { ICON_SIZE } from '../../lib/icons'
import { pickFile, downloadUrl } from '../../lib/fileIo'
import Drawer from '../shell/Drawer'
import PanelTabs, { panelPropsForTab, type PanelTab } from '../ui/PanelTabs'
import BookmarksPanel from '../library/BookmarksPanel'
import RoutesPanel from '../library/RoutesPanel'

interface LibraryDrawerProps {
  open: boolean
  onClose: () => void
}

type TabId = 'bookmarks' | 'routes'

function LibraryDrawer({ open, onClose }: LibraryDrawerProps) {
  const t = useT()
  const bm = useBookmarkContext()
  const sim = useSimContext()

  const [activeTab, setActiveTab] = useState<TabId>('bookmarks')

  const savedRoutes = bm.savedRoutes as readonly { id: string }[]
  const currentPosition = sim.sim.currentPosition
    ? { lat: sim.sim.currentPosition.lat, lng: sim.sim.currentPosition.lng }
    : null

  const tabs: PanelTab<TabId>[] = [
    { id: 'bookmarks', label: t('panel.bookmarks_count'), count: bm.bookmarks.length },
    { id: 'routes', label: t('panel.routes_count'), count: savedRoutes.length },
  ]

  const activeCategoryCount = bm.categories.length
  const libSubtitle = `${bm.bookmarks.length} ${t('panel.bookmarks_count').toLowerCase()} · ${activeCategoryCount} ${t('bm.manage_categories').toLowerCase()}`

  // Tab-aware header icon buttons — matches the design's 3-icon cluster
  // (Import / Export / Close) in the library drawer header.
  const headerActions = useMemo(() => {
    if (activeTab === 'bookmarks') {
      return (
        <>
          <IconBtnSm
            label={t('bm.import')}
            onClick={async () => {
              const f = await pickFile('application/json,.json')
              if (f) void bm.handleBookmarkImport(f)
            }}
            icon={<Upload width={ICON_SIZE.sm} height={ICON_SIZE.sm} />}
          />
          <IconBtnSm
            label={t('bm.export')}
            disabled={bm.bookmarks.length === 0}
            onClick={() => downloadUrl(bm.bookmarkExportUrl, 'bookmarks.json')}
            icon={<Download width={ICON_SIZE.sm} height={ICON_SIZE.sm} />}
          />
        </>
      )
    }
    // Routes tab
    return (
      <>
        <IconBtnSm
          label={t('panel.route_gpx_import')}
          onClick={async () => {
            const f = await pickFile('.gpx,application/gpx+xml')
            if (f) void bm.handleGpxImport(f)
          }}
          icon={<FileUp width={ICON_SIZE.sm} height={ICON_SIZE.sm} />}
        />
        <IconBtnSm
          label={t('panel.routes_import_all')}
          onClick={async () => {
            const f = await pickFile('.json,application/json')
            if (f) void bm.handleRoutesImportAll(f)
          }}
          icon={<Upload width={ICON_SIZE.sm} height={ICON_SIZE.sm} />}
        />
        <IconBtnSm
          label={t('panel.routes_export_all')}
          disabled={savedRoutes.length === 0}
          onClick={() => downloadUrl(bm.routesExportAllUrl, 'gpscontroller-routes.json')}
          icon={<Download width={ICON_SIZE.sm} height={ICON_SIZE.sm} />}
        />
      </>
    )
  }, [activeTab, t, bm, savedRoutes.length])

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Library"
      subtitle={libSubtitle}
      icon={<BookOpen className="w-[18px] h-[18px]" />}
      width="w-[min(480px,100vw)]"
      headerActions={headerActions}
    >
      <div className="px-4 pt-3 pb-1">
        <PanelTabs
          tabs={tabs}
          activeId={activeTab}
          onChange={setActiveTab}
          ariaLabel={t('panel.library')}
        />
      </div>

      {activeTab === 'bookmarks' ? (
        <div {...panelPropsForTab('bookmarks')}>
          <BookmarksPanel
            onBookmarkClick={(lat, lng) => { sim.handleTeleport(lat, lng); onClose() }}
            currentPosition={currentPosition}
          />
        </div>
      ) : (
        <div {...panelPropsForTab('routes')}>
          <RoutesPanel onRouteLoaded={onClose} />
        </div>
      )}
    </Drawer>
  )
}

// ─── Small glass icon button for the drawer header — matches the
// design's .icon-btn-sm (34×34 rounded-10). Shares a single
// disabled/hover treatment with the close button next to it.

interface IconBtnSmProps {
  icon: React.ReactNode
  label: string
  onClick?: () => void
  disabled?: boolean
}

function IconBtnSm({ icon, label, onClick, disabled }: IconBtnSmProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={[
        'w-[34px] h-[34px] rounded-[10px] grid place-items-center',
        'text-[var(--color-text-2)] hover:text-[var(--color-text-1)]',
        'bg-white/[0.04] hover:bg-white/[0.08]',
        'border border-[var(--color-border)]',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        'transition-colors duration-150 cursor-pointer',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]',
      ].join(' ')}
    >
      {icon}
    </button>
  )
}

export default LibraryDrawer
