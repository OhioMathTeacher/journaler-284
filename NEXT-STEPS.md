# Journaler-284 — next steps

_App/code task list. Update it as things get done; history is in `git log`._

> **This repo is public** so GitHub Pages can serve the app. Course-internal material — the
> readings pipeline, distribution, machines, local paths — lives in the private planning repo,
> **not here**. Keep it that way when adding notes.

Last updated: 2026-07-29. **Build/version lives in `index.html`** as `?v=` on the `app.css` and
`app.js` tags (currently `2026-07-29-18`); `app.js` reads it back off its own `src` for the badge
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
- **Save / restore** — `⤓ Save my work` writes the whole DB as one file; `⤒ Open my file` restores
  it on any machine or origin.

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
- **Relink orphaned readings.** Readings loaded through the `＋ Load` pickers get random ids, so
  highlights and Q&A saved against them cannot reattach after a restore or a move to a folder-backed
  shelf. The data survives in the export, it just has nothing to render against, and there is no
  "relink this reading to a file" action. A one-time migration re-keying by filename onto
  `d:<filename>` would fix it.
- Optional: route Open-page free-writes into the Notebook, dated.

## Needs testing in a browser (nothing blocks on code)

- **Bundle → PDF** from both lenses.
- **Readings folder**, especially the **thumb-drive round trip** — whether a stored handle survives
  unplug/replug, or a remount at a different path, is untested. Folder-on-disk works.
- **The reading partner on a larger local model.** A 3B gives thin replies; that is the model, not
  the prompt. Re-judge before touching the prompt again.
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

## Verify after any merge between machines

Type in each tab → refresh → work persists. `⤓ Save my work` → reload → `⤒ Open my file`
round-trips. Load a folder of readings → the shelf lists them in order → select one and highlight a
multi-line passage. Export a One-Pager: two sheets, images intact, session record present.
Notebook → Bundle → PDF from both lenses. Confirm the build badge bottom-right matches the `?v=`
you deployed.
