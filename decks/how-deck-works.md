# How <span class="hand">deck</span> works

Every file in this folder is one deck. This one explains the format, by being one.

---

<span class="eyebrow">the format</span>

## One file, one storyline

- A markdown file in your decks folder
- Slides split by `---` on its own line
- The first slide is the **title slide**, styled automatically
- Edit it in any editor — the deck reloads live

---

## What a slide can hold

Headings, paragraphs, **bold**, *italic*, `code`, lists, tables, quotes, images.

Type scales with the stage, so a slide never needs a font size.

---

## Layouts pick themselves

| Slide looks like | Layout | Shape |
| --- | --- | --- |
| The first block | `title` | Centred |
| Only a heading | `center` | Centred |
| Only a blockquote | `quote` | Centred |
| Anything else | `default` | **Title on top, content below, air underneath** |

Override with `<!-- layout: center -->` anywhere in the slide.

---

<span class="eyebrow">the visual layouts</span>

## Five you ask for by name

| Put in the slide | You get |
| --- | --- |
| `<!-- layout: columns -->` | Side-by-side columns, numbered |
| `<!-- layout: versus -->` | Expectation against reality |
| `<!-- layout: stats -->` | A row of headline numbers |
| `<!-- layout: flow -->` | A left-to-right pipeline |
| `<!-- layout: timeline -->` | A dotted rail down the slide |
| `<!-- layout: image -->` | One screenshot, full bleed |

**All of them read the same shape:** everything before the first `###` is the title block, then each `###` starts a new block.

---

<!-- layout: columns -->

## Three options, one slide

### Do nothing

Costs nothing, changes nothing. The baseline every option has to beat.

### Ship the small version

Two days of work. Answers the question badly but answers it this week.

### Build it properly

Three weeks. Right answer, wrong timing — unless the first two fail.

<!-- note: columns — one h3 per column, as many as you write -->

---

<!-- layout: versus -->

## Versus: the guess against the outcome

### What I expected

The first block is the hypothesis. Drawn provisionally, dashed, quiet.

### What happened

Everything after it is what actually occurred. Solid, warm, accent rule down the side.

<!-- note: two h3s is the normal case. more than two all render as outcome. -->

---

<!-- layout: stats -->

## Stats: numbers do the talking

### 7,000

The h3 is the figure

### 95

The text under it is the label

### **~25%**

Bold the h3 to make one number the point

<!-- note: `### **+25**` is how you pick the hero number. one per slide. -->

---

<!-- layout: flow -->

## Flow: a funnel that draws itself

### 15

Emails sent

### 10

Opened

### 5

Reached checkout

### 0

Paid

<!-- note: all-numeric steps get bars scaled against the biggest one, and a zero renders as collapse -->

---

<!-- layout: flow -->

## Flow also takes words

### Google

Found us

### Signed up

No referral

### Uploaded

A pile of tests

### **Paid**

Same layout, no bars

---

<!-- layout: timeline -->

## Timeline: a bullet list on a rail

- **Jul** Bold at the start of a line becomes the marker column
- **Aug** Everything after it is the beat
- **Sep** Each item gets an orange dot
- **Then** The last dot is hollow, because that is where a story goes quiet

<!-- note: flat lists only — don't nest under a timeline item -->

---

<span class="eyebrow">screenshots</span>

## Paste one onto the slide

**⌘V** with an image in the clipboard, or drag the file onto the window. It lands on the slide you are looking at.

It floats **over** the slide — it never pushes the text around. Drag it anywhere, pull the corner to resize, **backspace** to remove it, **⌘Z** to undo.

<!-- note: pasted images live with the annotations, not in the markdown. rename a heading and they orphan, same as the drawings. -->

---

## Or write it into the markdown

When the image is part of the slide rather than laid over it, embed it by name — and the file can sit anywhere the app is allowed to look.

```
![[shot.png]]            full width, capped
![[shot.png|600]]        600px at a 1280-wide stage, scales with it
![[shot.png|50%]]        half the slide
![[shot.png|large]]      small · medium · large · full
![[shot.png|420|center]] size and align, any order
```

Plain `![](shot.png)` works too. `<!-- layout: image -->` makes one cover the whole stage.

---

<span class="eyebrow">voiceover</span>

## Speaker notes

Add `<!-- note: ... -->` to a slide. It renders **under** the stage, not on it — so it stays out of the recording crop but stays in front of you.

<!-- note: this line is the note for this slide — it never appears on the slide itself -->

---

## Two accents

Use `<span class="hand">like this</span>` for the <span class="hand">handwritten</span> accent, and `<span class="eyebrow">day 42</span>` above a heading for the mono label.

Both are optional. One per slide, max.

---

## Drawing

- **1** select — drag any mark, shape, text or image to realign it (Shift locks one axis)
- Click to select, **backspace** to delete it, click the slide to deselect
- **2** pen · **3** highlighter · **4** arrow · **5** shape · **6** text · **7** eraser
- Press **5** again to cycle the shape: square → oval → triangle → line
- Letters work too: **V P H A S T E**
- **Shift** while drawing snaps to a straight line, or makes a shape square/circular
- **6** then click to type — annotation text lands in the handwritten accent face
- **⇧1–4** picks a colour, **C** cycles it
- **⌘Z** undo, **X** clears the slide
- Marks save per slide, automatically, and survive a reload

<!-- note: demo the shift-snap here, it is the one that looks best on camera -->

---

## Navigating

- **← →** or **space** or scroll to move
- **⌘B** sidebar · **F** focus mode · **Esc** back out

---

> Write the story first. Draw on it second.
