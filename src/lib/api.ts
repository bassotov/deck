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

/** Reads as a data URL so the bytes survive JSON — `data:image/png;base64,AAA…` */
function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('could not read the image'))
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.readAsDataURL(blob)
  })
}

/** Stores the image beside the deck and returns its filename. */
export async function addImage(slug: string, blob: Blob): Promise<string> {
  const res = await fetch('/api/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, mime: blob.type, data: await toBase64(blob) }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `image: ${res.status}`)
  return body.name as string
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
