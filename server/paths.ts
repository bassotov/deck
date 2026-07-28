import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Where the package actually sits. Found by walking up for the `package.json`
 * rather than counting `..` segments, because the depth differs between running
 * the compiled output (`lib/server/paths.js`) and running the sources through a
 * loader — and a wrong count fails as a missing `dist/`, which reads like a
 * broken install rather than a path bug.
 */
function findPackageRoot(from: string): string {
  let dir = from
  for (;;) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir
    const up = path.dirname(dir)
    if (up === dir) throw new Error(`no package.json above ${from}`)
    dir = up
  }
}

export const PKG_ROOT = findPackageRoot(path.dirname(fileURLToPath(import.meta.url)))

/** The built client. Vite writes it; the standalone server serves it. */
export const DIST_DIR = path.join(PKG_ROOT, 'dist')

/**
 * The PNG exporter, as a path to spawn. Resolved against this module rather
 * than the package root so it points at the compiled sibling either way.
 */
export const EXPORT_SCRIPT = fileURLToPath(new URL('../scripts/export.js', import.meta.url))

export function readPackageVersion(): string {
  const pkg = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8'))
  return pkg.version as string
}
