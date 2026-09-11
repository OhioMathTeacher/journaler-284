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
| iPad · Safari | ✓ | ✓ keys · ✗→fixed dictation | ✓ save · — restore | — | ✓ | ✓ |
| iPhone · Safari | — | — | — | — | — | — |
| Android 14 tablet · Chrome 113 (emulator) | ✓ | — | ✓ save · — restore | ✗→fixed | — | — |
| Android 14 phone · Chrome 113 (emulator) | ✓ | — | ✓ save · — restore | ✓ report only | — | — |
| Android · inside the Canvas app | ✓ | — | ✗ | ✗ | — | — |

**The Linux rows are a boot check only.** Four green ticks in the first column means the app
loads and reports sane state on Gecko, Blink and WebKit. It says nothing about the reader, the
exports, or the lock on those machines.

**iPad is the exception, and it is the device with real hours on it** (2026-09-08): chapters
read, passages marked and the marks recovered intact from an export, focus mode entered and —
eventually — left. Two of its cells stay open on purpose:

* **Edit-lock — tested 2026-09-08, and it FAILED.** The soft keyboard's delete key was
  refused correctly. Dictation was not: Todd, on the device, "I am able to delete the gush
  when it's dictated." Dictation emits no key events at all, and the lock was one `keydown`
  handler. Fixed in `2026-09-08-251` by guarding `beforeinput`, which fires for every
  mutation whatever produced it — that also closes autocorrect, ⌘Z, cut and drag, none of
  which had ever been blocked either. `tools/probes/run.py lock` covers all of it, but the
  FIX itself has only been verified in Chromium; **re-test dictation on the device.**
* **Restore INTO an iPad — untested.** Saving *from* one is verified, and had two bugs found in
  it the same day (see below), so the round trip is only half proven. `⤒ Open my file` also
  changed shape in `2026-09-08-245`: it offers to ADD rather than replace, and that path has
  never run on a touch device.

⚠ **Re-test iPad saving on `2026-09-08-245` or later.** Before it, every file this app handed an
iPad was named after the blob's UUID rather than dated, and four of the five download paths
revoked the object URL on the statement after `click()` — a race that on iOS Safari lands an
empty file. Any earlier "save works on iPad" result was measuring a different app.

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

## Android (2026-09-11, emulator: Pixel Tablet and Pixel 7 profiles, Android 14, Chrome 113)

Prompted by a student whose Android tablet "could not print or download anything, not even a
diagnostic report". Two separate causes, both now handled in code.

- **Every PDF export printed the app, not the document — on every Android browser.** On
  Android, `window.print()` hands the page to the system print dialog and RETURNS while that
  dialog is still open, and `afterprint` fires at that same moment (~2.7 s in), before a single
  page has been rendered; the dialog renders lazily after that and again when the reader taps
  Save. `printDoc` tore its host down on `afterprint`, so the preview was the nav bar, the
  Progress tab and the backup toast. **Fixed in `2026-09-11-253`:** the host lives until the
  first touch or key after `print()` returns (nothing the page can observe says when that dialog
  closes — visibility never changes, there is no blur/focus). Verified: the bundle prints all
  its parts and files as `Writer's Notebook — TCE 284.pdf`. The diagnostics report was never
  affected (its page is static), which is why it printed when nothing else would.
- **A link tapped inside the Canvas app opens in the app's own embedded page (a WebView),
  not Chrome.** A WebView cannot download a `blob:`, cannot print, cannot open a window, and
  keeps storage of its own. The student's "nothing works" was this. `2026-09-11-253` detects it
  (UA `; wv)` / `Version/x.y … Chrome/` / `candroid`; on iOS, no `Safari/` token), shows a
  banner with an *Open in Chrome* action (`intent://…;package=com.android.chrome;end`), refuses
  to record a backup that the host would have swallowed, and reports it in Diagnostics as
  **In-app browser: YES**. The detection is verified against a spoofed UA only — **no real
  Canvas-app session has run yet.** Ask the next Android student for a Diagnostics paste from
  inside Canvas.
- **pdf.js 6.0.227 wants a 2025 browser, and the reader died on anything older.** On the
  emulator's Chrome 113 every PDF was "Could not render this PDF · Promise.withResolvers is
  not a function"; with that patched, the worker handshake failed on `Promise.try` (Chrome
  128 / Safari 18.2 / Firefox 134) and pdf.js fell back to a main-thread worker whose path
  resolved to `vendor/vendor/`; with THAT patched, pages rendered with no words at all
  because the worker stopped at the first font on `Math.sumPrecise` (Chrome 141) and
  `ArrayBuffer.transferToFixedLength` (Chrome 114) — silently, the operator list just
  ended at `beginText`. Seven polyfills now live in `vendor/pdf-compat.mjs` (loaded on
  both threads) and `workerSrc` is absolute; verified on Chrome 113 with the manual and
  three course chapters, and unchanged on desktop Chromium via `run.py pages`. Real
  casualties before `2026-09-11-254`: any iPad on iPadOS 17 or earlier, a Galaxy tablet on
  Samsung Internet ≤ 27, any Chrome older than mid-2025. **To find the next one:** import
  `vendor/pdf.worker.compat.mjs` on the main thread before `getDocument` — pdf.js then runs
  the worker in-page and the TypeErrors surface as console warnings instead of a blank page.
- **Downloads in real Chrome just work,** phone and tablet: no dialog, a "File downloaded"
  card under the address bar, file in `Files → Downloads` under its dated name. The card shows
  the blob URL rather than the filename, which is Chrome's doing.
- **Print dialog on Android is one tap longer than anywhere else:** it opens on "Select a
  printer" with nothing chosen; *Save as PDF* is in that dropdown, then the round PDF button,
  then Save. Tell students.
- **Chrome silently ignores `window.print()` while an earlier print job is still pending** (a
  dialog backgrounded and forgotten). Not our bug, but it will look like "the button does
  nothing"; the cure is to finish or cancel the old dialog.
- **Untested on Android:** restore into it, the reader, selection, the edit-lock, Samsung
  Internet (the default on Galaxy tablets — Chromium, so the print fix should carry), and the
  installed (home-screen) app: the emulator cannot mint a WebAPK without a Google account.

**Reproducing on a Mac:** `brew install openjdk@17 && brew install --cask android-commandlinetools`,
then `sdkmanager --install platform-tools emulator "system-images;android-34;google_apis_playstore;arm64-v8a"`,
`avdmanager create avd -n tab -k "system-images;android-34;google_apis_playstore;arm64-v8a" -d pixel_tablet`,
`emulator -avd tab`. Serve the repo with `serve-nocache.py`, `adb reverse tcp:8000 tcp:8000`,
and open `http://localhost:8000/` in the emulator's Chrome. `adb forward tcp:9222
localabstract:chrome_devtools_remote` exposes DevTools at `localhost:9222/json` for driving
the page and reading its console; `adb exec-out screencap -p > shot.png` for screenshots.

## Still entirely unknown

- **Every mobile question beyond the iPad and the Android emulator above.**
- **Real Safari**, as opposed to WebKitGTK.
- **Windows and ChromeOS**, on which nothing has ever run. ChromeOS is *expected* to be fine —
  Blink with a keyboard, a trackpad and print-to-PDF clears every bar identified above — but that
  is reasoning, not a result.
- **A student.** All testing to date is one person. Run 3–5 testers through OP1 end to end before
  the term starts; that is the item the course notes have carried as first priority for a week.
