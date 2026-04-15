import { DeviceChip } from './DeviceChip'
import { useT } from '../i18n'
import type { DeviceInfo } from '../hooks/useDevice'
import type { RuntimesMap } from '../hooks/useSimulation'

interface Props {
  devices: DeviceInfo[]           // connected devices in order (max 2)
  runtimes: RuntimesMap
  onAdd: () => void               // opens add-device picker
  onDisconnect: (udid: string) => void
  onRestoreOne: (udid: string) => void
  onEnableDev?: (udid: string) => void
}

export function DeviceChipRow({ devices, runtimes, onAdd, onDisconnect, onRestoreOne, onEnableDev }: Props) {
  const t = useT()
  const atMax = devices.length >= 2

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
      {!atMax && (
        <button
          onClick={onAdd}
          title={t('device.add_device')}
          className="surface-control"
          style={{
            height: 32, minWidth: 44, padding: '0 12px',
            borderRadius: 'var(--radius-full)',
            color: 'rgba(255,255,255,0.85)',
            fontSize: 12, fontWeight: 500, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 5,
          }}
        >
          <span style={{ fontSize: 15, lineHeight: 1 }}>+</span>
          {devices.length === 0 && <span>{t('device.add_device')}</span>}
        </button>
      )}
    </div>
  )
}
