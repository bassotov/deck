/**
 * The slide grammar lives in `server/slides.mjs`, in plain JS, because the CLI
 * and the MCP server read decks too and none of them may disagree about where a
 * slide ends. This module is only the app's door onto it.
 */
export { DIRECTIVE, splitSlides, firstHeading } from '../../server/slides.mjs'
