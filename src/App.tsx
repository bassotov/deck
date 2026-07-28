import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Sidebar from './components/Sidebar'
import SlideView from './components/SlideView'
import InkLayer from './components/InkLayer'
import PropertyBar from './components/PropertyBar'
import ToolRail from './components/ToolRail'
import { addImage, createStory, fetchInk, fetchStories, saveInk } from './lib/api'
import {
  INK_COLORS,
  SHAPE_ORDER,
  TOOL_ORDER,
  baseWidth,
  clampDelta,
  copyEl,
  makeDrawStyle,
  makeStyle,
  normalizeSlide,
  placeImage,
  restyle,
  translateEl,
  uid,
} from './lib/ink'
import type { DrawStyle, InkEl, ShapeKind, Story, StoryInk, Tool } from './types'

const HISTORY_LIMIT = 60

/** Far enough that a duplicate reads as a copy and not as a mark that failed to move. */
const DUPLICATE_OFFSET = 24

/** Arrow-key nudge, in stage units — Shift steps ten times further. */
const NUDGE = 4
const NUDGE_SHIFT = 20

/** Digit tool-switches, the letter aliases, and slide navigation — ignored
 *  while a gesture (a stroke, a drag, or a handle resize) is in flight, since
 *  switching mid-gesture is exactly what corrupts or destroys it. */
const GESTURE_LOCKED_KEYS = new Set([
  'v',
  'p',
  'h',
  'a',
  's',
  't',
  'e',
  'arrowright',
  'arrowleft',
  'arrowup',
  'arrowdown',
  ' ',
  'j',
  'k',
  'home',
  'end',
])

/** A sticky toast stays until it is replaced — a save that failed has to be seen. */
interface Toast {
  text: string
  sticky?: boolean
}

const TEMPLATE = (title: string) => `# ${title}

The one line that says what this is about.

---

## The setup

- What I was trying to do
- Why it mattered

---

## What actually happened

Write the beat here. <span class="hand">this bit</span> gets the handwritten accent.

<!-- note: slow down here, this is the turn -->

---

## The takeaway

> One sentence people can repeat.
`

/** Natural size of a pasted blob, so it can be placed at the right aspect ratio. */
function measureImage(blob: Blob): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve({ w: img.naturalWidth, h: img.naturalHeight })
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('That file is not an image'))
    }
    img.src = url
  })
}

