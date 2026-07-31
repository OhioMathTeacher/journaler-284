# Journaler-284 — next steps

_App/code task list. Update it as things get done; history is in `git log`._

> **This repo is public** so GitHub Pages can serve the app. Course-internal material — the
> readings pipeline, distribution, machines, local paths — lives in the private planning repo,
> **not here**. Keep it that way when adding notes.

Last updated: **2026-07-31**, build **`2026-07-31-78`**. **Build/version lives in `index.html`** as
`?v=` on the `app.css` and `app.js` tags. **Set BOTH with one regex** — they drifted apart once
(css moved, js stuck three builds behind) and the stale JS was served for hours; `app.js` reads it back off its own `src` for the badge
bottom-right. **Bump `?v=` on every deploy** — on Pages it is the only thing stopping a cached
`app.js` being served after a push. Forget, and the old value shows on screen rather than failing
silently, which is the point: it tells on itself.

## Where the app is

Four tabs (Freewrite / Currere / Readings / Notebook), in `index.html` + `app.css` + `app.js`
(classic script — run `node --check app.js` before shipping; a stray smart-quote once blanked the
whole app). The 318P source is kept at `reference/journaler-318-source.html` as the harvest source.

**Built and working:**
- **Freewrite** — gush (timed, editing locked) → shape. Everything typed auto-saves to
  `localStorage` (`cr284_state`). **Focus mode** is defined by the clock: while it runs, the
  gush is the only thing on screen. **`Copy →`** moves a selection out of the gush into the
  One-Pager as its own line, with a keep-count ("Kept 47 of 380 words"). Deliberately **no
  copy-it-all button** — the scarcity is the assignment. Re-gushing wipes the text but the
  session carries `gushes` / `totalMinutes` / `totalWords`, so sheet two reports the whole
  effort. Counts only, never the erased text. **Verified working by Todd 2026-07-31.**
- **Post-buzzer reflection partner** with a saved answer box. Skipped entirely under 10 words:
  it was inventing observations about writing that did not happen.
- **Export One-Pager → PDF** — the submitted artifact. Prints as HTML so embedded images survive,
  measured against one sheet before printing, with a writing-session + AI-use record as sheet two.
- **Currere** four moments.
- **Notebook** — two lenses (By day / By piece), month calendar, `elevate()` to keep a dated pass.
- **Bundle notebook → PDF** — the turn-in artifact.
- **Readings** — PDF (pdf.js canvas + selectable text layer) and `.docx` (mammoth), numeric-sorted
  shelf, multi-file / whole-folder load, a persistent readings folder, Single/Continuous toggle,
  built-in PDF manual as the first-run reading.
- **Reading partner** with persistent geometry-based highlights, a threaded conversation, and
  page ±1 grounding. That page cache is in memory and **never** in `DB`.
- **Save / restore** — **one** button. `⤓ Save my work` writes a zip: the whole DB *plus* every
  reading file, so a second machine needs one artifact rather than a save file and a pile of
  chapters. `⤒ Open my file` takes that zip **or** an older `.json`. Restoring a zip writes the
  reading bytes back under filename-derived ids **first**, so the highlights in the JSON find their
  pages. Zipped with **STORE, not DEFLATE** — PDFs are already compressed, so deflating costs seconds
  of CPU for nothing; packing is a copy. That is what makes carrying the readings cheap enough to be
  the only save. Deliberately vendor-neutral: a thumb drive, any cloud, or none. `jszip` was already
  vendored for `.docx`.
  **There is deliberately no "quick save".** Typing is already persisted to the browser on every
  keystroke, so this button was never the frequent action — a second, lighter button only offered a
  way to reach another machine missing your chapters.

## Settings, and how to find out what a browser is doing

A **gear** in the top bar opens Settings — three tabs, after Allegory's pattern. Things touched
once a term live here rather than on the writing surface.

