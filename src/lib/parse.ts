import { marked } from 'marked'
import { LAYOUTS, type Slide, type SlideLayout, type Story } from '../types'
import { DIRECTIVE, splitSlides } from './slides'

marked.setOptions({ gfm: true, breaks: false })

function readDirectives(block: string) {
  const found: Record<string, string> = {}
  const body = block.replace(DIRECTIVE, (_m, key: string, value: string) => {
    found[key.toLowerCase()] = value.trim()
    return ''
  })
  return { body: body.trim(), directives: found }
}

/* ------------------------------------------------------------------ images */

const SIZE_PRESET: Record<string, string> = {
  small: '26cqw',
  medium: '42cqw',
  large: '62cqw',
  full: '100%',
}

const ALIGN = new Set(['left', 'center', 'right'])

/**
 * A bare number is pixels at a 1280-wide reference stage, converted to `cqw` so
 * the image scales with the stage instead of pinning to one screen size. That
 * keeps `![[shot.png|600]]` looking the same here as it does in Obsidian.
 */
function sizeToCss(token: string): string | null {
  if (SIZE_PRESET[token]) return SIZE_PRESET[token]
  if (/^\d+(?:\.\d+)?%$/.test(token)) return token
  const px = token.match(/^(\d+(?:\.\d+)?)(?:x\d+)?$/)
  return px ? `${(parseFloat(px[1]) / 12.8).toFixed(2)}cqw` : null
}

/** Everything after the first `|` is size, alignment, or alt text, in any order. */
function readImageParams(params: string[]) {
  const alt: string[] = []
  let size: string | null = null
  let align: string | null = null

  for (const raw of params) {
    const token = raw.trim()
    if (!token) continue
    const low = token.toLowerCase()
    if (ALIGN.has(low)) align = low
    else {
      const css = sizeToCss(low)
      if (css) size = css
      else alt.push(token)
    }
  }

  const query = [size && `w=${size}`, align && `a=${align}`].filter(Boolean).join('&')
  return { alt: alt.join(' '), hash: query ? `#${query}` : '' }
}

/**
 * Encode a raw path/URL the way `encodeURI` would, but leave it alone if it
 * already looks percent-encoded (`%20`, …) — re-encoding that would turn the
 * `%` itself into `%25` and corrupt an already-valid destination.
 */
function encodeSrcIfNeeded(src: string): string {
  return /%[0-9a-fA-F]{2}/.test(src) ? src : encodeURI(src)
}

/** Obsidian embeds (`![[chart.png|600]]`) and relative paths both resolve against
 *  the vault, which the dev server serves under /stories-assets. */
function resolveAssets(md: string): string {
  const wiki = md.replace(
    /!\[\[([^\]|]+?)((?:\|[^\]|]*)*)\]\]/g,
    (_m, file: string, rest: string) => {
      const { alt, hash } = readImageParams(rest.split('|').slice(1))
      // Pasted screenshots keep Obsidian's spaces in the filename — encode so
      // marked still sees a single-token destination.
      return `![${alt}](${encodeURI(file.trim())}${hash})`
    },
  )

  // Plain-markdown form carries its size in the alt slot: `![alt|60%](shot.png)`.
  // The destination may be a bare token or the `<...>` angle-bracket form,
  // and — unlike the old `[^)\s]+` capture — may contain spaces, since a
  // hand-typed `![alt](my photo.png)` is a real path, not a broken one.
  return wiki.replace(
    /!\[([^\]]*)\]\((?:<([^<>]*)>|([^)]+))\)/g,
    (_m, alt: string, angleSrc: string | undefined, bareSrc: string | undefined) => {
      const src = encodeSrcIfNeeded((angleSrc ?? bareSrc ?? '').trim())
      if (!alt.includes('|')) return `![${alt}](${src})`
      const parts = alt.split('|')
      const { alt: text, hash } = readImageParams(parts.slice(1))
      return `![${[parts[0].trim(), text].filter(Boolean).join(' ')}](${src}${hash})`
    },
  )
}

function rewriteImageSrc(html: string): string {
  return html.replace(/<img([^>]*?)\ssrc="([^"]+)"([^>]*?)>/g, (_m, pre, src: string, post) => {
    const hash = src.indexOf('#')
    const url = hash === -1 ? src : src.slice(0, hash)
    const query = hash === -1 ? '' : src.slice(hash + 1)
    const width = query.match(/w=([^&]+)/)?.[1]
    const align = query.match(/a=([^&]+)/)?.[1]

    const href = /^(?:https?:|data:|\/)/.test(url) ? url : `/stories-assets/${url}`
    const cls = [width && 'sized', align && `al-${align}`].filter(Boolean).join(' ')

    return `<img${pre}${post} src="${href}"${cls ? ` class="${cls}"` : ''}${
      width ? ` style="width:${width}"` : ''
    }>`
  })
}

/* ------------------------------------------------------------ h3 sections */

/** The h3-block layouts all read the same shape: a header, then one block per h3. */
function splitSections(html: string) {
  const parts = html.split(/(?=<h3)/)
  if (parts.length < 2) return null
  return { header: parts[0], sections: parts.slice(1) }
}

function headOf(section: string) {
  const m = section.match(/^<h3[^>]*>([\s\S]*?)<\/h3>/)
  return {
    /** Bolding the heading (`### **+25**`) marks it as the one that matters. */
    key: m ? /<strong>/.test(m[1]) : false,
    text: m ? m[1].replace(/<[^>]+>/g, '').trim() : '',
    body: m ? section.slice(m[0].length) : section,
  }
}

