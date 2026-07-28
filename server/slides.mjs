/**
 * The slide grammar. Kept apart from the renderer so the shape of a deck is
 * stated once, with no markdown parser attached to it — and kept in plain JS so
 * the app, the CLI and the MCP server all read a deck the same way. A second
 * splitter that disagreed about fenced code blocks would renumber slides only
 * on the decks that document the syntax.
 */

/**
 * `<!-- layout: quote -->` / `<!-- note: say this bit slowly -->`
 * Must sit on its own line — otherwise a comment quoted inside a code span
 * (documenting the syntax) gets swallowed as a real directive.
 */
export const DIRECTIVE = /^[ \t]*<!--[ \t]*(layout|note)[ \t]*:([\s\S]*?)-->[ \t]*$/gim

const FENCE = /^[ \t]*(`{3,}|~{3,})/
const BREAK_LINE = /^[ \t]*---[ \t]*$/

/**
 * A slide break is a `---` alone on its own line — except inside a fenced code
 * block, where a bare `---` is common (a YAML frontmatter example, a markdown
 * horizontal rule shown as a sample). A blind regex split can't tell the two
 * apart and fractures one slide into two, silently renumbering everything
 * after it — so this walks line by line, tracking whether a ``` or ~~~ fence
 * is open, and only treats `---` as a break outside one.
 *
 * @param {string} raw
 * @returns {string[]}
 */
export function splitSlides(raw) {
  const lines = raw.split(/\r?\n/)
  /** @type {string[]} */
  const blocks = []
  /** @type {string[]} */
  let current = []
  /** @type {{ marker: string, length: number } | null} */
  let fence = null

  for (const line of lines) {
    const hit = line.match(FENCE)
    if (hit) {
      const [marker, length] = [hit[1][0], hit[1].length]
      if (!fence) fence = { marker, length }
      // A closing fence must be the same character and at least as long as
      // the one that opened it — a shorter or different-character run inside
      // stays literal text.
      else if (marker === fence.marker && length >= fence.length) fence = null
      current.push(line)
      continue
    }
    if (!fence && BREAK_LINE.test(line)) {
      blocks.push(current.join('\n'))
      current = []
      continue
    }
    current.push(line)
  }
  blocks.push(current.join('\n'))
  return blocks
}

/**
 * The heading as plain text. Inline HTML is stripped as well as markdown: a
 * heading carrying an accent span (`# How <span class="hand">deck</span> works`)
 * renders fine on the slide, but this string is used raw in the sidebar and the
 * outline, and it seeds the annotation key — so leaving the tags in printed the
 * markup at the user and keyed marks to `h:how-span-class-hand-deck-span-works`.
 *
 * @param {string} md
 * @returns {string | null}
 */
export function firstHeading(md) {
  const m = md.match(/^\s*#{1,3}\s+(.+?)\s*$/m)
  if (!m) return null
  const text = m[1]
    .replace(/<[^>]+>/g, '')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text || null
}
