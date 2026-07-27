import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { InkEl, ShapeKind, Tool } from '../types'
import {
  STAGE_H,
  STAGE_W,
  TOOL_SIZE,
  arrowToPath,
  boundsOf,
  makeStyle,
  shapeToPath,
  strokeToPath,
} from '../lib/ink'
import { HitArea, Visual } from './ink/ElementView'
import TextEditor, { useTextEditor } from './ink/TextEditor'
import { useInkDrawing } from '../hooks/useInkDrawing'
import { useSelectionInteraction } from '../hooks/useSelectionInteraction'

const ERASER_CURSOR =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='26' height='26'%3E%3Ccircle cx='13' cy='13' r='10' fill='rgba(0,0,0,0.06)' stroke='%2317161A' stroke-width='1.4'/%3E%3C/svg%3E\") 13 13, auto"

interface Props {
  elements: InkEl[]
  tool: Tool
  shape: ShapeKind
  color: string
  selectedIds: string[]
  onSelect: (ids: string[]) => void
  onCommit: (el: InkEl) => void
  onUpdate: (el: InkEl) => void
  onErase: (ids: string[]) => void
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

export default function InkLayer({
  elements,
  tool,
  shape,
  color,
  selectedIds,
  onSelect,
  onCommit,
  onUpdate,
  onErase,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)

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

  const { editing, setEditing, commitText, updateValue } = useTextEditor({ color, onCommit })

  // Switching tool or slide shouldn't strand an open text box.
  useEffect(() => {
    if (tool !== 'text') commitText()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool])

  const { active, brush, brushStyle, points, dragTo, start, onPointerDown, onPointerMove, onPointerUp } =
    useInkDrawing({
      elements,
      tool,
      shape,
      color,
      toStage,
      onCommit,
      onErase,
      editing,
      setEditing,
      commitText,
    })

  const { interaction, onElDown, onElMove, onElUp, onSizeDown, onSizeMove, onSizeUp } =
    useSelectionInteraction({ selecting, onSelect, onUpdate, toStage })

  /** Images sit behind the vector ink, so a drawing is never hidden by a paste. */
  const ordered = useMemo(
    () => [...elements].sort((a, b) => Number(a.kind !== 'image') - Number(b.kind !== 'image')),
    [elements],
  )

  const committed = useMemo(
    () =>
      ordered.map((el) => {
        const moving =
          interaction.mode === 'dragging' && interaction.id === el.id ? interaction : null
        const live =
          interaction.mode === 'resizing' && interaction.id === el.id && el.kind === 'image'
            ? { ...el, w: interaction.w, h: interaction.h }
            : el
        const selected = selecting && selectedIds.includes(el.id)
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
    [ordered, selecting, selectedIds, interaction],
  )

  const scale = pxPerUnit()

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
            d={strokeToPath({ points, brush, style: brushStyle })}
            fill={brushStyle.stroke}
            opacity={brushStyle.opacity}
            className={brush === 'highlighter' ? 'ink-highlight' : undefined}
          />
        )}
        {dragTo && tool === 'arrow' && (
          <path
            d={arrowToPath({
              from: start.current,
              to: dragTo,
              style: makeStyle({ strokeWidth: TOOL_SIZE.arrow }),
            })}
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

      {editing && (
        <TextEditor
          draft={editing}
          color={color}
          fontSize={TOOL_SIZE.text}
          scale={scale}
          onChange={updateValue}
          onCommit={commitText}
        />
      )}
    </div>
  )
}