/** `7,000`, `+25`, `~25%`, `$149` all read as numbers so a flow can size its bars. */
function numeric(text: string): number | null {
  const cleaned = text.replace(/[,\s$~+]/g, '').replace(/%$/, '')
  return /^-?\d+(?:\.\d+)?$/.test(cleaned) ? parseFloat(cleaned) : null
}

/** `columns` layout: everything before the first h3 is the header, then each h3
 *  starts a new column. Lets a comparison slide stay plain markdown. */
function buildColumns(html: string): string {
  const split = splitSections(html)
  if (!split) return html
  const cols = split.sections
    .map(
      (col, i) =>
        `<div class="col"><span class="col-num">${String(i + 1).padStart(2, '0')}</span>${col}</div>`,
    )
    .join('')
  return `${split.header}<div class="cols">${cols}</div>`
}

/**
 * `flow`: a left-to-right pipeline. When every step is a number the bars are
 * scaled against the largest one, so the drop-off is the picture, not the text.
 */
function buildFlow(html: string): string {
  const split = splitSections(html)
  if (!split) return html

  const heads = split.sections.map(headOf)
  const values = heads.map((h) => numeric(h.text))
  const max = Math.max(0, ...values.map((v) => v ?? 0))
  const scaled = values.every((v) => v !== null) && max > 0

  const steps = heads
    .map((h, i) => {
      const value = values[i]
      const pct = scaled ? Math.max(4, ((value as number) / max) * 100) : 100
      // Words instead of numbers means this is a path, not a funnel: no bars to
      // scale, and the step reads at label size rather than headline size.
      const bar = scaled
        ? `<div class="flow-bar"><span style="width:${pct.toFixed(1)}%"></span></div>`
        : ''
      const flags = [
        !scaled && ' data-text="true"',
        scaled && value === 0 && ' data-dead="true"',
        h.key && ' data-key="true"',
      ]
        .filter(Boolean)
        .join('')
      return `<div class="flow-step"${flags}><div class="flow-fig">${h.text}</div>${bar}<div class="flow-label">${h.body}</div></div>`
    })
    .join('<div class="flow-arrow"></div>')

  return `${split.header}<div class="flow">${steps}</div>`
}

/** `stats`: the same blocks as a flow, standing alone — headline numbers, no story between them. */
function buildStats(html: string): string {
  const split = splitSections(html)
  if (!split) return html
  const tiles = split.sections
    .map((section) => {
      const h = headOf(section)
      return `<div class="stat"${h.key ? ' data-key="true"' : ''}><div class="stat-fig">${
        h.text
      }</div><div class="stat-label">${h.body}</div></div>`
    })
    .join('')
  return `${split.header}<div class="stats">${tiles}</div>`
}

/** `versus`: first block is the guess, the rest is what actually happened. */
function buildVersus(html: string): string {
  const split = splitSections(html)
  if (!split) return html
  const panes = split.sections
    .map((s, i) => `<div class="vs-pane" data-side="${i === 0 ? 'a' : 'b'}">${s}</div>`)
    .join('')
  return `${split.header}<div class="vs">${panes}</div>`
}

/**
 * `timeline`: a bullet list becomes a dotted rail. A bold lead (`- **Aug** the demo
 * landed`) splits into the marker column and the beat. Flat lists only.
 */
function buildTimeline(html: string): string {
  return html.replace(/<ul>([\s\S]*?)<\/ul>/g, (_m, items: string) => {
    const rows = items.replace(/<li>([\s\S]*?)<\/li>/g, (_li, inner: string) => {
      const lead = inner.match(/^\s*<strong>([\s\S]*?)<\/strong>[ \t]*/)
      const when = lead ? `<span class="tl-when">${lead[1]}</span>` : ''
      const what = lead ? inner.slice(lead[0].length) : inner
      return `<li>${when}<span class="tl-what">${what}</span></li>`
    })
    return `<ul class="tl">${rows}</ul>`
  })
}

const BUILDERS: Partial<Record<SlideLayout, (html: string) => string>> = {
  columns: buildColumns,
  flow: buildFlow,
  stats: buildStats,
  versus: buildVersus,
  timeline: buildTimeline,
}

/* ------------------------------------------------------------------ slides */

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

/** A typo in a layout directive should fall back, not render an unstyled slide. */
function readLayout(directive: string | undefined, body: string, index: number): SlideLayout {
  const named = directive?.toLowerCase() as SlideLayout | undefined
  return named && LAYOUTS.includes(named) ? named : detectLayout(body, index)
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
  const blocks = splitSlides(raw)
  const taken = new Set<string>()

  const slides: Slide[] = blocks
    .map((block, index) => {
      const { body, directives } = readDirectives(block)
      return { body, directives, index }
    })
    .filter(({ body }) => body.length > 0)
    .map(({ body, directives }, index) => {
      const layout = readLayout(directives.layout, body, index)
      const heading = firstHeading(body)
      const html = rewriteImageSrc(marked.parse(resolveAssets(body)) as string)
      return {
        key: slideKey(heading, index, taken),
        index,
        layout,
        heading,
        preview: heading ?? plainPreview(body),
        html: BUILDERS[layout]?.(html) ?? html,
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
