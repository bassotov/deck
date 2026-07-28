import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'

/** `.env.local` is read here as well as from the environment, so a personal
 *  content folder can be configured once instead of on every command. */
const fileEnv = loadEnv(process.env.NODE_ENV || 'development', process.cwd(), '')
const env = (...names: string[]) =>
  names.map((n) => process.env[n] ?? fileEnv[n]).find((v) => v)

/** A shell expands `~` in `DECKS_DIR=~/notes npm run dev`; a `.env.local` line
 *  does not, and `path.resolve` would then make a literal `~` folder. */
const resolveDir = (dir: string) =>
  path.resolve(dir.startsWith('~/') ? path.join(os.homedir(), dir.slice(2)) : dir)

/**
 * Storylines are plain markdown, kept outside the app so they stay editable in
 * whatever you already write in — a notes app, an editor, a synced folder. The
 * bundled `decks/` folder is only the default. This app never writes to a `.md`.
 *
 *   DECKS_DIR=~/Notes/Decks npm run dev
 */
const STORIES_DIR = resolveDir(env('DECKS_DIR', 'STORIES_DIR') ?? 'decks')

/** Annotations live in a dot-folder so note apps and finders ignore them. */
const INK_DIR = path.join(STORIES_DIR, '.ink')

/**
 * Obsidian resolves `![[shot.png]]` by name across the whole vault, and it drops
 * pasted screenshots wherever the attachment setting points — which is not this
 * folder. Point ASSET_ROOT at the vault and an embed by bare name just works.
 *
 * It defaults to the decks folder itself: widening the search is opt-in, since
 * the fallback walks the tree and the parent of a decks folder can be anything.
 */
const ASSET_ROOT = (() => {
  const root = env('ASSET_ROOT', 'VAULT_DIR')
  if (!root) return STORIES_DIR
  const resolved = resolveDir(root)
  return STORIES_DIR.startsWith(resolved + path.sep) ? resolved : STORIES_DIR
})()

const SLUG = /^[a-z0-9][a-z0-9._-]*$/i

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
}

const json = (res: any, status: number, body: unknown) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

const readBody = (req: any, limit = 8_000_000) =>
  new Promise<string>((resolve, reject) => {
    let data = ''
    req.on('data', (c: Buffer) => {
      data += c
      if (data.length > limit) reject(new Error('body too large'))
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })

/** Pasted screenshots land next to the deck, numbered per storyline. */
const IMAGES_DIR = path.join(STORIES_DIR, 'images')

const EXT_FOR: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
}

async function nextImageName(slug: string, ext: string) {
  await fs.mkdir(IMAGES_DIR, { recursive: true })
  const existing = await fs.readdir(IMAGES_DIR).catch(() => [] as string[])
  const taken = existing
    .map((n) => n.match(new RegExp(`^${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)\\.`)))
    .map((m) => (m ? Number(m[1]) : 0))
  return `${slug}-${String(Math.max(0, ...taken) + 1).padStart(2, '0')}${ext}`
}

const SKIP_DIRS = new Set(['node_modules', '.git', '.obsidian', '.trash'])

/** basename -> absolute path. Rebuilt on a miss, so a fresh paste shows up. */
let imageIndex = new Map<string, string>()
let indexedAt = 0

async function indexAssetRoot() {
  const found = new Map<string, string>()
  const walk = async (dir: string, depth: number) => {
    if (depth > 8) return
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(full, depth + 1)
      else if (MIME[path.extname(entry.name).toLowerCase()] && !found.has(entry.name))
        found.set(entry.name, full)
    }
  }
  await walk(ASSET_ROOT, 0)
  return found
}

/** Alongside the deck first, then `images/`, then anywhere under ASSET_ROOT by name. */
async function resolveAsset(rel: string): Promise<string | null> {
  for (const candidate of [path.join(STORIES_DIR, rel), path.join(STORIES_DIR, 'images', rel)]) {
    if (!candidate.startsWith(STORIES_DIR + path.sep)) continue
    if (await fs.access(candidate).then(() => true, () => false)) return candidate
  }

  const name = path.basename(rel)
  if (!imageIndex.has(name) && Date.now() - indexedAt > 5_000) {
    imageIndex = await indexAssetRoot()
    indexedAt = Date.now()
  }
  const hit = imageIndex.get(name)
  return hit?.startsWith(ASSET_ROOT + path.sep) ? hit : null
}

async function listStories() {
  await fs.mkdir(STORIES_DIR, { recursive: true })
  const names = (await fs.readdir(STORIES_DIR)).filter(
    (n) => n.endsWith('.md') && !n.startsWith('.'),
  )
  const settled = await Promise.allSettled(
    names.map(async (name) => {
      const file = path.join(STORIES_DIR, name)
      const [raw, stat] = await Promise.all([fs.readFile(file, 'utf8'), fs.stat(file)])
      return { slug: name.replace(/\.md$/, ''), raw, mtime: stat.mtimeMs }
    }),
  )

  // An editor saves into this folder while the watcher below triggers a
  // refetch, so a file mid-write, permission-denied, or deleted between the
  // readdir and the readFile is routine — skip it rather than taking down
  // the whole list.
  const stories: { slug: string; raw: string; mtime: number }[] = []
  settled.forEach((result, i) => {
    if (result.status === 'fulfilled') stories.push(result.value)
    else console.warn(`[stories] skipping ${names[i]}:`, result.reason)
  })
  return stories.sort((a, b) => b.mtime - a.mtime)
}

