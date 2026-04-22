/** Centralized localStorage key constants. */
export const STORAGE_KEYS = {
  lang: 'gpscontroller.lang',
  tileLayer: 'gpscontroller.tile_layer',
  straightLine: 'gpscontroller.straight_line',
  tunnelIp: 'gpscontroller.tunnel.ip',
  tunnelPort: 'gpscontroller.tunnel.port',
  pauseMultiStop: 'gpscontroller.pause.multi_stop',
  pauseLoop: 'gpscontroller.pause.loop',
  pauseRandomWalk: 'gpscontroller.pause.random_walk',
  updateDismissed: 'gpscontroller.update_check.dismissed',
  // Avatar keys pre-date the gpscontroller.* prefix convention; keep the
  // original literals so existing users don't lose their selected avatar
  // on upgrade.
  avatarSelection: 'gpsController.avatarSelection',
  avatarCustom: 'gpsController.avatarCustom',
} as const
