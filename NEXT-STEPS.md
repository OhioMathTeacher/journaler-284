# Journaler-284 — next steps

_App/code task list. Update it as things get done; history is in `git log`._

> **This repo is public** so GitHub Pages can serve the app. Course-internal material — the
> readings pipeline, distribution, machines, local paths — lives in the private planning repo,
> **not here**. Keep it that way when adding notes.

Last updated: **2026-07-30**, build **`2026-07-30-67`**. **Build/version lives in `index.html`** as
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
  `localStorage` (`cr284_state`).
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

## Open slices (not started)

- **"Build from the gush."** The assignment says to build the One-Pager *from the gush*, and the
  shape pane opens blank — the interface asks a question instead of answering it. Wanted: a
  lift-**selected**-lines gesture, not a bulk copy, so shaping stays selection rather than tidying.
  **Do this next.**
- **Reconcile the `OPS` table against the assignment handouts.** The framing and placeholder text in
  `OPS` predates them, and drift means two sources of reality for one assignment.
- **Currere two-pane** — still narrow, never got the wide pass Freewrite has.
- **Notebook calendar shows every day**; the locked design is MON/WED only. Minor.
- **AI-use log** — done for the One-Pagers. Still wanted per piece elsewhere. Currere studio tools
  (themes / craft consultant) + Conference-Packet PDF.
- ~~Relink orphaned readings~~ **DONE 2026-07-30 (build 40).** Ids now derive from the filename
  (`f:<name>`), and `migrateReadingIds()` re-keys existing shelves once, carrying highlights and Q&A
  across. Bytes stay filed under the old id, so records keep a `legacyId` and `readingBytesFor` falls
  back to it. **Untested with real student data — the McGuffey run is the first proof.**
- Optional: route Open-page free-writes into the Notebook, dated.

## Needs testing in a browser (nothing blocks on code)

- **Bundle → PDF** from both lenses.
- **Readings folder**, especially the **thumb-drive round trip** — whether a stored handle survives
  unplug/replug, or a remount at a different path, is untested. Folder-on-disk works.
- **The reading partner on a larger local model.** A 3B gives thin replies; that is the model, not
  the prompt. Re-judge before touching the prompt again. **Settings → AI → Local now lists whatever
  is installed**, so switching is a click — no endpoint to type.
- **Text selection in a reading**, since it was rebuilt: drag across several lines and check the
  band is continuous and stops where you released, that ⌘C matches the popup's ⧉ Copy, and that a
  downward drag never reaches up. Try it in a narrow window too — tolerances are proportional now,
  but that path is untested at small sizes.
- **Ollama from a hosted origin.** `OLLAMA_ORIGINS` is a machine setting on whatever runs Ollama,
  **not** app code: Ollama allows only local origins by default and refuses a call from an `https://`
  page at its end. Fedora: `sudo systemctl edit ollama` → `Environment="OLLAMA_ORIGINS=<origin>"` →
  restart. macOS: `launchctl setenv OLLAMA_ORIGINS "<origin>"` → restart Ollama. Also untested:
  whether `https:` → `http://localhost` hits mixed-content or private-network friction. **Test
  early** — the hosted-AI alternative needs only a key pasted into the browser, and no-AI mode
  always works.

## A note on what leaves the machine

The reading partner sends the quoted passage, the last few turns, and page ±1 of the open PDF to
whichever model is configured. On a local model that stays on the machine. On a hosted provider it
does not. The reflection partner likewise sends the gush text. Worth being explicit with students
about, and worth weighing when recommending a provider.

## ⚑ TWO-MACHINE TEST — the McGuffey run (2026-07-30)

First real cross-machine test. Nothing here has been tried outside one desktop. Build must
read **`2026-07-30-41`** on BOTH machines — check the badge bottom-right and hard-refresh if not.

**Before leaving (iMac, readings already loaded):**
1. Note whether the **📁 Use a readings folder** chip appears in the Readings shelf. Present =
   Chromium; absent = Firefox/Safari. Write down which, for both machines. This decides whether any
   folder-handle feature is worth building for students.
2. Make a highlight on a chapter and ask the reading partner one question, so there is something
   with a known right answer to check later.
3. Click **⤓ Save my work**. One zip: your work plus the reading files. Put it on a thumb drive or
   anywhere you like — it needs no account and no cloud. Note how long packing takes and how big the
   file is; if that is painful with all 27 chapters, say so and we will reconsider.

**At McGuffey:**
5. Open the app. It should be empty — new machine, new origin-and-profile, nothing carried.
6. **⤒ Open my file** → pick the **zip**. It reloads.
7. Check, in order:
   - the reading shelf lists your chapters **and they open** (bytes came out of the zip);
   - your **highlights are on the right passages** — this is the whole point of the filename-id
     change, and it is untested in the wild;
   - the reading-partner thread is there;
   - your notebook, One-Pagers and name came across;
   - the images inside any One-Pager survived.

**Bring back:** which browser each machine runs, whether the folder chip appeared, and anything
that landed in the wrong place. A highlight on the wrong passage is the single most useful bug.

## Verify after any merge between machines

Type in each tab → refresh → work persists. `⤓ Save my work` → reload → `⤒ Open my file`
round-trips. Load a folder of readings → the shelf lists them in order → select one and highlight a
multi-line passage. Export a One-Pager: two sheets, images intact, session record present.
Notebook → Bundle → PDF from both lenses. Confirm the build badge bottom-right matches the `?v=`
you deployed.
