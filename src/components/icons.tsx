import type { ShapeKind } from '../types'

/** The house icon: one 24-grid stroked path, plus whatever else it needs. */
export const icon = (d: string, extra?: React.ReactNode) => (
  <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
    {extra}
  </svg>
)

/** The shape vocabulary, shared by the rail's button (which wears the shape it
 *  will draw next) and the property bar's swap row. */
export const SHAPE_ICON: Record<ShapeKind, React.ReactNode> = {
  rect: icon('M4.5 5.5h15v13h-15z'),
  ellipse: (
    <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6">
      <ellipse cx="12" cy="12" rx="8.5" ry="7" />
    </svg>
  ),
  triangle: icon('M12 4.5L20 19H4z'),
  line: icon('M4.5 19.5L19.5 4.5'),
}

export const SHAPE_LABEL: Record<ShapeKind, string> = {
  rect: 'Square',
  ellipse: 'Oval',
  triangle: 'Triangle',
  line: 'Line',
}
