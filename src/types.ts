export type SlideLayout = 'title' | 'center' | 'quote' | 'columns' | 'default'

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

export interface StrokeEl {
  id: string
  kind: 'stroke'
  color: string
  size: number
  opacity: number
  /** [x, y, pressure] in the fixed 1600x900 stage space. */
  points: number[][]
}

export interface ArrowEl {
  id: string
  kind: 'arrow'
  color: string
  size: number
  from: [number, number]
  to: [number, number]
}

export interface ShapeEl {
  id: string
  kind: 'shape'
  shape: ShapeKind
  color: string
  size: number
  from: [number, number]
  to: [number, number]
}

export interface TextEl {
  id: string
  kind: 'text'
  color: string
  size: number
  x: number
  y: number
  text: string
}

export type InkEl = StrokeEl | ArrowEl | ShapeEl | TextEl

/** slide.key -> elements */
export type StoryInk = Record<string, InkEl[]>
