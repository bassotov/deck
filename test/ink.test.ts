import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CLICK_SLOP_PX,
  HANDLES,
  RESIZE_MIN,
  STAGE_H,
  STAGE_MARGIN,
  STAGE_W,
  TOOL_ORDER,
  boundsOf,
  boundsOfMany,
  boxFromDrag,
  boxesIntersect,
  clampDelta,
  hitsElement,
  makeStyle,
  normalizeEl,
  normalizeSlide,
  placeImage,
  resizeBox,
  scaleEl,
  snapAngle,
  squareOff,
  stageSlop,
  translateEl,
} from '../src/lib/ink.ts'
import type { InkEl } from '../src/types.ts'

const handle = (pos: string) => HANDLES.find((h) => h.pos === pos)!
const none = { aspect: false, fromCenter: false }

const arrow = (from: [number, number], to: [number, number]): InkEl => ({
  id: 'a',
  kind: 'arrow',
  style: makeStyle({ strokeWidth: 4 }),
  from,
  to,
})

/* ------------------------------------------------------------- load boundary */

test('normalizeEl converts a flat legacy stroke to the grouped style', () => {
  const el = normalizeEl({
    id: 's1',
    kind: 'stroke',
    color: '#2563EB',
    size: 6,
    points: [
      [0, 0, 0.3],
      [10, 10],
    ],
  })
  assert.ok(el && el.kind === 'stroke')
  assert.equal(el.style.stroke, '#2563EB')
  assert.equal(el.style.strokeWidth, 6)
  assert.equal(el.style.opacity, 1)
  assert.deepEqual(el.points, [
    [0, 0, 0.3],
    [10, 10, 0.5], // missing pressure gets the drawing stand-in
  ])
})

test('a legacy dimmed stroke is a highlighter; an explicit brush wins', () => {
  const pts = [[0, 0]]
  const dim = normalizeEl({ kind: 'stroke', opacity: 0.4, points: pts })
  assert.ok(dim && dim.kind === 'stroke')
  assert.equal(dim.brush, 'highlighter')
  assert.equal(dim.style.opacity, 0.4)

  // The reason the brush is stored: a dimmed *pen* stroke must stay a pen.
  const pen = normalizeEl({ kind: 'stroke', brush: 'pen', style: { opacity: 0.4 }, points: pts })
  assert.ok(pen && pen.kind === 'stroke')
  assert.equal(pen.brush, 'pen')
})

test('text keeps its legacy size as a font size, not a stroke width', () => {
  const el = normalizeEl({ kind: 'text', text: 'hi', size: 40, x: 5, y: 6 })
  assert.ok(el && el.kind === 'text')
  assert.equal(el.fontSize, 40)
  assert.equal(el.style.strokeWidth, 0)
})

test('shape falls back to rect for an unknown shape name', () => {
  const el = normalizeEl({ kind: 'shape', shape: 'hexagon', from: [0, 0], to: [5, 5] })
  assert.ok(el && el.kind === 'shape')
  assert.equal(el.shape, 'rect')
})

test('normalizeEl drops junk rather than guessing', () => {
  for (const bad of [
    null,
    'str',
    42,
    {},
    { kind: 'nope' },
    { kind: 'stroke', points: [] },
    { kind: 'stroke', points: [['a', 'b']] },
    { kind: 'arrow', from: [0, 0] },
    { kind: 'text', text: 7 },
    { kind: 'image', src: '' },
  ]) {
    assert.equal(normalizeEl(bad), null, JSON.stringify(bad))
  }
})

test('non-finite numbers fall back instead of poisoning the geometry', () => {
  const el = normalizeEl({ kind: 'text', text: 'x', x: Infinity, y: NaN, size: 30 })
  assert.ok(el && el.kind === 'text')
  assert.equal(el.x, 0)
  assert.equal(el.y, 0)
})

