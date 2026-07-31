# Journaler-284 — testing checklist

_The app runs on machines nobody here chose. This is the list to work through on each one.
Record results in the table below. Code-level tasks live in `NEXT-STEPS.md`; this file is
about what a real device does._

> **This repo is public.** Keep personal machines, local paths and course-internal detail out
> of it. Record *device classes* here, not whose laptop it was.

## How to run any of this

1. Open the app and check the **build badge, bottom right**. Every tester must be on the same
   build or the results are not comparable.
2. **Settings (gear) → Diagnostics → Copy.** That one paste answers most environment questions
   without anyone reading a console: build, storage against quota, secure context, folder-picker
   and clipboard availability, provider, and for an open reading the text-layer span count.
3. ⚠ **Snapshot with a reading page actually on screen** if you want the span count to mean
   anything. The count reads the live DOM. Before build `2026-07-31-70` it reported
   "no text layer (image-only PDF?)" when nothing was rendered, which blamed the file for the
   panel's blind spot and cost one session a detour.

## Status

Legend: **✓** verified · **✗** fails · **—** untested · **n/a** does not apply

| Device / browser | Boots | Edit-lock | Save→restore | Print to PDF | Reader render | Selection |
|---|---|---|---|---|---|---|
| Linux · Firefox 151 | ✓ | — | — | — | — | — |
| Linux · Chromium 148 | ✓ | — | — | — | — | — |
| Linux · Brave 148 | ✓ | — | — | — | — | — |
| Linux · GNOME Web 50.4 (WebKitGTK 2.52.3) | ✓ | — | — | — | — | — |
| macOS · Safari | — | — | — | — | — | — |
| macOS · Chrome | — | — | — | — | — | — |
| Windows · any | — | — | — | — | — | — |
| ChromeOS · Chrome | — | — | — | — | — | — |
| iPad · Safari | — | — | — | — | — | — |
| iPhone · Safari | — | — | — | — | — | — |

**Everything above the mobile rows is a boot check only.** Four green ticks in the first column
means the app loads and reports sane state on Gecko, Blink and WebKit. It says nothing yet about
the reader, the exports, or the lock.

## The five things, in order of what it costs to get them wrong

### 1. The edit-lock holds — the only graded integrity mechanism

The syllabus requires the five timed One-Pager drafts to happen in the app because the timer
locks editing while it runs. If the lock fails, the guarantee fails silently and invisibly.

- Start a One-Pager gush. Type a sentence. Press **Backspace**, then **Delete**.
- **PASS:** neither key removes text while the timer runs.
- **FAIL:** text deletes. Note the device and stop using it for graded drafts.
- ⚠ **The known risk is touch.** The lock is a `keydown` handler matching `Backspace`/`Delete`.
  Soft keyboards do not reliably emit those. **Untested and the highest-stakes unknown.**
- Also check **↺ Reset-clock** still works, and that the lock releases at the buzzer.

### 2. Work survives — including onto a second machine

- Type in each tab, refresh, confirm the work is still there.
- **⤓ Save my work** → reload → **⤒ Open my file** round-trips.
- **Cross-machine:** save on machine A, restore on machine B, then check **the highlights are on
  the right passages**. This is the proof of the filename-derived reading ids
  (`f:<name>` + `migrateReadingIds`) and it is **still outstanding**. A highlight on the wrong
  passage is the single most useful bug in this document.
- Note how long packing takes and how large the zip is with a full set of chapters aboard.
- **Safari and WebKit cannot report quota at all** — `navigator.storage.estimate` does not exist
  there. Build 70 says so out loud rather than dropping the line. Safari is also the most
  aggressive at evicting site data, so it is the platform where exporting matters most and
  warning is least possible.

### 3. Both turn-in artifacts print

Both go through the browser's own Save-as-PDF, so the print dialog genuinely differs per
platform. **A device that cannot do this cannot submit work**, however well the app runs on it.

- **Export One-Pager → PDF:** two sheets, images intact, the writing-session and AI-use record
  present as sheet two. It measures against one sheet and deliberately never auto-shrinks.
