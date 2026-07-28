import { defineConfig, type Plugin, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { resolveConfig } from './server/config.mjs'
import { createStore } from './server/store.mjs'
import { createApiHandler, createWatchers } from './server/api.mjs'

/**
 * The dev server and the published CLI serve the same API over the same store —
 * this plugin is only the Vite-shaped adapter around it. Anything that belongs
 * to the product rather than to Vite lives in `server/`.
 *
 *   DECKS_DIR=~/Notes/Decks npm run dev
 */
const config = resolveConfig()

function deckApi(): Plugin {
  const store = createStore(config)
  const watchers = createWatchers()
  const handle = createApiHandler(store, watchers)

  return {
    name: 'deck-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        if (!(await handle(req, res))) next()
      })

      // Live-reload the deck when a storyline changes on disk. Vite's own
      // watcher does the noticing; the notification goes out over the same
      // server-sent event the standalone server uses, so the client has one path.
      server.watcher.add(config.decksDir)
      const notify = (file: string) => {
        if (file.startsWith(config.decksDir) && file.endsWith('.md')) watchers.notify()
      }
      server.watcher.on('add', notify)
      server.watcher.on('change', notify)
      server.watcher.on('unlink', notify)

      server.config.logger.info(`\n  decks  ${config.decksDir}\n`)
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwind(), deckApi()],
  server: { port: 5290, host: true },
})