const legacyImage = { id: 'img', kind: 'image', src: 'a.png', x: 0, y: 0, w: 10, h: 10 }
const legacyArrow = { id: 'arr', kind: 'arrow', from: [0, 0], to: [9, 9], color: '#17161A', size: 3 }
const styled = (row: object) => ({ ...row, style: { stroke: '#FF5A1F', fill: null, strokeWidth: 3, opacity: 1 } })

test('a slide with legacy rows is partitioned images-first', () => {
  const ids = normalizeSlide([legacyArrow, legacyImage]).map((e) => e.id)
  assert.deepEqual(ids, ['img', 'arr'])
})

test('a slide whose rows all carry a style keeps its order verbatim', () => {
  // "Bring image to front" must survive a reload.
  const ids = normalizeSlide([styled(legacyImage), styled(legacyArrow)].reverse()).map((e) => e.id)
  assert.deepEqual(ids, ['arr', 'img'])
  assert.deepEqual(normalizeSlide([styled(legacyArrow), styled(legacyImage)]).map((e) => e.id), ['arr', 'img'])
})

test('normalizeSlide tolerates non-arrays and drops bad rows', () => {
  assert.deepEqual(normalizeSlide(undefined), [])
  assert.deepEqual(normalizeSlide({ not: 'an array' }), [])
  assert.deepEqual(normalizeSlide([null, { kind: 'x' }]), [])
})

test('normalizeSlide is idempotent on its own output', () => {
  const once = normalizeSlide([legacyArrow, legacyImage])
  assert.deepEqual(normalizeSlide(JSON.parse(JSON.stringify(once))), once)
})

/* ------------------------------------------------------------------ geometry */

test('click slop is 4 CSS px converted through the live stage scale', () => {
  assert.equal(CLICK_SLOP_PX, 4)
  assert.equal(stageSlop(STAGE_W), 4) // stage drawn 1:1
  assert.equal(stageSlop(STAGE_W / 2), 8) // half-size window: a pixel covers 2 units
  assert.equal(stageSlop(0), 4) // not laid out yet: no divide-by-zero
})

test('boxFromDrag is direction-independent', () => {
  const box = { x: 10, y: 20, w: 30, h: 40 }
  assert.deepEqual(boxFromDrag([10, 20], [40, 60]), box)
  assert.deepEqual(boxFromDrag([40, 60], [10, 20]), box)
  assert.deepEqual(boxFromDrag([40, 20], [10, 60]), box)
})

test('boxesIntersect is overlap, not enclosure, and edges merely touching do not count', () => {
  const a = { x: 0, y: 0, w: 10, h: 10 }
  assert.ok(boxesIntersect(a, { x: 9, y: 9, w: 10, h: 10 }))
  assert.ok(boxesIntersect(a, { x: 2, y: 2, w: 1, h: 1 }))
  assert.ok(!boxesIntersect(a, { x: 10, y: 0, w: 5, h: 5 }))
  assert.ok(!boxesIntersect(a, { x: 20, y: 20, w: 5, h: 5 }))
})

test('squareOff keeps the drag direction and takes the longer side', () => {
  assert.deepEqual(squareOff([0, 0], [30, 10]), [30, 30])
  assert.deepEqual(squareOff([0, 0], [-10, -30]), [-30, -30])
  assert.deepEqual(squareOff([5, 5], [5, 5]), [5, 5])
})

test('snapAngle snaps to 15° and preserves length', () => {
  const [x, y] = snapAngle([0, 0], [100, 3]) // ~1.7° -> 0°
  assert.ok(Math.abs(x - Math.hypot(100, 3)) < 1e-9)
  assert.ok(Math.abs(y) < 1e-9)
  const [dx, dy] = snapAngle([0, 0], [100, 95]) // ~43.5° -> 45°
  assert.ok(Math.abs(dx - dy) < 1e-9)
  assert.ok(Math.abs(Math.hypot(dx, dy) - Math.hypot(100, 95)) < 1e-9)
})

