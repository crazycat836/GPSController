import React, { createContext, useContext } from 'react'
import { useDevice } from '../hooks/useDevice'
import type { DeviceInfo } from '../hooks/useDevice'
import { useWebSocketContext } from './WebSocketContext'

// Re-export for consumers
export type { DeviceInfo }

type DeviceHookReturn = ReturnType<typeof useDevice>

const DeviceContext = createContext<DeviceHookReturn | null>(null)

export function DeviceProvider({ children }: { children: React.ReactNode }) {
  const { subscribe } = useWebSocketContext()
  const device = useDevice(subscribe)
  return (
    <DeviceContext.Provider value={device}>
      {children}
    </DeviceContext.Provider>
  )
}

export function useDeviceContext() {
  const ctx = useContext(DeviceContext)
  if (!ctx) throw new Error('useDeviceContext must be used within DeviceProvider')
  return ctx
}
