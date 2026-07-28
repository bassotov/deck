# deck

Write a storyline in markdown. Get a 16:9 deck you can draw on while you record.

<!-- Drop a screenshot or a short gif here: docs/preview.png -->

```bash
git clone https://github.com/bassotov/deck.git
cd deck
npm install
npm run dev          # http://localhost:5290
```

That opens the two example decks in `decks/`. Point it somewhere else with `DECKS_DIR`.

## What it does

- **Markdown in, slides out.** One file is one deck, slides split by `---` on its own line. No binary format, no editor lock-in.
- **Layouts pick themselves.** A heading alone centres. A blockquote becomes a pull quote. Ask for `columns`, `stats`, `flow`, `timeline` or `versus` by name when you want them.
- **Draw on the slide while you talk.** Pen, highlighter, arrow, shapes, text, eraser. Vector, not pixels, so marks stay crisp at any window size.
- **Tuned for a trackpad, not a stylus.** Stroke width comes from velocity, jitter is smoothed hard, and Shift snaps to a straight line.
- **Paste a screenshot straight onto a slide.** It floats over the slide instead of pushing the text around. Drag it, resize it, undo it.
- **Marks save themselves,** per slide, and survive a reload.

## Why I built it

I record build-in-public videos every week, and every deck tool I tried was built for a room instead of a screen recording.

Keynote wanted me in Keynote. The web ones wanted an account and a subscription, and my slides ended up in someone else's database. Both of them made drawing on a slide a whole mode I had to remember how to enter.

What I actually wanted was to write the story as a text file, the same place I write everything else, and then have something to scribble on while I talked over it. So the markdown stays a plain file you can edit anywhere, and the drawing sits on top and never touches it.

The default slide is title on top, content below, air underneath. Short slides leave the bottom empty on purpose. That is the shape, not a bug to fix ;)

## Write a storyline

`decks/how-storylines-work.md` is the reference deck, and it renders itself. Open the app and read it there.

The short version:

````markdown
# Title slide

Everything before the first `---` is the title.

---

<span class="eyebrow">day 42</span>

## A normal slide

Headings, **bold**, `code`, lists, tables, quotes, images.

<!-- note: speaker note. renders under the stage, outside the recording crop. -->

---

<!-- layout: stats -->

## Numbers do the talking

### 7,000

The h3 is the figure

### **~25%**

Bold one to make it the point
````

Two accents, both optional: `<span class="hand">handwritten</span>` and `<span class="eyebrow">mono label</span>`.

## Keys

`1` cursor · `2` pen · `3` highlighter · `4` arrow · `5` shape · `6` text · `7` eraser

Press `5` again to cycle square → oval → triangle → line. Letters work too (`V P H A S T E`).

| | |
| --- | --- |
| `← →` `space` scroll | Move through slides |
| Shift while drawing | Snap to a straight line |
| `⇧1`–`⇧4` · `C` | Pick a colour · cycle it |
| `⌘A` `⌘C` `⌘V` `⌘D` | Select all, copy, paste, duplicate |
| `⌘]` `⌘[` | Bring to front, send to back |
| `⌘Z` `⇧⌘Z` · `X` | Undo, redo · clear the slide |
| `⌘B` · `F` · `Esc` | Sidebar · focus mode · back out one step |

Arrows nudge whatever is selected and only move slides when nothing is. `space`, `j` and `k` always move, so advancing mid-recording never depends on remembering to hit `Esc` first.

## Configuration

Both are optional. Set them in the shell, or copy them into a `.env.local` (gitignored).

| | |
| --- | --- |
| `DECKS_DIR` | Folder to read decks from. Default `./decks`. |
| `ASSET_ROOT` | Widens image lookup by bare name to a whole notes folder, the way Obsidian resolves `![[shot.png]]`. Must be a parent of `DECKS_DIR`. Default: `DECKS_DIR` itself. |

```bash
DECKS_DIR=~/Notes/Decks npm run dev
```

Keeping decks outside the repo is the point if you already write in Obsidian, iCloud, or anything synced. The app only ever reads your `.md` files. Annotations go beside them in a `.ink/` dot-folder, and pasted images in `images/`.

## Where this is going

Right now this is a dev server you run locally, and that is honestly fine for recording. Two things I want next:

- [ ] **A CLI.** `npx @bassotov/deck ./my-decks` and it just opens, no clone, no install.
- [ ] **An MCP server,** so an agent can write and edit the deck itself. Markdown is already the format agents are best at, so "make me a deck about X" should end with a real file on disk you can open and fix, not a proprietary blob behind an API. A free PowerPoint for agents, roughly.

Neither exists yet. If you want one of them, open an issue and say so, it genuinely helps me pick.

## Notes

- macOS is what this is developed and recorded on. It should run anywhere Node does, but the shortcuts are written for a Mac keyboard.
- Dev-server only by design. The deck and annotation APIs are Vite middleware reading your local filesystem, so there is no build to deploy and nothing leaves your machine.
- `CLAUDE.md` in the repo root is the working reference for the internals, including why a lot of the fiddly interaction decisions went the way they did. It is written for an agent but it reads fine as a design doc.

## License

MIT