test('translateEl moves every kind and does not mutate the original', () => {
  const a = arrow([0, 0], [10, 10])
  const moved = translateEl(a, 5, -5)
  assert.ok(moved.kind === 'arrow')
  assert.deepEqual([moved.from, moved.to], [[5, -5], [15, 5]])
  assert.deepEqual(a.kind === 'arrow' && a.from, [0, 0])
})

test('boundsOf pads a stroke by its width and boundsOfMany unions', () => {
  const stroke = normalizeEl({
    kind: 'stroke',
    style: { strokeWidth: 10 },
    points: [[0, 0], [100, 50]],
  })!
  assert.deepEqual(boundsOf(stroke), { x: -5, y: -5, w: 110, h: 60 })
  const union = boundsOfMany([arrow([0, 0], [10, 10]), arrow([50, 60], [70, 90])])
  assert.deepEqual(union, { x: 0, y: 0, w: 70, h: 90 })
  assert.deepEqual(boundsOfMany([]), { x: 0, y: 0, w: 0, h: 0 })
})

test('scaleEl maps into the new box; width follows the geometric mean', () => {
  const a = arrow([0, 0], [100, 100])
  const out = scaleEl(a, { x: 0, y: 0, w: 100, h: 100 }, { x: 10, y: 10, w: 200, h: 50 })
  assert.ok(out.kind === 'arrow')
  assert.deepEqual([out.from, out.to], [[10, 10], [210, 60]])
  // sx=2, sy=0.5: √(2·0.5)=1, so the stroke keeps its thickness.
  assert.ok(Math.abs(out.style.strokeWidth - 4) < 1e-9)
})

test('scaleEl survives a zero-extent source axis', () => {
  const flat = arrow([0, 50], [100, 50]) // perfectly horizontal
  const out = scaleEl(flat, { x: 0, y: 50, w: 100, h: 0 }, { x: 0, y: 50, w: 200, h: 0 })
  assert.ok(out.kind === 'arrow')
  assert.deepEqual([out.from, out.to], [[0, 50], [200, 50]])
})

/* ------------------------------------------------------------------- resize */

const box = { x: 100, y: 100, w: 200, h: 100 }

test('a corner drag pins the opposite corner', () => {
  assert.deepEqual(resizeBox(box, handle('se'), [400, 300], none), { x: 100, y: 100, w: 300, h: 200 })
  assert.deepEqual(resizeBox(box, handle('nw'), [50, 50], none), { x: 50, y: 50, w: 250, h: 150 })
})

test('an edge drag changes one axis only', () => {
  assert.deepEqual(resizeBox(box, handle('e'), [500, 999], none), { x: 100, y: 100, w: 400, h: 100 })
  assert.deepEqual(resizeBox(box, handle('s'), [999, 400], none), { x: 100, y: 100, w: 200, h: 300 })
})

test('dragging past the anchor parks at the minimum instead of flipping', () => {
  const out = resizeBox(box, handle('se'), [0, 0], none)
  assert.equal(out.w, RESIZE_MIN)
  assert.equal(out.h, RESIZE_MIN)
  assert.equal(out.x, 100)
  assert.equal(out.y, 100)
})

test('aspect lock keeps the ratio, even from an edge handle', () => {
  const out = resizeBox(box, handle('se'), [500, 150], { aspect: true, fromCenter: false })
  assert.equal(out.w / out.h, 2)
  const edge = resizeBox(box, handle('e'), [500, 0], { aspect: true, fromCenter: false })
  assert.equal(edge.w, 400)
  assert.equal(edge.h, 200)
})

test('from-centre resizes symmetrically', () => {
  const out = resizeBox(box, handle('e'), [400, 0], { aspect: false, fromCenter: true })
  // Centre x is 200; pointer 200 away doubles to a 400-wide box.
  assert.deepEqual(out, { x: 0, y: 100, w: 400, h: 100 })
})

