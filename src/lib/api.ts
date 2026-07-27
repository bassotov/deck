import { parseStory } from './parse'
import type { Story, StoryInk } from '../types'

interface RawStory {
  slug: string
  raw: string
  mtime: number
}

export async function fetchStories(): Promise<{ dir: string; stories: Story[] }> {
  const res = await fetch('/api/stories')
  if (!res.ok) throw new Error(`stories: ${res.status}`)
  const data: { dir: string; stories: RawStory[] } = await res.json()
  return {
    dir: data.dir,
    stories: data.stories.map((s) => parseStory(s.slug, s.raw, s.mtime)),
  }
}

export async function createStory(slug: string, raw: string): Promise<void> {
  const res = await fetch('/api/stories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, raw }),
  })
  if (!res.ok) throw new Error(`create: ${res.status}`)
}

export async function fetchInk(slug: string): Promise<StoryInk> {
  const res = await fetch(`/api/ink/${encodeURIComponent(slug)}`)
  if (!res.ok) return {}
  return res.json()
}

export async function saveInk(slug: string, ink: StoryInk): Promise<void> {
  await fetch(`/api/ink/${encodeURIComponent(slug)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ink),
  })
}
