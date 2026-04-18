import React, { useState } from 'react'
import { BookOpen } from 'lucide-react'
import { useBookmarkContext } from '../../contexts/BookmarkContext'
import { useSimContext } from '../../contexts/SimContext'
import { useT } from '../../i18n'
import Drawer from '../shell/Drawer'
import PanelTabs, { panelPropsForTab, type PanelTab } from '../ui/PanelTabs'
import BookmarksPanel from '../library/BookmarksPanel'
import RoutesPanel from '../library/RoutesPanel'

interface LibraryDrawerProps {
  open: boolean
  onClose: () => void
}

type TabId = 'bookmarks' | 'routes'

const LibraryDrawer: React.FC<LibraryDrawerProps> = ({ open, onClose }) => {
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

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Library"
      subtitle={libSubtitle}
      icon={<BookOpen className="w-[18px] h-[18px]" />}
      width="w-[min(480px,100vw)]"
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
