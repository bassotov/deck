/**
 * The slide grammar lives in `server/slides.ts` because the CLI and the MCP
 * server read decks too, and none of them may disagree about where a slide
 * ends. That module imports nothing from `node:`, so it bundles into the
 * browser unchanged. This is only the app's door onto it.
 */
export { DIRECTIVE, splitSlides, firstHeading } from '../../server/slides.ts'
