import { Fragment } from 'react'
import type { Box, InkEl } from '../../types'
import type { Handle } from '../../lib/ink'
import { HANDLES, boundsOf, boundsOfMany, translateEl } from '../../lib/ink'
import type { Interaction } from '../../hooks/useSelectionInteraction'
import { resizePreview } from '../../hooks/useSelectionInteraction'

/** Breathing room between an element's bounds and its dashed selection outline. */
const SELECT_PAD = 8

/** Grip size in stage units. Smaller than the single image corner grip used to
 *  be — eight of them at that weight read as a fence rather than as chrome.
 *  Exactly twice `SELECT_PAD`, so a grip fills the padding ring and stops dead
 *  on the element's own edge. */
const HANDLE = SELECT_PAD * 2

/** How far the invisible grab target reaches past the grip, outward and along
 *  the outline — roughly doubling it, the same slack `HitArea` gives a 7px line
 *  because a trackpad needs what a mouse doesn't. */
const HANDLE_OUT = 20
const HANDLE_ALONG = 14

/**
 * The grab target's extent on one axis, relative to the grip's centre. Outward
 * it can be greedy: that space is empty chrome. Inward it stops at the grip
 * itself — so the element's own area always belongs to the element, and a small
 * mark stays draggable instead of being fenced in by its own handles.
 */
function span(f: number): [number, number] {
  if (f === 0.5) return [-HANDLE_ALONG, HANDLE_ALONG]
  return f === 0 ? [-HANDLE_OUT, HANDLE / 2] : [-HANDLE / 2, HANDLE_OUT]
}

function SelectionRect({ box, member }: { box: Box; member?: boolean }) {
  return (
    <rect
      className={member ? 'ink-selection ink-selection-member' : 'ink-selection'}
      x={box.x - SELECT_PAD}
      y={box.y - SELECT_PAD}
      width={box.w + SELECT_PAD * 2}
      height={box.h + SELECT_PAD * 2}
      rx={6}
    />
  )
}

interface Props {
  elements: InkEl[]
  selectedIds: string[]
  interaction: Interaction
  onHandleDown: (e: React.PointerEvent<SVGRectElement>, grip: Handle) => void
  onHandleMove: (e: React.PointerEvent<SVGRectElement>) => void
  onHandleUp: (e: React.PointerEvent<SVGRectElement>) => void
}

/**
 * Dashed selection chrome for the cursor tool: one outline around the box the
 * selection fills, plus eight grips on it. Two or more elements also get a
 * quieter outline each, so the group still reads as a group without the members
 * and the union box merging into one busy segmented strip.
 *
 * Rendered as one block on top of every element (not interleaved per-element,
 * as the outline used to be) so a later element can never sit on top of an
 * earlier one's chrome. No wrapping `<g>` — `.ink-selection` carries
 * `pointer-events: none` on its own and the grips manage their own hit areas,
 * and every committed element is expected to render as exactly one top-level
 * `<g>` (see `inkCounts` in the Playwright harness), which a wrapper would
 * throw off.
 */
export default function SelectionOverlay({
  elements,
  selectedIds,
  interaction,
  onHandleDown,
  onHandleMove,
  onHandleUp,
}: Props) {
  const dragging = interaction.mode === 'dragging' ? interaction : null

  // While a gesture is live, the chrome has to track the live preview — the same
  // translate the `<g transform>` in InkLayer applies, or the same scale it
  // renders through `resizePreview`, so the two can never disagree.
  const selected = elements
    .filter((el) => selectedIds.includes(el.id))
    .map((el) =>
      dragging && dragging.ids.includes(el.id) ? translateEl(el, dragging.dx, dragging.dy) : el,
    )
    .map((el) => resizePreview(el, interaction))

  if (!selected.length) return null

  // One element's union box is its own box, so single selection keeps exactly
  // the outline it has always had.
  const box = boundsOfMany(selected)

  return (
    <>
      {selected.length > 1 &&
        selected.map((el) => <SelectionRect key={el.id} box={boundsOf(el)} member />)}
      <SelectionRect box={box} />
      {HANDLES.map((grip) => {
        // Grips ride the padded outline, not the raw bounds — otherwise they sit
        // inside the box they resize and cover the element's own corners.
        const cx = box.x - SELECT_PAD + grip.fx * (box.w + SELECT_PAD * 2)
        const cy = box.y - SELECT_PAD + grip.fy * (box.h + SELECT_PAD * 2)
        const [x0, x1] = span(grip.fx)
        const [y0, y1] = span(grip.fy)
        return (
          // A Fragment, not a `<g>`: the harness counts top-level groups as
          // committed elements, and chrome must not show up in that count.
          <Fragment key={grip.pos}>
            <rect
              className="ink-handle-hit"
              data-axis={grip.axis}
              x={cx + x0}
              y={cy + y0}
              width={x1 - x0}
              height={y1 - y0}
              onPointerDown={(e) => onHandleDown(e, grip)}
              onPointerMove={onHandleMove}
              onPointerUp={onHandleUp}
              onPointerCancel={onHandleUp}
            />
            <rect
              className="ink-handle"
              x={cx - HANDLE / 2}
              y={cy - HANDLE / 2}
              width={HANDLE}
              height={HANDLE}
              rx={2}
            />
          </Fragment>
        )
      })}
    </>
  )
}
