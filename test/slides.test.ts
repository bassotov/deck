import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DIRECTIVE, firstHeading, splitSlides } from '../server/slides.ts'

test('splits on a --- alone on its own line', () => {
  assert.deepEqual(splitSlides('# One\n---\n# Two\n---\n# Three'), ['# One', '# Two', '# Three'])
})

test('tolerates CRLF line endings and trailing spaces on the break', () => {
  assert.deepEqual(splitSlides('a\r\n---  \r\nb'), ['a', 'b'])
})

test('a --- inside a fenced code block is not a break', () => {
  const raw = ['# Format', '```md', '---', 'layout: quote', '---', '```', '---', '# Next'].join('\n')
  const slides = splitSlides(raw)
  assert.equal(slides.length, 2)
  assert.match(slides[0], /layout: quote/)
  assert.equal(slides[1], '# Next')
})

test('a ~~~ fence protects a --- the same way', () => {
  assert.equal(splitSlides('~~~\n---\n~~~\n---\nx').length, 2)
})

test('a shorter or different fence inside does not close the block', () => {
  // The outer fence is four backticks; the inner three, and a tilde run, stay literal.
  const raw = ['````', '```', '~~~', '---', '````', '---', 'after'].join('\n')
  assert.equal(splitSlides(raw).length, 2)
})

test('an unclosed fence swallows every later break', () => {
  assert.equal(splitSlides('```\n---\n---\ntext').length, 1)
})

test('--- with other text on the line is not a break', () => {
  assert.equal(splitSlides('a\n--- b\nc\n----\nd').length, 1)
})

test('an empty string is one empty slide', () => {
  assert.deepEqual(splitSlides(''), [''])
})

test('DIRECTIVE matches only a comment alone on its line', () => {
  const find = (s: string) => [...s.matchAll(DIRECTIVE)].map((m) => [m[1], m[2].trim()])
  assert.deepEqual(find('<!-- layout: quote -->'), [['layout', 'quote']])
  assert.deepEqual(find('  <!-- note: say this slowly -->  '), [['note', 'say this slowly']])
  assert.deepEqual(find('<!-- LAYOUT: stats -->'), [['LAYOUT', 'stats']])
  // Quoted inside a code span while documenting the syntax: left alone.
  assert.deepEqual(find('Use `<!-- layout: quote -->` to override.'), [])
  assert.deepEqual(find('text <!-- note: x -->'), [])
})

test('firstHeading reads h1–h3 and strips markup', () => {
  assert.equal(firstHeading('# Plain'), 'Plain')
  assert.equal(firstHeading('intro\n\n### Third level'), 'Third level')
  assert.equal(firstHeading('# How <span class="hand">deck</span> works'), 'How deck works')
  assert.equal(firstHeading('# **bold** and `code` and _it_'), 'bold and code and it')
})

test('firstHeading is null when there is no usable heading', () => {
  assert.equal(firstHeading('just words'), null)
  assert.equal(firstHeading('#### too deep'), null)
  assert.equal(firstHeading('# <span></span>'), null)
})
