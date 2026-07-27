import { useRef, useState } from 'react'
import type { Box, InkEl } from '../types'
import type { Handle } from '../lib/ink'
import {
  boundsOf,
  boundsOfMany,
  boxFromDrag,
  boxesIntersect,
  resizeBox,
  scaleEl,
  translateEl,
} from '../lib/ink'

/**
 * Dragging a selection and resizing it are mutually exclusive — one
 * discriminated union so the type system enforces that rather than discipline.
 * A resize carries the two boxes rather than a size, because that pair is
 * exactly what `scaleEl` maps every kind of element through.
 */
export type Interaction =
  | { mode: 'idle' }
  | { mode: 'dragging'; ids: string[]; dx: number; dy: number }
  | { mode: 'resizing'; ids: string[]; from: Box; to: Box }

const IDLE: Interaction = { mode: 'idle' }

/**
 * The scaled copy a live resize shows, or the element untouched. A drag previews
 * with a `<g transform>` instead (cheaper for a long freehand path), but a
 * resize can't: a transform would stretch a font's glyphs and skew a stroke's
 * width, where `scaleEl` moves the font size and the width themselves.
 */
export function resizePreview(el: InkEl, interaction: Interaction): InkEl {
  return interaction.mode === 'resizing' && interaction.ids.includes(el.id)
    ? scaleEl(el, interaction.from, interaction.to)
    : el
}

interface Args {
  selecting: boolean
  elements: InkEl[]
  selectedIds: string[]
  onSelect: (ids: string[]) => void
  /** Batch commit — a group drag or resize touches several elements but must
   *  land as one history entry, whether the group has one member or ten. */
  onUpdateMany: (els: InkEl[]) => void
  toStage: (clientX: number, clientY: number) => [number, number]
}

/** Existing-element manipulation for the cursor tool: drag to move (solo or as a
 *  group), handles to resize, marquee to select on empty canvas. */
export function useSelectionInteraction({
  selecting,
  elements,
  selectedIds,
  onSelect,
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

  /** The gesture as it was when the grip was grabbed: which handle, the box the
   *  selection filled then, and where inside the grip the pointer landed. Every
   *  frame is measured against this, never against the box it is being dragged
   *  to — see `resizeBox` for why that distinction is load-bearing. */
  const sizeFrom = useRef<{ grip: Handle; box: Box; ids: string[]; grab: [number, number] } | null>(
    null,
  )

  const onHandleDown = (e: React.PointerEvent<SVGRectElement>, grip: Handle) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const ids = selectedIds.filter((id) => elements.some((el) => el.id === id))
    if (!ids.length) return
    const box = boundsOfMany(elements.filter((el) => ids.includes(el.id)))
    const [x, y] = toStage(e.clientX, e.clientY)
    sizeFrom.current = {
      grip,
      box,
      ids,
      // The grips sit on the padded outline, and nobody grabs one dead centre.
      // Both offsets are captured once, so they shift the drag without ever
      // accumulating into it.
      grab: [x - (box.x + grip.fx * box.w), y - (box.y + grip.fy * box.h)],
    }
    setInteraction({ mode: 'resizing', ids, from: box, to: box })
  }

  const onHandleMove = (e: React.PointerEvent<SVGRectElement>) => {
    const from = sizeFrom.current
    if (interaction.mode !== 'resizing' || !from) return
    const [x, y] = toStage(e.clientX, e.clientY)
    const to = resizeBox(from.box, from.grip, [x - from.grab[0], y - from.grab[1]], {
      aspect: e.shiftKey,
      fromCenter: e.altKey,
    })
    setInteraction({ mode: 'resizing', ids: from.ids, from: from.box, to })
  }

  const onHandleUp = (e: React.PointerEvent<SVGRectElement>) => {
    const from = sizeFrom.current
    if (interaction.mode !== 'resizing' || !from) return
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    const { to } = interaction
    sizeFrom.current = null
    setInteraction(IDLE)
    // One commit for the whole gesture — the live preview was throwaway, so the
    // resize lands as a single undo entry however many elements it scaled.
    if (to.w !== from.box.w || to.h !== from.box.h || to.x !== from.box.x || to.y !== from.box.y) {
      onUpdateMany(
        elements.filter((el) => from.ids.includes(el.id)).map((el) => scaleEl(el, from.box, to)),
      )
    }
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
    onHandleDown,
    onHandleMove,
    onHandleUp,
    marqueeBox,
    onBackdropDown,
    onBackdropMove,
    onBackdropUp,
  }
}
