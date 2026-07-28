import { useCallback, useEffect, useRef, useState } from 'react'
import type { DrawStyle, InkEl, TextEl } from '../../types'
import { makeStyle, textBox, uid } from '../../lib/ink'

/**
 * The open text box, before it's written back. Two callers open one with
 * different intent, so the shape says which rather than leaving it to an
 * `id?: string` a caller could half-populate: the text tool starts a `create`
 * draft with no identity yet, and double-clicking a committed mark starts an
 * `edit` draft carrying the original element, so committing writes back to its
 * id instead of adding a new one.
 */
export type TextDraft =
  | { kind: 'create'; x: number; y: number; value: string }
  | { kind: 'edit'; x: number; y: number; value: string; original: TextEl }

interface UseTextEditorArgs {
  /** Sticky defaults — the colour, opacity and size the next *new* text is set in. */
  style: DrawStyle
  onCommit: (el: InkEl) => void
  /** Writes an edit back to its own id, one history entry — the same path the
   *  property bar uses to restyle a selection. */
  onUpdateMany: (els: InkEl[]) => void
  onErase: (ids: string[]) => void
}

/**
 * The open text box is mirrored into a ref so `commitText` can read the live
 * value without working inside a setState updater — StrictMode invokes those
 * twice, which committed the same text element twice.
 */
export function useTextEditor({ style, onCommit, onUpdateMany, onErase }: UseTextEditorArgs) {
  const [editing, setEditingState] = useState<TextDraft | null>(null)
  const editingRef = useRef<TextDraft | null>(null)

  const setEditing = useCallback((next: TextDraft | null) => {
    editingRef.current = next
    setEditingState(next)
  }, [])

  /** The text tool, clicking a point: a brand-new mark with no identity yet. */
  const startCreate = useCallback(
    (x: number, y: number) => setEditing({ kind: 'create', x, y, value: '' }),
    [setEditing],
  )

  /** Double-click on a committed mark: reopens it in place, seeded from the
   *  element's own colour and size rather than the sticky draw style, so
   *  editing doesn't silently reskin it. */
  const startEdit = useCallback(
    (el: TextEl) => setEditing({ kind: 'edit', x: el.x, y: el.y, value: el.text, original: el }),
    [setEditing],
  )

  const commitText = useCallback(() => {
    const current = editingRef.current
    // Cleared first: a pointerdown and the textarea's blur both fire for one
    // click away, and only the first of them should write an element.
    setEditing(null)
    if (!current) return

    if (current.kind === 'create') {
      if (!current.value.trim()) return
      onCommit({
        id: uid(),
        kind: 'text',
        style: makeStyle({ stroke: style.stroke, opacity: style.opacity }),
        fontSize: style.fontSize,
        x: current.x,
        y: current.y,
        text: current.value.replace(/\s+$/, ''),
      })
      return
    }

    // Editing writes back to the same id, one history entry — an edit, not a
    // new element plus a delete of the old one.
    const { original } = current
    const text = current.value.replace(/\s+$/, '')
    if (!text.trim()) {
      // An empty mark is invisible and unselectable — leaving one behind would
      // strand an unreachable element, so clearing the text deletes it instead.
      onErase([original.id])
    } else if (text !== original.text) {
      onUpdateMany([{ ...original, text }])
    }
    // Unchanged text: nothing to write, so no pointless history entry.
  }, [style, onCommit, onUpdateMany, onErase, setEditing])

  /** Mirrors the textarea's `onChange` — guarded by the ref for the same reason
   *  `commitText` reads from it rather than from a closed-over `editing`. */
  const updateValue = useCallback(
    (value: string) => {
      const current = editingRef.current
      if (current) setEditing({ ...current, value })
    },
    [setEditing],
  )

  return { editing, startCreate, startEdit, commitText, updateValue }
}

interface Props {
  draft: TextDraft
  color: string
  fontSize: number
  /** Stage units -> CSS pixels, for sizing the live text input. */
  scale: number
  onChange: (value: string) => void
  onCommit: () => void
}

export default function TextEditor({ draft, color, fontSize, scale, onChange, onCommit }: Props) {
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [draft])

  const preview = textBox({ x: draft.x, y: draft.y, text: draft.value, fontSize })

  return (
    <textarea
      ref={inputRef}
      value={draft.value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape' || (e.key === 'Enter' && e.metaKey)) {
          e.preventDefault()
          onCommit()
        }
      }}
      spellCheck={false}
      className="ink-text-input"
      style={{
        left: preview.x * scale,
        top: preview.y * scale,
        fontSize: fontSize * scale,
        lineHeight: 1.02,
        color,
        // Grow with the content — `white-space: pre` would otherwise hide
        // everything past the initial width.
        width: Math.max(preview.w + fontSize * 2, 260) * scale,
        height: (draft.value.split('\n').length * fontSize * 1.02 + 6) * scale,
      }}
    />
  )
}
