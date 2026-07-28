import fs from 'node:fs/promises'
import path from 'node:path'
import { MIME, StoreError } from './store.mjs'

const json = (res, status, body) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

const readBody = (req, limit = 8_000_000) =>
  new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => {
      data += c
      if (data.length > limit) reject(new Error('body too large'))
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })

/**
 * Everyone watching for a deck change on disk. The dev server used Vite's HMR
 * channel for this, which the standalone server has no equivalent of — so both
 * now push the same server-sent event and the client has one code path.
 */
export function createWatchers() {
  const clients = new Set()
  return {
    add(res) {
      clients.add(res)
      res.on('close', () => clients.delete(res))
    },
    notify() {
      for (const res of clients) res.write('event: decks\ndata: {}\n\n')
    },
    get size() {
      return clients.size
    },
  }
}

/**
 * The HTTP surface, over a store. Returns true when it handled the request, so
 * a caller can fall through to static files or to the next middleware.
 */
export function createApiHandler(store, watchers = createWatchers()) {
  return async function handle(req, res) {
    const url = (req.url ?? '').split('?')[0]

    if (url.startsWith('/stories-assets/')) {
      try {
        const rel = decodeURIComponent(url.slice('/stories-assets/'.length))
        const file = await store.resolveAsset(rel)
        if (!file) {
          res.statusCode = 404
          res.end()
          return true
        }
        const body = await fs.readFile(file)
        res.setHeader(
          'Content-Type',
          MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
        )
        res.setHeader('Cache-Control', 'no-cache')
        res.end(body)
      } catch (err) {
        if (err instanceof StoreError) json(res, err.status, { error: err.message })
        else {
          res.statusCode = 404
          res.end()
        }
      }
      return true
    }

    if (!url.startsWith('/api/')) return false

    try {
      // The client holds this open; it is the live-reload channel.
      if (url === '/api/watch' && req.method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        })
        res.write('retry: 2000\n\n')
        watchers.add(res)
        return true
      }

      if (url === '/api/stories' && req.method === 'GET') {
        return json(res, 200, { dir: store.config.decksDir, stories: await store.listDecks() }), true
      }

      if (url === '/api/stories' && req.method === 'POST') {
        const { slug, raw } = JSON.parse((await readBody(req)) || '{}')
        await store.createDeck(slug, raw)
        watchers.notify()
        return json(res, 200, { ok: true, slug }), true
      }

      // Paste or drop an image: store the bytes and hand back the name. The
      // placement is an ink element, so the slide's markdown is untouched.
      if (url === '/api/image' && req.method === 'POST') {
        const { slug, mime, data } = JSON.parse(await readBody(req, 40_000_000))
        return json(res, 200, { name: await store.addImage(slug, mime, data) }), true
      }

      const ink = url.match(/^\/api\/ink\/(.+)$/)
      if (ink) {
        const slug = decodeURIComponent(ink[1])
        if (req.method === 'GET') return json(res, 200, await store.readInk(slug)), true
        if (req.method === 'PUT') {
          await store.writeInk(slug, (await readBody(req)) || '{}')
          return json(res, 200, { ok: true }), true
        }
      }

      return json(res, 404, { error: 'not found' }), true
    } catch (err) {
      const status = err instanceof StoreError ? err.status : 500
      // A 409 carries the slug so the client can navigate to what already exists
      // rather than reporting a create that silently did nothing.
      const body = { error: String(err?.message ?? err) }
      if (err instanceof StoreError && err.slug) Object.assign(body, { ok: false, slug: err.slug })
      return json(res, status, body), true
    }
  }
}
