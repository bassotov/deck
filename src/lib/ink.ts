import { getStroke } from 'perfect-freehand'
import type {
  ArrowEl,
  Box,
  DrawStyle,
  ElStyle,
  ImageEl,
  InkEl,
  ShapeEl,
  ShapeKind,
  StrokeEl,
  TextEl,
  Tool,
} from '../types'

/** Every annotation lives in this fixed space; the SVG viewBox does the scaling. */
export const STAGE_W = 1600
export const STAGE_H = 900

export const INK_COLORS = [
  { name: 'coral', value: '#FF5A1F' },
  { name: 'ink', value: '#17161A' },
  { name: 'blue', value: '#2563EB' },
  { name: 'green', value: '#16A34A' },
] as const

/** Rail order and the digit that selects each tool — 1-indexed. */
export const TOOL_ORDER: Tool[] = [
  'cursor',
  'pen',
  'highlighter',
  'arrow',
  'shape',
  'text',
  'eraser',
]

/** Pressing the shape digit again (or clicking its button) walks this list. */
export const SHAPE_ORDER: ShapeKind[] = ['rect', 'ellipse', 'triangle', 'line']

export const TOOL_SIZE: Record<Exclude<Tool, 'cursor' | 'eraser'>, number> = {
  pen: 7,
  highlighter: 34,
  arrow: 8,
  shape: 7,
  text: 54,
}

/**
 * The three widths the property bar offers, as multiples of the drawing tool's
 * own default rather than as pixels — see `DrawStyle.widthScale`. A resized
 * element lands between steps, and none of them then claims it, which is the
 * honest answer.
 */
export const WIDTH_STEPS = [
  { name: 'Thin', scale: 0.5 },
  { name: 'Regular', scale: 1 },
  { name: 'Thick', scale: 2 },
] as const

/** The width an element counts as "regular" at — the tool that drew it. Only the
 *  stroked kinds carry a meaningful one, and only they are ever asked. */
export function baseWidth(el: InkEl): number {
  if (el.kind === 'stroke') return TOOL_SIZE[el.brush]
  if (el.kind === 'arrow') return TOOL_SIZE.arrow
  return TOOL_SIZE.shape
}

/** Text sizes, in stage units. `TOOL_SIZE.text` is the middle one by definition. */
export const FONT_STEPS = [
  { name: 'S', size: 36 },
  { name: 'M', size: TOOL_SIZE.text },
  { name: 'L', size: 80 },
  { name: 'XL', size: 116 },
] as const

/** Discrete stops, not a slider: on camera, "a bit dimmer" has to be repeatable. */
export const OPACITY_STEPS = [1, 0.75, 0.5, 0.25] as const

export const uid = () => Math.random().toString(36).slice(2, 10)

/** Falls back to the colour a fresh session draws in, for data that names none. */
const DEFAULT_STROKE = INK_COLORS[0].value

/**
 * Every element carries a full style, so the fields a given kind ignores still need
 * a value — `strokeWidth` on text, `fill` everywhere until a shape asks for one.
 */
export function makeStyle(patch: Partial<ElStyle> = {}): ElStyle {
  return { stroke: DEFAULT_STROKE, fill: null, strokeWidth: 0, opacity: 1, ...patch }
}

/** What a fresh session draws with, before any property has been touched. */
export function makeDrawStyle(): DrawStyle {
  return {
    stroke: DEFAULT_STROKE,
    fill: null,
    widthScale: 1,
    opacity: 1,
    fontSize: TOOL_SIZE.text,
    custom: null,
  }
}

/** Restyle any element without narrowing its kind by hand at every call site. */
export function restyle(el: InkEl, patch: Partial<ElStyle>): InkEl {
  return { ...el, style: { ...el.style, ...patch } }
}

/** A copy at an offset, with a fresh identity — the one thing a duplicate can't share. */
export function copyEl(el: InkEl, dx: number, dy: number): InkEl {
  return { ...translateEl(el, dx, dy), id: uid() }
}

/**
 * Trackpad and mouse report no useful pressure, so perfect-freehand simulates it
 * from velocity. Streamline is pushed high because trackpad input is jittery.
 */
const PEN_OPTS = {
  size: TOOL_SIZE.pen,
  thinning: 0.58,
  smoothing: 0.62,
  streamline: 0.62,
  simulatePressure: true,
  last: true,
  start: { taper: 0, cap: true },
  end: { taper: 18, cap: true },
}