- **Readings** — the persistent readings-folder control, and the theme toggle.
- **AI** — Local / $0 / Pay sub-tabs. **Local auto-discovers**: it probes ports 8765, 11434 and
  1234, asks each responder `/v1/models`, and lists what is installed as one-click tiles, so a
  student never types an endpoint. It probes **both `127.0.0.1` and the host that served the page** —
  a browser cannot see its own LAN address but always knows the one it loaded from, so a laptop
  reaches a model on the machine serving it with nothing typed. Embedding models are filtered out.
  Writes the existing `cr_provider` / `cr_local_endpoint` / `cr_local_model` keys, so `callModel`,
  `aiLabel()` and the AI-use log are untouched.
- **Diagnostics** — a rolling 300-event log plus a snapshot, with **Copy** and **Download** so a
  student can send the lot in one paste. Snapshot covers the build that loaded and its asset URL,
  localStorage bytes against quota, journal/highlight/exchange counts, provider, secure context,
  folder-picker and clipboard availability, and for the open reading the **text-layer span count and
  lines detected**.

⚠ **The log is in its own storage key, NOT in `DB`.** `DB` is what `⤓ Save my work` exports; a
student's turn-in must not carry a debug log, and an unbounded log would eat the quota it exists to
report on. Keep it that way.

**Why this exists:** the app runs on ~25 machines and browsers nobody here chose. Chasing one
selection bug took an afternoon of reading the console over someone's shoulder — that does not
scale to a class.

## Reading selection — how it works now, and what to leave alone

Selecting text in a reading is driven by **where the pointer went**, never by the DOM range.

`orderByReadingColumns` re-sorts the text items, so the text layer's DOM order stops matching
reading order. Every DOM-based approach inherits that: `range.getClientRects()` and
`range.intersectsNode()` both walk the tree, so a drag across a whole line yields a range missing
that line's tail (9 anchors for an 8-line selection), a downward drag can reach *up* and grab
earlier lines, and `cloneContents()` returns the text shuffled with the chapter header spliced in.

So: `bandsFromPoints()` takes mousedown → current → mouseup, finds the line each point lands on and
fills every line between from that line's own text extent. **Do not "simplify" this back to the
selection range.** The range is used only to detect that a selection exists and to copy from.

- The browser's own `::selection` is **hidden inside the reader**. pdf.js paints it per span and
  tesseract emits one span per word-chunk, so the gaps between words stay unpainted and a perfectly
  continuous selection LOOKS torn — which is what reads as "the app didn't highlight what I
  selected". A continuous band is drawn per line instead, live as the drag happens.
- Saved bands are hidden while previewing, so overlapping translucent layers cannot masquerade as a
  patchy new one. (They did, for several builds.)
- Copy takes its text from the bands, so it comes out in reading order, with OCR cleanup: a capital
  I read as `|`, stray specks, and a line-break hyphen with a speck after it. Conservative on
  purpose — de-hyphenation is two rules, because one loosened rule turned "co-op" into "coop".
- Geometry tolerances are **proportional to the rendered text**, never fixed pixels; a 6px floor
  that is harmless at 12px type is over half the line spacing at 9px and merges lines on a phone.
- A highlight keeps the rects it was **saved** with, so bands from an older build can only be
  dropped and remade — hence **Clear all** at the foot of the highlights pane.

⚠ **STILL OPEN: `orderByReadingColumns` is the root cause.** It looks for column gaps in word
left-edges, and on a **single-column** scan the left margin, paragraph indents and justified spacing
still cluster — so it detects columns that are not there and shuffles the items. Everything above
routes around it geometrically. The honest fix is upstream: only reorder on a wide, sustained
vertical gutter with text down both sides. It was added to help selection and marquee capture, so
check which page motivated it before changing it.

## Upstream code worth borrowing (investigated 2026-07-30, nothing adopted yet)

We hand-rolled the selection geometry. Better-tested versions of the same thing exist, and one of
them is **already in the file we load** — `vendor/pdf.min.mjs` is **pdf.js 6.0.227**, which exports
`AnnotationEditorLayer`, `AnnotationEditorUIManager`, `AnnotationEditorType`, `DrawLayer` and
`TextLayer`, with `HighlightEditor` and **`Outliner`** inside. `Outliner` merges a selection's
per-word boxes into one clean outline — the job `unionRectsByLine()` does here — written by the
people who own the text layer, and it handles free-form highlighting on image-only pages too.

Three sources, most useful first:

