import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ImageEl, InkEl, ShapeKind, TextEl, Tool } from '../types'
import {
  STAGE_H,
  STAGE_W,
  TOOL_SIZE,
  arrowToPath,
  boundsOf,
  hitsElement,
  resizeImage,
  shapeToPath,
  snapAngle,
  squareOff,
  strokeToPath,
  textBox,
  translateEl,
  uid,
} from '../lib/ink'

const ERASER_RADIUS = 16

/** The open text box, before it becomes a `TextEl`. */
type TextDraft = { x: number; y: number; value: string }

const ERASER_CURSOR =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='26' height='26'%3E%3Ccircle cx='13' cy='13' r='10' fill='rgba(0,0,0,0.06)' stroke='%2317161A' stroke-width='1.4'/%3E%3C/svg%3E\") 13 13, auto"

interface Props {
  elements: InkEl[]
  tool: Tool
  shape: ShapeKind
  color: string
  selectedId: string | null
  onSelect: (id: string | null) => void
  onCommit: (el: InkEl) => void
  onUpdate: (el: InkEl) => void
  onErase: (ids: string[]) => void
}

function TextElement({ el }: { el: TextEl }) {
  const lines = el.text.split('\n')
  return (
    <text
      x={el.x}
      y={el.y}
      fill={el.color}
      fontSize={el.size}
      fontFamily="Caveat, cursive"
      fontWeight={600}
      style={{ whiteSpace: 'pre' }}
    >
      {lines.map((line, i) => (
        <tspan key={i} x={el.x} dy={i === 0 ? 0 : el.size * 1.02}>
          {line || ' '}
        </tspan>
      ))}
    </text>
  )
}

function Visual({ el }: { el: InkEl }) {
  if (el.kind === 'image') {
    return (
      <image
        href={`/stories-assets/${encodeURIComponent(el.src)}`}
        x={el.x}
        y={el.y}
        width={el.w}
        height={el.h}
        preserveAspectRatio="xMidYMid meet"
      />
    )
  }
  if (el.kind === 'arrow' || el.kind === 'shape') {
    return (
      <path
        d={el.kind === 'arrow' ? arrowToPath(el) : shapeToPath(el)}
        fill="none"
        stroke={el.color}
        strokeWidth={el.size}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    )
  }
  if (el.kind === 'text') return <TextElement el={el} />
  return (
    <path
      d={strokeToPath(el)}
      fill={el.color}
      opacity={el.opacity}
      className={el.opacity < 1 ? 'ink-highlight' : undefined}
    />
  )
}

/** Corner grip on a selected image, in stage units. */
const HANDLE = 26

const SELECT_PAD = 8

function Selection({ el }: { el: InkEl }) {
  const b = boundsOf(el)
  return (
    <rect
      className="ink-selection"
      x={b.x - SELECT_PAD}
      y={b.y - SELECT_PAD}
      width={b.w + SELECT_PAD * 2}
      height={b.h + SELECT_PAD * 2}
      rx={6}
    />
  )
}

/**
 * An invisible, fatter copy of the element so a 7px line is still easy to grab
 * with a trackpad. Closed shapes hit-test on their outline only, so a rectangle
 * drawn around content doesn't swallow clicks meant for the slide underneath.
 */
function HitArea({ el }: { el: InkEl }) {
  if (el.kind === 'text' || el.kind === 'image') {
    const b = el.kind === 'text' ? textBox(el) : el
    return <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="none" pointerEvents="all" />
  }
  if (el.kind === 'arrow' || el.kind === 'shape') {
    const closed = el.kind === 'shape' && el.shape !== 'line'
    return (
      <path
        d={el.kind === 'arrow' ? arrowToPath(el) : shapeToPath(el)}
        fill="none"
        stroke="transparent"
        strokeWidth={el.size + 24}
        pointerEvents={closed ? 'stroke' : 'all'}
      />
    )
  }
  return (
    <path
      d={strokeToPath(el)}
      fill="transparent"
      stroke="transparent"
      strokeWidth={18}
      pointerEvents="all"
    />
  )
}

