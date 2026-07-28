/**
 * Export slides to PNG.
 *
 *   npm run export                          every slide of every deck
 *   npm run export -- how-deck-works        one deck
 *   npm run export -- how-deck-works 0,6,8  particular slides, 0-indexed
 *   npm run export -- how-deck-works --app  the whole window, not just the stage
 *
 * Playwright is not a dependency, because it pulls a browser down on install and
 * nobody needs one to run the app. Install it when you want to export:
 *
 *   npm i -D playwright && npx playwright install chromium
 *
 * The dev server is the renderer, so this boots one on its own port and stops it
 * again. Nothing is written to your decks folder.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

const PORT = Number(process.env.EXPORT_PORT ?? 5291)
const OUT = path.resolve(process.env.EXPORT_OUT ?? 'exports')
const SCALE = Number(process.env.EXPORT_SCALE ?? 2)

const argv = process.argv.slice(2)
const appShot = argv.includes('--app')
const [slugArg, slidesArg] = argv.filter((a) => !a.startsWith('--'))
const wanted = slidesArg
  ? new Set(slidesArg.split(',').map((n) => Number(n.trim())))
  : null

let chromium
try {
  ;({ chromium } = await import('playwright'))
} catch {
  console.error(
    'Export needs Playwright:\n\n  npm i -D playwright && npx playwright install chromium\n',
  )
  process.exit(1)
}

/** The app is a dev server, so exporting means running one. */
const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  stdio: ['ignore', 'ignore', 'inherit'],
  env: process.env,
})
const stop = () => server.kill()
process.on('exit', stop)
process.on('SIGINT', () => {
  stop()
  process.exit(130)
})

const base = `http://localhost:${PORT}`

async function waitForServer(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/stories`)
      if (res.ok) return res.json()
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`dev server did not come up on ${base}`)
}

const { dir, stories } = await waitForServer()
const decks = slugArg ? stories.filter((s) => s.slug === slugArg) : stories
if (!decks.length) {
  console.error(`No deck matched "${slugArg}". Found: ${stories.map((s) => s.slug).join(', ')}`)
  process.exit(1)
}

const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: { width: 1680, height: 1050 },
  deviceScaleFactor: SCALE,
})

await fs.mkdir(OUT, { recursive: true })
console.log(`\n  reading  ${dir}\n  writing  ${OUT}\n`)

/**
 * How many slides a deck has, asked of the app rather than recomputed here.
 * `---` inside a fenced code block is not a slide break, so a regex split
 * over the raw markdown disagrees with the real parser on exactly the decks
 * that document the format. Overshooting the index instead lets the app clamp
 * it and write the clamped, 1-based value back into the hash.
 */
async function countSlides(slug) {
  await page.goto(`${base}/#/${slug}/9999`, { waitUntil: 'load' })
  await page.waitForSelector('.stage .slide', { state: 'visible' })
  await page.waitForFunction(() => !/\/9999$/.test(window.location.hash))
  return Number(new URL(page.url()).hash.match(/\/(\d+)$/)?.[1] ?? 1)
}

let written = 0
for (const deck of decks) {
  const count = await countSlides(deck.slug)

  for (let i = 0; i < count; i++) {
    if (wanted && !wanted.has(i)) continue
    // The hash is 1-based; the filenames stay 0-based to match `--slides`.
    await page.goto(`${base}/#/${deck.slug}/${i + 1}`, { waitUntil: 'load' })

    // The display faces arrive over the network and slides fade in. Screenshot
    // either early and you get fallback type or a half-transparent slide.
    await page.evaluate(() => document.fonts.ready)
    await page.waitForSelector('.stage .slide', { state: 'visible' })
    await page.waitForTimeout(450)

    const target = appShot ? page : page.locator('.stage')
    const name = `${deck.slug}-${String(i).padStart(2, '0')}${appShot ? '-app' : ''}.png`
    await target.screenshot({ path: path.join(OUT, name) })
    console.log(`  ${name}`)
    written++
  }
}

await browser.close()
stop()
console.log(`\n  ${written} png${written === 1 ? '' : 's'}\n`)