1. **pdf.js's own `HighlightEditor` / `Outliner`** — already vendored, no new dependency.
2. **`react-pdf-highlighter`** — its `optimizeClientRects()` is a compact, well-tested answer to the
   merge-rects-per-line problem. Worth reading even if we adopt none of it.
3. **Hypothesis's client (`pdf-anchoring`)** — anchors highlights by **text quote + position**, not
   coordinates, and re-finds them when the page renders.

**(3) is the one to think hard about.** Every painful moment on 2026-07-30 came from storing
*rects*: a highlight keeps the geometry it was saved with, so bands from an older build could never
be repaired — the wrong numbers were the data. Text-anchored highlights would survive zoom, a
re-crop, a **re-OCR**, even a fresh scan of the same chapter, because they would re-find the quote.
Given chapters do get re-OCR'd and students carry work between machines, that is a real gain.

⚠ **Two things to know before adopting any of it:**

- **pdf.js's editor stores highlights in `AnnotationStorage`**, designed for writing back into the
  PDF. Ours live in `DB.highlights`, keyed per reading, carried in the save zip, and threaded into
  the Notebook and the reading partner. Adopting the editor means bridging those or losing them.
- **`orderByReadingColumns` would break pdf.js's editor too.** It assumes it built the text layer
  itself, in item order; we re-sort before building, so ANY upstream selection code inherits the
  same scrambling. **That function is the prerequisite for all three options.**

**Recommended order.** Do not rip out working code before Aug 24 — selection works and is heavily
commented. First fix `orderByReadingColumns` to reorder only on a genuine gutter (small, and it
unblocks everything). Then, once the term is running, evaluate text-anchored highlights as the
actual fix for stale geometry.

## ▶ START HERE NEXT SESSION — fix `orderByReadingColumns` (app.js:1464)

**One function is the prerequisite for everything else in Readings.** It is named as the root cause
in two sections above; this is the concrete brief so the next session can act without re-deriving it.

### What it does today

`orderByReadingColumns(items, pageWidth)` runs at **app.js:2505**, inside the text-layer build, on
`dedupeTextItems(tc.items)` before the layer exists. It:

1. keeps items with non-blank text, bails if fewer than 10;
2. sorts every item's **left edge** (`transform[4]`);
3. walks that sorted list and starts a new cluster whenever the gap to the previous left edge
   exceeds **`pageWidth * 0.06`**;
4. keeps clusters holding **≥4%** of items and calls each one a column;
5. if two or more survive, **re-sorts the items into column-then-vertical order**.

### Why it is wrong

It infers columns from **left-edge clustering alone**, and never checks that the gap it found is a
real gutter. On an ordinary single-column scan the left edges already cluster hard: the left margin,
first-line paragraph indents, and the ragged starts produced by justified spacing. Two or three of
those clusters clear both thresholds, so it declares columns that are not on the page and shuffles
reading order. Nothing downstream can recover: the text layer is built from the shuffled array.

### What it broke, and what routes around it

- `range.getClientRects()` / `range.intersectsNode()` / `cloneContents()` all walk the DOM, so they
  inherit the scrambling — hence 9 anchors for an 8-line drag, downward drags reaching upward, and
  copied text with the chapter header spliced in.
- `bandsFromPoints()` exists **because of this**, driving selection off pointer geometry instead.
- It would break **pdf.js's own editor too** — `HighlightEditor` / `Outliner` assume they built the
  text layer in item order. So all three upstream options are blocked until this is fixed.

### The fix

Require evidence of a **genuine gutter** before reordering, not just clustered left edges:

- a **wide** vertical band (a real gutter is far more than 6% of page width),
- **sustained** down most of the page's text height, not present on a few lines,
- with **text on both sides** of it across that span,
- and ideally corroborated by item **right edges**, not left edges alone — a true two-column page has
  lines *ending* well short of the page's right margin, which indents and ragged starts do not cause.

Cheapest correct version: build the column hypothesis, then **verify** it by checking that the
candidate gutter is empty across ≥60–70% of the text rows and that both sides carry text on those
rows. If verification fails, `return items` unchanged. Failing safe to natural order is right: a
genuinely two-column page read in natural order is mildly wrong, while a single-column page shuffled
is catastrophically wrong — and single-column is every chapter in this book.

