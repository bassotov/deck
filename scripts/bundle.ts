/**
 * Build the Claude Desktop extension — an MCP Bundle (`.mcpb`), which is a zip
 * holding the server, its dependencies and a manifest describing it.
 *
 *   npm run bundle          →  build/deck-<version>.mcpb
 *
 * Installed through Settings → Extensions → Install Extension, which is what
 * makes this a one-click install rather than a hand-edited JSON config.
 *
 * The bundle is self-contained on purpose: it carries its own `node_modules`,
 * so it does not care whether the user has ever run npm.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { PKG_ROOT } from '../server/paths.ts'

const STAGE = path.join(PKG_ROOT, 'build', 'mcpb')
const OUT_DIR = path.join(PKG_ROOT, 'build')

interface PackageJson {
  version: string
  description: string
  homepage: string
  author: string
  dependencies: Record<string, string>
}

const pkg: PackageJson = JSON.parse(
  await fs.readFile(path.join(PKG_ROOT, 'package.json'), 'utf8'),
)

/** Short enough to read in the extension list; the real reference is deck_syntax. */
const TOOLS = [
  { name: 'deck_syntax', description: 'The storyline format: layouts, accents, notes, images' },
  { name: 'list_decks', description: 'Every deck, with titles, slide counts and headings' },
  { name: 'read_deck', description: 'Read one deck as raw markdown' },
  { name: 'write_deck', description: 'Write a deck; refuses to overwrite unless told to' },
  { name: 'append_slide', description: 'Add one slide to the end of a deck' },
  { name: 'open_deck', description: 'Start the viewer and hand back its URL' },
  { name: 'export_deck', description: 'Render a deck to PNG' },
]

const manifest = {
  manifest_version: '0.3',
  name: 'deck',
  display_name: 'deck',
  version: pkg.version,
  description: 'PowerPoint for agents. Claude writes the deck; you open it and draw on it.',
  long_description:
    'Lets Claude write and edit slide decks as plain markdown files on your own disk, ' +
    'then open them in a 16:9 viewer you can annotate while you record. ' +
    'Nothing is uploaded: the decks are files you own and can edit in any editor.',
  author: { name: 'Pasha Barbashin', url: 'https://github.com/bassotov' },
  homepage: pkg.homepage,
  documentation: pkg.homepage,
  support: 'https://github.com/bassotov/deck/issues',
  icon: 'icon.png',
  keywords: ['slides', 'presentation', 'markdown', 'deck', 'annotation'],
  license: 'MIT',
  server: {
    type: 'node',
    entry_point: 'lib/bin/deck.js',
    mcp_config: {
      command: 'node',
      args: ['${__dirname}/lib/bin/deck.js', 'mcp'],
      env: {
        DECKS_DIR: '${user_config.decks_dir}',
        ASSET_ROOT: '${user_config.asset_root}',
      },
    },
  },
  tools: TOOLS,
  user_config: {
    decks_dir: {
      type: 'directory',
      title: 'Decks folder',
      description:
        'Where your decks live. One markdown file is one deck. Point it at a notes folder you already use — nothing else in it is touched.',
      required: true,
      default: '${HOME}/Documents/Decks',
    },
    asset_root: {
      type: 'directory',
      title: 'Image folder (optional)',
      description:
        'Widens image lookup by bare name to a whole notes vault, the way Obsidian resolves ![[shot.png]]. Must be a parent of the decks folder. Leave blank to look only beside the decks.',
      required: false,
    },
  },
  compatibility: {
    claude_desktop: '>=0.10.0',
    platforms: ['darwin', 'win32', 'linux'],
    runtimes: { node: '>=20.19' },
  },
}

async function copyDir(from: string, to: string): Promise<void> {
  await fs.cp(from, to, { recursive: true })
}

async function exists(p: string): Promise<boolean> {
  return fs.access(p).then(() => true, () => false)
}

// The bundle ships built output, so refuse rather than package a stale or
// missing build — a bundle that installs and then cannot start is far worse
// than one that was never produced.
for (const required of ['lib/bin/deck.js', 'dist/index.html']) {
  if (!(await exists(path.join(PKG_ROOT, required)))) {
    console.error(`Missing ${required}. Run \`npm run build\` first.`)
    process.exit(1)
  }
}

await fs.rm(STAGE, { recursive: true, force: true })
await fs.mkdir(STAGE, { recursive: true })

await copyDir(path.join(PKG_ROOT, 'lib'), path.join(STAGE, 'lib'))
await copyDir(path.join(PKG_ROOT, 'dist'), path.join(STAGE, 'dist'))
await fs.copyFile(path.join(PKG_ROOT, 'mcpb', 'icon.png'), path.join(STAGE, 'icon.png'))
for (const doc of ['README.md', 'LICENSE']) {
  await fs.copyFile(path.join(PKG_ROOT, doc), path.join(STAGE, doc))
}

await fs.writeFile(path.join(STAGE, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

// `readPackageVersion` walks up for a package.json, and the server needs to find
// this one rather than the host app's — so the bundle carries a real manifest of
// its own, with only what the runtime actually resolves.
await fs.writeFile(
  path.join(STAGE, 'package.json'),
  `${JSON.stringify(
    {
      name: '@bassotov/deck',
      version: pkg.version,
      description: pkg.description,
      type: 'module',
      private: true,
      dependencies: pkg.dependencies,
    },
    null,
    2,
  )}\n`,
)

console.log('  installing runtime dependencies…')
const install = spawnSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], {
  cwd: STAGE,
  stdio: 'inherit',
})
if (install.status !== 0) process.exit(install.status ?? 1)

const out = path.join(OUT_DIR, `deck-${pkg.version}.mcpb`)
console.log('  packing…')
const pack = spawnSync('npx', ['--yes', '@anthropic-ai/mcpb@2', 'pack', STAGE, out], {
  cwd: PKG_ROOT,
  stdio: 'inherit',
})
if (pack.status !== 0) process.exit(pack.status ?? 1)

console.log(`\n  ${out}\n\n  Claude Desktop → Settings → Extensions → Install Extension\n`)
