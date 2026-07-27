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

/** A slide break is a `---` alone on its own line. */
export const SLIDE_BREAK = /\r?\n[ \t]*---[ \t]*(?=\r?\n)/
