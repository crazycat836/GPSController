import { useState, useEffect, useCallback, useRef } from 'react'

interface JoystickInput {
  direction: number
  intensity: number
}

export function useJoystick(
  sendWsMessage: (type: string, data: JoystickInput) => void,
  active: boolean,
) {
  const [direction, setDirection] = useState(0)
  const [intensity, setIntensity] = useState(0)
  const sendRef = useRef(sendWsMessage)

  useEffect(() => {
    sendRef.current = sendWsMessage
  }, [sendWsMessage])

  const emitState = useCallback((dir: number, int: number) => {
    setDirection(dir)
    setIntensity(int)
    sendRef.current('joystick_input', { direction: dir, intensity: int })
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
