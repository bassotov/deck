import { useRef, useState } from 'react'
import type { ImageEl, InkEl } from '../types'
import { resizeImage, translateEl } from '../lib/ink'

/**
 * Dragging an element and resizing an image are mutually exclusive — one
 * discriminated union so the type system enforces that rather than discipline.
 */
export type Interaction =
  | { mode: 'idle' }
  | { mode: 'dragging'; id: string; dx: number; dy: number }
  | { mode: 'resizing'; id: string; w: number; h: number }

const IDLE: Interaction = { mode: 'idle' }

interface Args {
  selecting: boolean
  onSelect: (ids: string[]) => void
  onUpdate: (el: InkEl) => void
  toStage: (clientX: number, clientY: number) => [number, number]
}

/** Existing-element manipulation for the cursor tool: drag to move, grip to resize. */
export function useSelectionInteraction({ selecting, onSelect, onUpdate, toStage }: Args) {
  const [interaction, setInteraction] = useState<Interaction>(IDLE)
  const dragFrom = useRef<[number, number]>([0, 0])

  /* ------------------------------------------------------- select & move */

  const onElDown = (e: React.PointerEvent<SVGGElement>, el: InkEl) => {
    if (!selecting || e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragFrom.current = toStage(e.clientX, e.clientY)
    onSelect([el.id])
    setInteraction({ mode: 'dragging', id: el.id, dx: 0, dy: 0 })
  }

  const onElMove = (e: React.PointerEvent<SVGGElement>) => {
    if (interaction.mode !== 'dragging') return
    const [x, y] = toStage(e.clientX, e.clientY)
    let dx = x - dragFrom.current[0]
    let dy = y - dragFrom.current[1]
    // Shift constrains the move to one axis — the usual way to keep a row aligned.
    if (e.shiftKey) {
      if (Math.abs(dx) >= Math.abs(dy)) dy = 0
      else dx = 0
    }
    setInteraction((cur) => (cur.mode === 'dragging' ? { ...cur, dx, dy } : cur))
  }

  const onElUp = (e: React.PointerEvent<SVGGElement>, el: InkEl) => {
    if (interaction.mode !== 'dragging') return
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    if (Math.hypot(interaction.dx, interaction.dy) > 1) onUpdate(translateEl(el, interaction.dx, interaction.dy))
    setInteraction(IDLE)
  }

  /* ------------------------------------------------------------- resizing */

  /** The element as it was when the grip was grabbed — the drag is measured
   *  against this, never against the size it is currently being dragged to. */
  const sizeFrom = useRef<ImageEl | null>(null)
  const grabOffset = useRef(0)

  const onSizeDown = (e: React.PointerEvent<SVGRectElement>, el: ImageEl) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const [x] = toStage(e.clientX, e.clientY)
    sizeFrom.current = el
    // Grabbing the grip slightly off-centre shouldn't snap the corner to the cursor.
    grabOffset.current = x - (el.x + el.w)
    setInteraction({ mode: 'resizing', id: el.id, w: el.w, h: el.h })
  }

  const onSizeMove = (e: React.PointerEvent<SVGRectElement>) => {
    const from = sizeFrom.current
    if (interaction.mode !== 'resizing' || !from) return
    const [x] = toStage(e.clientX, e.clientY)
    setInteraction({ mode: 'resizing', id: from.id, ...resizeImage(from, x - grabOffset.current) })
  }

  const onSizeUp = (e: React.PointerEvent<SVGRectElement>) => {
    const from = sizeFrom.current
    if (interaction.mode !== 'resizing' || !from) return
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    const { w, h } = interaction
    sizeFrom.current = null
    setInteraction(IDLE)
    if (w !== from.w) onUpdate({ ...from, w, h })
  }

  return { interaction, onElDown, onElMove, onElUp, onSizeDown, onSizeMove, onSizeUp }
}
