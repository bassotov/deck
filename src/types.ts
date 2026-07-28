export type SlideLayout =
  | 'title'
  | 'center'
  | 'quote'
  | 'columns'
  | 'flow'
  | 'stats'
  | 'versus'
  | 'timeline'
  | 'image'
  | 'default'

export const LAYOUTS: readonly SlideLayout[] = [
  'title',
  'center',
  'quote',
  'columns',
  'flow',
  'stats',
  'versus',
  'timeline',
  'image',
  'default',
]

export interface Slide {
  /** Stable within a story: annotations are keyed by this. */
  key: string
  index: number
  layout: SlideLayout
  heading: string | null
  /** Heading, or the opening words — whatever names the slide in the outline. */
  preview: string
  html: string
  note: string | null
}

export interface Story {
  slug: string
  title: string
  subtitle: string | null
  slides: Slide[]
  mtime: number
}

export type Tool = 'cursor' | 'pen' | 'highlighter' | 'arrow' | 'shape' | 'text' | 'eraser'

export type ShapeKind = 'rect' | 'ellipse' | 'triangle' | 'line'

/** A rectangle in stage units — a bounding box, or a box to map one into. */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/**
 * The visual style every annotation carries. One shape for all kinds, so an edit
 * ("make this thinner") is written once rather than per element type.
 */
export interface ElStyle {
  /** The mark's own colour. Rendered as SVG fill for freehand + text, stroke for arrow/shape. */
  stroke: string
  /** Interior fill. Only meaningful for closed shapes (rect/ellipse/triangle); null elsewhere. */
  fill: string | null
  strokeWidth: number
  opacity: number
}

export interface StrokeEl {
  id: string
  kind: 'stroke'
  style: ElStyle
  /**
   * Which nib drew it. Stored, never derived from opacity: opacity is an editable
   * property, so a pen stroke dimmed to 60% must not start rendering with the
   * highlighter's flat, taper-less geometry.
   */
  brush: 'pen' | 'highlighter'
  /** [x, y, pressure] in the fixed 1600x900 stage space. */
  points: number[][]
}

export interface ArrowEl {
  id: string
  kind: 'arrow'
  style: ElStyle
  from: [number, number]
  to: [number, number]
}

export interface ShapeEl {
  id: string
  kind: 'shape'
  shape: ShapeKind
  style: ElStyle
  from: [number, number]
  to: [number, number]
}

export interface TextEl {
  id: string
  kind: 'text'
  /** Text is filled, not stroked — `style.strokeWidth` is unused and stays 0. */
  style: ElStyle
  fontSize: number
  x: number
  y: number
  text: string
}

/**
 * A pasted screenshot. It lives on the ink layer, not in the markdown, so it
 * floats over the slide without touching the layout — and gets undo, drag and
 * delete for free like any other annotation.
 */
export interface ImageEl {
  id: string
  kind: 'image'
  /** Filename under `Content/Stories/images/`, resolved by the asset server. */
  src: string
  /** Only `opacity` means anything here; the rest exists so every element is uniform. */
  style: ElStyle
  x: number
  y: number
  w: number
  h: number
}

export type InkEl = StrokeEl | ArrowEl | ShapeEl | TextEl | ImageEl

/**
 * The style the next mark is drawn with. Editing a property on a selection writes
 * back here too, so "make it thinner" sticks for the mark after it as well.
 */
export interface DrawStyle {
  stroke: string
  /** Interior of the next closed shape; null draws it hollow. */
  fill: string | null
  /**
   * Width as a multiple of each tool's own default, never an absolute size: 8px
   * is a regular pen line and a hairline highlighter, so one number can't mean
   * the same thing across nibs.
   */
  widthScale: number
  opacity: number
  fontSize: number
  /** The one remembered custom colour, overwritten by the next ⊕ pick. */
  custom: string | null
}

/** slide.key -> elements. Array order is z-order: the last element draws on top. */
export type StoryInk = Record<string, InkEl[]>
