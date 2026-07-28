import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

/** Where the decks are, and how wide the by-name image search may go. */
export interface DeckConfig {
  decksDir: string
  assetRoot: string
  inkDir: string
  imagesDir: string
}

export interface ResolveConfigOptions {
  /** An explicit directory — a CLI argument. Wins over every environment source. */
  decksDir?: string | undefined
  assetRoot?: string | undefined
  cwd?: string
}

/**
 * A shell expands `~` in `DECKS_DIR=~/notes deck`; a line in an env file does
 * not, and `path.resolve` would then make a literal `~` directory.
 */
export function resolveDir(dir: string): string {
  return path.resolve(dir.startsWith('~/') ? path.join(os.homedir(), dir.slice(2)) : dir)
}

/**
 * The env files are parsed here rather than through Vite's `loadEnv`, so the CLI
 * and the MCP server honour the same `.env.local` the dev server does without
 * dragging Vite into a published package.
 */
function readEnvFiles(cwd: string): Record<string, string> {
  const found: Record<string, string> = {}
  for (const name of ['.env', '.env.local']) {
    let text: string
    try {
      text = fs.readFileSync(path.join(cwd, name), 'utf8')
    } catch {
      continue
    }
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
      if (!m) continue
      // A `#` inside a quoted value is data; outside one it opens a comment.
      let value = m[2].trim()
      const quoted = value.match(/^(['"])([\s\S]*)\1$/)
      value = quoted ? quoted[2] : value.split('#')[0].trim()
      found[m[1]] = value
    }
  }
  return found
}

/**
 * `decksDir` wins over the environment, so an explicit `deck ~/notes` is never
 * silently overridden by an env file left in the working directory.
 */
export function resolveConfig({
  decksDir,
  assetRoot,
  cwd = process.cwd(),
}: ResolveConfigOptions = {}): DeckConfig {
  const fileEnv = readEnvFiles(cwd)
  /**
   * Empty is unset, and so is an unsubstituted `${user_config.…}`: a desktop
   * extension passes its optional fields through verbatim when the user leaves
   * them blank, and resolving that would create a directory with a literal
   * `${` in its name rather than falling back.
   */
  const usable = (v: string | undefined): boolean => Boolean(v && !v.includes('${'))
  const env = (...names: string[]): string | undefined =>
    names.map((n) => process.env[n] ?? fileEnv[n]).find(usable)

  const decks = resolveDir(decksDir ?? env('DECKS_DIR', 'STORIES_DIR') ?? 'decks')

  /**
   * Obsidian resolves `![[shot.png]]` by name across a whole vault, and drops
   * pasted screenshots wherever its attachment setting points — which is not
   * this folder. Pointing ASSET_ROOT at the vault makes a bare-name embed work.
   *
   * It defaults to the decks folder itself: widening is opt-in, because the
   * fallback walks the tree and the parent of a decks folder can be anything.
   */
  const rootArg = assetRoot ?? env('ASSET_ROOT', 'VAULT_DIR')
  let root = decks
  if (rootArg) {
    const resolved = resolveDir(rootArg)
    if (decks.startsWith(resolved + path.sep)) root = resolved
  }

  return {
    decksDir: decks,
    assetRoot: root,
    inkDir: path.join(decks, '.ink'),
    imagesDir: path.join(decks, 'images'),
  }
}
