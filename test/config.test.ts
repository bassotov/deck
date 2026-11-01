import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveConfig, resolveDir } from '../server/config.ts'

const NAMES = ['DECKS_DIR', 'STORIES_DIR', 'ASSET_ROOT', 'VAULT_DIR']
let cwd: string
let saved: Record<string, string | undefined>

beforeEach(() => {
  saved = Object.fromEntries(NAMES.map((n) => [n, process.env[n]]))
  for (const n of NAMES) delete process.env[n]
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-config-'))
})

afterEach(() => {
  for (const n of NAMES) {
    if (saved[n] === undefined) delete process.env[n]
    else process.env[n] = saved[n]
  }
  fs.rmSync(cwd, { recursive: true, force: true })
})

test('defaults to ./decks under the working directory', () => {
  const c = resolveConfig({ cwd })
  assert.equal(c.decksDir, path.resolve('decks'))
  assert.equal(c.assetRoot, c.decksDir)
  assert.equal(c.inkDir, path.join(c.decksDir, '.ink'))
  assert.equal(c.imagesDir, path.join(c.decksDir, 'images'))
})

test('an explicit argument beats the environment and an env file', () => {
  process.env.DECKS_DIR = '/from/env'
  fs.writeFileSync(path.join(cwd, '.env.local'), 'DECKS_DIR=/from/file\n')
  assert.equal(resolveConfig({ decksDir: '/from/arg', cwd }).decksDir, '/from/arg')
})

test('the environment beats an env file, and .env.local beats .env', () => {
  fs.writeFileSync(path.join(cwd, '.env'), 'DECKS_DIR=/from/env-file\n')
  assert.equal(resolveConfig({ cwd }).decksDir, '/from/env-file')
  fs.writeFileSync(path.join(cwd, '.env.local'), 'DECKS_DIR=/from/local\n')
  assert.equal(resolveConfig({ cwd }).decksDir, '/from/local')
  process.env.DECKS_DIR = '/from/env'
  assert.equal(resolveConfig({ cwd }).decksDir, '/from/env')
})

test('STORIES_DIR is still read as the old name', () => {
  process.env.STORIES_DIR = '/old/name'
  assert.equal(resolveConfig({ cwd }).decksDir, '/old/name')
})

test('an unsubstituted ${user_config.…} placeholder counts as unset', () => {
  process.env.DECKS_DIR = '${user_config.decks_dir}'
  process.env.ASSET_ROOT = '${user_config.asset_root}'
  const c = resolveConfig({ cwd })
  assert.equal(c.decksDir, path.resolve('decks'))
  assert.ok(!c.decksDir.includes('${'))
  assert.equal(c.assetRoot, c.decksDir)
})

test('an empty value counts as unset', () => {
  process.env.DECKS_DIR = ''
  assert.equal(resolveConfig({ cwd }).decksDir, path.resolve('decks'))
})

test('env file parsing: quotes, comments, and a # inside quotes', () => {
  fs.writeFileSync(
    path.join(cwd, '.env.local'),
    ['# a comment', 'DECKS_DIR = "/with #hash"', "ASSET_ROOT=/x # trailing"].join('\n'),
  )
  assert.equal(resolveConfig({ cwd }).decksDir, '/with #hash')
})

test('~/ expands to the home directory', () => {
  assert.equal(resolveDir('~/notes'), path.join(os.homedir(), 'notes'))
})

test('assetRoot only widens to a parent of the decks folder', () => {
  const widened = resolveConfig({ decksDir: '/vault/decks', assetRoot: '/vault', cwd })
  assert.equal(widened.assetRoot, '/vault')
  // A sibling or child is not a parent: fall back to the decks folder.
  assert.equal(resolveConfig({ decksDir: '/vault/decks', assetRoot: '/elsewhere', cwd }).assetRoot, '/vault/decks')
  assert.equal(resolveConfig({ decksDir: '/vault', assetRoot: '/vault/decks', cwd }).assetRoot, '/vault')
  // The prefix check must respect the path separator: /vault2 is not /vault.
  assert.equal(resolveConfig({ decksDir: '/vault2/decks', assetRoot: '/vault', cwd }).assetRoot, '/vault2/decks')
})
