import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveConfig } from '../server/config.ts'
import { createStore, SLUG, StoreError, type DeckStore } from '../server/store.ts'

let root: string
let decks: string
let store: DeckStore

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'deck-store-')))
  decks = path.join(root, 'vault', 'decks')
  fs.mkdirSync(decks, { recursive: true })
  store = createStore(resolveConfig({ decksDir: decks, cwd: root }))
})

afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

const rejects = (p: Promise<unknown>, status: number) =>
  assert.rejects(p, (e: unknown) => e instanceof StoreError && e.status === status)

test('SLUG accepts plain names and refuses anything path-shaped', () => {
  for (const ok of ['talk', 'my-deck', 'v1.2_final', 'A1']) assert.ok(SLUG.test(ok), ok)
  for (const bad of ['', '.hidden', '-lead', '../x', 'a/b', 'a\\b', 'a b', '/abs']) {
    assert.ok(!SLUG.test(bad), JSON.stringify(bad))
  }
})

test('every slug-taking operation validates the slug', async () => {
  const bad = '../escape'
  await rejects(store.readDeck(bad), 400)
  await rejects(store.createDeck(bad, 'x'), 400)
  await rejects(store.writeDeck(bad, 'x'), 400)
  await rejects(store.addImage(bad, 'image/png', ''), 400)
  await rejects(store.readInk(bad), 400)
  await rejects(store.writeInk(bad, '{}'), 400)
  assert.deepEqual(fs.readdirSync(path.join(root, 'vault')), ['decks'])
})

test('createDeck refuses to clobber with a 409 and leaves the file alone', async () => {
  await store.createDeck('talk', 'original')
  await rejects(store.createDeck('talk', 'replacement'), 409)
  assert.equal(await store.readDeck('talk'), 'original')
})

test('writeDeck overwrites on purpose and reports whether it created', async () => {
  assert.equal((await store.writeDeck('talk', 'one')).created, true)
  assert.equal((await store.writeDeck('talk', 'two')).created, false)
  assert.equal(await store.readDeck('talk'), 'two')
})

test('readDeck on a missing deck is a 404', async () => {
  await rejects(store.readDeck('nope'), 404)
})

test('listDecks returns only visible .md files, newest first', async () => {
  fs.writeFileSync(path.join(decks, 'old.md'), 'old')
  fs.writeFileSync(path.join(decks, 'new.md'), 'new')
  fs.writeFileSync(path.join(decks, '.dot.md'), 'hidden')
  fs.writeFileSync(path.join(decks, 'notes.txt'), 'not a deck')
  fs.utimesSync(path.join(decks, 'old.md'), 1, 1)
  const list = await store.listDecks()
  assert.deepEqual(list.map((d) => d.slug), ['new', 'old'])
})

test('addImage numbers per deck, picks the right extension, rejects unknown types', async () => {
  const png = Buffer.from('png-bytes').toString('base64')
  assert.equal(await store.addImage('talk', 'image/png', png), 'talk-01.png')
  assert.equal(await store.addImage('talk', 'image/jpeg', png), 'talk-02.jpg')
  assert.equal(await store.addImage('other', 'image/png', png), 'other-01.png')
  assert.equal(fs.readFileSync(path.join(decks, 'images', 'talk-01.png'), 'utf8'), 'png-bytes')
  await rejects(store.addImage('talk', 'image/svg+xml', png), 415)
  await rejects(store.addImage('talk', 'text/html', png), 415)
})

test('addImage does not treat a dot in a slug as a regex wildcard', async () => {
  const png = Buffer.from('x').toString('base64')
  await store.addImage('v1.2', 'image/png', png)
  assert.equal(await store.addImage('v1x2', 'image/png', png), 'v1x2-01.png')
})

test('ink round-trips, defaults to {}, and refuses invalid JSON without touching disk', async () => {
  assert.deepEqual(await store.readInk('talk'), {})
  await store.writeInk('talk', JSON.stringify({ 'h:intro': [1, 2] }))
  assert.deepEqual(await store.readInk('talk'), { 'h:intro': [1, 2] })
  await assert.rejects(store.writeInk('talk', '{not json'))
  assert.deepEqual(await store.readInk('talk'), { 'h:intro': [1, 2] })
})

test('writeInk leaves no temp files behind, even with overlapping writes', async () => {
  await Promise.all([1, 2, 3, 4, 5].map((n) => store.writeInk('talk', JSON.stringify({ n }))))
  assert.deepEqual(fs.readdirSync(path.join(decks, '.ink')), ['talk.json'])
})

test('resolveAsset: beside the deck, then images/, then null', async () => {
  fs.mkdirSync(path.join(decks, 'images'))
  fs.writeFileSync(path.join(decks, 'a.png'), '')
  fs.writeFileSync(path.join(decks, 'images', 'b.png'), '')
  assert.equal(await store.resolveAsset('a.png'), path.join(decks, 'a.png'))
  assert.equal(await store.resolveAsset('b.png'), path.join(decks, 'images', 'b.png'))
  assert.equal(await store.resolveAsset('missing.png'), null)
})

test('resolveAsset refuses any .. segment with a 403', async () => {
  fs.writeFileSync(path.join(root, 'vault', 'secret.png'), '')
  await rejects(store.resolveAsset('../secret.png'), 403)
  await rejects(store.resolveAsset('a/../../secret.png'), 403)
  await rejects(store.resolveAsset('..\\secret.png'), 403)
})

test('resolveAsset by name stays inside the asset root', async () => {
  // By default the root is the decks folder: a file in the parent is invisible.
  fs.writeFileSync(path.join(root, 'vault', 'shot.png'), '')
  assert.equal(await store.resolveAsset('shot.png'), null)

  // Widened to the vault, the same bare name resolves — Obsidian-style.
  const widened = createStore(
    resolveConfig({ decksDir: decks, assetRoot: path.join(root, 'vault'), cwd: root }),
  )
  assert.equal(await widened.resolveAsset('shot.png'), path.join(root, 'vault', 'shot.png'))
})

test('the by-name walk skips dot-folders, node_modules and non-images', async () => {
  const widened = createStore(
    resolveConfig({ decksDir: decks, assetRoot: path.join(root, 'vault'), cwd: root }),
  )
  for (const dir of ['.obsidian', 'node_modules', '.trash']) {
    fs.mkdirSync(path.join(root, 'vault', dir))
    fs.writeFileSync(path.join(root, 'vault', dir, 'hidden.png'), '')
  }
  fs.writeFileSync(path.join(root, 'vault', 'notes.md'), '')
  assert.equal(await widened.resolveAsset('hidden.png'), null)
  assert.equal(await widened.resolveAsset('notes.md'), null)
})
