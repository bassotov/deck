# deck

Storylines are markdown files; this app renders them as 16:9 slides you can scroll
through and draw on while recording a voiceover. `README.md` is the user-facing doc —
this file is the working reference for the internals.

## Run it

```bash
npm run dev            # vite, http://localhost:5290 — the app-development loop
npm start              # build, then the CLI, serving the built app
npm run mcp            # build, then the MCP server on stdio
npm run typecheck      # both projects
```

## Shape

Three front ends over one core. The rule that makes this work: nothing product-shaped
lives in `vite.config.ts`, and nothing transport-shaped lives in `server/store.ts`.

```
server/paths.ts    package root, dist and the export script, found not counted
server/config.ts   where the decks are — argument, then env, then env file, then ./decks
server/slides.ts   the slide grammar. imports no `node:`, so it bundles to the browser too
server/store.ts    every filesystem operation. no HTTP, no MCP
server/api.ts      the HTTP surface over a store; resolves true when it handled a request
server/serve.ts    the standalone server: built app + api + live reload, no Vite
vite.config.ts     the dev adapter — middleware around the same handler
bin/deck.ts        the CLI
mcp/               the MCP server and the syntax crib it hands to agents
src/               the React app
scripts/export.ts  PNG export, driving `serve` through Playwright
scripts/bundle.ts  the Claude Desktop extension (.mcpb), staged and packed
mcpb/icon.html     the extension icon's source; the png is rendered from it
```

## The extension

`npm run bundle` writes `build/deck-<version>.mcpb` — a zip of `manifest.json`, `lib/`,
`dist/`, an icon, and a **production-only `node_modules` installed into the staging
directory**. It has to be self-contained: the host runs `node lib/bin/deck.js mcp`
directly, with no install step and no guarantee the user has ever run npm.

The decks folder arrives as `DECKS_DIR` from a `user_config` field of type `directory`.
An optional field the user leaves blank is passed through as the literal string
`${user_config.asset_root}`, so `resolveConfig` treats any value still containing `${`
as unset — otherwise it would resolve to a directory with `${` in its name.

`startMcpServer` exits explicitly rather than letting the event loop drain. Shutdown can
land while a tool call is in flight, and an `open_deck` that starts a moment later binds
a socket nothing is left to close, so the process would hang forever with the host
waiting on it.

## Releasing

**Anything shipped needs the npm bump.** deck goes out through three channels and they
do not sync. Publishing one and not the other is how `npx` starts serving code that is
weeks behind the repo, which is worse than not shipping at all.

| Channel | Carries | Updated by |
| --- | --- | --- |
| npm `@bassotov/deck` | the CLI, and `npx` for every MCP client | `npm publish` |
| GitHub release `.mcpb` | the Claude Desktop extension | `gh release create` |
| the repo | source | `git push` |

```bash
# 1. bump the version in package.json — npm versions are immutable, so a
#    published number can never be replaced, only superseded or deprecated
npm run typecheck && npm run build
npm publish --access public          # prompts for a 2FA code

# 2. the extension carries its own copy of lib/ and dist/, so it is stale the
#    moment the package is not
npm run bundle
gh release create vX.Y.Z build/deck-X.Y.Z.mcpb --title "…" --notes-file …
```

The MCP server reports `readPackageVersion()`, so a forgotten bump shows up as a client
announcing the wrong version rather than as an error. `prepublishOnly` runs the
typecheck and build, so a stale `dist/` cannot be published by accident.

`files` must keep carrying `PRIVACY.md`, `SECURITY.md` and `THIRD-PARTY-LICENSES.md`.
The tarball ships the bundled woff2 files, and the OFL requires their notices to travel
with them.

## The two builds

| | Project | In | Out |
| --- | --- | --- | --- |
| Client | `tsconfig.json` | `src`, `vite.config.ts` | `dist/` (vite) |
| Node | `tsconfig.node.json` | `server`, `bin`, `mcp`, `scripts` | `lib/` (tsc) |

Both are shipped: `files` is `["lib","dist"]` and `bin` points at `lib/bin/deck.js`.

The Node project is `module: NodeNext` with **`rewriteRelativeImportExtensions`**, so
imports are written with the real `./store.ts` extension and emitted as `./store.js`.
The alternative — writing `.js` in a `.ts` file — is the conventional trick and it reads
like a mistake every time.

`server/slides.ts` is compiled twice: by tsc for Node, and by Vite into the browser
bundle via the `src/lib/slides.ts` re-export. That is why it must never import `node:`.

`scripts/export.ts` declares the slice of Playwright it drives rather than importing its
types, and loads it through a variable specifier. Playwright is deliberately not a
dependency, and a literal import would fail the build on any machine without it.