/** `#/<slug>/<1-based slide>` — so a deck reopens exactly where it was left. */
function readHash() {
  const m = window.location.hash.match(/^#\/([^/]+)(?:\/(\d+))?/)
  return {
    slug: m ? decodeURIComponent(m[1]) : null,
    index: m?.[2] ? Math.max(0, Number(m[2]) - 1) : 0,
  }
}

export default function App() {
  const initial = useRef(readHash()).current

  const [stories, setStories] = useState<Story[]>([])
  const [dir, setDir] = useState('')
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [activeSlug, setActiveSlug] = useState<string | null>(initial.slug)
  const [index, setIndex] = useState(initial.index)

  const [ink, setInkState] = useState<StoryInk>({})
  const [past, setPastState] = useState<StoryInk[]>([])
  const [future, setFutureState] = useState<StoryInk[]>([])
  const [inkCounts, setInkCounts] = useState<Record<string, number>>({})

  /**
   * Ink and its two history stacks are mirrored into refs, and every write goes
   * through the wrappers below. An edit reads the current value from the ref and
   * then fires plain setters: computing inside a setState updater meant
   * StrictMode's double-invoke pushed each snapshot onto `past` twice and made
   * one undo walk back two steps.
   */
  const inkRef = useRef(ink)
  const pastRef = useRef(past)
  const futureRef = useRef(future)

  const setInk = useCallback((next: StoryInk) => {
    inkRef.current = next
    setInkState(next)
  }, [])

  const setPast = useCallback((next: StoryInk[]) => {
    pastRef.current = next
    setPastState(next)
  }, [])

  const setFuture = useCallback((next: StoryInk[]) => {
    futureRef.current = next
    setFutureState(next)
  }, [])

  /** The one place `inkCounts` is derived from what's actually landing in
   *  `ink` — an edit, an undo, or a redo all route through this, so the
   *  sidebar's per-deck count can't drift the way it did when only `mutate`
   *  recomputed it and undo/redo quietly bypassed that. */
  const applyInk = useCallback(
    (next: StoryInk) => {
      setInk(next)
      if (activeSlug) {
        setInkCounts((c) => ({
          ...c,
          [activeSlug]: Object.values(next).reduce((n, els) => n + els.length, 0),
        }))
      }
    },
    [activeSlug, setInk],
  )

  const [tool, setTool] = useState<Tool>('cursor')
  const [shape, setShape] = useState<ShapeKind>(SHAPE_ORDER[0])
  /** One current style rather than one current colour: every property the bar
   *  edits is also the default the next mark is drawn with. */
  const [style, setStyle] = useState<DrawStyle>(makeDrawStyle)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [focus, setFocus] = useState(false)
  const [idle, setIdle] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  /** Focus mode hides the header — and with it the sidebar toggle — so leaving
   *  it has to restore whatever the sidebar's state was before entering,
   *  rather than always leaving it closed. */
  const sidebarBeforeFocus = useRef(sidebarOpen)

  const enterFocus = useCallback(() => {
    sidebarBeforeFocus.current = sidebarOpen
    setSidebarOpen(false)
    setFocus(true)
  }, [sidebarOpen])

  const exitFocus = useCallback(() => {
    setSidebarOpen(sidebarBeforeFocus.current)
    setFocus(false)
  }, [])

  const dirty = useRef(false)

  const story = useMemo(
    () => stories.find((s) => s.slug === activeSlug) ?? null,
    [stories, activeSlug],
  )
  const slide = story?.slides[Math.min(index, story.slides.length - 1)] ?? null
  const slideInk = slide ? (ink[slide.key] ?? []) : []

  /* ------------------------------------------------------------- loading */

  const load = useCallback(async () => {
    try {
      const { dir, stories } = await fetchStories()
      setDir(dir)
      setStories(stories)
      setStatus('ready')
      setActiveSlug((current) =>
        current && stories.some((s) => s.slug === current) ? current : (stories[0]?.slug ?? null),
      )
    } catch {
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    void load()
    if (import.meta.hot) import.meta.hot.on('stories:changed', () => void load())
  }, [load])

  // Keep the index inside the deck when a storyline is edited or swapped.
  useEffect(() => {
    if (!story) return
    setIndex((i) => Math.min(Math.max(0, i), Math.max(0, story.slides.length - 1)))
  }, [story])

  useEffect(() => {
    if (!activeSlug) return
    const next = `#/${encodeURIComponent(activeSlug)}/${index + 1}`
    if (window.location.hash !== next) window.history.replaceState(null, '', next)
  }, [activeSlug, index])

  // Back/forward and a hand-edited hash both fire this — the app only ever
  // writes the hash above via `replaceState`, which never fires it itself, so
  // there's no loop: this effect's own writes can't re-trigger this listener.
  useEffect(() => {
    const onHashChange = () => {
      const next = readHash()
      if (!next.slug) return
      setActiveSlug(next.slug)
      setIndex(next.index)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    if (!activeSlug) return
    let cancelled = false
    dirty.current = false
    setPast([])
    setFuture([])
    void fetchInk(activeSlug).then((data) => {
      if (cancelled) return
      // The one place on-disk shapes are read. Everything downstream — renderers,
      // hit-tests, geometry — sees only the current shape, never a legacy fallback,
      // and an order that already means z-order.
      const loaded: StoryInk = Object.fromEntries(
        Object.entries(data).map(([key, els]) => [key, normalizeSlide(els)]),
      )
      applyInk(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [activeSlug, applyInk, setPast, setFuture])

  /** The (slug, ink) pair the debounce is holding — never the live `activeSlug`,
   *  so a flush writes the storyline the edit was actually made on. */
  const pending = useRef<{ slug: string; ink: StoryInk } | null>(null)

  /**
   * Writes the pending ink out now. Safe to call twice: the pair is taken before
   * the request goes out, so the timer firing and a storyline switch flushing
   * can't both PUT the same edit.
   */
  const flushInk = useCallback(async (keepalive = false) => {
    const p = pending.current
    if (!p) return
    pending.current = null
    try {
      await saveInk(p.slug, p.ink, keepalive)
      // The edit is only on disk once the PUT came back OK — clear a failure
      // that is now stale.
      setToast((t) => (t?.sticky ? null : t))
    } catch (err) {
      setToast({
        text: err instanceof Error ? `Not saved — ${err.message}` : 'Not saved',
        sticky: true,
      })
    }
  }, [])

  useEffect(() => {
    if (!activeSlug || !dirty.current) return
    pending.current = { slug: activeSlug, ink }
    const id = setTimeout(() => void flushInk(), 600)
    return () => clearTimeout(id)
  }, [ink, activeSlug, flushInk])

  // Leaving a storyline tears the debounce down mid-flight. Flush instead of
  // dropping it — otherwise a switch within 600ms of a stroke lost the stroke.
  useEffect(() => {
    return () => void flushInk()
  }, [activeSlug, flushInk])

  // Same again for the page going away, where the request has to outlive it.
  useEffect(() => {
    const onLeave = () => void flushInk(true)
    window.addEventListener('beforeunload', onLeave)
    return () => window.removeEventListener('beforeunload', onLeave)
  }, [flushInk])

  /* ------------------------------------------------------------ mutations */

  /** Which continuous gesture the newest history entry belongs to, if any. The OS
   *  colour panel streams an event a frame while it is dragged, and undo has to
   *  step back over the whole pick rather than over each frame of it. */
  const coalescing = useRef<string | null>(null)

  const mutate = useCallback(
    (next: (prev: StoryInk) => StoryInk, coalesce?: string) => {
      const prev = inkRef.current
      const updated = next(prev)
      dirty.current = true
      applyInk(updated)
      // Still the same gesture: extend the entry that is already on the stack
      // instead of pushing another one beside it.
      if (!coalesce || coalescing.current !== coalesce) {
        setPast([...pastRef.current.slice(-HISTORY_LIMIT), prev])
      }
      coalescing.current = coalesce ?? null
      setFuture([])
    },
    [applyInk, setPast, setFuture],
  )

  /* Batch first, single as the thin wrapper: one gesture is one history entry, whether
     it moved one element or ten — the shape `erase` has always had. */

  const commitMany = useCallback(
    /** `behind` puts the new elements at the start of the slide — the array is the
     *  z-order, and a pasted image belongs under the ink, not over it. */
    (els: InkEl[], behind = false) => {
      if (!slide || !els.length) return
      mutate((prev) => {
        const current = prev[slide.key] ?? []
        return { ...prev, [slide.key]: behind ? [...els, ...current] : [...current, ...els] }
      })
    },
    [mutate, slide],
  )

  const updateMany = useCallback(
    (els: InkEl[], coalesce?: string) => {
      if (!slide || !els.length) return
      const next = new Map(els.map((el) => [el.id, el]))
      mutate(
        (prev) => ({
          ...prev,
          [slide.key]: (prev[slide.key] ?? []).map((el) => next.get(el.id) ?? el),
        }),
        coalesce,
      )
    },
    [mutate, slide],
  )

  const commit = useCallback((el: InkEl) => commitMany([el]), [commitMany])

  const erase = useCallback(
    (ids: string[]) => {
      if (!slide) return
      const gone = new Set(ids)
      mutate((prev) => ({
        ...prev,
        [slide.key]: (prev[slide.key] ?? []).filter((el) => !gone.has(el.id)),
      }))
    },
    [mutate, slide],
  )

  const clearSlide = useCallback(() => {
    if (!slide || slideInk.length === 0) return
    mutate((prev) => ({ ...prev, [slide.key]: [] }))
    // Instant and undoable on purpose — a confirmation dialog mid-recording
    // would be worse — but it still needs to say so.
    setToast({ text: 'Slide cleared · ⌘Z to undo' })
  }, [mutate, slide, slideInk.length])

  /** Keeps the empty array identical when nothing was selected, so clicking bare
   *  slide doesn't re-render every element for a no-op. */
  const clearSelection = useCallback(() => {
    setSelectedIds((current) => (current.length ? [] : current))
  }, [])

  const deleteSelected = useCallback(() => {
    if (!selectedIds.length) return
    erase(selectedIds)
    clearSelection()
  }, [clearSelection, erase, selectedIds])

  /** ⌘A / Ctrl+A — every element on the current slide. */
  const selectAll = useCallback(() => {
    setSelectedIds(slideInk.map((el) => el.id))
  }, [slideInk])

  // A selection can't outlive the slide it was made on.
  useEffect(clearSelection, [clearSelection, slide?.key, activeSlug, tool])

  /* ------------------------------------------------------ selection editing */

  /** The selected elements themselves — what the property bar reads its fields
   *  from, and what an edit is written across. */
  const selected = useMemo(
    () => slideInk.filter((el) => selectedIds.includes(el.id)),
    [slideInk, selectedIds],
  )

  /**
   * Writes a property onto every selected element it applies to — one history
   * entry however many it touched — and leaves the rest of the selection alone:
   * a font size with a text and a shape selected is still a font size.
   */
  const editSelection = useCallback(
    (edit: (el: InkEl) => InkEl | null, coalesce?: string) => {
      const next = selected.map(edit).filter((el): el is InkEl => el !== null)
      if (next.length) updateMany(next, coalesce)
    },
    [selected, updateMany],
  )

  /* Every property below does the same two things: write the selection, and make
     the value the default the next mark is drawn with. */

  const applyStroke = useCallback(
    (stroke: string, coalesce?: string) => {
      setStyle((s) => ({ ...s, stroke }))
      editSelection((el) => restyle(el, { stroke }), coalesce)
    },
    [editSelection],
  )

  const applyFill = useCallback(
    (fill: string | null, coalesce?: string) => {
      setStyle((s) => ({ ...s, fill }))
      // Only a closed shape has an interior; an arrow filled to its head, or a
      // line with a fill it can't show, is nobody's idea of "fill".
      editSelection(
        (el) => (el.kind === 'shape' && el.shape !== 'line' ? restyle(el, { fill }) : null),
        coalesce,
      )
    },
    [editSelection],
  )

  /** ⊕ picked a colour: it becomes the remembered slot and the live value at once. */
  const pickCustom = useCallback(
    (c: string, target: 'stroke' | 'fill') => {
      setStyle((s) => ({ ...s, custom: c }))
      if (target === 'fill') applyFill(c, 'custom-fill')
      else applyStroke(c, 'custom-stroke')
    },
    [applyFill, applyStroke],
  )

  const applyWidth = useCallback(
    (widthScale: number) => {
      setStyle((s) => ({ ...s, widthScale }))
      editSelection((el) =>
        el.kind === 'stroke' || el.kind === 'arrow' || el.kind === 'shape'
          ? restyle(el, { strokeWidth: baseWidth(el) * widthScale })
          : null,
      )
    },
    [editSelection],
  )

  const applyOpacity = useCallback(
    (opacity: number) => {
      setStyle((s) => ({ ...s, opacity }))
      editSelection((el) => restyle(el, { opacity }))
    },
    [editSelection],
  )

  const applyFontSize = useCallback(
    (fontSize: number) => {
      setStyle((s) => ({ ...s, fontSize }))
      editSelection((el) => (el.kind === 'text' ? { ...el, fontSize } : null))
    },
    [editSelection],
  )

  /** Also arms the shape tool, so "actually, an oval" holds for the next one too. */
  const applyShapeKind = useCallback(
    (kind: ShapeKind) => {
      setShape(kind)
      editSelection((el) => (el.kind === 'shape' ? { ...el, shape: kind } : null))
    },
    [editSelection],
  )

  /** ⇧1-4 and the rail's swatches go through the same door as the property bar. */
  const cycleColor = useCallback(() => {
    const at = INK_COLORS.findIndex((c) => c.value === style.stroke)
    applyStroke(INK_COLORS[(at + 1) % INK_COLORS.length].value)
  }, [applyStroke, style.stroke])

  /** Front and back move the selection to the end / start of the slide's array —
   *  the array is the z-order. One history entry, however many marks moved. */
  const reorderSelected = useCallback(
    (toFront: boolean) => {
      if (!slide || !selected.length) return
      const chosen = new Set(selectedIds)
      const rest = slideInk.filter((el) => !chosen.has(el.id))
      mutate((prev) => ({
        ...prev,
        [slide.key]: toFront ? [...rest, ...selected] : [...selected, ...rest],
      }))
    },
    [mutate, selected, selectedIds, slide, slideInk],
  )

  const duplicateSelected = useCallback(() => {
    if (!selected.length) return
    const [dx, dy] = clampDelta(selected, DUPLICATE_OFFSET, DUPLICATE_OFFSET)
    const copies = selected.map((el) => copyEl(el, dx, dy))
    commitMany(copies)
    // The copy is what you go on to move — leaving the original selected would
    // mean every duplicate needs a click before it can be used.
    setSelectedIds(copies.map((el) => el.id))
  }, [commitMany, selected])

  /**
   * The in-memory ink clipboard — never the OS clipboard, so no custom MIME
   * type to invent. It lives here rather than in `InkLayer`, which remounts on
   * every slide change (its `key` is `${activeSlug}:${slide.key}`): a clipboard
   * inside it could never survive a slide change, and reusing the same mark
   * across slides is the whole reason this exists. `slug`/`slideKey` record
   * where the copy was made, so paste can tell same-slide from cross-slide;
   * `pastes` drives the cascade and resets on every fresh copy.
   */
  const clipboard = useRef<{ slug: string; slideKey: string; els: InkEl[]; pastes: number } | null>(
    null,
  )

  const copySelection = useCallback(() => {
    if (!selected.length || !slide || !activeSlug) return
    // `copyEl` at a zero offset still deep-copies (fresh point/from/to arrays,
    // fresh id) — later edits to the originals can't reach back into what's
    // sitting on the clipboard.
    clipboard.current = {
      slug: activeSlug,
      slideKey: slide.key,
      els: selected.map((el) => copyEl(el, 0, 0)),
      pastes: 0,
    }
  }, [selected, slide, activeSlug])

  const pasteClipboard = useCallback(() => {
    const clip = clipboard.current
    if (!clip || !slide || !activeSlug) return
    const sameSlide = clip.slug === activeSlug && clip.slideKey === slide.key
    // Cross-slide paste lands at the copied coordinates untouched — the point
    // of copying an arrow on one slide and pasting it on another is putting the
    // same mark in the same place. Pasting back onto the slide it was copied
    // from cascades like a repeated duplicate, so each paste still reads as a
    // new object rather than as one that failed to move.
    const offset = sameSlide ? DUPLICATE_OFFSET * ((clip.pastes % 5) + 1) : 0
    const [dx, dy] = clampDelta(clip.els, offset, offset)
    const pasted = clip.els.map((el) => copyEl(el, dx, dy))
    commitMany(pasted)
    setSelectedIds(pasted.map((el) => el.id))
    if (sameSlide) clip.pastes += 1
  }, [slide, activeSlug, commitMany])

  const undo = useCallback(() => {
    const p = pastRef.current
    if (!p.length) return
    dirty.current = true
    // Whatever gesture the top entry belonged to is over; a repeat of it must
    // start a new entry rather than quietly extend the one just undone.
    coalescing.current = null
    setFuture([inkRef.current, ...futureRef.current].slice(0, HISTORY_LIMIT))
    applyInk(p[p.length - 1])
    setPast(p.slice(0, -1))
  }, [applyInk, setFuture, setPast])

  const redo = useCallback(() => {
    const f = futureRef.current
    if (!f.length) return
    dirty.current = true
    coalescing.current = null
    setPast([...pastRef.current.slice(-HISTORY_LIMIT), inkRef.current])
    applyInk(f[0])
    setFuture(f.slice(1))
  }, [applyInk, setFuture, setPast])

  /* ----------------------------------------------------------- navigation */

  const total = story?.slides.length ?? 0

  const go = useCallback(
    (delta: number) => {
      setIndex((i) => Math.max(0, Math.min(total - 1, i + delta)))
    },
    [total],
  )

  /** Arrow keys move the selection when there is one, rather than the slide —
   *  same clamp as a drag, same history shape as any other edit, but never
   *  coalesced: a run of held-down nudges undoes one step at a time. Skips the
   *  history entry entirely when the clamp reduces the move to nothing, so
   *  holding an arrow into the stage edge doesn't spam undo. */
  const nudgeSelected = useCallback(
    (dx: number, dy: number) => {
      const [cdx, cdy] = clampDelta(selected, dx, dy)
      if (!cdx && !cdy) return
      updateMany(selected.map((el) => translateEl(el, cdx, cdy)))
    },
    [selected, updateMany],
  )

  /** Re-picking the shape tool walks to the next shape — square, oval, … */
  const pickTool = useCallback(
    (t: Tool) => {
      if (t === 'shape' && tool === 'shape') {
        setShape((s) => SHAPE_ORDER[(SHAPE_ORDER.indexOf(s) + 1) % SHAPE_ORDER.length])
      }
      setTool(t)
    },
    [tool],
  )

  const selectStory = useCallback((slug: string) => {
    setActiveSlug(slug)
    setIndex(0)
  }, [])

  const newStory = useCallback(async () => {
    const title = window.prompt('Storyline title')
    if (!title) return
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
    if (!slug) return
    try {
      await createStory(slug, TEMPLATE(title))
    } catch (err) {
      // A 409 means the slug's already taken — the common case, and worth its
      // own message. Anything else still needs to be seen rather than eaten.
      const conflict = err instanceof Error && err.message.includes('409')
      setToast({
        text: conflict ? `A storyline called ${slug} already exists` : 'Could not create the storyline',
      })
      return
    }
    await load()
    selectStory(slug)
  }, [load, selectStory])

  /* ---------------------------------------------------------------- images */

  /**
   * Paste or drop an image and it lands on the slide you are looking at. The
   * markdown in the vault is what changes — the deck reloads from that, so the
   * paste is durable and editable in Obsidian like anything else.
   */
  // One drop can arrive as several events. Without this, a single drag wrote
  // the same screenshot two or three times.
  const adding = useRef(false)

  const dropImage = useCallback(
    async (blob: Blob) => {
      if (!activeSlug || !slide || adding.current) return
      adding.current = true
      setToast({ text: 'Adding image…' })
      try {
        const [src, natural] = await Promise.all([addImage(activeSlug, blob), measureImage(blob)])
        const nth = slideInk.filter((el) => el.kind === 'image').length
        // Behind everything: a paste must not hide the drawing it was pasted for.
        commitMany(
          [{ id: uid(), kind: 'image', src, style: makeStyle(), ...placeImage(natural, nth) }],
          true,
        )
        setToast({ text: `Added ${src}` })
      } catch (err) {
        setToast({ text: err instanceof Error ? err.message : 'Could not add the image' })
      } finally {
        adding.current = false
      }
    },
    [activeSlug, slide, slideInk, commitMany],
  )

  useEffect(() => {
    // A sticky toast is a failed save — it stays until a save succeeds.
    if (!toast || toast.sticky) return
    const id = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(id)
  }, [toast])

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      const item = Array.from(e.clipboardData?.items ?? []).find((i) =>
        i.type.startsWith('image/'),
      )
      const blob = item?.getAsFile()
      if (blob) {
        e.preventDefault()
        void dropImage(blob)
        return
      }
      // No image on the OS clipboard: this is where a real ⌘V lands, so the
      // in-memory ink clipboard is pasted from here rather than from the
      // keydown handler — wiring ⌘V there too would paste it twice.
      if (!clipboard.current) return
      e.preventDefault()
      pasteClipboard()
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [dropImage, pasteClipboard])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/'))
      if (!file) return
      e.preventDefault()
      void dropImage(file)
    },
    [dropImage],
  )

  /* ------------------------------------------------------------- keyboard */

  /** Whether a stroke, a drag, or a handle resize is currently in flight — a
   *  ref, not state, since it only needs to gate the keydown handler below at
   *  call time and must never itself trigger a re-render or a re-subscribe.
   *  Pointer capture keeps delivering that gesture's events to whatever tool
   *  (or slide) it started on, so a keyboard tool switch or slide navigation
   *  landing mid-gesture would corrupt or destroy it — see InkLayer. */
  const gestureActive = useRef(false)
  const onGestureChange = useCallback((active: boolean) => {
    gestureActive.current = active
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        return e.shiftKey ? redo() : undo()
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        return setSidebarOpen((v) => !v)
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        return selectAll()
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
        e.preventDefault()
        return copySelection()
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
        // Otherwise the browser opens its "bookmark this page" dialog.
        e.preventDefault()
        return duplicateSelected()
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === ']' || e.key === '[')) {
        // Same reorder the property bar's Front/Back buttons use.
        // preventDefault so Ctrl+] doesn't switch tabs and ⌘[ doesn't walk history.
        e.preventDefault()
        return reorderSelected(e.key === ']')
      }
      // ⌘V is deliberately not handled here — a real paste already fires the
      // window `paste` listener above, which is where it's wired.
      if (e.metaKey || e.ctrlKey || e.altKey) return

      // A stroke, a drag, or a handle resize is mid-gesture: pointer capture is
      // still delivering it to the tool (and slide) it started on, so switching
      // either out from under it here would corrupt or destroy it — see
      // InkLayer's `onGestureChange`.
      if (gestureActive.current && GESTURE_LOCKED_KEYS.has(e.key.toLowerCase())) {
        e.preventDefault()
        return
      }

      // Backspace would otherwise walk the browser back a page.
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault()
        return deleteSelected()
      }

      // Digits pick a tool, Shift+digit picks a colour. Read `code`, not `key` —
      // Shift+1 arrives as "!" on a Mac layout.
      const digit = e.code.match(/^Digit([1-9])$/)?.[1]
      if (digit) {
        e.preventDefault()
        const n = Number(digit) - 1
        if (e.shiftKey) {
          const c = INK_COLORS[n]
          if (c) applyStroke(c.value)
        } else if (!gestureActive.current) {
          const t = TOOL_ORDER[n]
          if (t) pickTool(t)
        }
        return
      }

      switch (e.key) {
        case ' ':
        case 'j':
          // The guaranteed escape hatch: always navigates, selection or not —
          // arrows below are the ones that nudge.
          e.preventDefault()
          return go(1)
        case 'k':
          e.preventDefault()
          return go(-1)
        case 'ArrowRight':
        case 'ArrowLeft':
        case 'ArrowUp':
        case 'ArrowDown': {
          e.preventDefault()
          // A selection eats the arrows to nudge it; only an empty selection
          // lets them fall through to slide navigation.
          if (!selected.length) {
            return go(e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1)
          }
          const step = e.shiftKey ? NUDGE_SHIFT : NUDGE
          const dx = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0
          const dy = e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0
          return nudgeSelected(dx, dy)
        }
        case 'Home':
          return setIndex(0)
        case 'End':
          return setIndex(Math.max(0, total - 1))
        case 'Escape': {
          // One step per press: clear a selection, then reset the tool, then
          // leave focus — never more than one at once.
          if (selected.length) return clearSelection()
          if (tool !== 'cursor') return setTool('cursor')
          if (focus) return exitFocus()
          return
        }
      }

      switch (e.key.toLowerCase()) {
        case 'v':
          return pickTool('cursor')
        case 'p':
          return pickTool('pen')
        case 'h':
          return pickTool('highlighter')
        case 'a':
          return pickTool('arrow')
        case 's':
          return pickTool('shape')
        case 't':
          return pickTool('text')
        case 'e':
          return pickTool('eraser')
        case 'x':
          return clearSlide()
        case 'b':
          return setSidebarOpen((v) => !v)
        case 'f':
          return focus ? exitFocus() : enterFocus()
        case 'c':
          return cycleColor()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    applyStroke,
    clearSelection,
    clearSlide,
    copySelection,
    cycleColor,
    deleteSelected,
    duplicateSelected,
    enterFocus,
    exitFocus,
    focus,
    go,
    nudgeSelected,
    pickTool,
    redo,
    reorderSelected,
    selectAll,
    selected,
    tool,
    total,
    undo,
  ])

  /* ---------------------------------------------------------------- wheel */

  const wheelLock = useRef(0)
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      if (Math.abs(e.deltaY) < 12) return
      const now = performance.now()
      if (now - wheelLock.current < 420) return
      wheelLock.current = now
      go(e.deltaY > 0 ? 1 : -1)
    },
    [go],
  )

  /* ----------------------------------------------------------- idle chrome */

  useEffect(() => {
    let timer = 0
    const wake = () => {
      setIdle(false)
      clearTimeout(timer)
      timer = window.setTimeout(() => setIdle(true), 2200)
    }
    wake()
    window.addEventListener('pointermove', wake)
    window.addEventListener('keydown', wake)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('pointermove', wake)
      window.removeEventListener('keydown', wake)
    }
  }, [])

  /* ----------------------------------------------------------------- view */

  const stageWidth = `min(1440px, 100%, calc((100vh - ${focus ? 130 : 210}px) * 16 / 9))`

  return (
    <div className="flex h-full w-full overflow-hidden">
      {sidebarOpen && (
        <Sidebar
          stories={stories}
          dir={dir}
          activeSlug={activeSlug}
          activeIndex={index}
          onSelectStory={selectStory}
          onSelectSlide={setIndex}
          onNewStory={() => void newStory()}
          inkCounts={inkCounts}
        />
      )}

      <main
        className="shell-atmosphere relative flex min-w-0 flex-1 flex-col"
        onWheel={onWheel}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      >
        {!focus && (
          <header className="relative z-10 flex items-center justify-between px-7 pt-5 pb-2">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSidebarOpen((v) => !v)}
                title="Toggle sidebar · ⌘B"
                className="flex size-7 items-center justify-center rounded-md text-dimmer transition-colors hover:bg-white/[0.06] hover:text-dim"
              >
                <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="2.5" y="3.5" width="15" height="13" rx="2.5" />
                  <path d="M8 3.5v13" />
                </svg>
              </button>
              <span className="label">{story ? story.slug : 'no storyline'}</span>
            </div>

            <div className="flex items-center gap-4">
              <span className="font-mono text-[11px] text-dimmer">
                <span className="text-dim">{String(index + 1).padStart(2, '0')}</span> /{' '}
                {String(total).padStart(2, '0')}
              </span>
              <button
                onClick={enterFocus}
                title="Focus mode · F"
                className="label transition-colors hover:text-accent"
              >
                Focus
              </button>
            </div>
          </header>
        )}

        {/* pr leaves a gutter for the tool rail — it must never sit over the slide,
            or it lands inside the recording crop. */}
        <div className="relative z-10 flex min-h-0 flex-1 items-center justify-center pr-[92px] pb-6 pl-7">
          <div className="flex flex-col items-center gap-4" style={{ width: stageWidth }}>
            <div className="stage w-full">
              {slide ? (
                <SlideView slide={slide} />
              ) : (
                <div className="slide" data-layout="center">
                  <div className="slide-fit">
                    <h2>{status === 'loading' ? 'Loading…' : 'No storyline selected'}</h2>
                    <p>
                      {status === 'error'
                        ? 'Could not read the storylines folder.'
                        : 'Add a markdown file to the folder, or press + in the sidebar.'}
                    </p>
                  </div>
                </div>
              )}

              {slide && (
                <InkLayer
                  key={`${activeSlug}:${slide.key}`}
                  elements={slideInk}
                  tool={tool}
                  shape={shape}
                  style={style}
                  selectedIds={selectedIds}
                  onSelect={setSelectedIds}
                  onCommit={commit}
                  onUpdateMany={updateMany}
                  onCommitMany={commitMany}
                  onErase={erase}
                  onGestureChange={onGestureChange}
                />
              )}
            </div>

            {/* One reserved slot under the stage: the property bar while something
                is selected, the speaker note otherwise. The height is fixed so the
                stage never moves or resizes between the two — and both live outside
                `.stage`, which is the recording crop. */}
            {!focus && (
              <div className="flex h-[66px] w-full shrink-0 items-start">
                {selected.length > 0 ? (
                  <PropertyBar
                    elements={selected}
                    custom={style.custom}
                    onCustom={pickCustom}
                    onStroke={applyStroke}
                    onFill={applyFill}
                    onWidth={applyWidth}
                    onOpacity={applyOpacity}
                    onFontSize={applyFontSize}
                    onShapeKind={applyShapeKind}
                    onFront={() => reorderSelected(true)}
                    onBack={() => reorderSelected(false)}
                    onDuplicate={duplicateSelected}
                    onDelete={deleteSelected}
                  />
                ) : (
                  slide?.note && (
                    <p className="w-full text-[13.5px] leading-relaxed text-dim">
                      <span className="label mr-2 text-accent/70">note</span>
                      {slide.note}
                    </p>
                  )
                )}
              </div>
            )}
          </div>
        </div>

        <div className="pointer-events-none absolute top-1/2 right-5 z-20 -translate-y-1/2">
          <ToolRail
            tool={tool}
            shape={shape}
            color={style.stroke}
            custom={style.custom}
            idle={idle && tool === 'cursor'}
            canUndo={past.length > 0}
            canRedo={future.length > 0}
            hasInk={slideInk.length > 0}
            onTool={pickTool}
            onColor={applyStroke}
            onCustom={(c) => pickCustom(c, 'stroke')}
            onUndo={undo}
            onRedo={redo}
            onClear={clearSlide}
          />
        </div>

        {/* Bottom-left, outside the stage — a paste confirmation must never end
            up in the recording. */}
        {toast && (
          <div className="pointer-events-none absolute bottom-4 left-7 z-20">
            <span
              className={`label rounded-md bg-white/[0.06] px-2.5 py-1.5 ${
                toast.sticky ? 'text-accent' : 'text-dim'
              }`}
            >
              {toast.text}
            </span>
          </div>
        )}
      </main>
    </div>
  )
}
