import { spawn } from 'node:child_process'
import path from 'node:path'
import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import * as z from 'zod/v4'
import { createStore } from '../server/store.ts'
import { splitSlides, firstHeading } from '../server/slides.ts'
import { EXPORT_SCRIPT, PKG_ROOT, readPackageVersion } from '../server/paths.ts'
import type { DeckConfig } from '../server/config.ts'
import type { RunningServer } from '../server/serve.ts'
import { SYNTAX } from './syntax.ts'

const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] })
const fail = (s: string) => ({ content: [{ type: 'text' as const, text: s }], isError: true })

interface Outline {
  slug: string
  title: string
  slides: number
  headings: string[]
}

/** Slide count and title without rendering anything — the outline of a deck. */
function outline(slug: string, raw: string): Outline {
  const slides = splitSlides(raw).filter((b) => b.trim().length > 0)
  return {
    slug,
    title: firstHeading(raw) ?? slug.replace(/-/g, ' '),
    slides: slides.length,
    headings: slides.map((b, i) => firstHeading(b) ?? `(slide ${i + 1})`),
  }
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/**
 * The viewer `open_deck` starts, held outside the server instance so whoever
 * owns the process can shut it down. It is an HTTP server: left running it
 * keeps the event loop alive and the process never exits.
 */
export interface ViewerHandle {
  running: RunningServer | null
}

export function createDeckMcpServer(
  config: DeckConfig,
  viewer: ViewerHandle = { running: null },
): McpServer {
  const store = createStore(config)
  // Read, never hardcoded: a version literal here silently drifts from the
  // package the client actually installed.
  const server = new McpServer({ name: 'deck', version: readPackageVersion() })

  server.registerTool(
    'deck_syntax',
    {
      annotations: {
        title: 'Deck syntax reference',
        readOnlyHint: true,
        openWorldHint: false,
      },
      description:
        'The storyline format: how slides are split, every layout and the blocks it expects, the inline accents, speaker notes and image embeds. Read this BEFORE writing or editing a deck — the layouts are not guessable and getting them wrong produces a deck that renders but reads badly.',
      inputSchema: z.object({}),
    },
    async () => text(SYNTAX),
  )

  server.registerTool(
    'list_decks',
    {
      annotations: { title: 'List decks', readOnlyHint: true, openWorldHint: false },
      description:
        'List every deck in the decks folder, with its title, slide count and slide headings.',
      inputSchema: z.object({}),
    },
    async () => {
      const decks = await store.listDecks()
      if (!decks.length) return text(`No decks in ${config.decksDir} yet.`)
      const body = decks.map((d) => outline(d.slug, d.raw))
      return text(`Decks in ${config.decksDir}:\n\n${JSON.stringify(body, null, 2)}`)
    },
  )

  server.registerTool(
    'read_deck',
    {
      annotations: { title: 'Read a deck', readOnlyHint: true, openWorldHint: false },
      description: 'Read one deck as raw markdown.',
      inputSchema: z.object({
        slug: z.string().describe('Filename without .md, e.g. launch-week'),
      }),
    },
    async ({ slug }) => {
      try {
        return text(await store.readDeck(slug))
      } catch (err) {
        return fail(message(err))
      }
    },
  )

  server.registerTool(
    'write_deck',
    {
      annotations: {
        title: 'Write a deck',
        readOnlyHint: false,
        // With overwrite:true it replaces an existing file wholesale.
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      description:
        'Write a whole deck. Creates it if new. Call deck_syntax first if you have not already. Overwriting an existing deck requires overwrite:true, and replaces the entire file — read_deck first if you mean to keep any of it.',
      inputSchema: z.object({
        slug: z.string().describe('Filename without .md. Lowercase with hyphens, e.g. launch-week'),
        content: z.string().describe('The complete markdown for the deck'),
        overwrite: z
          .boolean()
          .optional()
          .describe('Replace an existing deck of this name. Default false.'),
      }),
    },
    async ({ slug, content, overwrite }) => {
      try {
        if (overwrite) {
          const { created } = await store.writeDeck(slug, content)
          return text(
            `${created ? 'Created' : 'Replaced'} ${slug}.md — ${outline(slug, content).slides} slides.`,
          )
        }
        await store.createDeck(slug, content)
        return text(`Created ${slug}.md — ${outline(slug, content).slides} slides.`)
      } catch (err) {
        if (err instanceof Error && 'status' in err && err.status === 409) {
          return fail(
            `${slug}.md already exists. Read it with read_deck, then call write_deck again with overwrite:true if you mean to replace it.`,
          )
        }
        return fail(message(err))
      }
    },
  )

  server.registerTool(
    'append_slide',
    {
      annotations: {
        title: 'Append a slide',
        readOnlyHint: false,
        // Only ever adds to the end; it never rewrites what is already there.
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      description:
        'Add one slide to the end of an existing deck. Cheaper and safer than rewriting the whole file when you are building a deck up slide by slide.',
      inputSchema: z.object({
        slug: z.string(),
        content: z
          .string()
          .describe('The markdown for the slide alone, with no leading or trailing ---'),
      }),
    },
    async ({ slug, content }) => {
      try {
        const raw = await store.readDeck(slug)
        const body = content.replace(/^\s*---\s*$/gm, '').trim()
        if (!body) return fail('Nothing to append.')
        const joined = `${raw.replace(/\s+$/, '')}\n\n---\n\n${body}\n`
        await store.writeDeck(slug, joined)
        return text(`Appended to ${slug}.md — now ${outline(slug, joined).slides} slides.`)
      } catch (err) {
        return fail(message(err))
      }
    },
  )

  server.registerTool(
    'open_deck',
    {
      annotations: {
        title: 'Open the viewer',
        // Starts a local server, so not read-only, but it touches no deck.
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      description:
        'Start the viewer and return its URL, so a human can look at the deck, present it, or draw on it. Runs until the MCP server stops.',
      inputSchema: z.object({
        slug: z.string().optional().describe('Open straight onto this deck'),
        port: z.number().int().optional(),
      }),
    },
    async ({ slug, port }) => {
      try {
        const { serve } = await import('../server/serve.ts')
        if (!viewer.running) viewer.running = await serve({ config, port: port ?? 5290 })
        const base = viewer.running.url
        return text(slug ? `${base}/#/${encodeURIComponent(slug)}/1` : base)
      } catch (err) {
        return fail(`Could not start the viewer: ${message(err)}`)
      }
    },
  )

  server.registerTool(
    'export_deck',
    {
      annotations: {
        title: 'Export a deck to PNG',
        readOnlyHint: false,
        // Writes only into exports/, which is regenerated output.
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      description:
        'Render a deck to PNG files, annotations included, and return where they were written. Needs Playwright installed (npm i -D playwright && npx playwright install chromium); says so if it is missing.',
      inputSchema: z.object({
        slug: z.string(),
        slides: z
          .string()
          .optional()
          .describe('Comma-separated 0-based slide indices, e.g. "0,4,7". Omit for all.'),
      }),
    },
    async ({ slug, slides }) => {
      const args = [EXPORT_SCRIPT, slug]
      if (slides) args.push(slides)
      const out = path.join(PKG_ROOT, 'exports')

      const result = await new Promise<{ code: number; stdout: string; stderr: string }>(
        (resolve) => {
          const child = spawn(process.execPath, args, {
            cwd: PKG_ROOT,
            env: {
              ...process.env,
              DECKS_DIR: config.decksDir,
              ASSET_ROOT: config.assetRoot,
              EXPORT_OUT: out,
            },
          })
          let stdout = ''
          let stderr = ''
          child.stdout.on('data', (d) => (stdout += d))
          child.stderr.on('data', (d) => (stderr += d))
          child.on('error', (err) => resolve({ code: 1, stdout, stderr: String(err) }))
          child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }))
        },
      )

      if (result.code !== 0)
        return fail(result.stderr.trim() || result.stdout.trim() || 'export failed')
      return text(`${result.stdout.trim()}\n\nWritten to ${out}`)
    },
  )

  return server
}

/**
 * Entry point for `deck mcp`. stdout is the JSON-RPC channel, so every log line
 * goes to stderr — a stray console.log corrupts the stream and the client drops
 * the connection with no useful error.
 *
 * `serveStdio` hands back a handle immediately rather than a promise that runs
 * for the session, so this waits on the input stream itself. Returning straight
 * away would end the CLI process and take the server down with it.
 */
export async function startMcpServer(config: DeckConfig): Promise<void> {
  console.error(`deck MCP server on stdio — decks: ${config.decksDir}`)
  const viewer: ViewerHandle = { running: null }
  const handle = serveStdio(() => createDeckMcpServer(config, viewer))

  await new Promise<void>((resolve) => {
    process.stdin.on('close', () => resolve())
    process.stdin.on('end', () => resolve())
    process.on('SIGINT', () => resolve())
    process.on('SIGTERM', () => resolve())
  })

  await handle.close().catch(() => {})
  // A viewer opened during the session would otherwise outlive the connection:
  // its listening socket holds the event loop open and the host is left waiting
  // on a process that has already stopped answering.
  await viewer.running?.close().catch(() => {})

  // Exit rather than falling off the end. Shutdown can land while a tool call
  // is still in flight, and an `open_deck` that starts a moment later would
  // bind a socket nothing is left to close — so the process must not depend on
  // the handle count reaching zero on its own. stdin has already ended here,
  // which means the client is gone and there is no reply left worth writing.
  process.exit(0)
}
