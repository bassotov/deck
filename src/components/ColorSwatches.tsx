import { useRef } from 'react'
import { INK_COLORS } from '../lib/ink'

interface Props {
  /** The colour every element in scope agrees on — null is "no fill" when
   *  `allowNone`, and simply nothing selected otherwise. */
  value: string | null
  onChange: (c: string | null) => void
  /** A selection whose members disagree: no chip is active, and nothing lies
   *  about the first element's colour. */
  mixed?: boolean
  /** The one remembered custom colour, overwritten by the next ⊕ pick. */
  custom: string | null
  /**
   * A colour out of the OS panel. It is remembered *and* selected — nobody picks
   * one meaning not to use it — so this replaces `onChange` rather than joining
   * it. The panel streams an event per frame while it is dragged, which is the
   * caller's cue to treat the whole pick as one gesture.
   */
  onCustom: (c: string) => void
  /** Fill offers ⊘ as a first chip; a stroke always has a colour. */
  allowNone?: boolean
  /** The rail stacks its row; the property bar runs it across. */
  vertical?: boolean
  /** Only the rail's row is keyboard-addressable, so only it says so. */
  shortcuts?: boolean
}

/**
 * The four house colours, the one remembered custom slot, and the ⊕ that opens
 * the OS colour panel. One implementation for the rail and the property bar, so
 * a pigment picked in either reads identically.
 */
export default function ColorSwatches({
  value,
  onChange,
  mixed,
  custom,
  onCustom,
  allowNone,
  vertical,
  shortcuts,
}: Props) {
  const nativeRef = useRef<HTMLInputElement>(null)

  /** Nothing reads as current on a mixed selection — that is what makes it
   *  indeterminate rather than a claim about the first element. */
  const isOn = (c: string | null) => !mixed && value === c

  /** The ring the rail has always drawn on the colour it is holding. The hairline
   *  border is what makes `ink` — near-black pigment on a near-black panel —
   *  a swatch rather than a gap in the row. */
  const chip = (active: boolean) =>
    `size-4 shrink-0 rounded-full border border-white/20 transition-transform ${
      active
        ? 'scale-100 ring-2 ring-white/70 ring-offset-2 ring-offset-[#141312]'
        : 'scale-90 hover:scale-100'
    }`

  return (
    <div
      className={`flex items-center gap-1.5 ${vertical ? 'flex-col py-1' : ''}`}
      data-mixed={mixed ? 'true' : undefined}
    >
      {allowNone && (
        <button
          type="button"
          data-swatch="none"
          title="No fill"
          onClick={() => onChange(null)}
          data-active={isOn(null) || undefined}
          className={`${chip(isOn(null))} text-white/45`}
        >
          <svg viewBox="0 0 16 16" className="size-full" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M3.5 12.5L12.5 3.5" />
          </svg>
        </button>
      )}

      {INK_COLORS.map((c, i) => (
        <button
          key={c.value}
          type="button"
          data-swatch={c.name}
          title={shortcuts ? `${c.name}  ·  ⇧${i + 1}  ·  C cycles` : c.name}
          onClick={() => onChange(c.value)}
          data-active={isOn(c.value) || undefined}
          className={chip(isOn(c.value))}
          style={{ background: c.value }}
        />
      ))}

      {custom && (
        <button
          type="button"
          data-swatch="custom"
          title={`Custom  ·  ${custom}`}
          onClick={() => onChange(custom)}
          data-active={isOn(custom) || undefined}
          className={chip(isOn(custom))}
          style={{ background: custom }}
        />
      )}

      {/* The ⊕ is the visible control; the input behind it is only ever opened
          programmatically. It stays rendered and merely transparent — display:none
          suppresses the picker in some browsers — and pinned over the button so
          the OS panel drops where the swatch is. */}
      <span className="relative inline-flex shrink-0">
        <button
          type="button"
          data-swatch="pick"
          title="Custom colour…  (eyedropper lives in the OS panel)"
          onClick={() => nativeRef.current?.click()}
          className={`${chip(false)} border-dashed border-white/35 text-white/50 hover:text-white/80`}
        >
          <svg viewBox="0 0 16 16" className="size-full" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M8 4.5v7M4.5 8h7" />
          </svg>
        </button>
        <input
          ref={nativeRef}
          type="color"
          aria-hidden
          tabIndex={-1}
          // Uncontrolled on purpose: the input itself is the live value while the
          // OS panel is open, and `onInput` (not `onChange`) is what keeps a drag
          // inside that panel updating as it happens.
          defaultValue={custom ?? value ?? INK_COLORS[0].value}
          onInput={(e) => onCustom(e.currentTarget.value)}
          className="pointer-events-none absolute inset-0 size-full opacity-0"
        />
      </span>
    </div>
  )
}
