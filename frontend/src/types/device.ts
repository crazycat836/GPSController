/**
 * Device domain model shared by the services layer (`services/deviceApi`)
 * and the hooks layer (`hooks/device/parsers`, `hooks/useDevice`). Lives in
 * a neutral module so neither layer has to import the other for types.
 */
export interface DeviceInfo {
  udid: string
  name: string
  ios_version: string
  connection_type: string
  is_connected: boolean
  /** Raw toggle state — usually not needed by the frontend. Consume
   *  `can_reveal_developer_mode` instead. */
  developer_mode_enabled?: boolean | null
  /** True when all preconditions for the AMFI "Reveal Developer Mode"
   *  action are met (connected, USB, iOS 16+, toggle OFF). */
  can_reveal_developer_mode?: boolean
}
