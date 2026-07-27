import { useMemo, useState } from 'react'
import type { Story } from '../types'

interface Props {
  stories: Story[]
  dir: string
  activeSlug: string | null
  activeIndex: number
  onSelectStory: (slug: string) => void
  onSelectSlide: (index: number) => void
  onNewStory: () => void
  inkCounts: Record<string, number>
}

export default function Sidebar({
  stories,
  dir,
  activeSlug,
  activeIndex,
  onSelectStory,
  onSelectSlide,
  onNewStory,
  inkCounts,
}: Props) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return stories
    return stories.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.slug.toLowerCase().includes(q) ||
        s.slides.some((sl) => sl.heading?.toLowerCase().includes(q)),
    )
  }, [stories, query])

  return (
    <aside className="flex h-full w-[290px] shrink-0 flex-col border-r border-hair bg-panel">
      <div className="flex items-center justify-between px-5 pt-5 pb-3">
        <span className="label">Storylines</span>
        <button
          onClick={onNewStory}
          title="New storyline"
          className="flex size-6 items-center justify-center rounded-md border border-hair text-dim transition-colors hover:border-accent/50 hover:text-accent"
        >
          <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor">
            <path d="M8 3.5v9M3.5 8h9" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="px-5 pb-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter"
          className="w-full rounded-md border border-hair bg-black/25 px-2.5 py-1.5 text-[13px] text-[#e8e4e0] outline-none placeholder:text-dimmer focus:border-accent/40"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-4">
        {filtered.length === 0 && (
          <p className="px-2.5 py-6 text-[13px] leading-relaxed text-dimmer">
            No storylines yet. Drop a <code className="font-mono text-dim">.md</code> file in the
            folder below, or hit <span className="text-dim">+</span>.
          </p>
        )}

        {filtered.map((story) => {
          const isActive = story.slug === activeSlug
          return (
            <div key={story.slug} className="mb-0.5">
              <button
                onClick={() => onSelectStory(story.slug)}
                className={`group flex w-full flex-col gap-1 rounded-lg px-2.5 py-2 text-left transition-colors ${
                  isActive ? 'bg-white/[0.055]' : 'hover:bg-white/[0.03]'
                }`}
              >
                <span
                  className={`font-display text-[17px] leading-tight tracking-tight ${
                    isActive ? 'text-[#f4f1ee]' : 'text-[#cdc7c1] group-hover:text-[#e8e4e0]'
                  }`}
                >
                  {story.title}
                </span>
                <span className="label flex items-center gap-2">
                  <span>{story.slides.length} slides</span>
                  {inkCounts[story.slug] > 0 && (
                    <span className="text-accent/70">{inkCounts[story.slug]} marks</span>
                  )}
                </span>
              </button>

              {isActive && (
                <ol className="mt-1 mb-2 ml-2.5 border-l border-hair">
                  {story.slides.map((slide) => {
                    const current = slide.index === activeIndex
                    return (
                      <li key={slide.key}>
                        <button
                          onClick={() => onSelectSlide(slide.index)}
                          className={`relative -ml-px flex w-full items-baseline gap-2.5 border-l py-1.5 pr-2 pl-3 text-left transition-colors ${
                            current
                              ? 'border-accent text-[#e8e4e0]'
                              : 'border-transparent text-[#8a8480] hover:border-white/20 hover:text-[#cdc7c1]'
                          }`}
                        >
                          <span
                            className={`font-mono text-[10px] ${current ? 'text-accent' : 'text-dimmer'}`}
                          >
                            {String(slide.index + 1).padStart(2, '0')}
                          </span>
                          <span
                            className={`line-clamp-2 text-[13px] leading-snug ${
                              slide.heading ? '' : 'italic opacity-70'
                            }`}
                          >
                            {slide.preview || '—'}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ol>
              )}
            </div>
          )
        })}
      </div>

      <div className="border-t border-hair px-5 py-3">
        <p className="truncate font-mono text-[10px] text-dimmer" title={dir}>
          {dir.replace(/^\/Users\/[^/]+/, '~')}
        </p>
      </div>
    </aside>
  )
}
