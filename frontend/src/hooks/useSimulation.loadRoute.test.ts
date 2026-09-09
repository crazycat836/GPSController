// @vitest-environment jsdom
/**
 * Tests for loading a saved route into the Route (Loop) editor.
 *
 * `setMode` deliberately clears staged waypoints when leaving Teleport,
 * which makes "switch mode + stage waypoints" ordering-sensitive: points
 * staged before the mode switch get wiped by the clear. `loadRouteWaypoints`
 * exists so route-load has one explicit action (raw mode setter + staging,
 * same as the internal start-handlers) that can't be broken by call order.
 */

import { renderHook, act, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SimMode, useSimulation } from './useSimulation'

afterEach(cleanup)

const WPS = [
  { lat: 25.0, lng: 121.5 },
  { lat: 25.01, lng: 121.51 },
]

describe('loadRouteWaypoints', () => {
  it('switches Teleport → Loop and stages the waypoints in one action', () => {
    const { result } = renderHook(() => useSimulation())

    expect(result.current.mode).toBe(SimMode.Teleport)
    act(() => { result.current.loadRouteWaypoints(WPS) })

    expect(result.current.mode).toBe(SimMode.Loop)
    expect(result.current.waypoints).toEqual(WPS)
  })

  it('replaces previously staged waypoints when already in a route mode', () => {
    const { result } = renderHook(() => useSimulation())

    act(() => { result.current.loadRouteWaypoints(WPS) })
    const next = [{ lat: 24.9, lng: 121.4 }]
    act(() => { result.current.loadRouteWaypoints(next) })

    expect(result.current.mode).toBe(SimMode.Loop)
    expect(result.current.waypoints).toEqual(next)
  })

  it('staging waypoints before setMode(Loop) loses them to the mode-switch clear (why loadRouteWaypoints exists)', () => {
    const { result } = renderHook(() => useSimulation())

    act(() => {
      result.current.setWaypoints(WPS)
      result.current.setMode(SimMode.Loop)
    })

    expect(result.current.waypoints).toEqual([])
  })
})
