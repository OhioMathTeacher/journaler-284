# journaler-284 and its 318P parent

This app was forked from `journaler` (the TCE 318P reading-journal) on **2026-07-19**. The
conversion that fork implied — freewrite-first entry, the gush engine, the One-Pager flow,
the AI roles, dropping the JSTOR/reading-homework workflow — **is done.** This file replaces
`CONVERSION-NOTES.md`, which outlived its usefulness and then lied: it still said *"Do not
publish until the items below are done"* for an app that had been live and shipping daily
since August.

So this file deliberately does **not** keep a checklist of what is built. Checklists of live
state rot. What follows is the part that stays true: how the two apps relate, and what that
means when you are tempted to copy something from one into the other.

`README.md` says what this app is and how to build, run and deploy it. Go there first.
Course intent lives in `fall-2026/TCE-284/course-vision.md`.

## They share ancestry, not code

Both are local-only: no server, no account, work kept in the browser. Both warn about Safari's
seven-day storage sweep and point at Add to Home Screen. Both have a backup file and a restore
path, a nag system, a diagnostics report, a build badge and an update check.

Underneath, they have almost nothing in common any more.

|  | journaler (318P) | journaler-284 |
|---|---|---|
| Shape | one `index.html`, ~8,000 lines | `index.html` + `app.js` / `app.css` / `readings.js` / `tips.js` |
| Scope | top-level functions | one big IIFE |
| Storage | ~19 flat `cr_*` keys | one `DB` object in `cr284_state`, written by `saveDB()` |
| Archive | `.json` | `.zip` |
| Cache busting | none on the page itself | `?v=` on all four asset tags, bumped every deploy |

As of 2026-10-11 exactly four function names exist in both: `saveWork`, `reportDigest`,
`checkForUpdate`, `applyUpdate`.

**So code does not port between them.** A fix in one is a reimplementation in the other, not
a copy-paste. Budget accordingly — and check first whether the problem even exists here,
because often it does not.

## Where 284 is ahead — do not "port back" into these

These are better here than in 318P. If you are harmonising the two, move 318P toward this
side, not the other way.

- **`nagAction()` opens the thing it is nagging about** — Settings → My work, with
  `#saveWorkBtn` focused. 318P names a button in prose instead, and on 2026-10-11 that cost
  it a real bug: its alert said "⤓ in the top bar" when the top-bar ⤓ downloads the article
  PDF. Naming a control in prose is a bug waiting to happen; opening it cannot drift.
- **`WEBKIT_SWEEPS` tests the engine, not the brand**, and excludes standalone. Chrome and
  Edge on iOS are Safari underneath and get swept the same way.
- **`nagIfWebView` / `webviewWarn`** handle Canvas-style in-app browsers, on boot and at the
  moment of failure. 318P has no concept of this at all.
- **The About → "Keeping your work" pane** gives per-platform install steps and already warns
  that the Home Screen copy starts with its own empty storage.
- **Ranked nags and per-kind snooze** (2026-10-11). One banner slot, explicit priority
  `webview 1, sweep 2, backup 3, update 4`, and one ✕ no longer silences an unrelated message.
- **A boot-time update check** (2026-10-11). See below — this one is load-bearing.

## Where 284 is behind

- **`navigator.storage.persist()` is never called.** 318P now asks, behind a click. Measured
  2026-10-11: Safari denies this in a tab and **grants it to a Home Screen app**; Firefox
  prompts; Chromium denies on a cold profile. Since most students will not install, this is
  worth little here — but `isStandalone()` already exists, so asking automatically when
  installed is about ten lines whenever it is wanted.
- **Nothing says that deleting the Home Screen icon deletes the work behind it.** 318P says it
  in three places. Every path in this app pushes toward installing, and installing is exactly
  what makes a deletable icon the only copy.

## Two traps that cost real time

**A stale `index.html` pins a stale `app.js`.** The `?v=` tag lives *inside* the page the
cache is holding, so the whole app freezes as a set. Pages sends `max-age=600` and Safari
honours it for far longer — Todd ran 318P build 54 for a month while 60 was published. This
is why `checkForUpdate` now runs at boot rather than only when someone opens Diagnostics, and
why `README.md` insists you bump all four `?v=` tags on every deploy. A fix that does not
reach a cached browser is not shipped.

**An installed app opens empty.** iOS gives a Home Screen app its own storage container, so
work written in Safari is not there. The About pane says so. It did not help: on 2026-10-11
Todd hit this himself, having written that warning, and it still read as total data loss.
Treat prose warnings as insufficient for this case — the app should notice it has zero work in
a standalone session and offer **⤒ Open my file** on the spot.

## Verify, do not trust this file

Anything here that could drift, check instead:

```bash
# what is actually published
curl -s https://ohiomathteacher.github.io/journaler-284/ | grep -o 'app.js?v=[0-9-]*'

# what the working tree would publish
grep -o '?v=[0-9-]*' index.html | sort -u

# does this app call the storage API at all yet?
grep -c 'storage\.persist' app.js

# the full suite the pre-push hook runs
python3 tools/probes/run.py
```