### Before changing it — two things to establish

1. ⚠ **Find the page that motivated it.** The note above says it was added to help selection and
   marquee capture. If a real two-column page drove it, the fix must keep that page working; if it
   was added speculatively, the bar can be higher still. **Check this first** — it decides whether
   the function is fixed or deleted.
2. **Regression set.** Before touching it, capture the current behaviour on: a body-text page, a
   chapter-opening page (large display type, deep indents), the front matter (mixed sizes on one
   line — already the OCR outlier at 10.1% baseline scatter), and any genuinely two-column page. A
   fix that improves body text and breaks chapter openers is not a fix.

### How to tell it worked

Settings → **Diagnostics** already reports, for the open reading, the **text-layer span count and
lines detected**. Compare those before and after on the same page. Then the human check: drag across
eight lines and confirm eight bands, no reaching upward, and copied text in reading order.

### Then, and only then

- Consider `Outliner` from the already-vendored **pdf.js 6.0.227** to replace `unionRectsByLine()`.
- **After Aug 24**, evaluate **text-quote anchoring** (Hypothesis's model). The deepest lesson from
  2026-07-30 is in the section above: storing rects means *the wrong numbers were the data*, so a
  bad highlight can only be discarded, never repaired — which is why **Clear all** had to exist.
  Quote-anchored highlights would survive zoom, re-crop, **re-OCR**, and a fresh scan. Chapters here
  do get re-OCR'd, so this is a real gain rather than a theoretical one.

⚠ **Do not rip out working selection before Aug 24.** It works, it is heavily commented, and the
term starts. This fix is small and surgical; the rewrite is not.

### Open question carried over from 2026-07-30

Whether the build-44 leftovers — the highlight-rect clamp and `overflow: hidden` on `.pdf-page` —
are still doing anything now that bands are drawn per line, or are redundant belt-and-braces. Check
before removing: they were added because a band escaped the sheet and painted across the surround.

## Storage: what survives a revision

**Revising the app does not clear saved work.** `localStorage` and IndexedDB are keyed to the
**origin**, not the file version, and `?v=` changes the asset URL only. Adding a DB field is safe by
construction: `Object.assign({defaults}, loadDB())` gives an older save the new default. That is how
`name` and `session` landed with no migration.

Three things do destroy work, none of them about versions:

1. **A new origin is a new empty bucket.** ⚠ **The production URL is a locked decision** — renaming
   the repo, moving orgs, or changing host wipes every student. Keep localhost for development only.
2. **Quota.** Images used to go in as full-resolution base64, into both `localStorage` (the whole DB
   shares a 5–10MB budget) and every exported PDF. Now re-encoded on insert — long edge to
   `IMG_MAX_PX` 1600, JPEG `IMG_QUALITY` 0.85. Paste is swept too (`shrinkImagesIn`), since pasted
   images never touch the ＋ picker; `data-shrunk` makes the sweep idempotent.
3. **A silent save failure.** `saveDB` used to `console.warn` and nothing else, so a student kept
   typing into an app that had stopped recording. Now `#saveAlarm`, a non-dismissible banner saying
   to export immediately, cleared when a save next succeeds.

`DB_SCHEMA` + `migrateDB()` exist and `v` is actually read. v1→v2 is a no-op stamp; the hook is
there so the next real change has somewhere to go. An older build reading a newer save is safe too:
it ignores `v`, and `Object.assign` preserves keys it does not know.

**The real safety net is `⤓ Save my work`** — the whole DB as one JSON, restorable on any origin.

## Copy-from-gush: four rules, all learned the hard way (builds 75–78)

Todd used the Freewrite tab for the first time on 2026-07-31 and found three bugs in one
sitting. All four rules below exist because breaking them fails **silently**.

1. ⚠ **The gush is `readonly` after the buzzer, NEVER `disabled`.** It shipped disabled, and
   **a disabled textarea cannot be selected in any browser** — so there was no way to select
   the lines to copy and the whole feature was dead on arrival, with no error. `readonly`
   freezes the text (sheet two prints it as "the gush, unedited") and keeps it selectable,
   which is exactly what the chalkboard rule wants. Same in the restore path for a returning
   student. If you ever reach for `disabled` here, you are removing the feature.
2. **The insertion marker is a fixed overlay on `<body>`, never a node inside `.page`.**
   `pg.innerHTML` is serialised straight into `DB.shape` and printed on the submitted PDF, so
   any marker element, class or attribute inside the pane ends up in a student's turn-in.
   It is taken down on tab change, on Open page, and when the pane scrolls it out of view.
3. **Copy inserts at the last caret, not at the end**, and shows where before you click. It
   used to `appendChild`, so everything stacked at the bottom regardless — and because
   selecting in the gush moves focus out of the pane, the browser stops painting a caret and
   the pane gave no clue at all. Wrong was survivable; unknowable was not.
4. **Every formatting command must be reversible.** `H` is a toggle (pressed on an `h3` it
   gives back a `p`) because block format was the one trap — B and I already toggled, so an
   accidental heading looked permanent. Undo/redo buttons and ctrl/cmd-Z are wired too.

Naming: it was **"↑ Lift"** and neither half read. "Lift" is a metaphor and this course writes
to students literally; the up arrow pointed at a pane that is to the **right**. The label is
short (`Copy →`) because a long one re-wrapped and shoved the timer row's height around; the
destination and the order of operations live in the note beside it, which can afford words.

## Design decisions worth not undoing

- **The One-Pager export measures but never auto-shrinks.** Deciding what to cut is the assignment.
  `#printOnePager` print typography therefore lives **outside** `@media print`, so the measuring
  probe lays out under the rules the sheet will use. Don't "tidy" it back inside.
- **The session record can report absence.** When no gush was recorded it says so. It is evidence,
  so it must never imply a session that did not happen.
- **The two OP columns share row tracks** (subgrid: label, note, controls, surface, footer). As
  independent flex stacks they drifted, because the gushbar's lock message wraps and the toolbar's
  does not.
- **Both PDFs print through the browser's own Save-as-PDF** — no build step, no CDN, no vendored PDF
  library, and the student's paper size is honoured.
- **One-Pagers do not elevate into the Notebook.** They are submitted as their own PDF;
  `pieceKind:'one-pager'` is legacy-only.

## ⚠ Touch devices: there is no touch handling anywhere in this app

Established by reading the code on 2026-07-31, not yet by running it on a device. There is **no
`touchstart`, no `pointerType`, no `maxTouchPoints`, and no `(pointer: coarse)`** in `app.js` or
`app.css`. Two mechanisms depend on input that a touch device may not produce, and **both fail
silently**, which is the one failure mode everything else in this app has been built to avoid.

1. **The edit-lock** (`app.js:571`) is `if(['Backspace','Delete'].includes(e.key)) e.preventDefault()`.
   Soft keyboards do not reliably emit those `keydown`s. If it does not fire, a timed One-Pager
   draft has no lock, no error, and no sign of it afterwards — and that lock is the reason the
   syllabus requires the app for graded drafts at all. **Highest-stakes unknown in the project.**
2. **Reading selection** is driven by `mousedown`/`mousemove`/`mouseup` into `_dragFrom`/`_dragTo`
   (`app.js:1759-1761`). Touch does not fire `mousemove` for a drag, so capture falls through to
   the DOM range — the path `orderByReadingColumns` scrambles. Expected failure is therefore
   **wrong bands, not absent ones**.

What is *not* broken: `index.html` has a proper viewport meta, and `app.css` collapses the
notebook grid and the reader to single column at 720px. Small screens were thought about.

**Recommended response, in this order.** Do not try to make the app fully touch-capable before
Aug 24. Instead: (a) test on a real iPad and replace the inferences above with facts; (b) make it
**tell on itself** — detect a coarse pointer at boot, report it in Diagnostics, and on the graded
surfaces either work correctly or say plainly that this one needs a laptop. Wrong-but-silent is
the only outcome that cannot be accepted, because those drafts are graded. The course site now
carries hardware guidance saying to write on a computer, but guidance does not protect a student
who ignores it.

## Open slices (not started)

- ~~"Build from the gush."~~ **DONE 2026-07-31 (build 74).** ↑ Lift + keep-count; see Freewrite above.
- **Reconcile the `OPS` table against the assignment handouts.** The framing and placeholder text in
  `OPS` predates them, and drift means two sources of reality for one assignment.
- **Currere two-pane** — still narrow, never got the wide pass Freewrite has.
- **Notebook calendar shows every day**; the locked design is MON/WED only. Minor.
- **AI-use log** — done for the One-Pagers. Still wanted per piece elsewhere. Currere studio tools
  (themes / craft consultant) + Conference-Packet PDF.
- ~~Relink orphaned readings~~ **DONE 2026-07-30 (build 40).** Ids now derive from the filename
  (`f:<name>`), and `migrateReadingIds()` re-keys existing shelves once, carrying highlights and Q&A
  across. Bytes stay filed under the old id, so records keep a `legacyId` and `readingBytesFor` falls
  back to it. **The McGuffey run exercised the restore and the zip came back fine; whether the
  highlights themselves landed on the right passages was not checked. Still the open proof.**
- Optional: route Open-page free-writes into the Notebook, dated.

## Needs testing on a real device → see `TESTING.md`

**The device checklist moved to `TESTING.md`** so there is one list rather than two drifting
copies. It holds the status matrix, the five things to check in order of what it costs to get
them wrong, and the environment findings per browser. Record results there.

The short version of what it says: the app **boots clean on all four engines** (Gecko, Blink
twice under different policies, WebKit), which means the browser was never the variable. The
device is. Nothing below the boot line — the reader, the exports, the edit-lock — has been
verified anywhere yet.

## A note on what leaves the machine

The reading partner sends the quoted passage, the last few turns, and page ±1 of the open PDF to
whichever model is configured. On a local model that stays on the machine. On a hosted provider it
does not. The reflection partner likewise sends the gush text. Worth being explicit with students
about, and worth weighing when recommending a provider.

## ⚑ TWO-MACHINE TEST — the McGuffey run (2026-07-30): the zip works

**Ran it. The one-zip save/restore works well across machines.** That was the biggest structural
bet in the app — carrying the whole workspace, readings included, as a single file needing no
account and no cloud — and it holds up in practice, not just on the bench. Packing with STORE
rather than DEFLATE is what makes it cheap enough to be the only save button. Keep that decision.

**Still unreported from the run, and worth capturing on the next trip:**
- **Whether restored highlights landed on the right passages.** This is the real proof of the
  filename-id change (`f:<name>` + `migrateReadingIds`), and it is still untested against anyone's
  data but one person's. A highlight on the wrong passage is the single most useful bug here.
- **Which browser each machine runs**, and whether the **📁 Use a readings folder** chip appeared.
  Present = Chromium; absent = Firefox/Safari. This decides whether the folder-handle path is worth
  developing for students at all, or whether the zip simply replaces it.
- **How long packing took and how big the file got** with all 27 chapters aboard. If that is painful
  on a slower machine, reconsider before a class of 25 does it.

**The wider gap is unchanged and is not about code: no student has used this.** All testing to date
is one person, and the syllabus makes the app a hard requirement for the 5 timed One-Pager drafts.
That decision belongs in the course notes, not here, but the app-side consequence is worth stating:
nothing in the build list below matters as much as putting the app in front of a few real people.

⚑ **2026-07-31 made that concrete.** Todd sat down and used the Freewrite tab as a writer for the
first time, and found **three bugs in one session** — a feature that could not work at all
(`disabled` textarea), copied text landing in the wrong place with no way to see where, and an
unreversible heading. None of them threw an error; all of them had shipped. One person, one
sitting, no test plan. That is the whole argument for the 3–5 testers before Aug 24.

## Verify after any merge between machines

Type in each tab → refresh → work persists. `⤓ Save my work` → reload → `⤒ Open my file`
round-trips. Load a folder of readings → the shelf lists them in order → select one and highlight a
multi-line passage. Export a One-Pager: two sheets, images intact, session record present.
Notebook → Bundle → PDF from both lenses. Confirm the build badge bottom-right matches the `?v=`
you deployed.
