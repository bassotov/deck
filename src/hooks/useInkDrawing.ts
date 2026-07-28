import { useCallback, useRef, useState } from 'react'
import type { DrawStyle, InkEl, ShapeKind, Tool } from '../types'
import { TOOL_SIZE, hitsElement, makeStyle, snapAngle, squareOff, uid } from '../lib/ink'
import type { TextDraft } from '../components/ink/TextEditor'

const ERASER_RADIUS = 16

interface Args {
  elements: InkEl[]
  tool: Tool
  shape: ShapeKind
  /** Sticky defaults: whatever was last set, on the rail or the property bar. */
  style: DrawStyle
  toStage: (clientX: number, clientY: number) => [number, number]
  onCommit: (el: InkEl) => void
  onErase: (ids: string[]) => void
  editing: TextDraft | null
  startCreate: (x: number, y: number) => void
  commitText: () => void
  /** Flags a stroke as in flight, so a keyboard tool switch or slide change
   *  can't land mid-gesture and corrupt or destroy it. */
  onGestureChange: (active: boolean) => void
}

/** The new-element authoring state and the pointer trio that drives it, for
 *  every tool except cursor (select & move lives in `useSelectionInteraction`). */
export function useInkDrawing({
  elements,
  tool,
  shape,
  style,
  toStage,
  onCommit,
  onErase,
  editing,
  startCreate,
  commitText,
  onGestureChange,
}: Args) {
  const drawing = useRef(false)
  const start = useRef<[number, number]>([0, 0])
  /** The tool this gesture started with. Pointer capture keeps delivering
   *  move/up events to this hook after a keyboard tool switch mid-stroke, so
   *  branching on the live `tool` prop there could reinterpret a pen stroke as
   *  an eraser drag, or drop it silently once the commit condition no longer
   *  matches. `onPointerDown` still reads the live `tool` — that's what decides
   *  whether a new gesture starts at all — but move/up read this instead. */
  const gestureTool = useRef<Tool>(tool)

  const [points, setPoints] = useState<number[][] | null>(null)
  const [dragTo, setDragTo] = useState<[number, number] | null>(null)

  const active = tool !== 'cursor'

  /** The nib a freehand stroke draws with, and the style it commits with. The
   *  highlighter's dimming belongs to the nib — nothing reads it back the other
   *  way, and no chosen opacity overrides it, or the nib stops being a nib. */
  const brush: 'pen' | 'highlighter' = tool === 'highlighter' ? 'highlighter' : 'pen'
  const brushStyle = makeStyle({
    stroke: style.stroke,
    strokeWidth: TOOL_SIZE[brush] * style.widthScale,
    opacity: brush === 'highlighter' ? 0.32 : style.opacity,
  })

  const erase = useCallback(
    (x: number, y: number) => {
      const hits = elements.filter((el) => hitsElement(el, x, y, ERASER_RADIUS)).map((el) => el.id)
      if (hits.length) onErase(hits)
    },
    [elements, onErase],
  )

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!active || e.button !== 0) return
    e.preventDefault()

    // A click outside an open text box commits it rather than starting a new one.
    if (editing) return commitText()

    const [x, y] = toStage(e.clientX, e.clientY)
    start.current = [x, y]

    if (tool === 'text') return startCreate(x, y)

    gestureTool.current = tool
    e.currentTarget.setPointerCapture(e.pointerId)
    drawing.current = true
    onGestureChange(true)

    if (tool === 'eraser') return erase(x, y)
    if (tool === 'arrow' || tool === 'shape') return setDragTo([x, y])
    setPoints([[x, y, e.pressure || 0.5]])
  }

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drawing.current) return
    const [x, y] = toStage(e.clientX, e.clientY)
    const gesture = gestureTool.current

    if (gesture === 'eraser') return erase(x, y)

    if (gesture === 'arrow') {
      return setDragTo(e.shiftKey ? snapAngle(start.current, [x, y]) : [x, y])
    }

    if (gesture === 'shape') {
      if (!e.shiftKey) return setDragTo([x, y])
      // Shift makes a square/circle, or snaps a line's angle.
      return setDragTo(
        shape === 'line' ? snapAngle(start.current, [x, y]) : squareOff(start.current, [x, y]),
      )
    }

    // Shift turns the stroke into a straight, angle-snapped line.
    if (e.shiftKey) {
      const [sx, sy] = snapAngle(start.current, [x, y])
      return setPoints([
        [start.current[0], start.current[1], 0.5],
        [sx, sy, 0.5],
      ])
    }

    const native = e.nativeEvent as PointerEvent
    const batch = native.getCoalescedEvents?.() ?? [native]
    setPoints((prev) => {
      if (!prev) return prev
      const next = prev.slice()
      for (const ev of batch) {
        const [cx, cy] = toStage(ev.clientX, ev.clientY)
        next.push([cx, cy, ev.pressure || 0.5])
      }
      return next
    })
  }

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drawing.current) return
    drawing.current = false
    onGestureChange(false)
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    const gesture = gestureTool.current

    if ((gesture === 'arrow' || gesture === 'shape') && dragTo) {
      const [x1, y1] = start.current
      if (Math.hypot(dragTo[0] - x1, dragTo[1] - y1) > 14) {
        onCommit(
          gesture === 'arrow'
            ? {
                id: uid(),
                kind: 'arrow',
                style: makeStyle({
                  stroke: style.stroke,
                  strokeWidth: TOOL_SIZE.arrow * style.widthScale,
                  opacity: style.opacity,
                }),
                from: start.current,
                to: dragTo,
              }
            : {
                id: uid(),
                kind: 'shape',
                shape,
                style: makeStyle({
                  stroke: style.stroke,
                  // A line has no interior; carrying a fill it can't show would
                  // only surprise the next person to open the JSON.
                  fill: shape === 'line' ? null : style.fill,
                  strokeWidth: TOOL_SIZE.shape * style.widthScale,
                  opacity: style.opacity,
                }),
                from: start.current,
                to: dragTo,
              },
        )
      }
      setDragTo(null)
      return
    }

    if (points && points.length > 1 && (gesture === 'pen' || gesture === 'highlighter')) {
      onCommit({ id: uid(), kind: 'stroke', brush: gesture, style: brushStyle, points })
    }
    setPoints(null)
  }

  return {
    active,
    brush,
    brushStyle,
    points,
    dragTo,
    start,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  }
}
