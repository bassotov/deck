import { useRef, useState } from 'react'
import type { ImageEl, InkEl } from '../types'
import { boundsOf, boxFromDrag, boxesIntersect, resizeImage, translateEl } from '../lib/ink'

/**
 * Dragging an element and resizing an image are mutually exclusive — one
 * discriminated union so the type system enforces that rather than discipline.
 */
export type Interaction =
  | { mode: 'idle' }
  | { mode: 'dragging'; ids: string[]; dx: number; dy: number }
  | { mode: 'resizing'; id: string; w: number; h: number }

const IDLE: Interaction = { mode: 'idle' }

interface Args {
  selecting: boolean
  elements: InkEl[]
  selectedIds: string[]
  onSelect: (ids: string[]) => void
  onUpdate: (el: InkEl) => void
  /** Batch commit — a group drag moves several elements but must land as one
   *  history entry, whether the group has one member or ten. */
  onUpdateMany: (els: InkEl[]) => void
  toStage: (clientX: number, clientY: number) => [number, number]
}

/** Existing-element manipulation for the cursor tool: drag to move (solo or as a
 *  group), grip to resize, marquee to select on empty canvas. */
export function useSelectionInteraction({
  selecting,
  elements,
  selectedIds,
  onSelect,
  onUpdate,
  onUpdateMany,
  toStage,
}: Args) {
  const [interaction, setInteraction] = useState<Interaction>(IDLE)
  const dragFrom = useRef<[number, number]>([0, 0])

  /** Set at pointerdown when Shift/Cmd is held on an element; resolved at
   *  pointerup once we know whether the gesture was a click or a drag — see
   *  onElUp for why the toggle can't just happen immediately. */
  const pendingToggle = useRef<{ id: string; wasSelected: boolean } | null>(null)

  /* ------------------------------------------------------- select & move */

  const onElDown = (e: React.PointerEvent<SVGGElement>, el: InkEl) => {
    if (!selecting || e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragFrom.current = toStage(e.clientX, e.clientY)

    const already = selectedIds.includes(el.id)
    const toggle = e.shiftKey || e.metaKey

    if (toggle) {
      // Shift/Cmd-click toggles this element's membership — but only if the
      // gesture turns out to be a click rather than a drag. Toggling now would
      // either collapse the rest of the selection before we know, or (worse)
      // immediately drag a member the user is trying to remove.
      pendingToggle.current = { id: el.id, wasSelected: already }
    } else {
      pendingToggle.current = null
      // Dragging a member of the current selection moves the whole group;
      // pressing an unselected element (no Shift) collapses to just it, as today.
      if (!already) onSelect([el.id])
    }

    // The set that moves if this becomes a drag: the full selection when the
    // press landed on one of its members, otherwise just the pressed element.
    setInteraction({ mode: 'dragging', ids: already ? selectedIds : [el.id], dx: 0, dy: 0 })
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

  const onElUp = (e: React.PointerEvent<SVGGElement>) => {
    if (interaction.mode !== 'dragging') return
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    const { ids, dx, dy } = interaction
    const toggle = pendingToggle.current
    pendingToggle.current = null

    if (Math.hypot(dx, dy) > 1) {
      // A real drag: move every dragged element together and skip the toggle
      // entirely — a drag is not a click, so Shift's other meaning doesn't apply.
      const moved = elements.filter((el) => ids.includes(el.id)).map((el) => translateEl(el, dx, dy))
      onUpdateMany(moved)
    } else if (toggle) {
      onSelect(
        toggle.wasSelected
          ? selectedIds.filter((id) => id !== toggle.id)
          : [...selectedIds, toggle.id],
      )
    }
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

  /* -------------------------------------------------------------- marquee */

  /** The box being dragged out, in stage-space corners — normalized to x/y/w/h
   *  only at read time, since which corner is "from" depends on drag direction. */
  const [marquee, setMarquee] = useState<{ from: [number, number]; to: [number, number] } | null>(
    null,
  )
  /** Shift at marquee-start: adds to the existing selection instead of replacing it. */
  const marqueeAdditive = useRef(false)

  const onBackdropDown = (e: React.PointerEvent<SVGRectElement>) => {
    if (!selecting || e.button !== 0) return
    // Stops this from bubbling to `.stage`'s onPointerDown, which clears the
    // selection unconditionally on any press — that would wipe an additive
    // (Shift) marquee's starting selection before the drag even begins.
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = toStage(e.clientX, e.clientY)
    marqueeAdditive.current = e.shiftKey
    setMarquee({ from: p, to: p })
  }

  const onBackdropMove = (e: React.PointerEvent<SVGRectElement>) => {
    if (!marquee) return
    const p = toStage(e.clientX, e.clientY)
    setMarquee((m) => (m ? { ...m, to: p } : m))
  }

  const onBackdropUp = (e: React.PointerEvent<SVGRectElement>) => {
    if (!marquee) return
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    const box = boxFromDrag(marquee.from, marquee.to)
    setMarquee(null)

    // Too small to have been a deliberate drag — reads as a plain click on
    // empty canvas. Only clears when it isn't additive: a stray Shift-click
    // shouldn't wipe out the selection the user was trying to add to.
    if (Math.max(box.w, box.h) < 4) {
      if (!marqueeAdditive.current) onSelect([])
      return
    }

    const hits = elements.filter((el) => boxesIntersect(boundsOf(el), box)).map((el) => el.id)
    onSelect(marqueeAdditive.current ? [...new Set([...selectedIds, ...hits])] : hits)
  }

  const marqueeBox = marquee ? boxFromDrag(marquee.from, marquee.to) : null

  return {
    interaction,
    onElDown,
    onElMove,
    onElUp,
    onSizeDown,
    onSizeMove,
    onSizeUp,
    marqueeBox,
    onBackdropDown,
    onBackdropMove,
    onBackdropUp,
  }
}
