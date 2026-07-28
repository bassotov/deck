import type { InkEl, ShapeEl, ShapeKind, TextEl } from '../types'
import { FONT_STEPS, OPACITY_STEPS, SHAPE_ORDER, WIDTH_STEPS, baseWidth } from '../lib/ink'
import ColorSwatches from './ColorSwatches'
import { SHAPE_ICON, SHAPE_LABEL, icon } from './icons'

interface Props {
  /** The selected elements themselves: which fields apply, and what they read,
   *  is a question about the selection — not something App can flatten first. */
  elements: InkEl[]
  custom: string | null
  /** ⊕ picked a colour: remember it *and* apply it to whichever field asked. */
  onCustom: (c: string, target: 'stroke' | 'fill') => void
  /** That pick is over — the OS panel closed. */
  onCustomEnd: () => void
  onStroke: (c: string) => void
  onFill: (c: string | null) => void
  /** A multiple of each tool's own default width — see `DrawStyle.widthScale`. */
  onWidth: (scale: number) => void
  onOpacity: (o: number) => void
  onFontSize: (px: number) => void
  onShapeKind: (k: ShapeKind) => void
  onFront: () => void
  onBack: () => void
  onDuplicate: () => void
  onDelete: () => void
}

/**
 * The one value every element agrees on, or `mixed` when they don't. A
 * multi-selection that disagrees shows nothing active rather than letting the
 * first element's value speak for the rest — and an edit then still writes to
 * all of them.
 */
function agree<T>(values: T[]): { value: T | null; mixed: boolean } {
  if (!values.length) return { value: null, mixed: false }
  const first = values[0]
  return values.every((v) => v === first)
    ? { value: first, mixed: false }
    : { value: null, mixed: true }
}

/** Float noise from a resize would otherwise make two identical widths disagree. */
const round = (n: number) => Math.round(n * 1000) / 1000

/** Which preset a number landed on, or -1 — a resized element sits between steps,
 *  and no preset should claim it. */
const stepAt = (steps: readonly number[], v: number | null, tol = 0.005) =>
  v === null ? -1 : steps.findIndex((s) => Math.abs(s - v) <= tol)

function Group({
  field,
  label,
  children,
}: {
  field: string
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex shrink-0 flex-col gap-1.5" data-field={field}>
      {/* leading-none pins the caption's box to its font size, so the bar's own
          height doesn't drift with whatever mono face actually loaded — App
          reserves that height under the stage. */}
      <span className="label leading-none">{label}</span>
      <div className="flex h-8 items-center gap-1">{children}</div>
    </div>
  )
}

const Divider = () => <div className="h-8 w-px shrink-0 self-end bg-white/10" />

/** The rail's RailButton, laid on its side: same sizes, same states, same accent. */
function BarButton({
  active,
  title,
  wide,
  onClick,
  children,
}: {
  active?: boolean
  title: string
  wide?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      data-active={active ? 'true' : undefined}
      onClick={onClick}
      className={`flex h-8 items-center justify-center rounded-lg transition-colors ${
        wide ? 'px-2.5 font-mono text-[10px] tracking-[0.1em] uppercase' : 'w-8'
      } ${active ? 'bg-accent text-black' : 'text-[#a9a29c] hover:bg-white/[0.07] hover:text-[#e8e4e0]'}`}
    >
      {children}
    </button>
  )
}

/**
 * Contextual properties for whatever is selected, docked under the stage in the
 * speaker note's slot. It never floats over the slide: the stage is the recording
 * crop, and chrome inside it lands in the video (the same rule the tool rail's
 * gutter and the toast's corner follow).
 *
 * Presentational only — every field is fed and written back by App, so the sticky
 * defaults for the *next* mark and the edit to the current one stay one decision.
 */
