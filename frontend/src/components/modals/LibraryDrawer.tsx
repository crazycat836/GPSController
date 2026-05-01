import React, { useMemo, useState } from 'react'
import { BookOpen, Upload, Download, FileUp } from 'lucide-react'
import { useBookmarkContext } from '../../contexts/BookmarkContext'
import { useSimContext } from '../../contexts/SimContext'
import { useT } from '../../i18n'
import { ICON_SIZE } from '../../lib/icons'
import { pickFile } from '../../lib/fileIo'
import Drawer from '../shell/Drawer'
import PanelTabs, { panelPropsForTab, type PanelTab } from '../ui/PanelTabs'
import GlassIconButton from '../ui/GlassIconButton'
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

  const libSubtitle = `${t('bm.bookmarks_count_label', { n: bm.bookmarks.length })} · ${t('bm.places_count', { n: bm.places.length })} · ${t('bm.tags_count', { n: bm.tags.length })}`

  // Tab-aware header icon buttons — matches the design's 3-icon cluster
  // (Import / Export / Close) in the library drawer header.
  const headerActions = useMemo(() => {
    if (activeTab === 'bookmarks') {
      return (
        <>
          <GlassIconButton
            label={t('bm.import')}
            onClick={async () => {
              const f = await pickFile('application/json,.json')
              if (f) void bm.handleBookmarkImport(f)
            }}
            icon={<Upload width={ICON_SIZE.sm} height={ICON_SIZE.sm} />}
          />
          <GlassIconButton
            label={t('bm.export')}
            disabled={bm.bookmarks.length === 0}
            onClick={() => { void bm.handleBookmarkExport() }}
            icon={<Download width={ICON_SIZE.sm} height={ICON_SIZE.sm} />}
          />
        </>
      )
    }
    // Routes tab
    return (
      <>
        <GlassIconButton
          label={t('panel.route_gpx_import')}
          onClick={async () => {
            const f = await pickFile('.gpx,application/gpx+xml')
            if (f) void bm.handleGpxImport(f)
          }}
          icon={<FileUp width={ICON_SIZE.sm} height={ICON_SIZE.sm} />}
        />
        <GlassIconButton
          label={t('panel.routes_import_all')}
          onClick={async () => {
            const f = await pickFile('.json,application/json')
            if (f) void bm.handleRoutesImportAll(f)
          }}
          icon={<Upload width={ICON_SIZE.sm} height={ICON_SIZE.sm} />}
        />
        <GlassIconButton
          label={t('panel.routes_export_all')}
          disabled={savedRoutes.length === 0}
          onClick={() => { void bm.handleRoutesExportAll() }}
          icon={<Download width={ICON_SIZE.sm} height={ICON_SIZE.sm} />}
        />
      </>
    )
  }, [activeTab, t, bm, savedRoutes.length])

  return (
    <Drawer
      data-fc="drawer.library"
      open={open}
      onClose={onClose}
      title={t('panel.library')}
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

export default LibraryDrawer
