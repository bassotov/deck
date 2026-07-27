import { marked } from 'marked'
import type { Slide, SlideLayout, Story } from '../types'

marked.setOptions({ gfm: true, breaks: false })

/**
 * `<!-- layout: quote -->` / `<!-- note: say this bit slowly -->`
 * Must sit on its own line — otherwise a comment quoted inside a code span
 * (documenting the syntax) gets swallowed as a real directive.
 */
const DIRECTIVE = /^[ \t]*<!--[ \t]*(layout|note)[ \t]*:([\s\S]*?)-->[ \t]*$/gim

/** A slide break is a `---` alone on its own line. */
const SLIDE_BREAK = /\r?\n[ \t]*---[ \t]*(?=\r?\n)/

function readDirectives(block: string) {
  const found: Record<string, string> = {}
  const body = block.replace(DIRECTIVE, (_m, key: string, value: string) => {
    found[key.toLowerCase()] = value.trim()
    return ''
  })
  return { body: body.trim(), directives: found }
}

/** Obsidian embeds (`![[chart.png]]`) and relative paths both resolve against
 *  the storylines folder, which the dev server mounts at /stories-assets. */
function resolveAssets(md: string): string {
  return md.replace(
    /!\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g,
    (_m, file: string, alt = '') => `![${alt}](${file.trim()})`,
  )
}

function rewriteImageSrc(html: string): string {
  return html.replace(
    /(<img[^>]*\ssrc=")(?!https?:|data:|\/)([^"]+)"/g,
    (_m, head: string, src: string) => `${head}/stories-assets/${src}"`,
  )
}

/** `columns` layout: everything before the first h3 is the header, then each h3
 *  starts a new column. Lets a comparison slide stay plain markdown. */
function buildColumns(html: string): string {
  const parts = html.split(/(?=<h3)/)
  if (parts.length < 2) return html
  const cols = parts
    .slice(1)
    .map(
      (col, i) =>
        `<div class="col"><span class="col-num">${String(i + 1).padStart(2, '0')}</span>${col}</div>`,
    )
    .join('')
  return `${parts[0]}<div class="cols">${cols}</div>`
}

function firstHeading(md: string): string | null {
  const m = md.match(/^\s*#{1,3}\s+(.+?)\s*$/m)
  return m ? m[1].replace(/[*_`]/g, '').trim() : null
}

/** For slides with no heading — quotes, image-only — name them by their words. */
function plainPreview(md: string): string {
  const text = md
    .replace(/^\s*[>#\-*\d.]+\s*/gm, '')
    .replace(/<[^>]+>/g, '')
    .replace(/[*_`|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > 60 ? `${text.slice(0, 60).trimEnd()}…` : text
}

function detectLayout(body: string, index: number): SlideLayout {
  const lines = body.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (index === 0) return 'title'
  if (lines.length > 0 && lines.every((l) => l.trim().startsWith('>'))) return 'quote'
  if (lines.length <= 2 && lines.every((l) => /^\s*#{1,3}\s+/.test(l))) return 'center'
  return 'default'
}

/**
 * Annotations are keyed by heading, not position — inserting or reordering slides
 * would otherwise drag every mark onto the wrong slide. Headless slides fall back
 * to position, and a repeated heading gets its index appended.
 */
function slideKey(heading: string | null, index: number, taken: Set<string>): string {
  const base = heading
    ? `h:${heading
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-|-$/g, '')}`
    : `s${index}`
  const key = base && base !== 'h:' ? base : `s${index}`
  const unique = taken.has(key) ? `${key}-${index}` : key
  taken.add(unique)
  return unique
}

export function parseStory(slug: string, raw: string, mtime: number): Story {
  const blocks = raw.split(SLIDE_BREAK)
  const taken = new Set<string>()

  const slides: Slide[] = blocks
    .map((block, index) => {
      const { body, directives } = readDirectives(block)
      return { body, directives, index }
    })
    .filter(({ body }) => body.length > 0)
    .map(({ body, directives }, index) => {
      const layout = (directives.layout as SlideLayout) || detectLayout(body, index)
      const heading = firstHeading(body)
      let html = rewriteImageSrc(marked.parse(resolveAssets(body)) as string)
      if (layout === 'columns') html = buildColumns(html)
      return {
        key: slideKey(heading, index, taken),
        index,
        layout,
        heading,
        preview: heading ?? plainPreview(body),
        html,
        note: directives.note ?? null,
      }
    })

  const titleFromBody = firstHeading(raw)
  const title = titleFromBody ?? slug.replace(/^\d{4}-\d{2}-\d{2}[-_]?/, '').replace(/-/g, ' ')

  // The first paragraph of the title slide, if it has one.
  const firstBody = blocks[0] ?? ''
  const sub = firstBody
    .replace(DIRECTIVE, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith('#'))

  return { slug, title, subtitle: sub ?? null, slides, mtime }
}