function storiesApi(): Plugin {
  return {
    name: 'stories-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url ?? '').split('?')[0]
        if (!url.startsWith('/api/')) return next()

        try {
          if (url === '/api/stories' && req.method === 'GET') {
            return json(res, 200, { dir: STORIES_DIR, stories: await listStories() })
          }

          if (url === '/api/stories' && req.method === 'POST') {
            const { slug, raw } = JSON.parse((await readBody(req)) || '{}')
            if (!SLUG.test(slug ?? '')) return json(res, 400, { error: 'bad slug' })
            const file = path.join(STORIES_DIR, `${slug}.md`)
            await fs.mkdir(STORIES_DIR, { recursive: true })
            try {
              await fs.writeFile(file, raw ?? '', { flag: 'wx' })
            } catch (e: any) {
              // `wx` correctly refuses to clobber an existing deck — but silently
              // swallowing that and returning ok:true had the client navigate into
              // the existing file believing it just created an empty one.
              if (e.code === 'EEXIST') return json(res, 409, { ok: false, error: 'exists', slug })
              throw e
            }
            return json(res, 200, { ok: true, slug })
          }

          // Paste or drop an image: store the bytes and hand back the name. The
          // placement is an ink element, so the slide's markdown is untouched.
          if (url === '/api/image' && req.method === 'POST') {
            const { slug, mime, data } = JSON.parse(await readBody(req, 40_000_000))
            if (!SLUG.test(slug ?? '')) return json(res, 400, { error: 'bad slug' })
            const ext = EXT_FOR[mime]
            if (!ext) return json(res, 415, { error: `unsupported type: ${mime}` })

            const name = await nextImageName(slug, ext)
            await fs.writeFile(path.join(IMAGES_DIR, name), Buffer.from(data, 'base64'))
            imageIndex.set(name, path.join(IMAGES_DIR, name))
            return json(res, 200, { name })
          }

          const ink = url.match(/^\/api\/ink\/(.+)$/)
          if (ink) {
            const slug = decodeURIComponent(ink[1])
            if (!SLUG.test(slug)) return json(res, 400, { error: 'bad slug' })
            const file = path.join(INK_DIR, `${slug}.json`)

            if (req.method === 'GET') {
              const data = await fs.readFile(file, 'utf8').catch(() => '{}')
              return json(res, 200, JSON.parse(data || '{}'))
            }
            if (req.method === 'PUT') {
              const body = (await readBody(req)) || '{}'
              JSON.parse(body) // validate before touching disk
              await fs.mkdir(INK_DIR, { recursive: true })
              // Unique per request — two overlapping PUTs for the same slug sharing
              // one temp path could rename out of order and persist the older save.
              const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`
              try {
                await fs.writeFile(tmp, body)
                await fs.rename(tmp, file)
              } catch (err) {
                await fs.rm(tmp, { force: true }).catch(() => {})
                throw err
              }
              return json(res, 200, { ok: true })
            }
          }

          return json(res, 404, { error: 'not found' })
        } catch (err: any) {
          return json(res, 500, { error: String(err?.message ?? err) })
        }
      })

      // Images referenced from a slide, resolved the way Obsidian resolves them:
      // by bare name, wherever the file actually sits.
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url ?? '').split('?')[0]
        if (!url.startsWith('/stories-assets/')) return next()
        try {
          const rel = decodeURIComponent(url.slice('/stories-assets/'.length))
          if (rel.split(/[\\/]/).includes('..')) return json(res, 403, { error: 'outside' })
          const file = await resolveAsset(rel)
          if (!file) {
            res.statusCode = 404
            return res.end()
          }
          const body = await fs.readFile(file)
          res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream')
          res.setHeader('Cache-Control', 'no-cache')
          return res.end(body)
        } catch {
          res.statusCode = 404
          return res.end()
        }
      })

      // Live-reload the deck when a storyline changes on disk.
      server.watcher.add(STORIES_DIR)
      const hot: any = (server as any).hot ?? server.ws
      const notify = (file: string) => {
        if (file.startsWith(STORIES_DIR) && file.endsWith('.md')) {
          hot.send({ type: 'custom', event: 'stories:changed' })
        }
      }
      server.watcher.on('add', notify)
      server.watcher.on('change', notify)
      server.watcher.on('unlink', notify)

      server.config.logger.info(`\n  storylines  ${STORIES_DIR}\n`)
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwind(), storiesApi()],
  server: { port: 5290, host: true },
})
