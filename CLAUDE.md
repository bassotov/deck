# stories

A storyline deck for the daily/weekly build-in-public videos. Storylines are markdown
in the PashaOS vault; this app renders them as 16:9 slides you can scroll through and
draw on while recording a voiceover.

Defers to `~/.claude/CLAUDE.md` and the vault's `~/Documents/PashaOS/CLAUDE.md`.

## Run it

```bash
npm run dev      # http://localhost:5290
```

Dev-server only by design — the storyline and annotation APIs are Vite middleware
reading the local filesystem. There is no deployed build.

## Where things live

| What | Where |
| --- | --- |
| Storylines (the content) | `~/Documents/PashaOS/Content/Stories/*.md` |
| Slide images | `~/Documents/PashaOS/Content/Stories/images/` |
| Annotations | `~/Documents/PashaOS/Content/Stories/.ink/<slug>.json` |
| The app | this repo |

The content directory is deliberately **outside** the repo: storylines belong in the
Obsidian graph, and `node_modules` must never sit inside the vault. Override with
`STORIES_DIR=/path npm run dev`.

Annotations go in a dot-folder so Obsidian ignores them.

## The storyline format

One file = one deck. Slides split by `---` alone on a line. Slide 1 is the title slide.

- `<!-- layout: title|center|quote|columns|default -->` — override the auto-detected layout
- `<!-- note: … -->` — speaker note; renders **under** the stage, outside the recording crop
- `<span class="eyebrow">day 42</span>` — mono label, put it **above** the heading
- `<span class="hand">like this</span>` — the Caveat handwritten accent

Directives must sit on their own line. Anything else — including a comment quoted
inside backticks to document the syntax — is left alone.

### The columns layout

For option/comparison slides: large title on top, columns below with air underneath.
Everything before the first `###` is the title block; each `###` opens a column. Two,
three, four — however many you write.

### Images

`![[chart.png]]` (Obsidian embed) or `![](chart.png)`, resolved against the storylines
folder and served by the dev server at `/stories-assets/…`. Generated graphics go in
`Content/Stories/images/` — one pass with the `visual-generation` skill is enough,
these are internal docs.

`Content/Stories/how-storylines-work.md` is the living reference deck for all of this —
update it when the format changes.

## Design

Follows the vault design brain: editorial-terminal chrome (warm charcoal shell, mono
uppercase labels) around a warm near-white slide stage. Instrument Serif display,
Inter body, Caveat accent, one coral accent (`#FF5A1F`) reserved for action and ink.

**Default slide shape: big title on top, content below, air underneath.** This is the
house layout — the one Pasha picked — so `default` and `columns` share it. Only `title`,
`center` and `quote` centre vertically. Don't "fix" the empty space at the bottom of a
short slide; it's the point.

Slide type is sized in `cqw` against the stage container, so nothing needs a font size
and everything scales with the window. `SlideView` shrink-to-fits only when a slide is
genuinely over-stuffed — a scrollbar mid-recording looks broken.

## Ink

Vector, not raster. Strokes are stored as points in a fixed 1600×900 space and rendered
as SVG paths, so they stay crisp at any window size and survive a resize.

Tuned for a **trackpad**, not a stylus: `simulatePressure` derives width from velocity,
`streamline` is pushed to 0.62 to kill trackpad jitter, and Shift snaps a stroke to a
straight 15°-incremented line. The eraser deletes whole strokes rather than chewing
pixel holes — it reads far cleaner on camera.

Adding a tool means touching `lib/ink.ts` (geometry), `InkLayer.tsx` (pointer handling)
and `ToolRail.tsx` (the button).

**Annotations key off the slide's heading**, not its position (`h:speaker-notes`, with
`s<index>` as the fallback for headless slides). Keying by position meant inserting a
slide dragged every mark onto the wrong one. Renaming a heading orphans its marks —
that's the accepted trade, since inserting and reordering happen far more often.

## Keys

`1` cursor · `2` pen · `3` highlighter · `4` arrow · `5` shape · `6` text · `7` eraser —
order comes from `TOOL_ORDER` in `lib/ink.ts`, which the rail also renders from, so the
digits and the buttons can't drift apart. Letter aliases `V P H A S T E` still work.

Pressing `5` again (or clicking the shape button again) walks `SHAPE_ORDER` — square →
oval → triangle → line. The button always wears the shape it will draw next.

`6` then click opens a text box at that point, set in the Caveat accent face so typed
annotation reads as annotation. `Esc` or `⌘↵` commits, clicking away commits.

`1` is select-and-move: drawn elements re-enable pointer events so they can be dragged
to realign, while clicks on empty slide pass straight through. Shift constrains a drag
to one axis. Each element carries an invisible fatter hit area so a 7px line is still
grabbable on a trackpad; closed shapes hit-test on their outline only, so a rectangle
drawn around content doesn't swallow clicks meant for the slide.

A selection — one element or ten — wears eight resize grips: four corners (both axes)
and four edge midpoints (one axis). Shift locks the aspect, Option resizes from the
centre. Everything scales, including text, whose font size follows the box the Keynote
way; there is no text wrapping in this format, so nothing else could sensibly mean
"bigger". The grips sit in the padding ring outside the outline and never reach into
the element's own area, so a small mark stays draggable rather than fenced in by its
own handles. No rotation: marks are drawn at their final angle in one gesture.

A selection also opens a **property bar under the stage**, in the slot the speaker note
otherwise holds — never over the slide, which is the recording crop. It shows only what
the selection can carry: colour always, fill on closed shapes, width on anything
stroked, opacity always, font size on text, and the shape kind, so a square can become
an oval after it was drawn. A multi-selection whose members disagree shows nothing
active rather than the first element's value, and an edit still writes to all of them as
one undo entry. Whatever is set there is also what the next mark is drawn with.

The four colours stay four. `⊕` opens the native OS colour panel — which is where the
macOS eyedropper lives — and what it returns is remembered as one extra swatch until the
next custom pick replaces it.

Array order is z-order, so Front and Back move the selection to the end or the start of
the slide's array. The renderer no longer re-sorts images behind the ink every frame —
that would make the control a lie — so two things keep old decks looking as they did: a
paste is inserted at the start, and a slide still holding **legacy** rows (flat
`color`/`size`, no `style` object) is partitioned images-first once on load. A slide
whose rows all carry a `style` was written by this code, so its order is trusted
verbatim. One save is all it takes for front/back to stick forever.

`⇧1–4` colour · `C` cycles colour · Shift while drawing snaps to a straight line
`⌘]`/`⌘[` front/back · `⌘Z`/`⇧⌘Z` undo/redo · `X` clear slide
`⌘B` sidebar · `F` focus mode · `Esc` out — clears a selection, then the tool, then focus, one step per press

Digits are read off `e.code`, not `e.key` — Shift+1 arrives as `!` on a Mac layout.

Arrows nudge the selection when one exists (4 stage units, Shift = 20) and navigate
the slide only when nothing is selected. `space`, `j`, `k` and scroll always navigate
regardless of selection — the guaranteed escape hatch mid-recording — and every one of
these, including the digits above, is ignored while a stroke, a drag, or a handle
resize is still in flight, so a keyboard switch can't land mid-gesture and corrupt it.

The URL carries `#/<slug>/<slide>`, so a deck reopens where it was left.
