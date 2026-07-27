import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Sidebar from './components/Sidebar'
import SlideView from './components/SlideView'
import InkLayer from './components/InkLayer'
import ToolRail from './components/ToolRail'
import { addImage, createStory, fetchInk, fetchStories, saveInk } from './lib/api'
import {
  INK_COLORS,
  SHAPE_ORDER,
  TOOL_ORDER,
  makeStyle,
  normalizeEl,
  placeImage,
  uid,
} from './lib/ink'
import type { InkEl, ShapeKind, Story, StoryInk, Tool } from './types'

const HISTORY_LIMIT = 60

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

  const [tool, setTool] = useState<Tool>('cursor')
  const [shape, setShape] = useState<ShapeKind>(SHAPE_ORDER[0])
  const [color, setColor] = useState<string>(INK_COLORS[0].value)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [focus, setFocus] = useState(false)
  const [idle, setIdle] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])

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

  useEffect(() => {
    if (!activeSlug) return
    let cancelled = false
    dirty.current = false
    setPast([])
    setFuture([])
    void fetchInk(activeSlug).then((data) => {
      if (cancelled) return
      // The one place on-disk shapes are read. Everything downstream — renderers,
      // hit-tests, geometry — sees only the current shape, never a legacy fallback.
      const loaded: StoryInk = Object.fromEntries(
        Object.entries(data).map(([key, els]) => [
          key,
          (Array.isArray(els) ? els : [])
            .map(normalizeEl)
            .filter((el): el is InkEl => el !== null),
        ]),
      )
      setInk(loaded)
      setInkCounts((c) => ({
        ...c,
        [activeSlug]: Object.values(loaded).reduce((n, els) => n + els.length, 0),
      }))
    })
    return () => {
      cancelled = true
    }
  }, [activeSlug, setInk, setPast, setFuture])

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

  const mutate = useCallback(
    (next: (prev: StoryInk) => StoryInk) => {
      const prev = inkRef.current
      const updated = next(prev)
      dirty.current = true
      setInk(updated)
      setPast([...pastRef.current.slice(-HISTORY_LIMIT), prev])
      setFuture([])
      if (activeSlug) {
        setInkCounts((c) => ({
          ...c,
          [activeSlug]: Object.values(updated).reduce((n, els) => n + els.length, 0),
        }))
      }
    },
    [activeSlug, setInk, setPast, setFuture],
  )

  /* Batch first, single as the thin wrapper: one gesture is one history entry, whether
     it moved one element or ten — the shape `erase` has always had. */

  const commitMany = useCallback(
    (els: InkEl[]) => {
      if (!slide || !els.length) return
      mutate((prev) => ({ ...prev, [slide.key]: [...(prev[slide.key] ?? []), ...els] }))
    },
    [mutate, slide],
  )

  const updateMany = useCallback(
    (els: InkEl[]) => {
      if (!slide || !els.length) return
      const next = new Map(els.map((el) => [el.id, el]))
      mutate((prev) => ({
        ...prev,
        [slide.key]: (prev[slide.key] ?? []).map((el) => next.get(el.id) ?? el),
      }))
    },
    [mutate, slide],
  )

  const commit = useCallback((el: InkEl) => commitMany([el]), [commitMany])

  const update = useCallback((el: InkEl) => updateMany([el]), [updateMany])

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

  // A selection can't outlive the slide it was made on.
  useEffect(clearSelection, [clearSelection, slide?.key, activeSlug, tool])

  const undo = useCallback(() => {
    const p = pastRef.current
    if (!p.length) return
    dirty.current = true
    setFuture([inkRef.current, ...futureRef.current].slice(0, HISTORY_LIMIT))
    setInk(p[p.length - 1])
    setPast(p.slice(0, -1))
  }, [setFuture, setInk, setPast])

  const redo = useCallback(() => {
    const f = futureRef.current
    if (!f.length) return
    dirty.current = true
    setPast([...pastRef.current.slice(-HISTORY_LIMIT), inkRef.current])
    setInk(f[0])
    setFuture(f.slice(1))
  }, [setFuture, setInk, setPast])

  /* ----------------------------------------------------------- navigation */

  const total = story?.slides.length ?? 0

  const go = useCallback(
    (delta: number) => {
      setIndex((i) => Math.max(0, Math.min(total - 1, i + delta)))
    },
    [total],
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
    await createStory(slug, TEMPLATE(title))
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
        commit({ id: uid(), kind: 'image', src, style: makeStyle(), ...placeImage(natural, nth) })
        setToast({ text: src })
      } catch (err) {
        setToast({ text: err instanceof Error ? err.message : 'Could not add the image' })
      } finally {
        adding.current = false
      }
    },
    [activeSlug, slide, slideInk, commit],
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
      if (!blob) return
      e.preventDefault()
      void dropImage(blob)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [dropImage])

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
      if (e.metaKey || e.ctrlKey || e.altKey) return

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
          if (c) setColor(c.value)
        } else {
          const t = TOOL_ORDER[n]
          if (t) pickTool(t)
        }
        return
      }

      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
        case ' ':
        case 'j':
          e.preventDefault()
          return go(1)
        case 'ArrowLeft':
        case 'ArrowUp':
        case 'k':
          e.preventDefault()
          return go(-1)
        case 'Home':
          return setIndex(0)
        case 'End':
          return setIndex(Math.max(0, total - 1))
        case 'Escape':
          setTool('cursor')
          return setFocus(false)
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
        case 'u':
          return undo()
        case 'b':
          return setSidebarOpen((v) => !v)
        case 'f':
          setSidebarOpen((v) => (focus ? v : false))
          return setFocus((v) => !v)
        case 'c':
          return setColor((current) => {
            const at = INK_COLORS.findIndex((c) => c.value === current)
            return INK_COLORS[(at + 1) % INK_COLORS.length].value
          })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [clearSlide, deleteSelected, focus, go, pickTool, redo, total, undo])

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
                onClick={() => {
                  setSidebarOpen(false)
                  setFocus(true)
                }}
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
            {/* A press that lands on the slide rather than on an object clears
                the selection — the ink elements stop propagation. */}
            <div className="stage w-full" onPointerDown={clearSelection}>
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
                  color={color}
                  selectedIds={selectedIds}
                  onSelect={setSelectedIds}
                  onCommit={commit}
                  onUpdate={update}
                  onErase={erase}
                />
              )}
            </div>

            {slide?.note && !focus && (
              <p className="w-full text-[13.5px] leading-relaxed text-dim">
                <span className="label mr-2 text-accent/70">note</span>
                {slide.note}
              </p>
            )}
          </div>
        </div>

        <div className="pointer-events-none absolute top-1/2 right-5 z-20 -translate-y-1/2">
          <ToolRail
            tool={tool}
            shape={shape}
            color={color}
            idle={idle && tool === 'cursor'}
            canUndo={past.length > 0}
            canRedo={future.length > 0}
            hasInk={slideInk.length > 0}
            onTool={pickTool}
            onColor={setColor}
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
