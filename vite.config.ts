import { defineConfig, type Plugin, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

/**
 * Storylines live in the Obsidian vault as plain markdown so they stay editable
 * in Obsidian and tracked in the graph. This app only reads them.
 * Override with STORIES_DIR=/some/path npm run dev
 */
const STORIES_DIR = process.env.STORIES_DIR
  ? path.resolve(process.env.STORIES_DIR)
  : path.join(os.homedir(), 'Documents/PashaOS/Content/Stories')

/** Annotations live in a dot-folder so Obsidian ignores them. */
const INK_DIR = path.join(STORIES_DIR, '.ink')

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

const readBody = (req: any) =>
  new Promise<string>((resolve, reject) => {
    let data = ''
    req.on('data', (c: Buffer) => {
      data += c
      if (data.length > 8_000_000) reject(new Error('body too large'))
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })

async function listStories() {
  await fs.mkdir(STORIES_DIR, { recursive: true })
  const names = (await fs.readdir(STORIES_DIR)).filter(
    (n) => n.endsWith('.md') && !n.startsWith('.'),
  )
  const stories = await Promise.all(
    names.map(async (name) => {
      const file = path.join(STORIES_DIR, name)
      const [raw, stat] = await Promise.all([fs.readFile(file, 'utf8'), fs.stat(file)])
      return { slug: name.replace(/\.md$/, ''), raw, mtime: stat.mtimeMs }
    }),
  )
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
            await fs.writeFile(file, raw ?? '', { flag: 'wx' }).catch((e: any) => {
              if (e.code !== 'EEXIST') throw e
            })
            return json(res, 200, { ok: true, slug })
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
              const tmp = `${file}.${process.pid}.tmp`
              await fs.writeFile(tmp, body)
              await fs.rename(tmp, file)
              return json(res, 200, { ok: true })
            }
          }

          return json(res, 404, { error: 'not found' })
        } catch (err: any) {
          return json(res, 500, { error: String(err?.message ?? err) })
        }
      })

      // Images referenced from a slide live alongside the storylines.
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url ?? '').split('?')[0]
        if (!url.startsWith('/stories-assets/')) return next()
        try {
          const rel = decodeURIComponent(url.slice('/stories-assets/'.length))
          const file = path.join(STORIES_DIR, rel)
          if (!file.startsWith(STORIES_DIR + path.sep)) return json(res, 403, { error: 'outside' })
          const body = await fs.readFile(file)
          res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream')
          res.setHeader('Cache-Control', 'no-cache')
          return res.end(body)
        } catch {
          res.statusCode = 404
          return res.end()
        }
      })

      // Live-reload the deck when a storyline changes in Obsidian.
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
