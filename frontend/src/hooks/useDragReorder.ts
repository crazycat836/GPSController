import { useCallback } from 'react'
import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type SensorDescriptor,
  type SensorOptions,
} from '@dnd-kit/core'
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable'

/** Panel lists: 8px activation distance prevents accidental drag on a tap. */
const PANEL_ACTIVATION_DISTANCE_PX = 8

interface ReorderSensorOptions {
  /** Pointer-sensor activation distance in px. */
  activationDistance?: number
  /** Include the keyboard sensor (panel lists do; compact dialogs don't). */
  keyboard?: boolean
}

/**
 * Shared dnd-kit sensor setup for every sortable list in the app.
 * `useSensors` filters null descriptors, so the keyboard sensor can be
 * excluded without breaking the rules of hooks.
 */
export function useReorderSensors(
  options: ReorderSensorOptions = {},
): SensorDescriptor<SensorOptions>[] {
  const { activationDistance = PANEL_ACTIVATION_DISTANCE_PX, keyboard = true } = options
  const pointer = useSensor(PointerSensor, {
    activationConstraint: { distance: activationDistance },
  })
  const keyboardSensor = useSensor(KeyboardSensor, {
    coordinateGetter: sortableKeyboardCoordinates,
  })
  return useSensors(pointer, keyboard ? keyboardSensor : null)
}

/**
 * Drag-to-reorder plumbing shared by the panel lists and the category
 * manager: sensors + an onDragEnd that maps the drop back onto `list`,
 * applies `arrayMove`, and hands the resulting id order to `onCommit`
 * (fire-and-forget — persistence/error handling lives with the caller).
 *
 * `list` may be null while reorder mode is off (BookmarksPanel renders the
 * DndContext only in reorder mode but the hook must run unconditionally).
 */
export function useDragReorder<T>(
  list: readonly T[] | null,
  getId: (item: T) => string,
  onCommit: (orderedIds: string[]) => void | Promise<unknown>,
  sensorOptions?: ReorderSensorOptions,
): { sensors: SensorDescriptor<SensorOptions>[]; handleDragEnd: (event: DragEndEvent) => void } {
  const sensors = useReorderSensors(sensorOptions)

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    if (!list) return
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = list.findIndex((item) => getId(item) === active.id)
    const newIndex = list.findIndex((item) => getId(item) === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    const next = arrayMove([...list], oldIndex, newIndex)
    void onCommit(next.map(getId))
  }, [list, getId, onCommit])

  return { sensors, handleDragEnd }
}