const HIGHLIGHTER_OPTS = {
  size: TOOL_SIZE.highlighter,
  thinning: 0,
  smoothing: 0.5,
  streamline: 0.55,
  simulatePressure: false,
  last: true,
  start: { taper: 0, cap: true },
  end: { taper: 0, cap: true },
}

function svgFromOutline(outline: number[][]): string {
  if (!outline.length) return ''
  const d = outline.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length]
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2)
      return acc
    },
    ['M', ...outline[0], 'Q'] as (string | number)[],
  )
  d.push('Z')
  return d.join(' ')
}

/** The nib decides the geometry — never the opacity, which the user can dial freely. */
export function strokeToPath({
  points,
  brush,
  style,
}: Pick<StrokeEl, 'points' | 'brush' | 'style'>): string {
  const base = brush === 'highlighter' ? HIGHLIGHTER_OPTS : PEN_OPTS
  return svgFromOutline(getStroke(points, { ...base, size: style.strokeWidth }))
}

export function arrowToPath({ from, to, style }: Pick<ArrowEl, 'from' | 'to' | 'style'>): string {
  const [x1, y1] = from
  const [x2, y2] = to
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const len = Math.hypot(x2 - x1, y2 - y1)
  const head = Math.min(len * 0.34, style.strokeWidth * 6.5)
  const wing = (a: number) =>
    `M ${x2} ${y2} L ${x2 + Math.cos(angle + Math.PI + a) * head} ${
      y2 + Math.sin(angle + Math.PI + a) * head
    }`
  return `M ${x1} ${y1} L ${x2} ${y2} ${wing(0.42)} ${wing(-0.42)}`
}

