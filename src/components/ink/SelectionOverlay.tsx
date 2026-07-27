import type { Box, InkEl } from '../../types'
import { boundsOf, boundsOfMany, translateEl } from '../../lib/ink'
import type { Interaction } from '../../hooks/useSelectionInteraction'

/** Breathing room between an element's bounds and its dashed selection outline. */
const SELECT_PAD = 8

function SelectionRect({ box }: { box: Box }) {
  return (
    <rect
      className="ink-selection"
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
}

/**
 * Dashed selection chrome for the cursor tool. One element selected gets the
 * single outline it always has; two or more each keep their own outline plus
 * one more around the union box, so the group still reads as a group rather
 * than a pile of individually-marked elements.
 *
 * Rendered as one block on top of every element (not interleaved per-element,
 * as the outline used to be) so a later element can never sit on top of an
 * earlier one's outline. No wrapping `<g>` — each `.ink-selection` rect
 * already carries `pointer-events: none` on its own, and every committed
 * element is expected to render as exactly one top-level `<g>` (see
 * `inkCounts` in the Playwright harness), which a wrapper here would throw off.
 */
export default function SelectionOverlay({ elements, selectedIds, interaction }: Props) {
  const dragging = interaction.mode === 'dragging' ? interaction : null

  // While a group drag is live, the outline has to track the live preview —
  // translate the same elements by the same delta the `<g transform>` in
  // InkLayer applies to their actual visuals, so the two never disagree.
  const selected = elements
    .filter((el) => selectedIds.includes(el.id))
    .map((el) =>
      dragging && dragging.ids.includes(el.id) ? translateEl(el, dragging.dx, dragging.dy) : el,
    )

  if (!selected.length) return null

  return (
    <>
      {selected.map((el) => (
        <SelectionRect key={el.id} box={boundsOf(el)} />
      ))}
      {selected.length > 1 && <SelectionRect box={boundsOfMany(selected)} />}
    </>
  )
}
