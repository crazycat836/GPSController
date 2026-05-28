import { useState, useEffect, useCallback, useRef } from 'react'

interface JoystickInput {
  direction: number
  intensity: number
  sensitivity?: number
}

export function useJoystick(
  sendWsMessage: (type: string, data: JoystickInput) => void,
  active: boolean,
  sensitivity = 1,
) {
  const [direction, setDirection] = useState(0)
  const [intensity, setIntensity] = useState(0)
  const sendRef = useRef(sendWsMessage)
  // Track sensitivity in a ref so the latest value rides along with each
  // input without re-creating the (stable) emitState callback.
  const sensitivityRef = useRef(sensitivity)

  useEffect(() => {
    sendRef.current = sendWsMessage
  }, [sendWsMessage])
  useEffect(() => {
    sensitivityRef.current = sensitivity
  }, [sensitivity])

  const emitState = useCallback((dir: number, int: number) => {
    setDirection(dir)
    setIntensity(int)
    sendRef.current('joystick_input', {
      direction: dir,
      intensity: int,
      sensitivity: sensitivityRef.current,
    })
  }, [])

  // Reset state when joystick mode exits, so a re-entry starts clean.
  useEffect(() => {
    if (!active) {
      setDirection(0)
      setIntensity(0)
    }
  }, [active])

  // JoystickPad owns the keyboard + pointer input. We just receive
  // normalized (direction, intensity) updates here and fan them out via
  // WS. A duplicate window keyboard listener here would make every WASD
  // press emit twice.
  const updateFromPad = useCallback(
    (dir: number, int: number) => {
      emitState(dir, Math.min(1, Math.max(0, int)))
    },
    [emitState],
  )

  return { direction, intensity, updateFromPad }
}
