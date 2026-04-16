import { DeviceChip } from './DeviceChip'
import type { DeviceInfo } from '../hooks/useDevice'
import type { RuntimesMap } from '../hooks/useSimulation'

interface Props {
  devices: DeviceInfo[]
  runtimes: RuntimesMap
  onDisconnect: (udid: string) => void
  onRestoreOne: (udid: string) => void
  onEnableDev?: (udid: string) => void
}

export function DeviceChipRow({ devices, runtimes, onDisconnect, onRestoreOne, onEnableDev }: Props) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 4,
      padding: '6px 10px 8px',
      flexWrap: 'wrap',
    }}>
      {devices.slice(0, 2).map((d, i) => {
        const letter = (i === 0 ? 'A' : 'B') as 'A' | 'B'
        return (
          <DeviceChip
            key={d.udid}
            letter={letter}
            device={d}
            runtime={runtimes[d.udid]}
            onDisconnect={() => onDisconnect(d.udid)}
            onRestoreOne={() => onRestoreOne(d.udid)}
            onEnableDev={onEnableDev ? () => onEnableDev(d.udid) : undefined}
          />
        )
      })}
    </div>
  )
}
