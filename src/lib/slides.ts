/**
 * The slide grammar. Kept apart from the renderer so the shape of a deck is
 * stated once, with no markdown parser attached to it.
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
 */
export function splitSlides(raw: string): string[] {
  const lines = raw.split(/\r?\n/)
  const blocks: string[] = []
  let current: string[] = []
  let fence: { marker: string; length: number } | null = null

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
