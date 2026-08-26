# Journaler · TCE 284

**▶ Run the app → https://ohiomathteacher.github.io/journaler-284/**

That link is the working app. What you are reading is the source repository behind
it, which is why you are looking at a README rather than at Journaler.

A local-first **reading-and-writing** app for TCE 284, built around the 50-point
**Writer's Notebook**. Students write in it all term, keep the pages worth keeping,
and hand in one PDF at the end. No account, no backend, no upload: everything lives
in the browser's own storage on the student's machine.

---

## The five tabs

| | |
|---|---|
| **Tips** | Where the app opens. One short passage a day from *Bad Ideas About Writing* — a free book of 43 chapters, each taking apart one bad idea. The rail lists every class meeting this term. |
| **Notebook** | Everything kept, in four lenses: **By day**, **By piece**, **My Progress**, **Threads**. This is what gets bundled into the submitted PDF. |
| **Readings** | Open a chapter PDF, read closely, and mark passages — each kept with the book's own page number. Notes only; no AI in the margin. Readings come from the student's own files — the app does not host them. |
| **Freewrite** | The five One-Pagers (timed gush → shaped page), an open page for keeping the practice, and the four required notebook entries. |
| **Currere** | Four movements — go back, go forward, lay them side by side, put it back together. |

**My Progress** also sits in the top bar, because it is the one thing a student needs
from wherever they happen to be writing.

## How the notebook is scored

50 points, in four rows. These numbers are the handout's, not the app's, and they live
in exactly one place in `app.js` (`NB_TOTAL`, `ENTRIES_BANDS`, the `ap-rows` table).

| Row | Pts | What it counts |
|---|---|---|
| Kept practice | 20 | Every entry kept, from anywhere. 25+ full, 15–24 partial, under 15 none. |
| Required entries | 5 | Week 1 baseline · Currere work · Topic map · Source notes |
| Look-Back Letter | 10 | Written in the last class, back to the Week 1 answer. |
| Thinking on the page | 15 | Three flagged entries, one per act, and a written reading of a thread. |

Keeping a page **on its own required-entry page tags it in the same action** — there is
nothing to go back and label in December.

## Romano, the optional AI

Named for the book's author, and disclaimed as software wherever a student meets it.
Everything in the app works with the AI switched off, which is the default.

- **Local first** — Ollama, LM Studio, llama.cpp. Nothing leaves the machine.
- **Hosted** — Groq, Claude, Gemini, or a custom OpenAI-compatible endpoint, each with
  the student's own key.
- The gear in the top bar shows a green dot when a model is actually usable; a provider
  chosen without a key gets no dot, because it is not connected.
- Romano never sees the notebook unless a page is shared with him deliberately.

## Files

Not a single self-contained HTML file any more:

```
index.html      shell, top bar, modals, the ?v= cache buster
app.js          the whole app
app.css         the whole stylesheet
tips.js         GENERATED — one tip per class meeting
poems.js        GENERATED — the daily poem, no longer shown; kept for reuse
manual.html     the student manual
vendor/         pdf.js, mammoth, jszip
fonts/          self-hosted, so nothing is fetched at runtime
tools/          the generators and the curator (below)
```

⚠ **Bump `?v=` on both tags in `index.html` on every deploy** (the stylesheet and the
scripts). GitHub Pages will otherwise serve a stale `app.js` against a new `index.html`
and the change will simply not appear.

## Building the tips

`tips.js` is generated, never hand-edited. The text comes from **Bad Ideas About
Writing**, ed. Cheryl E. Ball and Drew M. Loewe (WVU Libraries, 2017), **CC BY-NC-ND
4.0** — which decides how this works:

- **BY** — every tip carries its author, its chapter, and a link to the book.
- **NC** — a course app is non-commercial.
- **ND** — passages are verbatim runs of whole sentences. Nothing is reworded or
  stitched. An elision must be declared in `tips-chosen.txt`, and the builder **stops**
  if the phrase no longer matches the source.

```
python3 tools/passages.py  ~/path/to/badideasaboutwriting-book.pdf   # the candidate pool
python3 tools/build-tips.py ../tce284-fa26                           # assign to meetings
```

`tips-chosen.txt` is the editorial control: chosen passages in order, `-` to veto a whole
chapter, `+` to favour an author. The builder also screens candidates that are
discouraging, that carry an unglossed acronym, that open on a list the reader cannot see,
or that are a linguistics lesson rather than a tip — but a word list cannot read tone, so:

```
xdg-open tools/curate.html      # Tips mode: → use · ← pass · V veto the chapter
```

The curator walks the pool one passage at a time and exports lines to paste straight into
`tips-chosen.txt`. It also has a **Poems** mode for `poems.js`, whose builders
(`tools/build-poems.py`, `tools/build-candidates.py`) read the course repo `tce284-fa26`
for session dates and daily poems.

## Run it locally

ES-module imports (pdf.js) need HTTP, not `file://`:

```
cd ~/Repos/journaler-284
python3 serve-nocache.py        # http://localhost:8000, caching disabled
```

`serve-nocache.py` exists because a normal static server plus a stale `?v=` produced
phantom bugs that were only ever the browser holding old JavaScript.

## Testing

`TESTING.md` is the device checklist. Boot checks pass on Gecko, Blink and WebKit on
Linux. **Every mobile row is still untested** — that is the open item, not a formality:
the writing surfaces fill the pane now, and a soft keyboard on a small screen is exactly
where that could turn out to be the wrong call.

## Licence

Code: see `LICENSE`. Tips are quoted from a CC BY-NC-ND work and carry their own
attribution; `poem-texts/README.md` explains, poem by poem, which texts may be
reproduced here and which may only be linked.
