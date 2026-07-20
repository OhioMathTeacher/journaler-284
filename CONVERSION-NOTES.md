# journaler-284 — conversion state

Forked from `journaler` (the TCE 318P reading-journal app) on 2026-07-19.
**Right now this is still a 318P reading-journal with a 284 name.** Identity strings
(title, storage keys, file marker) were swapped; the app's *behavior* has NOT been
converted yet. Do not publish until the items below are done.

## Done
- Identity: `TCE 318P` → `TCE 284`, `cr318_` → `cr284_`, `journaler318` → `journaler284`.
- Fresh working copy, no git remote (won't push to the 318P repo by accident).

## To convert (the real work) — de-couple 318P, build 284

### De-couple the reading-course assumptions
- **PDF-only entry** — the paste/type path was removed for 318P. 284 is **freewrite-first**;
  a One-Pager has no assigned reading PDF. Restore/replace with a blank-entry start.
- **Reading-Homework / JSTOR workflow** — the onboarding instructions (open the sheet,
  follow the JSTOR link, download the article) are reading-course only. Remove.
- **Author-surname auto-detect + week-pooling** — matches PDFs against the 318P reading
  list and pools highlights across two-reading weeks. Irrelevant to 284. Remove.
- **"Reading Journal" print / "State my take"** — reframe to the 284 artifact.

### Build the 284 surface (does not exist anywhere yet)
> **Journaler comes online DAY 1 (decided 2026-07-20, supersedes the earlier "app-light Act I /
> wk4" plan).** The One-Pager timed drafts happen **in the app**, from the first week. The physical
> Writer's Notebook stays for the **daily free-writes** (Romano's "take up a pen" ethos); the app
> hosts the **OP drafts + AI reflection**. So the OP engine below is a **hard Aug-24 build target**,
> not wk4.

**The OP engine (the reusable flow every One-Pager runs through):**
1. **Gush mode — timed write, no editing.** A per-assignment timer (5 min for the Gush, 8 min for
   OP2–5). While it runs: **no backspace / delete / cursor-back** — the writer cannot fix anything.
   This enforces Romano ch2 ("don't let fear or doubt or standards stop the flow") in a way paper
   can't (paper still lets you cross out).
2. **Live session = the integrity guarantee.** Written in-app, timed, one sitting → this REPLACES
   "handwritten in ink" as proof the writing is the student's. No paste, no machine authorship; the
   captured session is the evidence. (This is now the genAI "human-first" mechanism for Act I.)
3. **AI reflection AFTER the buzzer** (NOT during — during would break the gush). Editing unlocks and
   a **reflection partner** asks 2–3 questions about the *experience* ("what surprised you? where did
   you speed up or stall? what showed up you didn't plan?"). It touches the experience, never the
   words. This is the Act I AI role (see below).
4. **Compose in place + export.** Keep the raw draft visible, build the one-pager around it (images/
   marks), export a **one-page PDF** or submit from the app.
5. **AI-use log** per piece → the disclosure artifact that travels with the turn-in.

- **Freewrite-first entry** (Elbow) as the primary flow. *(Needed for the OP engine, by Aug 24.)*
- **Genre-transform module** — recast the current buffer into a genre; before/after compare. *(Act III.)*
- **Generation Loss** — repeated same-genre transform compounds + decays. *(wk4 lab.)*

### Split Todd-in-the-Can into its three roles (currently 318P reading-partner ONLY)
- **Reflection partner** (Act I / One-Pagers): asks about the *experience* of the timed write AFTER
  the buffer; never writes or foils the student's words. *(Revises the earlier "Foil" role — the
  foil now lives only in the wk4 Generation Loss lab, not on every OP.)*
- **Studio tool** (Act II / currere): recast/explore; currere stays hand-written.
- **Reviser** (Act III / multigenre): strongest guardrails — closest to the 318P persona.

See `fall-2026/TCE-284/course-vision.md` for the design intent.
