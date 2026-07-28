/**
 * Export slides to PNG.
 *
 *   deck export                          every slide of every deck
 *   deck export how-deck-works           one deck
 *   deck export how-deck-works 0,6,8     particular slides, 0-indexed
 *   deck export how-deck-works --app     the whole window, not just the stage
 *
 * Playwright is not a dependency, because it pulls a browser down on install and
 * nobody needs one to run the app. Install it when you want to export:
 *
 *   npm i -D playwright && npx playwright install chromium
 *
 * The dev server is the renderer, so this boots one on its own port and stops it
 * again. Nothing is written to your decks folder.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { resolveConfig } from '../server/config.ts'
import { serve } from '../server/serve.ts'
import { DIRECTIVE, splitSlides } from '../server/slides.ts'

/**
 * Only the surface this script drives. Playwright is not installed by default —
 * importing its types would make the whole package fail to compile without it —
 * so the shape it must satisfy is stated here instead.
 */
interface Shot {
  screenshot(opts: { path: string }): Promise<unknown>
}
interface ExportPage extends Shot {
  goto(url: string, opts?: { waitUntil?: 'load' }): Promise<unknown>
  evaluate(expression: string): Promise<unknown>
  waitForSelector(selector: string, opts?: { state?: 'visible' }): Promise<unknown>
  waitForTimeout(ms: number): Promise<void>
  locator(selector: string): Shot
}
interface ExportBrowser {
  newPage(opts?: {
    viewport?: { width: number; height: number }
    deviceScaleFactor?: number
  }): Promise<ExportPage>
  close(): Promise<void>
}

const OUT = path.resolve(process.env.EXPORT_OUT ?? 'exports')
const SCALE = Number(process.env.EXPORT_SCALE ?? 2)
const PORT = Number(process.env.EXPORT_PORT ?? 5291)

const argv = process.argv.slice(2)
const appShot = argv.includes('--app')
const [slugArg, slidesArg] = argv.filter((a) => !a.startsWith('--'))
const wanted = slidesArg ? new Set(slidesArg.split(',').map((n) => Number(n.trim()))) : null

// The specifier is a variable on purpose: a literal would be resolved at compile
// time and fail the build on any machine that has not installed the browser.
const PLAYWRIGHT = 'playwright'
let chromium: { launch(): Promise<ExportBrowser> }
try {
  ;({ chromium } = (await import(PLAYWRIGHT)) as { chromium: { launch(): Promise<ExportBrowser> } })
} catch {
  console.error(
    'Export needs Playwright:\n\n  npm i -D playwright && npx playwright install chromium\n',
  )
  process.exit(1)
}

const config = resolveConfig()
const running = await serve({ config, port: PORT })

const decksRes = await fetch(`${running.url}/api/stories`)
const { stories } = (await decksRes.json()) as { stories: { slug: string; raw: string }[] }
const decks = slugArg ? stories.filter((s) => s.slug === slugArg) : stories

if (!decks.length) {
  console.error(`No deck matched "${slugArg}". Found: ${stories.map((s) => s.slug).join(', ')}`)
  await running.close()
  process.exit(1)
}

const browser: ExportBrowser = await chromium.launch()
const page: ExportPage = await browser.newPage({
  viewport: { width: 1680, height: 1050 },
  deviceScaleFactor: SCALE,
})

await fs.mkdir(OUT, { recursive: true })
console.log(`\n  reading  ${config.decksDir}\n  writing  ${OUT}\n`)

let written = 0
for (const deck of decks) {
  // Mirror the renderer exactly: it strips the directives, then drops whatever
  // is left empty. Counting raw blocks instead would keep a directive-only block
  // and ask for a slide the app never shows.
  const count = splitSlides(deck.raw)
    .map((b) => b.replace(DIRECTIVE, '').trim())
    .filter((b) => b.length > 0).length

  for (let i = 0; i < count; i++) {
    if (wanted && !wanted.has(i)) continue
    // The hash is 1-based; the filenames stay 0-based to match `--slides`.
    await page.goto(`${running.url}/#/${deck.slug}/${i + 1}`, { waitUntil: 'load' })

    // The display faces arrive over the network and slides fade in. Screenshot
    // either early and you get fallback type or a half-transparent slide.
    // Passed as an expression string so this file needs no DOM lib.
    await page.evaluate('document.fonts.ready')
    await page.waitForSelector('.stage .slide', { state: 'visible' })
    await page.waitForTimeout(450)

    const name = `${deck.slug}-${String(i).padStart(2, '0')}${appShot ? '-app' : ''}.png`
    const file = path.join(OUT, name)
    if (appShot) await page.screenshot({ path: file })
    else await page.locator('.stage').screenshot({ path: file })
    console.log(`  ${name}`)
    written++
  }
}

await browser.close()
await running.close()
console.log(`\n  ${written} png${written === 1 ? '' : 's'}\n`)