export function shapeToPath({ shape, from, to }: Pick<ShapeEl, 'shape' | 'from' | 'to'>): string {
  const [x0, y0] = from
  const [x1, y1] = to
  switch (shape) {
    case 'line':
      return `M ${x0} ${y0} L ${x1} ${y1}`
    case 'triangle':
      return `M ${(x0 + x1) / 2} ${y0} L ${x1} ${y1} L ${x0} ${y1} Z`
    case 'ellipse': {
      const cx = (x0 + x1) / 2
      const cy = (y0 + y1) / 2
      const rx = Math.abs(x1 - x0) / 2
      const ry = Math.abs(y1 - y0) / 2
      return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`
    }
    default:
      return `M ${x0} ${y0} L ${x1} ${y0} L ${x1} ${y1} L ${x0} ${y1} Z`
  }
}

/** Polyline approximation of a shape's outline — used for eraser hit-testing. */
function shapeOutline({ shape, from, to }: Pick<ShapeEl, 'shape' | 'from' | 'to'>): number[][] {
  const [x0, y0] = from
  const [x1, y1] = to
  switch (shape) {
    case 'line':
      return [
        [x0, y0],
        [x1, y1],
      ]
    case 'triangle':
      return [
        [(x0 + x1) / 2, y0],
        [x1, y1],
        [x0, y1],
        [(x0 + x1) / 2, y0],
      ]
    case 'ellipse': {
      const cx = (x0 + x1) / 2
      const cy = (y0 + y1) / 2
      const rx = Math.abs(x1 - x0) / 2
      const ry = Math.abs(y1 - y0) / 2
      return Array.from({ length: 33 }, (_, i) => {
        const t = (i / 32) * Math.PI * 2
        return [cx + Math.cos(t) * rx, cy + Math.sin(t) * ry]
      })
    }
    default:
      return [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
        [x0, y0],
      ]
  }
}

/** Move an element by a delta, in stage units. */
export function translateEl(el: InkEl, dx: number, dy: number): InkEl {
  switch (el.kind) {
    case 'stroke':
      return { ...el, points: el.points.map(([x, y, p]) => [x + dx, y + dy, p]) }
    case 'arrow':
    case 'shape':
      return {
        ...el,
        from: [el.from[0] + dx, el.from[1] + dy],
        to: [el.to[0] + dx, el.to[1] + dy],
      }
    case 'text':
    case 'image':
      return { ...el, x: el.x + dx, y: el.y + dy }
  }
}

/** A zero-extent axis — a perfectly horizontal line — has nothing to divide by. */
const axisScale = (from: number, to: number) => (from > 0 ? to / from : 1)

/**
 * Map an element out of one box and into another. No minimum size is enforced here:
 * clamping belongs to the interaction that drives the drag, not to the geometry.
 */
export function scaleEl(el: InkEl, from: Box, to: Box): InkEl {
  const sx = axisScale(from.w, to.w)
  const sy = axisScale(from.h, to.h)
  // Widths and font sizes have no axis of their own, so they follow the geometric
  // mean — a box pulled twice as wide but no taller thickens by √2, not by 2.
  const sm = Math.sqrt(sx * sy)
  const mapX = (x: number) => to.x + (x - from.x) * sx
  const mapY = (y: number) => to.y + (y - from.y) * sy

  switch (el.kind) {
    case 'stroke':
      return {
        ...el,
        style: { ...el.style, strokeWidth: el.style.strokeWidth * sm },
        points: el.points.map(([x, y, p]) => [mapX(x), mapY(y), p]),
      }
    case 'arrow':
    case 'shape':
      return {
        ...el,
        style: { ...el.style, strokeWidth: el.style.strokeWidth * sm },
        from: [mapX(el.from[0]), mapY(el.from[1])],
        to: [mapX(el.to[0]), mapY(el.to[1])],
      }
    case 'text':
      return { ...el, x: mapX(el.x), y: mapY(el.y), fontSize: el.fontSize * sm }
    case 'image':
      return { ...el, x: mapX(el.x), y: mapY(el.y), w: el.w * sx, h: el.h * sy }
  }
}

/* --------------------------------------------------------------- handles */

/**
 * The eight grips on a selection box, as fractions of it. A fraction of 0.5 on
 * an axis means that axis is pinned — which is the whole difference between a
 * corner handle (resizes both) and an edge handle (resizes one). `axis` names
 * the resize cursor the grip wears.
 */
export const HANDLES = [
  { pos: 'nw', fx: 0, fy: 0, axis: 'nwse' },
  { pos: 'n', fx: 0.5, fy: 0, axis: 'ns' },
  { pos: 'ne', fx: 1, fy: 0, axis: 'nesw' },
  { pos: 'e', fx: 1, fy: 0.5, axis: 'ew' },
  { pos: 'se', fx: 1, fy: 1, axis: 'nwse' },
  { pos: 's', fx: 0.5, fy: 1, axis: 'ns' },
  { pos: 'sw', fx: 0, fy: 1, axis: 'nesw' },
  { pos: 'w', fx: 0, fy: 0.5, axis: 'ew' },
] as const

export type Handle = (typeof HANDLES)[number]

/**
 * Smallest a selection may be dragged to, on either axis, in stage units — small
 * enough to be a deliberate size, large enough that the grips stay grabbable.
 * Clamped here rather than inside `scaleEl`, which stays pure geometry.
 */
export const RESIZE_MIN = 12

/**
 * The box a handle drag has pulled the selection into. The pointer is read
 * directly against a fixed anchor — never against the box's current size, since
 * deltas measured against a size that is itself changing compound into a
 * runaway drag. (That lesson predates this function; it cost an afternoon.)
 *
 * `aspect` (Shift) locks the original ratio; `fromCenter` (Alt) pins the centre
 * instead of the opposite edge, so both sides move together.
 */
export function resizeBox(
  from: Box,
  grip: Handle,
  [px, py]: [number, number],
  mod: { aspect: boolean; fromCenter: boolean },
): Box {
  // What the drag pulls against: the opposite edge/corner, or the centre.
  const anchorX = mod.fromCenter ? from.x + from.w / 2 : from.x + (1 - grip.fx) * from.w
  const anchorY = mod.fromCenter ? from.y + from.h / 2 : from.y + (1 - grip.fy) * from.h
  // From the centre, the pointer only ever covers half the box — so it counts double.
  const reach = mod.fromCenter ? 2 : 1

  const freeX = grip.fx !== 0.5
  const freeY = grip.fy !== 0.5
  // Clamped, not mirrored: dragging past the anchor parks the box at its minimum
  // rather than flipping it inside out, which no one has ever meant to do.
  let w = freeX ? Math.max(RESIZE_MIN, (px - anchorX) * (grip.fx === 1 ? 1 : -1) * reach) : from.w
  let h = freeY ? Math.max(RESIZE_MIN, (py - anchorY) * (grip.fy === 1 ? 1 : -1) * reach) : from.h

  // A degenerate box — a perfectly horizontal line — has no ratio to lock.
  if (mod.aspect && from.w > 0 && from.h > 0) {
    // Uniform scale off whichever axis was pulled furthest. An edge handle has
    // only one, which is exactly what makes Shift meaningful there too.
    const s = Math.max(freeX ? w / from.w : 0, freeY ? h / from.h : 0)
    w = Math.max(RESIZE_MIN, from.w * s)
    h = Math.max(RESIZE_MIN, from.h * s)
  }

  return {
    // How much of the new box sits before the anchor: all of it when the anchor
    // is the far edge, none when it's the near one, half when it's the centre.
    x: anchorX - w * (mod.fromCenter ? 0.5 : 1 - grip.fx),
    y: anchorY - h * (mod.fromCenter ? 0.5 : 1 - grip.fy),
    w,
    h,
  }
}

/* ---------------------------------------------------------------- images */

/** The box a pasted image is fitted into, in stage units. */
const IMAGE_FIT = { w: 700, h: 520 }

/**
 * Centre a pasted image, scaled to fit. Successive pastes on one slide cascade
 * so the second doesn't land exactly on top of the first.
 */
export function placeImage(natural: { w: number; h: number }, nth: number) {
  const scale = Math.min(IMAGE_FIT.w / natural.w, IMAGE_FIT.h / natural.h)
  const w = Math.round(natural.w * scale)
  const h = Math.round(natural.h * scale)
  const step = (nth % 5) * 46
  return { x: Math.round((STAGE_W - w) / 2) + step, y: Math.round((STAGE_H - h) / 2) + step, w, h }
}

/** Bounding box of any element, for drawing the selection outline. */
export function boundsOf(el: InkEl): Box {
  switch (el.kind) {
    case 'image':
      return { x: el.x, y: el.y, w: el.w, h: el.h }
    case 'text':
      return textBox(el)
    case 'arrow':
    case 'shape':
      return {
        x: Math.min(el.from[0], el.to[0]),
        y: Math.min(el.from[1], el.to[1]),
        w: Math.abs(el.to[0] - el.from[0]),
        h: Math.abs(el.to[1] - el.from[1]),
      }
    default: {
      const xs = el.points.map((p) => p[0])
      const ys = el.points.map((p) => p[1])
      const width = el.style.strokeWidth
      const pad = width / 2
      return {
        x: Math.min(...xs) - pad,
        y: Math.min(...ys) - pad,
        w: Math.max(...xs) - Math.min(...xs) + width,
        h: Math.max(...ys) - Math.min(...ys) + width,
      }
    }
  }
}

/** Union box over a set — the frame a multi-selection is moved and scaled by. */
export function boundsOfMany(els: InkEl[]): Box {
  if (!els.length) return { x: 0, y: 0, w: 0, h: 0 }
  const boxes = els.map(boundsOf)
  const x = Math.min(...boxes.map((b) => b.x))
  const y = Math.min(...boxes.map((b) => b.y))
  return {
    x,
    y,
    w: Math.max(...boxes.map((b) => b.x + b.w)) - x,
    h: Math.max(...boxes.map((b) => b.y + b.h)) - y,
  }
}

/** Stage units of an element's own box that must stay inside the stage — small
 *  enough that a near-edge placement doesn't visibly jump, large enough to
 *  still be a grabbable target on a trackpad. `.stage` clips everything past
 *  its edge (`overflow: hidden`), so a mark pushed fully outside it is gone
 *  for good — nothing left to click to bring it back. */
export const STAGE_MARGIN = 24

/**
 * How far a group can actually move by `[dx, dy]` before a margin of its
 * combined bounding box would cross the stage edge — the same delta for every
 * element in the group, so a multi-selection, a paste, or a duplicate keeps
 * its relative layout instead of each member clamping to a different edge.
 * Returns the delta unchanged when it doesn't push the group past the margin.
 * Resize never routes through this — a handle drag is already bounded by the
 * pointer driving it.
 */
export function clampDelta(elements: InkEl[], dx: number, dy: number): [number, number] {
  if (!elements.length) return [dx, dy]
  const box = boundsOfMany(elements)
  const x = box.x + dx
  const y = box.y + dy
  let cx = dx
  let cy = dy
  if (x + box.w < STAGE_MARGIN) cx = STAGE_MARGIN - box.w - box.x
  else if (x > STAGE_W - STAGE_MARGIN) cx = STAGE_W - STAGE_MARGIN - box.x
  if (y + box.h < STAGE_MARGIN) cy = STAGE_MARGIN - box.h - box.y
  else if (y > STAGE_H - STAGE_MARGIN) cy = STAGE_H - STAGE_MARGIN - box.y
  return [cx, cy]
}

/**
 * How far the pointer may travel and still count as a click rather than a drag.
 * In CSS pixels, because it is a fact about a hand on a trackpad — not about the
 * stage, whose units are ~1.5x smaller than a pixel at a typical window size, so
 * a threshold expressed in them made every real click a drag.
 */
export const CLICK_SLOP_PX = 4

/** That slop in stage units, for the stage as it is currently drawn. */
export function stageSlop(cssWidth: number): number {
  return CLICK_SLOP_PX * (STAGE_W / (cssWidth || STAGE_W))
}

/** Normalize a free-form drag into an axis-aligned box, whichever corner it started from. */
export function boxFromDrag(from: [number, number], to: [number, number]): Box {
  const x = Math.min(from[0], to[0])
  const y = Math.min(from[1], to[1])
  return { x, y, w: Math.abs(to[0] - from[0]), h: Math.abs(to[1] - from[1]) }
}

/**
 * Whether two boxes overlap at all. The marquee uses intersection rather than
 * full enclosure — direction-independent and far more forgiving on a trackpad
 * than requiring every element to be fully inside the drag.
 */
export function boxesIntersect(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

/** Rough box around a text element — enough for the eraser to grab it. */
export function textBox(el: Pick<TextEl, 'x' | 'y' | 'text' | 'fontSize'>): Box {
  const lines = el.text.split('\n')
  const longest = lines.reduce((n, l) => Math.max(n, l.length), 0)
  return {
    x: el.x,
    y: el.y - el.fontSize * 0.78,
    w: longest * el.fontSize * 0.4,
    h: lines.length * el.fontSize * 1.02,
  }
}

/** Constrain a drag to a square / circle, keeping the drag direction. */
export function squareOff(from: [number, number], to: [number, number]): [number, number] {
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  const side = Math.max(Math.abs(dx), Math.abs(dy))
  return [from[0] + Math.sign(dx || 1) * side, from[1] + Math.sign(dy || 1) * side]
}

/** Snap a drag to the nearest 15° so trackpad lines stay clean. */
export function snapAngle(from: [number, number], to: [number, number]): [number, number] {
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  const len = Math.hypot(dx, dy)
  const step = Math.PI / 12
  const angle = Math.round(Math.atan2(dy, dx) / step) * step
  return [from[0] + Math.cos(angle) * len, from[1] + Math.sin(angle) * len]
}

function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/**
 * Whole-stroke erase (not pixel erase) — reads far cleaner on a recording than
 * chewing holes in a line, and keeps everything vector.
 */
function nearPolyline(pts: number[][], x: number, y: number, r: number): boolean {
  for (let i = 0; i < pts.length - 1; i++) {
    if (distToSegment(x, y, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]) <= r) return true
  }
  return false
}

export function hitsElement(el: InkEl, x: number, y: number, radius: number): boolean {
  if (el.kind === 'arrow') {
    const r = radius + el.style.strokeWidth
    return distToSegment(x, y, el.from[0], el.from[1], el.to[0], el.to[1]) <= r
  }
  if (el.kind === 'shape') {
    return nearPolyline(shapeOutline(el), x, y, radius + el.style.strokeWidth)
  }
  if (el.kind === 'text' || el.kind === 'image') {
    const b = el.kind === 'text' ? textBox(el) : el
    return (
      x >= b.x - radius && x <= b.x + b.w + radius && y >= b.y - radius && y <= b.y + b.h + radius
    )
  }
  const pts = el.points
  const r = radius + el.style.strokeWidth / 2
  if (pts.length === 1) return Math.hypot(x - pts[0][0], y - pts[0][1]) <= r
  for (let i = 0; i < pts.length - 1; i++) {
    if (distToSegment(x, y, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]) <= r) return true
  }
  return false
}

/* ------------------------------------------------------------ load boundary */

type Raw = Record<string, unknown>

const num = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

const str = (v: unknown, fallback: string) => (typeof v === 'string' && v ? v : fallback)

function readPoint(v: unknown): [number, number] | null {
  if (!Array.isArray(v) || typeof v[0] !== 'number' || typeof v[1] !== 'number') return null
  return [v[0], v[1]]
}

function readPoints(v: unknown): number[][] | null {
  if (!Array.isArray(v) || !v.length) return null
  const pts: number[][] = []
  for (const p of v) {
    const xy = readPoint(p)
    if (!xy) return null
    // Pressure is what the pointer reported; 0.5 is the same stand-in drawing uses.
    pts.push([xy[0], xy[1], num((p as unknown[])[2], 0.5)])
  }
  return pts
}

/**
 * `width` is the fallback for a row that names no size. Text passes 0: its legacy
 * `size` is a font size and belongs to `fontSize`, not to a stroke width.
 */
function readStyle(raw: Raw, width: number): ElStyle {
  const s = (typeof raw.style === 'object' && raw.style !== null ? raw.style : {}) as Raw
  return {
    stroke: str(s.stroke, str(raw.color, DEFAULT_STROKE)),
    fill: typeof s.fill === 'string' && s.fill ? s.fill : null,
    strokeWidth: num(s.strokeWidth, width),
    opacity: num(s.opacity, num(raw.opacity, 1)),
  }
}

/**
 * The single boundary between what is on disk and what the app runs on. Decks written
 * before styles were grouped carry flat `color` / `size` / `opacity`; both shapes go in
 * and only the current one comes out, so no renderer, hit-test or geometry function
 * ever needs a fallback. Junk returns null for the caller to drop.
 *
 * There is no version field on purpose: one always-latest writer, dev-server only. A
 * slide upgrades on disk the next time it is saved.
 */
export function normalizeEl(raw: unknown): InkEl | null {
  if (!raw || typeof raw !== 'object') return null
  const el = raw as Raw
  const id = str(el.id, uid())

  switch (el.kind) {
    case 'stroke': {
      const points = readPoints(el.points)
      if (!points) return null
      const style = readStyle(el, num(el.size, TOOL_SIZE.pen))
      return {
        id,
        kind: 'stroke',
        // Before opacity was editable, a dimmed stroke could only have been a
        // highlighter — which is exactly what makes deriving it now unsafe.
        brush:
          el.brush === 'highlighter' || el.brush === 'pen'
            ? el.brush
            : style.opacity < 1
              ? 'highlighter'
              : 'pen',
        style,
        points,
      }
    }
    case 'arrow':
    case 'shape': {
      const from = readPoint(el.from)
      const to = readPoint(el.to)
      if (!from || !to) return null
      const kindDefault = el.kind === 'arrow' ? TOOL_SIZE.arrow : TOOL_SIZE.shape
      const style = readStyle(el, num(el.size, kindDefault))
      if (el.kind === 'arrow') return { id, kind: 'arrow', style, from, to }
      const shape = SHAPE_ORDER.find((s) => s === el.shape) ?? 'rect'
      return { id, kind: 'shape', shape, style, from, to }
    }
    case 'text': {
      if (typeof el.text !== 'string') return null
      return {
        id,
        kind: 'text',
        style: readStyle(el, 0),
        fontSize: num(el.fontSize, num(el.size, TOOL_SIZE.text)),
        x: num(el.x, 0),
        y: num(el.y, 0),
        text: el.text,
      }
    }
    case 'image': {
      if (typeof el.src !== 'string' || !el.src) return null
      return {
        id,
        kind: 'image',
        src: el.src,
        style: readStyle(el, 0),
        x: num(el.x, 0),
        y: num(el.y, 0),
        w: num(el.w, 0),
        h: num(el.h, 0),
      }
    }
    default:
      return null
  }
}

function imagesFirst(els: InkEl[]): InkEl[] {
  const images = els.filter((el) => el.kind === 'image')
  if (!images.length || images.length === els.length) return els
  return [...images, ...els.filter((el) => el.kind !== 'image')]
}

/** A grouped `style` object is the marker of a row this code wrote. Anything
 *  without one is flat-shaped and therefore predates array order meaning z-order. */
function isLegacyRow(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false
  const style = (raw as Raw).style
  return typeof style !== 'object' || style === null
}

/**
 * A slide's elements as the app runs on them, and the second half of the load
 * boundary: array position is z-order — the last element draws on top, which is
 * what Front/Back move.
 *
 * Decks written before that was true leaned on the renderer force-sorting images
 * behind the vector ink, so a drawing was never hidden by a paste. Those slides
 * are partitioned on the way in, which reproduces exactly that appearance. A
 * slide whose rows all carry a `style` object came from this code, so its order
 * is a decision someone made and is trusted verbatim — partitioning it too would
 * mean "bring this image to front" silently undid itself on the next reload.
 */
export function normalizeSlide(raw: unknown): InkEl[] {
  const rows = Array.isArray(raw) ? raw : []
  const els: InkEl[] = []
  let legacy = false
  for (const row of rows) {
    const el = normalizeEl(row)
    if (!el) continue
    if (isLegacyRow(row)) legacy = true
    els.push(el)
  }
  return legacy ? imagesFirst(els) : els
}
