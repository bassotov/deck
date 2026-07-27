import { getStroke } from 'perfect-freehand'
import type { ArrowEl, InkEl, ShapeEl, ShapeKind, StrokeEl, TextEl, Tool } from '../types'

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

export const uid = () => Math.random().toString(36).slice(2, 10)

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

export function strokeToPath(el: Pick<StrokeEl, 'points' | 'size' | 'opacity'>): string {
  const base = el.opacity < 1 ? HIGHLIGHTER_OPTS : PEN_OPTS
  return svgFromOutline(getStroke(el.points, { ...base, size: el.size }))
}

export function arrowToPath({ from, to, size }: Pick<ArrowEl, 'from' | 'to' | 'size'>): string {
  const [x1, y1] = from
  const [x2, y2] = to
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const len = Math.hypot(x2 - x1, y2 - y1)
  const head = Math.min(len * 0.34, size * 6.5)
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
      return { ...el, x: el.x + dx, y: el.y + dy }
  }
}

/** Rough box around a text element — enough for the eraser to grab it. */
export function textBox(el: TextEl) {
  const lines = el.text.split('\n')
  const longest = lines.reduce((n, l) => Math.max(n, l.length), 0)
  return {
    x: el.x,
    y: el.y - el.size * 0.78,
    w: longest * el.size * 0.4,
    h: lines.length * el.size * 1.02,
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
    return distToSegment(x, y, el.from[0], el.from[1], el.to[0], el.to[1]) <= radius + el.size
  }
  if (el.kind === 'shape') {
    return nearPolyline(shapeOutline(el), x, y, radius + el.size)
  }
  if (el.kind === 'text') {
    const b = textBox(el)
    return (
      x >= b.x - radius && x <= b.x + b.w + radius && y >= b.y - radius && y <= b.y + b.h + radius
    )
  }
  const pts = el.points
  const r = radius + el.size / 2
  if (pts.length === 1) return Math.hypot(x - pts[0][0], y - pts[0][1]) <= r
  for (let i = 0; i < pts.length - 1; i++) {
    if (distToSegment(x, y, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]) <= r) return true
  }
  return false
}
