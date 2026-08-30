# Probes — driving the real app to see what it actually does

```
python3 tools/probes/run.py          # both suites, ~2 minutes
python3 tools/probes/run.py undo     # deletes, the undo offer, the toast layer
python3 tools/probes/run.py pages    # page eviction, note anchoring, canvas memory
```

Needs `python3` and a `chromium`/`chrome` on `PATH`. Nothing else — no npm, no Playwright,
no packages. Exit code is the number of failed checks, so it works as a gate.

The probe page **is `index.html`** with one `<script>` tag added. Nothing is stubbed and
nothing is reimplemented: a suite that tests a copy of the app tests the copy.

Everything generated (`_p_undo.html`, `_p_pages.html`, `_p_probe.pdf`) is written to the
repo root, gitignored, and deleted when the run ends. Only the sources here are kept.

## ⚠ REAL TIME. Never `--virtual-time-budget`

`--virtual-time-budget=N` runs headless Chrome on a fake clock: timers fire as soon as the
browser has nothing queued, and the clock jumps forward. It is wonderful for a test that
*waits on a timer* — the undo suite sits still for 6.5 seconds to prove the offer does not
expire, and under virtual time that costs microseconds.

It is **wrong** for a test that waits on real work, and it fails silently rather than
loudly. Virtual time accounts for timers and pauses for pending network fetches. It knows
nothing about a **Web Worker**. pdf.js parses documents in one, so the main thread has
nothing to do, Chrome sees an idle renderer, and the clock races ahead of the parse. A
polling loop nominally willing to wait 30 seconds burns all 30 in a few real milliseconds.
Every assertion then runs against a pane still reading `Loading…`, with **no error
anywhere**, because nothing has actually failed — the harness simply stopped waiting.

That cost a run on 2026-08-30. The same code passed 29/29 the moment the flag came off.

**The rule:** virtual time when the thing you are waiting for is a timer; real time when it
is real work — workers, canvas rasterization, image decode, IndexedDB with real bytes.
Anything touching pdf.js is the second kind.

`run.py` therefore uses one mechanism for both suites: real clock, no virtual-time flag,
and results come back by `POST` to a small server instead of `--dump-dom`.

## What each suite pins down

Both are written against things Todd has said in so many words, and both seed the browser
and reload, because the app reads its DB once at boot.

**`undo`** (`driver-undo.js`) — *"I just don't want them to delete the wrong thing on
accident and not be able to get back."*

- a deletion offers itself back, and the offer has **no timer**: it is still standing, with
  its Undo, after 6.5 seconds
- Undo restores the page **in its original position**, with its text, tags and threads
- both entry points — the row's trash icon and the Delete inside the entry editor
- a second deletion does **not** silently commit the first
- an ordinary receipt (`Tagged: …`) cannot take a standing offer away with it
- and receipts still fade on their own when nothing is pending

**`pages`** (`driver-pages.js`) — *"We can't have notes disappearing while students are
reading a long document."*

Builds a 30-page chapter (`make-pdf.py`, hand-rolled so there are no dependencies), puts 12
highlights down it, scrolls it end to end in 24 steps and back, then switches page modes.

- **every `.pdf-page` div is present at all times** — the constraint that ruled out
  virtualising by removing them
- **no card is ever orphaned**, and every card stays within 2px of its band the whole way
- bands never leave the page, drawn or not: they come from the DB, not the canvas
- canvases **plateau** instead of climbing, and are released along with their text layers
- pages redraw on the way back up, and single/two-page mode still works

### Two traps worth keeping in mind if you extend these

- **`getBoundingClientRect()` reports layout position and ignores ancestor clipping.** A
  *visibility* check must intersect the rect with its clipping surface or it will pass
  against a visibly broken layout. (The drift check here compares two rects to each other,
  which is safe.)
- **Which element scrolls is not fixed.** `#docPane` has `overflow-y:auto`, but at page zoom
  it scrolls by 0px and the document scrolls instead. `scroller()` asks rather than assumes.

### Known limits

Chromium only, at whatever `devicePixelRatio` the headless window reports (1 by default, so
the memory figures are a **ratio**, not Todd's absolute numbers at `dpr 2`). The probe
chapter is born-digital with 30 uniform pages — not a real scan, no mixed page sizes. The
`undo` suite dates its seed to **today** and the notebook calendar only spans the term
(Jul–Dec 2026), so outside that window `A2` fails and says why.
