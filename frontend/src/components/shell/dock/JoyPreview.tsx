import { useSimContext } from '../../../contexts/SimContext'
import JoystickPad from '../../JoystickPad'

// Interactive joystick pad rendered in the dock-meta column when joystick
// mode is active. Drag or WASD/arrow keys → drives the device in real time
// (the underlying pad component owns input handling). Replaces what was
// previously a decorative SVG mock-up.
export default function JoyPreview() {
  const { joystick } = useSimContext()
  return (
    <div className="mt-3.5 flex justify-center">
      <JoystickPad
        size={84}
        direction={joystick.direction}
        intensity={joystick.intensity}
        onMove={joystick.updateFromPad}
        onRelease={() => joystick.updateFromPad(0, 0)}
      />
    </div>
  )
}
