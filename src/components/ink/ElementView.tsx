import type { InkEl, TextEl } from '../../types'
import { arrowToPath, shapeToPath, strokeToPath, textBox } from '../../lib/ink'

export function TextElement({ el }: { el: TextEl }) {
  const lines = el.text.split('\n')
  return (
    <text
      x={el.x}
      y={el.y}
      fill={el.style.stroke}
      opacity={el.style.opacity}
      fontSize={el.fontSize}
      fontFamily="Caveat, cursive"
      fontWeight={600}
      style={{ whiteSpace: 'pre' }}
    >
      {lines.map((line, i) => (
        <tspan key={i} x={el.x} dy={i === 0 ? 0 : el.fontSize * 1.02}>
          {line || ' '}
        </tspan>
      ))}
    </text>
  )
}

export function Visual({ el }: { el: InkEl }) {
  if (el.kind === 'image') {
    return (
      <image
        href={`/stories-assets/${encodeURIComponent(el.src)}`}
        x={el.x}
        y={el.y}
        width={el.w}
        height={el.h}
        opacity={el.style.opacity}
        preserveAspectRatio="xMidYMid meet"
      />
    )
  }
  if (el.kind === 'arrow' || el.kind === 'shape') {
    return (
      <path
        d={el.kind === 'arrow' ? arrowToPath(el) : shapeToPath(el)}
        // Only a closed shape has an interior; filling an arrow would fill its head.
        fill={(el.kind === 'shape' && el.style.fill) || 'none'}
        stroke={el.style.stroke}
        strokeWidth={el.style.strokeWidth}
        opacity={el.style.opacity}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    )
  }
  if (el.kind === 'text') return <TextElement el={el} />
  return (
    <path
      d={strokeToPath(el)}
      fill={el.style.stroke}
      opacity={el.style.opacity}
      className={el.brush === 'highlighter' ? 'ink-highlight' : undefined}
    />
  )
}

/**
 * An invisible, fatter copy of the element so a 7px line is still easy to grab
 * with a trackpad. Closed shapes hit-test on their outline only, so a rectangle
 * drawn around content doesn't swallow clicks meant for the slide underneath.
 */
export function HitArea({ el }: { el: InkEl }) {
  if (el.kind === 'text' || el.kind === 'image') {
    const b = el.kind === 'text' ? textBox(el) : el
    return <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="none" pointerEvents="all" />
  }
  if (el.kind === 'arrow' || el.kind === 'shape') {
    const closed = el.kind === 'shape' && el.shape !== 'line'
    return (
      <path
        d={el.kind === 'arrow' ? arrowToPath(el) : shapeToPath(el)}
        fill="none"
        stroke="transparent"
        strokeWidth={el.style.strokeWidth + 24}
        pointerEvents={closed ? 'stroke' : 'all'}
      />
    )
  }
  return (
    <path
      d={strokeToPath(el)}
      fill="transparent"
      stroke="transparent"
      strokeWidth={18}
      pointerEvents="all"
    />
  )
}
