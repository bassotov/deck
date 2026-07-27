import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { InkEl, ShapeKind, Tool } from '../types'
import {
  STAGE_H,
  STAGE_W,
  TOOL_SIZE,
  arrowToPath,
  makeStyle,
  shapeToPath,
  strokeToPath,
} from '../lib/ink'
import { HitArea, Visual } from './ink/ElementView'
import SelectionOverlay from './ink/SelectionOverlay'
import TextEditor, { useTextEditor } from './ink/TextEditor'
import { useInkDrawing } from '../hooks/useInkDrawing'
import { resizePreview, useSelectionInteraction } from '../hooks/useSelectionInteraction'

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
  /** Batch commit for a group drag or resize — every element it touched lands as
   *  one undo entry. */
  onUpdateMany: (els: InkEl[]) => void
  onErase: (ids: string[]) => void
}

export default function InkLayer({
  elements,
  tool,
  shape,
  color,
  selectedIds,
  onSelect,
  onCommit,
  onUpdateMany,
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

  const {
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
  } = useSelectionInteraction({
    selecting,
    elements,
    selectedIds,
    onSelect,
    onUpdateMany,
    toStage,
  })

  /** Images sit behind the vector ink, so a drawing is never hidden by a paste. */
  const ordered = useMemo(
    () => [...elements].sort((a, b) => Number(a.kind !== 'image') - Number(b.kind !== 'image')),
    [elements],
  )

  const committed = useMemo(
    () =>
      ordered.map((el) => {
        const moving =
          interaction.mode === 'dragging' && interaction.ids.includes(el.id) ? interaction : null
        // A live resize renders scaled but still drives off the committed
        // element, so one drag is one resize rather than a feedback loop.
        const live = resizePreview(el, interaction)
        return (
          <g
            key={el.id}
            className={selecting ? 'ink-el' : undefined}
            transform={moving ? `translate(${moving.dx} ${moving.dy})` : undefined}
            onPointerDown={selecting ? (e) => onElDown(e, el) : undefined}
            onPointerMove={selecting ? onElMove : undefined}
            onPointerUp={selecting ? onElUp : undefined}
            onPointerCancel={selecting ? onElUp : undefined}
          >
            <Visual el={live} />
            {selecting && <HitArea el={live} />}
            {/* The selection outline and its resize grips are drawn by
                SelectionOverlay, as one block on top of every element — see its
                render below. */}
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
        {/* Transparent full-stage backdrop, behind every element and only present
            in cursor mode — see the .ink-svg[data-tool='cursor'] comment in
            app.css for why this is what lets a marquee catch drags on empty
            canvas at all. A click (no drag) on it clears the selection; a real
            drag draws the marquee, resolved in onBackdropUp. */}
        {selecting && (
          <rect
            x={0}
            y={0}
            width={STAGE_W}
            height={STAGE_H}
            fill="none"
            pointerEvents="all"
            onPointerDown={onBackdropDown}
            onPointerMove={onBackdropMove}
            onPointerUp={onBackdropUp}
            onPointerCancel={onBackdropUp}
          />
        )}
        {committed}
        {selecting && (
          <SelectionOverlay
            elements={elements}
            selectedIds={selectedIds}
            interaction={interaction}
            onHandleDown={onHandleDown}
            onHandleMove={onHandleMove}
            onHandleUp={onHandleUp}
          />
        )}
        {marqueeBox && (
          <rect
            className="ink-marquee"
            x={marqueeBox.x}
            y={marqueeBox.y}
            width={marqueeBox.w}
            height={marqueeBox.h}
          />
        )}
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
