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

/**
 * Live reload, over server-sent events rather than Vite's HMR channel: the
 * published CLI serves the built app with no Vite in the process, and one
 * transport that works in both beats a dev-only path plus a fallback.
 * `EventSource` reconnects on its own, so a restarted server re-attaches.
 */
export function watchDecks(onChange: () => void): () => void {
  const source = new EventSource('/api/watch')
  source.addEventListener('decks', () => onChange())
  return () => source.close()
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

/**
 * Deliberately untyped elements: what is on disk may predate the current element
 * shape, so the caller has to run it through `normalizeEl` before it is `StoryInk`.
 */
export async function fetchInk(slug: string): Promise<Record<string, unknown[]>> {
  const res = await fetch(`/api/ink/${encodeURIComponent(slug)}`)
  if (!res.ok) return {}
  return res.json()
}

/**
 * `keepalive` is for the last write on the way out of the page — the request
 * outlives the document. It caps the body at ~64KB, so it is only used on
 * unload, never for the ordinary debounced save.
 */
export async function saveInk(slug: string, ink: StoryInk, keepalive = false): Promise<void> {
  const res = await fetch(`/api/ink/${encodeURIComponent(slug)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ink),
    keepalive,
  })
  if (!res.ok) throw new Error(`ink save: ${res.status}`)
}