- **Bundle notebook → PDF** from **both** lenses (By day and By piece).

### 4. The reader renders and selects

- A chapter PDF renders, and `.docx` renders (mammoth).
- Numeric-sorted shelf, Single/Continuous toggle, the built-in manual as first-run reading.
- **Drag across eight lines.** PASS = eight continuous bands, stopping where you released, never
  reaching upward. Then check ⌘/Ctrl+C matches the popup's **⧉ Copy**.
- **Repeat in a narrow window.** Geometry tolerances are proportional to rendered text rather
  than fixed pixels, but the small-size path is untested.
- ⚠ **Touch is the known gap.** Selection is driven by `mousedown`/`mousemove`/`mouseup`
  (`_dragFrom`/`_dragTo`). There is **no touch or pointer-type handling anywhere in the
  codebase**. On a touch device the capture falls through to the DOM range, which
  `orderByReadingColumns` scrambles — so the expected failure is *wrong bands*, not *no bands*.
- Old highlights keep the rects they were saved with. When testing, **Remove and remake** rather
  than judging a band saved by an older build.

### 5. The AI path is reachable

- Settings → AI. **Local** auto-discovers on ports 8765 / 11434 / 1234 and lists installed models
  as tiles, probing both `127.0.0.1` and the serving host.
- **No local model is possible on a Chromebook, iPad or iPhone**, so those students need a hosted
  key or the no-AI path. Confirm **no-AI mode** leaves reader, gush, notebook and One-Pager fully
  usable.
- **Ollama from a hosted origin** needs `OLLAMA_ORIGINS` set on the machine running Ollama; it is
  a machine setting, not app code. Fedora: `sudo systemctl edit ollama` →
  `Environment="OLLAMA_ORIGINS=<origin>"` → restart. macOS: `launchctl setenv OLLAMA_ORIGINS
  "<origin>"` → restart. Also untested: whether `https:` → `http://localhost` hits mixed-content
  or private-network friction.
- The reading partner on a larger model. A 3B gives thin replies; that is the model, not the
  prompt. **Re-judge before touching the prompt again.**

## Environment findings so far (2026-07-31, build 69)

| | Firefox 151 | Chromium 148 | Brave 148 | GNOME Web 50.4 |
|---|---|---|---|---|
| Folder picker | no | **available** | no | no |
| Clipboard API | yes | yes | yes | yes |
| Secure context | yes | yes | yes | yes |
| Quota ceiling | 10 GB | 10 GB | 2 GB | **not reportable** |

- **`showDirectoryPicker` is Chromium-only and not even all of Chromium** — Brave disables the
  File System Access API by default. One browser in four. **The 📁 readings-folder chip can never
  be the primary way students carry chapters**; the save zip is the road, and it is already
  proven across machines. Do not spend time on folder-handle work before the term starts.
- **Brave caps storage at 2 GB** rather than 10 GB. Irrelevant in practice: the full 27-chapter
  corpus is about 9.5 MB. Worth knowing that quota is browser policy, not a constant.
- **A UA string will not tell you what a student is running.** GNOME Web 50.4 on WebKitGTK 2.52.3
  reports `AppleWebKit/605.1.15 Version/60.5 Safari/605.1.15`. The `605.1.15` is a frozen legacy
  token and `Version/60.5` is a compatibility fiction. Ask for the Diagnostics paste instead.
- **WebKitGTK is a good engine proxy for Safari and a poor platform proxy.** Same WebCore and
  JavaScriptCore, so rendering evidence carries over. But ITP eviction, iOS quota ceilings, touch
  selection and the Safari print dialog are Apple-specific and are not exercised by it.

## Still entirely unknown

- **Every mobile question.** No touch device has run this app.
- **Real Safari**, as opposed to WebKitGTK.
- **Windows and ChromeOS**, on which nothing has ever run. ChromeOS is *expected* to be fine —
  Blink with a keyboard, a trackpad and print-to-PDF clears every bar identified above — but that
  is reasoning, not a result.
- **A student.** All testing to date is one person. Run 3–5 testers through OP1 end to end before
  the term starts; that is the item the course notes have carried as first priority for a week.