**Live reload is server-sent events**, not Vite HMR. The standalone server has no HMR
channel, and one transport that works in both beats a dev-only path plus a fallback.
Both servers push the same `decks` event; `src/lib/api.ts#watchDecks` is the only client.

**The store is the security boundary.** Slug validation, the refusal to serve outside
the asset root, and the refusal to clobber a deck all live there — so the CLI, the dev
server and the MCP server cannot each get it subtly wrong. `StoreError.status` carries
the HTTP status the API layer should report.

## Where things live

| What | Where |
| --- | --- |
| Storylines (the content) | `$DECKS_DIR/*.md`, default `./decks` |
| Slide images | `$DECKS_DIR/images/` |
| Annotations | `$DECKS_DIR/.ink/<slug>.json` |
| The app | this repo |

The content directory is configurable and expected to live **outside** the repo for
anyone using this for real: storylines belong wherever they already write, and
`node_modules` must never land in a notes folder. `deck /path`, `DECKS_DIR=/path npm run
dev`, or a gitignored `.env.local` — in that order of precedence, so an explicit argument
is never overridden by an env file that happens to be in the working directory.
`STORIES_DIR` is still read as the old name for it.

`ASSET_ROOT` widens the by-name image lookup to a parent folder, which is how an
Obsidian-style `![[shot.png]]` resolves against a whole vault. It defaults to
`DECKS_DIR`, because the fallback walks the tree and the parent of an arbitrary decks
folder can be anything.

Annotations go in a dot-folder so note apps and finders ignore them.

**The viewer never writes to a `.md`.** Ink, pasted images and their placement are stored
beside the deck, never spliced into the source — that is what keeps a storyline editable
anywhere and safe to keep in someone else's synced folder. Drawing on a slide cannot
touch the words on it.

Markdown is only ever written where a person or an agent asked for it by name: `deck new`,
and the MCP `write_deck` / `append_slide`. `write_deck` refuses to overwrite without an
explicit flag, and nothing anywhere deletes a deck.

## The storyline format

One file = one deck. Slides split by `---` alone on a line. Slide 1 is the title slide.

- `<!-- layout: … -->` — override the auto-detected layout. The full set is in `LAYOUTS`
  in `types.ts`: `title`, `center`, `quote`, `columns`, `flow`, `stats`, `versus`,
  `timeline`, `image`, `default`
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
`$DECKS_DIR/images/`.

`decks/how-deck-works.md` is the living reference deck for all of this — it renders
itself, so update it when the format changes. Its committed `.ink/` file is deliberate:
it demos the ink layer on a first run, and it is what the README screenshots show.

## Export

`npm run export` starts a `serve` and drives it through Playwright, writing PNGs to
`exports/`. Playwright is deliberately not a dependency — `npm i -D playwright` when you
need it. It renders the built app, so the build has to have run; the npm script does it.

Slide count is computed with the real `splitSlides` and then filtered the way the
renderer filters — strip the directives, drop what is left empty. Both halves matter: a
regex `---` splitter disagrees about fenced code blocks, on exactly the decks that
document the format, and skipping the filter asks for a directive-only slide the app
never shows. The URL hash is 1-based; the filenames are 0-based, to match `--slides`.

## Design

Editorial-terminal chrome (warm charcoal shell, mono uppercase labels) around a warm
near-white slide stage. Instrument Serif display, Inter body, Caveat accent, one coral
accent (`#FF5A1F`) reserved for action and ink.

**Default slide shape: big title on top, content below, air underneath.** This is the
house layout, so `default` and `columns` share it. Only `title`,
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

Every element carries one `style` object — `{ stroke, fill, strokeWidth, opacity }` — plus
its own geometry, and text carries a top-level `fontSize`. One shape for all five kinds is
what lets the property bar read and write any of them without per-kind field mapping. A
stroke also stores the `brush` it was drawn with: the highlighter used to be inferred from
`opacity < 1`, which would have turned any dimmed pen stroke into a highlighter the moment
opacity became editable.

Decks on disk predate that model. `normalizeSlide` in `lib/ink.ts` is the one load
boundary that converts flat legacy rows (`color`/`size`) into the current shape, so no
renderer or hit-tester carries a fallback. Nothing rewrites on load — a slide upgrades
the next time it is saved.

