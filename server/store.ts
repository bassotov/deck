import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import type { DeckConfig } from './config.ts'

export const SLUG = /^[a-z0-9][a-z0-9._-]*$/i

export const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
}

const EXT_FOR: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
}

const SKIP_DIRS = new Set(['node_modules', '.git', '.obsidian', '.trash'])

/** Thrown where the cause maps onto an HTTP status the API layer should report. */
export class StoreError extends Error {
  readonly status: number
  readonly slug?: string

  constructor(message: string, status = 400, extra: { slug?: string } = {}) {
    super(message)
    this.name = 'StoreError'
    this.status = status
    if (extra.slug !== undefined) this.slug = extra.slug
  }
}

export interface RawDeck {
  slug: string
  raw: string
  mtime: number
}

export interface DeckStore {
  readonly config: DeckConfig
  resolveAsset(rel: string): Promise<string | null>
  listDecks(): Promise<RawDeck[]>
  readDeck(slug: string): Promise<string>
  createDeck(slug: string, raw: string): Promise<{ slug: string; file: string }>
  writeDeck(slug: string, raw: string): Promise<{ slug: string; file: string; created: boolean }>
  addImage(slug: string, mime: string, base64: string): Promise<string>
  readInk(slug: string): Promise<Record<string, unknown>>
  writeInk(slug: string, body: string): Promise<void>
}

/**
 * Every filesystem operation the app performs, with no HTTP or MCP in sight.
 * The dev server, the standalone server and the MCP server all drive this same
 * object, so a rule enforced here — never serve a file outside the asset root,
 * never clobber a deck that was not named — holds for all three.
 */
export function createStore(config: DeckConfig): DeckStore {
  const { decksDir, assetRoot, inkDir, imagesDir } = config

  /** basename -> absolute path. Rebuilt on a miss, so a fresh paste shows up. */
  let imageIndex = new Map<string, string>()
  let indexedAt = 0

  async function indexAssetRoot(): Promise<Map<string, string>> {
    const found = new Map<string, string>()
    const walk = async (dir: string, depth: number): Promise<void> => {
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
    await walk(assetRoot, 0)
    return found
  }

  function assertSlug(slug: string): string {
    if (!SLUG.test(slug ?? '')) throw new StoreError('bad slug', 400)
    return slug
  }

  return {
    config,

    /** Alongside the deck first, then `images/`, then anywhere under the asset root by name. */
    async resolveAsset(rel) {
      if (rel.split(/[\\/]/).includes('..')) throw new StoreError('outside', 403)

      for (const candidate of [path.join(decksDir, rel), path.join(decksDir, 'images', rel)]) {
        if (!candidate.startsWith(decksDir + path.sep)) continue
        if (await fs.access(candidate).then(() => true, () => false)) return candidate
      }

      const name = path.basename(rel)
      if (!imageIndex.has(name) && Date.now() - indexedAt > 5_000) {
        imageIndex = await indexAssetRoot()
        indexedAt = Date.now()
      }
      const hit = imageIndex.get(name)
      return hit?.startsWith(assetRoot + path.sep) ? hit : null
    },

    async listDecks() {
      await fs.mkdir(decksDir, { recursive: true })
      const names = (await fs.readdir(decksDir)).filter(
        (n) => n.endsWith('.md') && !n.startsWith('.'),
      )
      const settled = await Promise.allSettled(
        names.map(async (name): Promise<RawDeck> => {
          const file = path.join(decksDir, name)
          const [raw, stat] = await Promise.all([fs.readFile(file, 'utf8'), fs.stat(file)])
          return { slug: name.replace(/\.md$/, ''), raw, mtime: stat.mtimeMs }
        }),
      )

      // An editor saves into this folder while the watcher triggers a refetch, so
      // a file mid-write, permission-denied, or deleted between the readdir and
      // the readFile is routine — skip it rather than taking down the whole list.
      const decks: RawDeck[] = []
      settled.forEach((result, i) => {
        if (result.status === 'fulfilled') decks.push(result.value)
        else console.warn(`[deck] skipping ${names[i]}:`, result.reason)
      })
      return decks.sort((a, b) => b.mtime - a.mtime)
    },

    async readDeck(slug) {
      assertSlug(slug)
      const raw = await fs.readFile(path.join(decksDir, `${slug}.md`), 'utf8').catch(() => null)
      if (raw === null) throw new StoreError(`no deck called ${slug}`, 404)
      return raw
    },

    /** Refuses to clobber. The caller decides whether overwriting is what was meant. */
    async createDeck(slug, raw) {
      assertSlug(slug)
      await fs.mkdir(decksDir, { recursive: true })
      const file = path.join(decksDir, `${slug}.md`)
      try {
        await fs.writeFile(file, raw ?? '', { flag: 'wx' })
      } catch (e) {
        // `wx` correctly refuses an existing deck — but swallowing that and
        // reporting success had the client navigate into the existing file
        // believing it had just created an empty one.
        if ((e as NodeJS.ErrnoException).code === 'EEXIST')
          throw new StoreError('exists', 409, { slug })
        throw e
      }
      return { slug, file }
    },

    /** The deliberate overwrite. Only ever called for a deck the caller named. */
    async writeDeck(slug, raw) {
      assertSlug(slug)
      await fs.mkdir(decksDir, { recursive: true })
      const file = path.join(decksDir, `${slug}.md`)
      const existed = await fs.access(file).then(() => true, () => false)
      await fs.writeFile(file, raw ?? '')
      return { slug, file, created: !existed }
    },

    /** Pasted screenshots land next to the deck, numbered per deck. */
    async addImage(slug, mime, base64) {
      assertSlug(slug)
      const ext = EXT_FOR[mime]
      if (!ext) throw new StoreError(`unsupported type: ${mime}`, 415)

      await fs.mkdir(imagesDir, { recursive: true })
      const existing = await fs.readdir(imagesDir).catch(() => [] as string[])
      const escaped = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const taken = existing
        .map((n) => n.match(new RegExp(`^${escaped}-(\\d+)\\.`)))
        .map((m) => (m ? Number(m[1]) : 0))
      const name = `${slug}-${String(Math.max(0, ...taken) + 1).padStart(2, '0')}${ext}`

      const full = path.join(imagesDir, name)
      await fs.writeFile(full, Buffer.from(base64, 'base64'))
      imageIndex.set(name, full)
      return name
    },

    async readInk(slug) {
      assertSlug(slug)
      const data = await fs.readFile(path.join(inkDir, `${slug}.json`), 'utf8').catch(() => '{}')
      return JSON.parse(data || '{}')
    },

    async writeInk(slug, body) {
      assertSlug(slug)
      JSON.parse(body) // validate before touching disk
      await fs.mkdir(inkDir, { recursive: true })
      const file = path.join(inkDir, `${slug}.json`)
      // Unique per request — two overlapping writes for one slug sharing a temp
      // path could rename out of order and persist the older save.
      const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`
      try {
        await fs.writeFile(tmp, body)
        await fs.rename(tmp, file)
      } catch (err) {
        await fs.rm(tmp, { force: true }).catch(() => {})
        throw err
      }
    },
  }
}
