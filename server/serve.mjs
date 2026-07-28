import http from 'node:http'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStore, MIME } from './store.mjs'
import { createApiHandler, createWatchers } from './api.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(HERE, '..', 'dist')

const STATIC_MIME = {
  ...MIME,
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
}

/**
 * Watch the decks folder and tell every connected client. `fs.watch` fires more
 * than once for a single save (write, then mtime), so this coalesces — a burst
 * of events during one save should be one reload, not four.
 */
function watchDecks(dir, onChange) {
  let timer = null
  let watcher
  try {
    watcher = fs.watch(dir, { persistent: false }, (_event, name) => {
      if (name && !name.endsWith('.md')) return
      clearTimeout(timer)
      timer = setTimeout(onChange, 80)
    })
  } catch {
    // A missing or unwatchable folder is not fatal; the app still serves, it
    // just will not live-reload. Better than refusing to start.
    return () => {}
  }
  return () => {
    clearTimeout(timer)
    watcher.close()
  }
}

async function sendFile(res, file) {
  const body = await fsp.readFile(file)
  res.setHeader('Content-Type', STATIC_MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream')
  // The built assets are content-hashed; index.html must never be held onto or
  // a rebuilt app keeps serving the old bundle from a stale cache.
  res.setHeader(
    'Cache-Control',
    file.endsWith('.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
  )
  res.end(body)
}

/**
 * The production server: the built app, the same API the dev server exposes,
 * and a live-reload stream. No Vite at runtime.
 */
export async function serve({ config, port = 5290, host = '127.0.0.1' } = {}) {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    throw new Error(
      `No built app at ${DIST}. Run \`npm run build\` first (or reinstall the package).`,
    )
  }

  const store = createStore(config)
  const watchers = createWatchers()
  const api = createApiHandler(store, watchers)

  const server = http.createServer(async (req, res) => {
    try {
      if (await api(req, res)) return

      const url = (req.url ?? '/').split('?')[0]
      const rel = decodeURIComponent(url).replace(/^\/+/, '')
      const candidate = path.join(DIST, rel)

      // Anything not under dist is a routing attempt, not a file request — the
      // app is a single page, so it gets index.html and reads its own hash.
      if (rel && candidate.startsWith(DIST + path.sep) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return await sendFile(res, candidate)
      }
      return await sendFile(res, path.join(DIST, 'index.html'))
    } catch (err) {
      res.statusCode = 500
      res.end(String(err?.message ?? err))
    }
  })

  await fsp.mkdir(config.decksDir, { recursive: true })
  const stopWatching = watchDecks(config.decksDir, () => watchers.notify())

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, resolve)
  })

  return {
    url: `http://${host === '0.0.0.0' ? 'localhost' : host}:${server.address().port}`,
    port: server.address().port,
    async close() {
      stopWatching()
      await new Promise((r) => server.close(r))
    },
  }
}
