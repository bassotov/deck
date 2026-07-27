import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Sidebar from './components/Sidebar'
import SlideView from './components/SlideView'
import InkLayer from './components/InkLayer'
import ToolRail from './components/ToolRail'
import { createStory, fetchInk, fetchStories, saveInk } from './lib/api'
import { INK_COLORS, SHAPE_ORDER, TOOL_ORDER } from './lib/ink'
import type { InkEl, ShapeKind, Story, StoryInk, Tool } from './types'

const HISTORY_LIMIT = 60

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

  const [ink, setInk] = useState<StoryInk>({})
  const [past, setPast] = useState<StoryInk[]>([])
  const [future, setFuture] = useState<StoryInk[]>([])
  const [inkCounts, setInkCounts] = useState<Record<string, number>>({})

  const [tool, setTool] = useState<Tool>('cursor')
  const [shape, setShape] = useState<ShapeKind>(SHAPE_ORDER[0])
  const [color, setColor] = useState<string>(INK_COLORS[0].value)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [focus, setFocus] = useState(false)
  const [idle, setIdle] = useState(false)

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
      setInk(data)
      setInkCounts((c) => ({
        ...c,
        [activeSlug]: Object.values(data).reduce((n, els) => n + els.length, 0),
      }))
    })
    return () => {
      cancelled = true
    }
  }, [activeSlug])

  useEffect(() => {
    if (!activeSlug || !dirty.current) return
    const id = setTimeout(() => void saveInk(activeSlug, ink), 600)
    return () => clearTimeout(id)
  }, [ink, activeSlug])

  /* ------------------------------------------------------------ mutations */

  const mutate = useCallback(
    (next: (prev: StoryInk) => StoryInk) => {
      setInk((prev) => {
        setPast((p) => [...p.slice(-HISTORY_LIMIT), prev])
        setFuture([])
        dirty.current = true
        const updated = next(prev)
        if (activeSlug) {
          setInkCounts((c) => ({
            ...c,
            [activeSlug]: Object.values(updated).reduce((n, els) => n + els.length, 0),
          }))
        }
        return updated
      })
    },
    [activeSlug],
  )

  const commit = useCallback(
    (el: InkEl) => {
      if (!slide) return
      mutate((prev) => ({ ...prev, [slide.key]: [...(prev[slide.key] ?? []), el] }))
    },
    [mutate, slide],
  )

  const update = useCallback(
    (el: InkEl) => {
      if (!slide) return
      mutate((prev) => ({
        ...prev,
        [slide.key]: (prev[slide.key] ?? []).map((e) => (e.id === el.id ? el : e)),
      }))
    },
    [mutate, slide],
  )

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

  const undo = useCallback(() => {
    setPast((p) => {
      if (!p.length) return p
      const prev = p[p.length - 1]
      setInk((current) => {
        setFuture((f) => [current, ...f].slice(0, HISTORY_LIMIT))
        return prev
      })
      dirty.current = true
      return p.slice(0, -1)
    })
  }, [])

  const redo = useCallback(() => {
    setFuture((f) => {
      if (!f.length) return f
      const next = f[0]
      setInk((current) => {
        setPast((p) => [...p.slice(-HISTORY_LIMIT), current])
        return next
      })
      dirty.current = true
      return f.slice(1)
    })
  }, [])

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
  }, [clearSlide, focus, go, pickTool, redo, total, undo])

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

      <main className="shell-atmosphere relative flex min-w-0 flex-1 flex-col" onWheel={onWheel}>
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
                  color={color}
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
      </main>
    </div>
  )
}
