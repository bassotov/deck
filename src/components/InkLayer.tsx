import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { InkEl, ShapeKind, TextEl, Tool } from '../types'
import {
  STAGE_H,
  STAGE_W,
  TOOL_SIZE,
  arrowToPath,
  hitsElement,
  shapeToPath,
  snapAngle,
  squareOff,
  strokeToPath,
  textBox,
  translateEl,
  uid,
} from '../lib/ink'

const ERASER_RADIUS = 16

const ERASER_CURSOR =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='26' height='26'%3E%3Ccircle cx='13' cy='13' r='10' fill='rgba(0,0,0,0.06)' stroke='%2317161A' stroke-width='1.4'/%3E%3C/svg%3E\") 13 13, auto"

interface Props {
  elements: InkEl[]
  tool: Tool
  shape: ShapeKind
  color: string
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

/**
 * An invisible, fatter copy of the element so a 7px line is still easy to grab
 * with a trackpad. Closed shapes hit-test on their outline only, so a rectangle
 * drawn around content doesn't swallow clicks meant for the slide underneath.
 */
function HitArea({ el }: { el: InkEl }) {
  if (el.kind === 'text') {
    const b = textBox(el)
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
  const [editing, setEditing] = useState<{ x: number; y: number; value: string } | null>(null)
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null)
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

  const commitText = useCallback(() => {
    setEditing((current) => {
      if (current && current.value.trim()) {
        onCommit({
          id: uid(),
          kind: 'text',
          color,
          size: TOOL_SIZE.text,
          x: current.x,
          y: current.y,
          text: current.value.replace(/\s+$/, ''),
        })
      }
      return null
    })
  }, [color, onCommit])

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

  const committed = useMemo(
    () =>
      elements.map((el) => {
        const moving = drag?.id === el.id ? drag : null
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
            <Visual el={el} />
            {selecting && <HitArea el={el} />}
          </g>
        )
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [elements, selecting, drag],
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
          onChange={(e) => setEditing((c) => (c ? { ...c, value: e.target.value } : c))}
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