test('aspect lock on a degenerate box does not divide by zero', () => {
  const flat = { x: 0, y: 0, w: 100, h: 0 }
  const out = resizeBox(flat, handle('e'), [200, 0], { aspect: true, fromCenter: false })
  assert.ok(Number.isFinite(out.w) && Number.isFinite(out.h))
})

/* ----------------------------------------------------------------- placement */

test('clampDelta leaves a harmless move alone', () => {
  assert.deepEqual(clampDelta([arrow([100, 100], [200, 200])], 50, 50), [50, 50])
  assert.deepEqual(clampDelta([], 9999, 9999), [9999, 9999])
})

test('clampDelta never lets a group leave the stage entirely', () => {
  const a = arrow([100, 100], [200, 200])
  const [dx, dy] = clampDelta([a], 99999, -99999)
  const moved = boundsOf(translateEl(a, dx, dy))
  assert.equal(moved.x, STAGE_W - STAGE_MARGIN)
  assert.equal(moved.y + moved.h, STAGE_MARGIN)
  const [lx] = clampDelta([a], -99999, 0)
  assert.equal(boundsOf(translateEl(a, lx, 0)).x + 100, STAGE_MARGIN)
})

test('placeImage fits into the box, centres, and cascades every paste', () => {
  const first = placeImage({ w: 1400, h: 520 }, 0)
  assert.deepEqual([first.w, first.h], [700, 260])
  assert.deepEqual([first.x, first.y], [450, 320])
  const second = placeImage({ w: 1400, h: 520 }, 1)
  assert.deepEqual([second.x - first.x, second.y - first.y], [46, 46])
  // The cascade wraps rather than walking off the stage.
  assert.deepEqual(placeImage({ w: 1400, h: 520 }, 5), first)
  assert.ok(STAGE_H > 0)
})

/* ---------------------------------------------------------------- hit-testing */

test('a thin line is still grabbable within the radius', () => {
  const a = arrow([0, 0], [100, 0])
  assert.ok(hitsElement(a, 50, 5, 4)) // 5 away, reach is radius + width = 8
  assert.ok(!hitsElement(a, 50, 20, 4))
  assert.ok(hitsElement(a, -3, 0, 4)) // just past the end
})

test('a closed shape hits on its outline only, so it does not swallow the slide', () => {
  const rect = normalizeEl({
    kind: 'shape',
    shape: 'rect',
    style: { strokeWidth: 4 },
    from: [100, 100],
    to: [500, 400],
  })!
  assert.ok(hitsElement(rect, 100, 250, 4)) // on the left edge
  assert.ok(!hitsElement(rect, 300, 250, 4)) // dead centre
})

test('text and images hit anywhere in their box', () => {
  const img = normalizeEl({ kind: 'image', src: 'a.png', x: 10, y: 10, w: 100, h: 100 })!
  assert.ok(hitsElement(img, 60, 60, 0))
  assert.ok(!hitsElement(img, 200, 60, 4))
  const text = normalizeEl({ kind: 'text', text: 'hello', x: 100, y: 100, fontSize: 40 })!
  assert.ok(hitsElement(text, 110, 95, 0))
  assert.ok(!hitsElement(text, 600, 95, 4))
})

test('a single-point stroke (a dot) is hittable', () => {
  const dot = normalizeEl({ kind: 'stroke', style: { strokeWidth: 8 }, points: [[50, 50]] })!
  assert.ok(hitsElement(dot, 52, 50, 2))
  assert.ok(!hitsElement(dot, 80, 50, 2))
})

/* ---------------------------------------------------------------------- keys */

test('tool digits come from TOOL_ORDER, cursor first and eraser last', () => {
  assert.equal(TOOL_ORDER[0], 'cursor')
  assert.equal(TOOL_ORDER[TOOL_ORDER.length - 1], 'eraser')
  assert.equal(new Set(TOOL_ORDER).size, TOOL_ORDER.length)
})
