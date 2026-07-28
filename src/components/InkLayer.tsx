import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { DrawStyle, InkEl, ShapeKind, Tool } from '../types'
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

/** Two clicks on the same element closer together than this count as a double-click. */
const DOUBLE_CLICK_MS = 400

interface Props {
  elements: InkEl[]
  tool: Tool
  shape: ShapeKind
  /** What the next mark is drawn with — colours, width, opacity, text size. */
  style: DrawStyle
  selectedIds: string[]
  onSelect: (ids: string[]) => void
  onCommit: (el: InkEl) => void
  /** Batch commit for a group drag or resize — every element it touched lands as
   *  one undo entry. */
  onUpdateMany: (els: InkEl[]) => void
  /** Batch commit for brand-new elements — where an Option-drag's copies land,
   *  since they're fresh elements rather than edits to the ones dragged. */
  onCommitMany: (els: InkEl[]) => void
  onErase: (ids: string[]) => void
  /** Flags a stroke, a drag, or a handle resize as in flight — App uses this to
   *  ignore a keyboard tool switch or slide change until the gesture ends,
   *  since pointer capture would otherwise keep delivering it to a tool (or a
   *  slide) that's no longer current. */
  onGestureChange: (active: boolean) => void
}

export default function InkLayer({
  elements,
  tool,
  shape,
  style,
  selectedIds,
  onSelect,
  onCommit,
  onUpdateMany,
  onCommitMany,
  onErase,
  onGestureChange,
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

  const { editing, startCreate, startEdit, commitText, updateValue } = useTextEditor({
    style,
    onCommit,
    onUpdateMany,
    onErase,
  })

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
      style,
      toStage,
      onCommit,
      onErase,
      editing,
      startCreate,
      commitText,
      onGestureChange,
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
    onDuplicateMany: onCommitMany,
    toStage,
    onGestureChange,
  })

  /** The last element a plain *click* (not a drag) landed on, and when. Read
   *  and written only at pointer-up, once `onElUp`'s own click-vs-drag call is
   *  known — pairing at pointerdown instead would treat "click to select, then
   *  immediately drag from the same point" as a double-click too, since both
   *  presses land on the same element within the window regardless of what
   *  the second one turns into. Native `dblclick` isn't an option either:
   *  `onElDown` preventDefaults the pointerdown, which can suppress the
   *  compatibility mouse events (click, dblclick) a browser derives from it. */
  const lastClick = useRef<{ id: string; time: number } | null>(null)

  const onElPointerUp = useCallback(
    (e: React.PointerEvent<SVGGElement>, el: InkEl) => {
      // Read before onElUp resets `interaction` back to idle.
      const wasClick =
        interaction.mode === 'dragging' && Math.hypot(interaction.dx, interaction.dy) <= 1
      onElUp(e)
      if (!wasClick) {
        // A real drag, however it started — don't let it pair with a click
        // before or after it.
        lastClick.current = null
        return
      }
      const now = Date.now()
      const prior = lastClick.current
      const isDouble = !!prior && prior.id === el.id && now - prior.time < DOUBLE_CLICK_MS
      lastClick.current = isDouble ? null : { id: el.id, time: now }
      // The first click of a double-click still selects normally — only
      // reopening the text box on the second one is new behaviour.
      if (isDouble && el.kind === 'text') startEdit(el)
    },
    [onElUp, interaction, startEdit],
  )

  /**
   * Plain array order — position *is* z-order, which is what Front/Back move.
   * Images still land behind the vector ink because they are inserted at the
   * front of the array on paste, and because a legacy slide is partitioned once
   * on the way in (see `normalizeSlide`) — not because the renderer re-sorts them
   * every frame, which would make any z-order control a lie.
   */
  const committed = useMemo(
    () =>
      elements.flatMap((el) => {
        const dragging =
          interaction.mode === 'dragging' && interaction.ids.includes(el.id) ? interaction : null
        // Option-drag leaves the pressed element exactly where it was — the
        // move-transform below is skipped for it, and a second, non-interactive
        // copy (rendered after this one) carries it instead. That's also what
        // keeps pointer capture on the untouched original for the rest of the
        // gesture, since it's still the element the drag started on.
        const moving = dragging && !dragging.duplicate ? dragging : null
        // A live resize renders scaled but still drives off the committed
        // element, so one drag is one resize rather than a feedback loop.
        const live = resizePreview(el, interaction)
        // The floating textarea is the only rendering of this element while
        // it's being edited — leaving the committed glyphs in the SVG too
        // would show doubled text behind it.
        const beingEdited = editing?.kind === 'edit' && editing.original.id === el.id
        const node = (
          <g
            key={el.id}
            className={selecting ? 'ink-el' : undefined}
            transform={moving ? `translate(${moving.dx} ${moving.dy})` : undefined}
            onPointerDown={selecting ? (e) => onElDown(e, el) : undefined}
            onPointerMove={selecting ? onElMove : undefined}
            onPointerUp={selecting ? (e) => onElPointerUp(e, el) : undefined}
            onPointerCancel={selecting ? (e) => onElPointerUp(e, el) : undefined}
          >
            {!beingEdited && <Visual el={live} />}
            {selecting && <HitArea el={live} />}
            {/* The selection outline and its resize grips are drawn by
                SelectionOverlay, as one block on top of every element — see its
                render below. */}
          </g>
        )
        if (!dragging?.duplicate) return [node]
        // The moving preview of the copy an Option-drag will commit on release —
        // the original staying put beside it is what makes "this duplicates"
        // legible mid-gesture, instead of looking like a drag that silently
        // teleports back at the end.
        return [
          node,
          <g
            key={`${el.id}:dup-preview`}
            transform={`translate(${dragging.dx} ${dragging.dy})`}
            pointerEvents="none"
          >
            <Visual el={live} />
          </g>,
        ]
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [elements, selecting, selectedIds, interaction, editing],
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
        // Commits an open edit before the click underneath it is handled. Can't
        // rely on the bubble-phase pointerdown below for this: onElDown/
        // onHandleDown preventDefault the pointerdown, which can suppress the
        // textarea's blur, so a click straight on another element would
        // otherwise leave the edit open underneath a fresh drag.
        onPointerDownCapture={editing ? commitText : undefined}
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
        {/* The preview draws with the same style the commit will use, so what a
            drag shows is what lands. */}
        {dragTo && tool === 'arrow' && (
          <path
            d={arrowToPath({
              from: start.current,
              to: dragTo,
              style: makeStyle({ strokeWidth: TOOL_SIZE.arrow * style.widthScale }),
            })}
            fill="none"
            stroke={style.stroke}
            strokeWidth={TOOL_SIZE.arrow * style.widthScale}
            opacity={style.opacity}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {dragTo && tool === 'shape' && (
          <path
            d={shapeToPath({ shape, from: start.current, to: dragTo })}
            fill={(shape !== 'line' && style.fill) || 'none'}
            stroke={style.stroke}
            strokeWidth={TOOL_SIZE.shape * style.widthScale}
            opacity={style.opacity}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>

      {editing && (
        <TextEditor
          draft={editing}
          // A fresh mark takes the sticky draw style; reopening a committed one
          // keeps its own colour and size instead, so editing doesn't reskin it.
          color={editing.kind === 'edit' ? editing.original.style.stroke : style.stroke}
          fontSize={editing.kind === 'edit' ? editing.original.fontSize : style.fontSize}
          scale={scale}
          onChange={updateValue}
          onCommit={commitText}
        />
      )}
    </div>
  )
}
