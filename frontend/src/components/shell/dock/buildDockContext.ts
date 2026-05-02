import { type ChainPoint } from '../../WaypointChain'
import { haversineM, polylineDistanceM } from '../../../lib/geo'
import { SimMode } from '../../../hooks/useSimulation'
import type { useSimContext } from '../../../contexts/SimContext'
import type { useT } from '../../../i18n'

const KM_THRESHOLD_M = 1000
const MIN_PTS_FOR_DIST = 2

type LatLng = { lat: number; lng: number }
type SimSlice = ReturnType<typeof useSimContext>['sim']
type Translator = ReturnType<typeof useT>

export interface DockCtx {
  title: string
  subtitle: string
  chainPoints: ChainPoint[]
  loop: boolean
}

// Build the per-mode meta (title, subtitle, optional waypoint chain)
// rendered in the dock's `panel-meta` column. Pure derivation from
// the live sim slice + positions; no side effects.
export function buildDockContext(
  mode: SimMode,
  sim: SimSlice,
  currentPos: LatLng | null,
  destPos: LatLng | null,
  t: Translator,
): DockCtx {
  const wp = sim.waypoints
  const toChain = (pts: LatLng[]): ChainPoint[] =>
    pts.map((p, i) => ({
      id: `wp-${i}`,
      label: i === 0 ? t('teleport.my_location') : t('panel.waypoint_num', { n: i + 1 }),
      position: p,
    }))

  switch (mode) {
    case SimMode.Teleport:
      return {
        title: destPos
          ? `${destPos.lat.toFixed(5)}°N · ${destPos.lng.toFixed(5)}°E`
          : t('teleport.add_destination'),
        subtitle: t('panel.teleport_hint'),
        chainPoints: [], loop: false,
      }
    case SimMode.Navigate: {
      if (!destPos) {
        return {
          title: t('teleport.add_destination'),
          subtitle: t('panel.navigate_hint'),
          chainPoints: [], loop: false,
        }
      }
      const distM = currentPos ? haversineM(currentPos, destPos) : 0
      const distLabel = formatNavDist(distM)
      return {
        title: `${t('teleport.destination')} · ${distLabel}`,
        subtitle: t('panel.navigate_hint'),
        chainPoints: [], loop: false,
      }
    }
    case SimMode.Loop: {
      const count = wp.length
      const totalDist = count >= MIN_PTS_FOR_DIST
        ? polylineDistanceM(wp) + haversineM(wp[count - 1], wp[0])
        : 0
      return {
        title: count === 0
          ? t('panel.waypoints_none')
          : `${t('mode.loop')} · ${count} ${t('panel.pts_short')}${formatChainDist(totalDist)}`,
        subtitle: count === 0 ? t('panel.waypoints_empty') : t('pause.loop'),
        chainPoints: toChain(wp),
        loop: true,
      }
    }
    case SimMode.MultiStop: {
      const count = wp.length
      const totalDist = count >= MIN_PTS_FOR_DIST ? polylineDistanceM(wp) : 0
      return {
        title: count === 0
          ? t('panel.waypoints_none')
          : `${t('mode.multi_stop')} · ${count} ${t('panel.pts_short')}${formatChainDist(totalDist)}`,
        subtitle: count === 0 ? t('panel.waypoints_empty') : t('pause.multi_stop'),
        chainPoints: toChain(wp),
        loop: false,
      }
    }
    case SimMode.RandomWalk:
      return {
        title: t('mode.random_walk'),
        subtitle: t('pause.random_walk'),
        chainPoints: [], loop: false,
      }
    case SimMode.Joystick:
      return {
        title: t('mode.joystick'),
        subtitle: t('panel.joystick_hint'),
        chainPoints: [], loop: false,
      }
  }
}

function formatNavDist(distM: number): string {
  return distM >= KM_THRESHOLD_M
    ? `${(distM / KM_THRESHOLD_M).toFixed(2)} km`
    : `${Math.round(distM)} m`
}

function formatChainDist(distM: number): string {
  if (distM <= 0) return ''
  return distM >= KM_THRESHOLD_M
    ? ` · ${(distM / KM_THRESHOLD_M).toFixed(1)} km`
    : ` · ${Math.round(distM)} m`
}
