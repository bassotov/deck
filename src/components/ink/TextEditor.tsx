import { useCallback, useEffect, useRef, useState } from 'react'
import type { DrawStyle, InkEl } from '../../types'
import { makeStyle, textBox, uid } from '../../lib/ink'

/** The open text box, before it becomes a `TextEl`. */
export type TextDraft = { x: number; y: number; value: string }

interface UseTextEditorArgs {
  /** Sticky defaults — the colour, opacity and size the next text is set in. */
  style: DrawStyle
  onCommit: (el: InkEl) => void
}

/**
 * The open text box is mirrored into a ref so `commitText` can read the live
 * value without working inside a setState updater — StrictMode invokes those
 * twice, which committed the same text element twice.
 */
export function useTextEditor({ style, onCommit }: UseTextEditorArgs) {
  const [editing, setEditingState] = useState<TextDraft | null>(null)
  const editingRef = useRef<TextDraft | null>(null)

  const setEditing = useCallback((next: TextDraft | null) => {
    editingRef.current = next
    setEditingState(next)
  }, [])

  const commitText = useCallback(() => {
    const current = editingRef.current
    // Cleared first: a pointerdown and the textarea's blur both fire for one
    // click away, and only the first of them should write an element.
    setEditing(null)
    if (!current || !current.value.trim()) return
    onCommit({
      id: uid(),
      kind: 'text',
      style: makeStyle({ stroke: style.stroke, opacity: style.opacity }),
      fontSize: style.fontSize,
      x: current.x,
      y: current.y,
      text: current.value.replace(/\s+$/, ''),
    })
  }, [style, onCommit, setEditing])

  /** Mirrors the textarea's `onChange` — guarded by the ref for the same reason
   *  `commitText` reads from it rather than from a closed-over `editing`. */
  const updateValue = useCallback(
    (value: string) => {
      const current = editingRef.current
      if (current) setEditing({ ...current, value })
    },
    [setEditing],
  )

  return { editing, setEditing, commitText, updateValue }
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