`InkLayer.tsx` is the orchestrator; the parts live beside it. `ink/ElementView.tsx` renders
one element plus its fat hit area, `ink/SelectionOverlay.tsx` draws outlines and grips (the
marquee rect itself is drawn by `InkLayer`, since it isn't tied to a selection),
`ink/TextEditor.tsx` owns the floating textarea, `hooks/useInkDrawing.ts` authors
new elements and `hooks/useSelectionInteraction.ts` manipulates existing ones through a
single `Interaction` union, so its modes can't overlap. Adding a tool means `lib/ink.ts`
(geometry), `useInkDrawing.ts` (pointer handling) and `ToolRail.tsx` (the button).

Live gesture state stays local until pointer-up, and the commit goes through `updateMany`.
That is what makes a drag or a resize of ten elements one undo entry instead of ten.
Nothing may call `setState` from inside another `setState` updater: the app only ever runs
under `npm run dev`, so StrictMode's double-invoke is permanent, and side effects in an
updater duplicated committed text and made one undo walk back two steps.

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
**Double-click a committed text with the cursor tool to edit it** — same textarea, seeded
from the element, written back to the same id. Clearing it deletes the mark, since empty
text is invisible and would strand something unselectable. Double-click is decided on
pointer-*up*, gated on the drag threshold: on pointer-down, "click to select then drag
from the same point" reads as a double-click and opens a textarea that steals the focus.

`1` is select-and-move. Click selects, **Shift-click adds or removes**, and dragging on
empty canvas draws a **marquee** that takes everything it intersects — intersection, not
enclosure, which is far more forgiving on a trackpad. `⌘A` takes the whole slide. Dragging
any member moves the whole selection as one undo entry; **Option-drag leaves the originals
and drags copies**. Shift constrains a drag to one axis, and because Shift also means
add-to-selection, the membership toggle is deferred to pointer-up and only applied if the
pointer never travelled far enough to count as a drag.

Each element carries an invisible fatter hit area so a 7px line is still grabbable on a
trackpad; closed shapes hit-test on their outline only, so a rectangle drawn around content
doesn't swallow clicks meant for the slide. The marquee needs pointer events on empty
canvas, which cursor mode used to pass through to the slide, so a transparent backdrop now
sits behind every element in that mode only — slide HTML is not directly clickable while
the cursor tool is active, which does not matter for a deck being annotated rather than
read.

`⌘C`/`⌘V` copy and paste, `⌘D` duplicates. The clipboard is an in-memory ref in `App` — not
the OS clipboard, since pasting a mark into another app is not a real use, and `InkLayer`
is remounted per slide so a clipboard living there could never survive the slide change
that cross-slide paste exists for. Real `⌘V` is handled **only** in the existing window
`paste` listener (images first, elements as the fallback) so it cannot fire twice. Pasting
onto the slide the copy came from cascades an offset; pasting onto another slide keeps the
original coordinates, because putting the same mark in the same place is the point.

Nothing can be dragged, nudged or pasted entirely off the stage — it clips overflow, so an
escaped mark left nothing to click and looked deleted. A gesture also latches its tool at
pointer-down, and tool and navigation keys are ignored while one is in flight: pointer
capture keeps delivering events, so a keyboard tool switch mid-stroke used to reinterpret
a pen stroke as an eraser drag or drop it silently.

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
`⌘A` select all · `⌘C`/`⌘V`/`⌘D` copy/paste/duplicate · `⌫` delete the selection
`⌘]`/`⌘[` front/back · `⌘Z`/`⇧⌘Z` undo/redo · `X` clear slide
`⌘B` sidebar · `F` focus mode · `Esc` out — clears a selection, then the tool, then focus, one step per press

**Arrows nudge whatever is selected** (4 stage units, 20 with Shift) and only navigate
slides when nothing is selected. `space`, `j`, `k` and scroll navigate **always** — that
is the escape hatch mid-recording, so advancing a slide never depends on remembering to
press `Esc` first.

Every key above — digits, letters, arrows, navigation, and `Esc`/`⌫` — is ignored while a
gesture is in flight: a stroke, a drag, a handle resize or a marquee. Pointer capture keeps
delivering events to a gesture that has already started, so a keyboard switch landing
mid-stroke used to reinterpret or corrupt it, and `Esc` mid-resize used to unmount the grip
holding capture and leave the keyboard locked for the rest of the session. Gestures
therefore end on a `window` pointer-up, never on the node that reported them — that node can
be unmounted by the very key that ended the gesture.

The click-versus-drag threshold is **4 CSS pixels converted through the live stage scale**,
not a raw stage-unit constant. One stage unit is about 0.68 CSS px, so a literal `1` meant
any real hand movement counted as a drag and double-click-to-edit and Shift-click-to-add
both failed on a wobble. Synthetic test mice don't wobble; hands do.

Digits are read off `e.code`, not `e.key` — Shift+1 arrives as `!` on a Mac layout.

The property bar's slot under the stage is always reserved, so the stage never resizes
when a selection appears. A stage that changes size mid-recording is far worse than a
strip of empty space.

The URL carries `#/<slug>/<slide>`, so a deck reopens where it was left, and `hashchange`
is honoured so browser back/forward works. The app's own writes use `replaceState`, which
doesn't fire the event, so there's no loop.
