/**
 * The format, written for whoever is generating a deck rather than for someone
 * learning it. `decks/how-deck-works.md` is the same thing for humans, and it
 * renders itself — this one is flat text because a tool result is read once.
 */
export const SYNTAX = `# The deck storyline format

One markdown file is one deck. Slides are split by \`---\` alone on a line.
A \`---\` inside a fenced code block is not a split.

Slide 1 is the title slide: an H1 and, optionally, one line under it.

## Layouts

Most slides need no layout. The default is: big title on top, content below,
air underneath. Do not try to fill the empty space at the bottom — that is the
house shape, not a gap.

Picked automatically:
  title    the first slide
  center   a slide holding only a heading
  quote    a slide holding only a blockquote
  default  everything else

Asked for by name, with \`<!-- layout: NAME -->\` on its own line in the slide:
  columns   side-by-side columns, auto-numbered — for options and comparisons
  stats     a row of headline figures
  flow      a left-to-right pipeline; all-numeric steps draw bars to scale
  timeline  a dotted rail down the slide
  versus    expectation against reality
  image     one screenshot, full bleed

The five block layouts all read the SAME shape: everything before the first
\`###\` is the title block, then each \`###\` opens one block.

## Blocks by layout

columns  — one \`###\` per column, prose under each. Two to four works best.
stats    — \`###\` is the figure, the text under it is the label.
           Bold ONE h3 (\`### **~25%**\`) to make it the hero. One per slide.
flow     — \`###\` is the step. If every step is numeric, bars scale to the
           largest and a zero renders as a collapse.
timeline — a flat bullet list, not h3s. Bold at the start of a line becomes
           the marker column: \`- **Jul** shipped the first build\`.
           Do not nest list items under a timeline entry.
versus   — first \`###\` is the expectation, everything after is what happened.

## Inline

**bold**, *italic*, \`code\`, lists, tables, blockquotes and images all work.
Type scales with the stage, so never set a font size.

<span class="eyebrow">day 42</span>   a mono uppercase label. Put it ABOVE the
                                      heading, on its own line.
<span class="hand">like this</span>   the handwritten coral accent.

Both are optional and at most one of each per slide.

## Speaker notes

<!-- note: say this bit slowly -->

Renders UNDER the stage, outside the recording crop. Never appears on the slide.

## Images

![[shot.png]]              by bare name, found under the asset root
![[shot.png|600]]          600px against a 1280-wide stage, scales with it
![[shot.png|50%]]          half the slide
![[shot.png|large]]        small · medium · large · full
![[shot.png|420|center]]   size and alignment, any order
![](shot.png)              plain markdown works too

## Writing well in this format

Short lines. One idea per slide. A slide is a beat in a story someone is
talking over, not a document — if it needs a paragraph, it needs two slides.
Directives must sit on their own line.`