export default function InkLayer({
  elements,
  tool,
  shape,
  color,
  selectedId,
  onSelect,
  onCommit,
  onUpdate,
  onErase,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const drawing = useRef(false)
  const start = useRef<[number, number]>([0, 0])

  const [points, setPoints] = useState<number[][] | null>(null)
  const [dragTo, setDragTo] = useState<[number, number] | null>(null)
  const [editing, setEditingState] = useState<TextDraft | null>(null)
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null)
  const [sizing, setSizing] = useState<{ id: string; w: number; h: number } | null>(null)
  const dragFrom = useRef<[number, number]>([0, 0])

  const active = tool !== 'cursor'
  const selecting = tool === 'cursor'

  const toStage = useCallback((clientX: number, clientY: number): [number, number] => {
    const rect = svgRef.current!.getBoundingClientRect()
    return [
      ((clientX - rect.left) / rect.width) * STAGE_W,
      ((clientY - rect.top) / rect.height) * STAGE_H,
    ]
  }, [])

  /** Stage units -> CSS pixels, for sizing the live text input. */
  const pxPerUnit = () => (wrapRef.current?.clientWidth ?? STAGE_W) / STAGE_W

  /**
   * The open text box is mirrored into a ref so `commitText` can read the live
   * value without working inside a setState updater — StrictMode invokes those
   * twice, which committed the same text element twice.
   */
  const editingRef = useRef<TextDraft | null>(null)

  const setEditing = useCallback((next: TextDraft | null) => {
    editingRef.current = next
    setEditingState(next)
  }, [])

  const commitText = useCallback(() => {
    const current = editingRef.current
    // Cleared first: a pointerdown and the textarea's blur both fire for one
    // click away, and only the first of them should write an element.
    setEditing(null)
    if (!current || !current.value.trim()) return
    onCommit({
      id: uid(),
      kind: 'text',
      color,
      size: TOOL_SIZE.text,
      x: current.x,
      y: current.y,
      text: current.value.replace(/\s+$/, ''),
    })
  }, [color, onCommit, setEditing])

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  // Switching tool or slide shouldn't strand an open text box.
  useEffect(() => {
    if (tool !== 'text') commitText()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool])

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

    if (tool === 'text') return setEditing({ x, y, value: '' })

    e.currentTarget.setPointerCapture(e.pointerId)
    drawing.current = true

    if (tool === 'eraser') return erase(x, y)
    if (tool === 'arrow' || tool === 'shape') return setDragTo([x, y])
    setPoints([[x, y, e.pressure || 0.5]])
  }

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drawing.current) return
    const [x, y] = toStage(e.clientX, e.clientY)

    if (tool === 'eraser') return erase(x, y)

    if (tool === 'arrow') {
      return setDragTo(e.shiftKey ? snapAngle(start.current, [x, y]) : [x, y])
    }

    if (tool === 'shape') {
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
    e.currentTarget.releasePointerCapture?.(e.pointerId)

    if ((tool === 'arrow' || tool === 'shape') && dragTo) {
      const [x1, y1] = start.current
      if (Math.hypot(dragTo[0] - x1, dragTo[1] - y1) > 14) {
        onCommit(
          tool === 'arrow'
            ? { id: uid(), kind: 'arrow', color, size: TOOL_SIZE.arrow, from: start.current, to: dragTo }
            : {
                id: uid(),
                kind: 'shape',
                shape,
                color,
                size: TOOL_SIZE.shape,
                from: start.current,
                to: dragTo,
              },
        )
      }
      setDragTo(null)
      return
    }

    if (points && points.length > 1 && (tool === 'pen' || tool === 'highlighter')) {
      onCommit({
        id: uid(),
        kind: 'stroke',
        color,
        size: TOOL_SIZE[tool],
        opacity: tool === 'highlighter' ? 0.32 : 1,
        points,
      })
    }
    setPoints(null)
  }

  /* ------------------------------------------------------- select & move */

  const onElDown = (e: React.PointerEvent<SVGGElement>, el: InkEl) => {
    if (!selecting || e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragFrom.current = toStage(e.clientX, e.clientY)
    onSelect(el.id)
    setDrag({ id: el.id, dx: 0, dy: 0 })
  }

  const onElMove = (e: React.PointerEvent<SVGGElement>) => {
    if (!drag) return
    const [x, y] = toStage(e.clientX, e.clientY)
    let dx = x - dragFrom.current[0]
    let dy = y - dragFrom.current[1]
    // Shift constrains the move to one axis — the usual way to keep a row aligned.
    if (e.shiftKey) {
      if (Math.abs(dx) >= Math.abs(dy)) dy = 0
      else dx = 0
    }
    setDrag((d) => (d ? { ...d, dx, dy } : d))
  }

  const onElUp = (e: React.PointerEvent<SVGGElement>, el: InkEl) => {
    if (!drag) return
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    if (Math.hypot(drag.dx, drag.dy) > 1) onUpdate(translateEl(el, drag.dx, drag.dy))
    setDrag(null)
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
    setSizing({ id: el.id, w: el.w, h: el.h })
  }

  const onSizeMove = (e: React.PointerEvent<SVGRectElement>) => {
    const from = sizeFrom.current
    if (!sizing || !from) return
    const [x] = toStage(e.clientX, e.clientY)
    setSizing({ id: from.id, ...resizeImage(from, x - grabOffset.current) })
  }

  const onSizeUp = (e: React.PointerEvent<SVGRectElement>) => {
    const from = sizeFrom.current
    if (!sizing || !from) return
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    const { w, h } = sizing
    sizeFrom.current = null
    setSizing(null)
    if (w !== from.w) onUpdate({ ...from, w, h })
  }

  /** Images sit behind the vector ink, so a drawing is never hidden by a paste. */
  const ordered = useMemo(
    () => [...elements].sort((a, b) => Number(a.kind !== 'image') - Number(b.kind !== 'image')),
    [elements],
  )

  const committed = useMemo(
    () =>
      ordered.map((el) => {
        const moving = drag?.id === el.id ? drag : null
        const live = sizing?.id === el.id && el.kind === 'image' ? { ...el, ...sizing } : el
        const selected = selecting && selectedId === el.id
        return (
          <g
            key={el.id}
            className={selecting ? 'ink-el' : undefined}
            transform={moving ? `translate(${moving.dx} ${moving.dy})` : undefined}
            onPointerDown={selecting ? (e) => onElDown(e, el) : undefined}
            onPointerMove={selecting ? onElMove : undefined}
            onPointerUp={selecting ? (e) => onElUp(e, el) : undefined}
            onPointerCancel={selecting ? (e) => onElUp(e, el) : undefined}
          >
            <Visual el={live} />
            {selecting && <HitArea el={live} />}
            {selected && <Selection el={live} />}
            {/* The grip renders at the live size but drives off the committed
                element, so one drag is one resize rather than a feedback loop. */}
            {selected && el.kind === 'image' && live.kind === 'image' && (
              <rect
                className="ink-handle"
                x={live.x + live.w - HANDLE / 2}
                y={live.y + live.h - HANDLE / 2}
                width={HANDLE}
                height={HANDLE}
                rx={3}
                onPointerDown={(e) => onSizeDown(e, el)}
                onPointerMove={onSizeMove}
                onPointerUp={onSizeUp}
                onPointerCancel={onSizeUp}
              />
            )}
          </g>
        )
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ordered, selecting, selectedId, drag, sizing],
  )

  const scale = pxPerUnit()
  const preview = editing
    ? textBox({ ...editing, id: '', kind: 'text', color, size: TOOL_SIZE.text, text: editing.value })
    : null

  return (
    <div ref={wrapRef} className="ink-layer" data-active={active}>
      <svg
        ref={svgRef}
        className="ink-svg"
        data-tool={tool}
        viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
        preserveAspectRatio="none"
        style={tool === 'eraser' ? { cursor: ERASER_CURSOR } : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {committed}
        {points && points.length > 0 && (
          <path
            d={strokeToPath({
              points,
              size: TOOL_SIZE[tool === 'highlighter' ? 'highlighter' : 'pen'],
              opacity: tool === 'highlighter' ? 0.32 : 1,
            })}
            fill={color}
            opacity={tool === 'highlighter' ? 0.32 : 1}
            className={tool === 'highlighter' ? 'ink-highlight' : undefined}
          />
        )}
        {dragTo && tool === 'arrow' && (
          <path
            d={arrowToPath({ from: start.current, to: dragTo, size: TOOL_SIZE.arrow })}
            fill="none"
            stroke={color}
            strokeWidth={TOOL_SIZE.arrow}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {dragTo && tool === 'shape' && (
          <path
            d={shapeToPath({ shape, from: start.current, to: dragTo })}
            fill="none"
            stroke={color}
            strokeWidth={TOOL_SIZE.shape}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>

      {editing && preview && (
        <textarea
          ref={inputRef}
          value={editing.value}
          onChange={(e) => {
            const c = editingRef.current
            if (c) setEditing({ ...c, value: e.target.value })
          }}
          onBlur={commitText}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Escape' || (e.key === 'Enter' && e.metaKey)) {
              e.preventDefault()
              commitText()
            }
          }}
          spellCheck={false}
          className="ink-text-input"
          style={{
            left: preview.x * scale,
            top: preview.y * scale,
            fontSize: TOOL_SIZE.text * scale,
            lineHeight: 1.02,
            color,
            // Grow with the content — `white-space: pre` would otherwise hide
            // everything past the initial width.
            width: Math.max(preview.w + TOOL_SIZE.text * 2, 260) * scale,
            height: (editing.value.split('\n').length * TOOL_SIZE.text * 1.02 + 6) * scale,
          }}
        />
      )}
    </div>
  )
}
