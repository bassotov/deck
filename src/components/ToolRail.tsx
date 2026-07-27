import type { ShapeKind, Tool } from '../types'
import { INK_COLORS, TOOL_ORDER } from '../lib/ink'

interface Props {
  tool: Tool
  shape: ShapeKind
  color: string
  idle: boolean
  canUndo: boolean
  canRedo: boolean
  hasInk: boolean
  onTool: (t: Tool) => void
  onColor: (c: string) => void
  onUndo: () => void
  onRedo: () => void
  onClear: () => void
}

const icon = (d: string, extra?: React.ReactNode) => (
  <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
    {extra}
  </svg>
)

/** Keyed by tool; the rail renders in TOOL_ORDER so the digits always match. */
/** The shape button wears whatever shape it will draw next. */
const SHAPE_ICON: Record<ShapeKind, React.ReactNode> = {
  rect: icon('M4.5 5.5h15v13h-15z'),
  ellipse: (
    <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6">
      <ellipse cx="12" cy="12" rx="8.5" ry="7" />
    </svg>
  ),
  triangle: icon('M12 4.5L20 19H4z'),
  line: icon('M4.5 19.5L19.5 4.5'),
}

const SHAPE_LABEL: Record<ShapeKind, string> = {
  rect: 'Square',
  ellipse: 'Oval',
  triangle: 'Triangle',
  line: 'Line',
}

const TOOL_META: Record<Tool, { alias: string; label: string; svg: React.ReactNode }> = {
  cursor: { alias: 'V', label: 'Select & move', svg: icon('M5 3l6.5 16 2.2-6.4L20 10.5z') },
  pen: { alias: 'P', label: 'Pen', svg: icon('M4 20l4.5-1.2L20 7.3a2 2 0 0 0-2.8-2.8L5.7 15.9z') },
  highlighter: {
    alias: 'H',
    label: 'Highlighter',
    svg: icon('M6 15l7.5-7.5a2 2 0 0 1 2.8 0l1.2 1.2a2 2 0 0 1 0 2.8L10 19H6z', <path d="M4 21h16" />),
  },
  arrow: { alias: 'A', label: 'Arrow', svg: icon('M5 19L19 5M19 5h-7M19 5v7') },
  shape: { alias: 'S', label: 'Shape', svg: null },
  text: { alias: 'T', label: 'Text', svg: icon('M5 6.5V5h14v1.5M12 5v14M9 19h6') },
  eraser: {
    alias: 'E',
    label: 'Eraser',
    svg: icon('M8.5 20H20M4.5 16.5l7-7a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 1 0 2.8L13 20H7.5z'),
  },
}

function RailButton({
  active,
  disabled,
  title,
  onClick,
  children,
}: {
  active?: boolean
  disabled?: boolean
  title: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`relative flex size-9 items-center justify-center rounded-lg transition-colors ${
        active
          ? 'bg-accent text-black'
          : disabled
            ? 'text-white/15'
            : 'text-[#a9a29c] hover:bg-white/[0.07] hover:text-[#e8e4e0]'
      }`}
    >
      {children}
    </button>
  )
}

export default function ToolRail({
  tool,
  shape,
  color,
  idle,
  canUndo,
  canRedo,
  hasInk,
  onTool,
  onColor,
  onUndo,
  onRedo,
  onClear,
}: Props) {
  return (
    <div
      data-idle={idle}
      className="rail pointer-events-auto flex flex-col items-center gap-1 rounded-2xl border border-white/[0.08] bg-[#1a1918] p-1.5 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.9)]"
    >
      {TOOL_ORDER.map((id, i) => {
        const meta = TOOL_META[id]
        const active = tool === id
        const isShape = id === 'shape'
        return (
          <RailButton
            key={id}
            active={active}
            title={
              isShape
                ? `${SHAPE_LABEL[shape]}  ·  ${i + 1} again to cycle shape`
                : `${meta.label}  ·  ${i + 1}  or  ${meta.alias}`
            }
            onClick={() => onTool(id)}
          >
            {isShape ? SHAPE_ICON[shape] : meta.svg}
            <span
              className={`absolute right-1 bottom-0.5 font-mono text-[8px] leading-none ${
                active ? 'text-black/45' : 'text-white/25'
              }`}
            >
              {i + 1}
            </span>
          </RailButton>
        )
      })}

      <div className="my-1 h-px w-6 bg-white/10" />

      <div className="flex flex-col items-center gap-1.5 py-1">
        {INK_COLORS.map((c, i) => (
          <button
            key={c.value}
            title={`${c.name}  ·  ⇧${i + 1}  ·  C cycles`}
            onClick={() => onColor(c.value)}
            className={`size-4 rounded-full transition-transform ${
              color === c.value
                ? 'scale-100 ring-2 ring-white/70 ring-offset-2 ring-offset-[#141312]'
                : 'scale-90 hover:scale-100'
            }`}
            style={{ background: c.value }}
          />
        ))}
      </div>

      <div className="my-1 h-px w-6 bg-white/10" />

      <RailButton title="Undo  ·  ⌘Z" disabled={!canUndo} onClick={onUndo}>
        {icon('M9 14L4 9l5-5', <path d="M4 9h10a6 6 0 0 1 0 12h-3" />)}
      </RailButton>
      <RailButton title="Redo  ·  ⇧⌘Z" disabled={!canRedo} onClick={onRedo}>
        {icon('M15 14l5-5-5-5', <path d="M20 9H10a6 6 0 0 0 0 12h3" />)}
      </RailButton>
      <RailButton title="Clear slide  ·  X" disabled={!hasInk} onClick={onClear}>
        {icon('M6 7h12M10 11v6M14 11v6M7 7l1 12a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2l1-12M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2')}
      </RailButton>
    </div>
  )
}
