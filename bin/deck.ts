#!/usr/bin/env node
import fsp from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { resolveConfig } from '../server/config.ts'
import { EXPORT_SCRIPT, PKG_ROOT, readPackageVersion } from '../server/paths.ts'

const VERSION = readPackageVersion()

const HELP = `
  deck — write a storyline in markdown, get a 16:9 deck you can draw on

  Usage
    deck [dir]                 serve the decks in dir           (default ./decks)
    deck new <name> [dir]      start a new storyline and open it
    deck export [args…]        render slides to PNG
    deck mcp [dir]             run the MCP server on stdio

  Options
    -p, --port <n>             port to serve on                 (default 5290)
    -h, --host <host>          host to bind                     (default 127.0.0.1)
        --asset-root <dir>     widen image lookup by bare name to this folder
        --no-open              do not open a browser
    -v, --version
        --help

  Examples
    deck ~/Notes/Decks
    deck new launch-week
    deck ~/Notes/Decks --asset-root ~/Notes --port 4000
`

interface Options {
  open: boolean
  positional: string[]
  help?: boolean
  version?: boolean
  port?: number
  host?: string
  assetRoot?: string
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { open: true, positional: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help') opts.help = true
    else if (a === '-v' || a === '--version') opts.version = true
    else if (a === '--no-open') opts.open = false
    else if (a === '-p' || a === '--port') opts.port = Number(argv[++i])
    else if (a === '-h' || a === '--host') opts.host = argv[++i]
    else if (a === '--asset-root') opts.assetRoot = argv[++i]
    else if (a.startsWith('-')) throw new Error(`unknown option ${a}`)
    else opts.positional.push(a)
  }
  return opts
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
  spawn(cmd, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' })
    .on('error', () => {})
    .unref()
}

const TEMPLATE = (title: string): string => `# ${title}

One line on what this is about.

---

## The first slide

Everything before the first \`---\` is the title slide. Split slides with
\`---\` on its own line.

<!-- note: speaker notes render under the stage, outside the recording crop -->

---

> The line worth quoting.
`

/** `deck new launch-week` → `launch-week.md`, and a title humans read. */
function slugify(name: string): string {
  return name
    .replace(/\.md$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

async function cmdNew(opts: Options): Promise<void> {
  const [, name, dir] = opts.positional
  if (!name) throw new Error('deck new needs a name — `deck new launch-week`')

  const slug = slugify(name)
  if (!slug) throw new Error(`"${name}" has no usable letters or digits in it`)

  const config = resolveConfig({ decksDir: dir, assetRoot: opts.assetRoot })
  const { createStore } = await import('../server/store.ts')
  const { StoreError } = await import('../server/store.ts')
  const store = createStore(config)

  try {
    await store.createDeck(slug, TEMPLATE(name.replace(/\.md$/i, '')))
  } catch (err) {
    if (!(err instanceof StoreError) || err.status !== 409) throw err
    console.error(`  ${slug}.md already exists — opening it`)
  }
  console.log(`\n  ${path.join(config.decksDir, `${slug}.md`)}`)
  await cmdServe({ ...opts, positional: ['serve', dir].filter(Boolean) as string[] }, slug)
}

async function cmdServe(opts: Options, openSlug?: string): Promise<void> {
  const config = resolveConfig({ decksDir: opts.positional[1], assetRoot: opts.assetRoot })
  const { serve } = await import('../server/serve.ts')

  const running = await serve({ config, port: opts.port ?? 5290, host: opts.host ?? '127.0.0.1' })

  const decks = (await fsp.readdir(config.decksDir).catch(() => [] as string[])).filter(
    (n) => n.endsWith('.md') && !n.startsWith('.'),
  )

  console.log(`\n  deck ${VERSION}`)
  console.log(`  decks   ${config.decksDir}`)
  if (config.assetRoot !== config.decksDir) console.log(`  assets  ${config.assetRoot}`)
  console.log(`  ready   ${running.url}\n`)
  if (!decks.length) {
    console.log(`  Nothing here yet. Start one with:\n\n    deck new my-first-deck\n`)
  }

  const url = openSlug ? `${running.url}/#/${encodeURIComponent(openSlug)}/1` : running.url
  if (opts.open) openBrowser(url)

  const bye = (): void => {
    void running.close().then(() => process.exit(0))
  }
  process.on('SIGINT', bye)
  process.on('SIGTERM', bye)
}

function cmdExport(opts: Options, rest: string[]): void {
  const config = resolveConfig({ assetRoot: opts.assetRoot })
  const child = spawn(process.execPath, [EXPORT_SCRIPT, ...rest], {
    stdio: 'inherit',
    cwd: PKG_ROOT,
    env: { ...process.env, DECKS_DIR: config.decksDir, ASSET_ROOT: config.assetRoot },
  })
  child.on('exit', (code) => process.exit(code ?? 0))
}

async function cmdMcp(opts: Options): Promise<void> {
  const config = resolveConfig({ decksDir: opts.positional[1], assetRoot: opts.assetRoot })
  const { startMcpServer } = await import('../mcp/server.ts')
  await startMcpServer(config)
}

const raw = process.argv.slice(2)
// Everything after `export` belongs to the export script, not to deck's own
// flag parser — `deck export my-deck 0,7 --app` must pass those through intact.
const isExport = raw[0] === 'export'
const own = isExport ? ['export'] : raw
const passthrough = isExport ? raw.slice(1) : []

let opts: Options
try {
  opts = parseArgs(own)
} catch (err) {
  console.error(`\n  ${err instanceof Error ? err.message : err}\n${HELP}`)
  process.exit(1)
}

if (opts.help) {
  console.log(HELP)
} else if (opts.version) {
  console.log(VERSION)
} else {
  const first = opts.positional[0]
  const command =
    first === 'new' || first === 'export' || first === 'mcp' ? first : ('serve' as const)
  // `deck ~/notes` has the directory in slot 0; the serve path reads slot 1.
  if (command === 'serve') opts.positional = ['serve', ...opts.positional]

  try {
    if (command === 'new') await cmdNew(opts)
    else if (command === 'export') cmdExport(opts, passthrough)
    else if (command === 'mcp') await cmdMcp(opts)
    else await cmdServe(opts)
  } catch (err) {
    console.error(`\n  ${err instanceof Error ? err.message : err}\n`)
    process.exit(1)
  }
}