export default function PropertyBar({
  elements,
  custom,
  onCustom,
  onCustomEnd,
  onStroke,
  onFill,
  onWidth,
  onOpacity,
  onFontSize,
  onShapeKind,
  onFront,
  onBack,
  onDuplicate,
  onDelete,
}: Props) {
  // A field applies to whichever elements can carry it, and leaves the rest of
  // the selection alone — a font size with a text and a shape selected is still
  // a font size.
  const fillable = elements.filter(
    (el): el is ShapeEl => el.kind === 'shape' && el.shape !== 'line',
  )
  const stroked = elements.filter(
    (el) => el.kind === 'stroke' || el.kind === 'arrow' || el.kind === 'shape',
  )
  const texts = elements.filter((el): el is TextEl => el.kind === 'text')
  const shapes = elements.filter((el): el is ShapeEl => el.kind === 'shape')

  const stroke = agree(elements.map((el) => el.style.stroke))
  const fill = agree(fillable.map((el) => el.style.fill))
  const width = agree(stroked.map((el) => round(el.style.strokeWidth / baseWidth(el))))
  const opacity = agree(elements.map((el) => round(el.style.opacity)))
  const fontSize = agree(texts.map((el) => el.fontSize))
  const shapeKind = agree(shapes.map((el) => el.shape))

  const widthAt = stepAt(WIDTH_STEPS.map((w) => w.scale), width.value, 0.02)
  const opacityAt = stepAt(OPACITY_STEPS, opacity.value)
  const fontAt = stepAt(FONT_STEPS.map((f) => f.size), fontSize.value, 0.5)

  const many = elements.length > 1

  return (
    <div
      data-property-bar
      className="flex w-full items-end gap-2.5 overflow-x-auto rounded-xl border border-white/[0.08] bg-[#1a1918] px-3 py-2 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.9)]"
    >
      <Group field="stroke" label="Colour">
        <ColorSwatches
          value={stroke.value}
          mixed={stroke.mixed}
          onChange={(c) => c && onStroke(c)}
          custom={custom}
          onCustom={(c) => onCustom(c, 'stroke')}
          onCustomEnd={onCustomEnd}
        />
      </Group>

      {fillable.length > 0 && (
        <>
          <Divider />
          <Group field="fill" label="Fill">
            <ColorSwatches
              value={fill.value}
              mixed={fill.mixed}
              onChange={onFill}
              custom={custom}
              onCustom={(c) => onCustom(c, 'fill')}
              onCustomEnd={onCustomEnd}
              allowNone
            />
          </Group>
        </>
      )}

      {stroked.length > 0 && (
        <>
          <Divider />
          <Group field="width" label="Width">
            {WIDTH_STEPS.map((w, i) => (
              <BarButton
                key={w.name}
                wide
                active={widthAt === i}
                title={`${w.name} line`}
                onClick={() => onWidth(w.scale)}
              >
                {w.name}
              </BarButton>
            ))}
          </Group>
        </>
      )}

      <Divider />
      <Group field="opacity" label="Opacity">
        {OPACITY_STEPS.map((o, i) => (
          <BarButton
            key={o}
            wide
            active={opacityAt === i}
            title={`${Math.round(o * 100)}% opaque`}
            onClick={() => onOpacity(o)}
          >
            {Math.round(o * 100)}
          </BarButton>
        ))}
      </Group>

      {texts.length > 0 && (
        <>
          <Divider />
          <Group field="size" label="Size">
            {FONT_STEPS.map((f, i) => (
              <BarButton
                key={f.name}
                wide
                active={fontAt === i}
                title={`${f.name} text`}
                onClick={() => onFontSize(f.size)}
              >
                {f.name}
              </BarButton>
            ))}
          </Group>
        </>
      )}

      {shapes.length > 0 && (
        <>
          <Divider />
          <Group field="shape" label="Shape">
            {SHAPE_ORDER.map((k) => (
              <BarButton
                key={k}
                active={shapeKind.value === k}
                title={SHAPE_LABEL[k]}
                onClick={() => onShapeKind(k)}
              >
                {SHAPE_ICON[k]}
              </BarButton>
            ))}
          </Group>
        </>
      )}

      <Divider />
      <Group field="order" label="Order">
        <BarButton title="Bring to front" onClick={onFront}>
          {icon('M12 4.5v11M8 8.5l4-4 4 4', <path d="M4.5 19.5h15" />)}
        </BarButton>
        <BarButton title="Send to back" onClick={onBack}>
          {icon('M12 19.5v-11M8 15.5l4 4 4-4', <path d="M4.5 4.5h15" />)}
        </BarButton>
      </Group>

      <Divider />
      <Group field="edit" label={many ? `${elements.length} marks` : 'Mark'}>
        <BarButton title="Duplicate" onClick={onDuplicate}>
          {icon('M9 9h10v10H9z', <path d="M15 5H5v10" />)}
        </BarButton>
        <BarButton title="Delete  ·  ⌫" onClick={onDelete}>
          {icon(
            'M6 7h12M10 11v6M14 11v6M7 7l1 12a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2l1-12M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2',
          )}
        </BarButton>
      </Group>
    </div>
  )
}
