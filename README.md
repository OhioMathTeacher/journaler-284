# Journaler · TCE 284

**▶ Run the app → https://ohiomathteacher.github.io/journaler-284/**

That link is the working app. What you are reading now is only the source
repository behind it, which is why you are looking at a README rather than
at Journaler.

A local-first **reading-and-writing** app for the TCE 284 Reading Journal. Open a
course article PDF, read it closely, think in the margins with an AI partner, and
keep a **dated journal** across the semester — then export the whole journal as **one
PDF** to submit. No account, no backend; your reading and writing stay in your browser.

_**Journaler** is this course's app: a close-reader (read + annotate + ask-AI) fused with
a dated journal you submit as one PDF. Its reader engine originated in a separate
close-reader experiment (`close-reader.html`); Journaler is its own thing now, tracked
here and named consistently as **Journaler**._

## What a student does
1. **Get the reading.** Follow the JSTOR link on that week's *Reading Homework* sheet
   and download the article PDF through Miami's library. (Readings live with the
   assignment — the app doesn't host or re-list them.)
2. **Open it here.** *Open article* → choose the PDF; it renders on the left to read.
3. **Think in the margins.** Select any passage to ask **Socrates** (a Socratic thinking
   partner about the reading); notes save beside the text.
4. **Write the entry.** Open the **Notebook** and write that week's **dated** journal
   entry, using the prompt on the Reading Homework sheet. **Elbow** (optional) responds
   to your own writing to keep you going.
5. **Turn it in.** At the end of Act I, **Print / PDF** exports the whole journal —
   every dated entry, grouped by reading — as one file to submit (50 pts).

## Notes for this build
- **Bring-your-own-PDF.** No built-in library; readings open from the student's own
  files. JSTOR auto-fetch isn't possible (it needs the student's Miami login), so the
  flow is download-then-open.
- **Calendar** is scoped to the fall semester, **August–December 2026**.
- **AI is optional and local-first.** With Ollama running it auto-connects; otherwise
  the reader + journal work fully without AI. Nothing you write is uploaded, and the AI
  never sees your Notebook unless you share a page.
- **English-only, single self-contained `index.html`** (+ `vendor/` for pdf.js, mammoth,
  jszip and `fonts/`). Vanilla JS, no build step. Serve statically.

## Run it
ES-module imports (pdf.js) need HTTP, not `file://`:

```
cd ~/Repos/journaler
python3 -m http.server 8000
# open http://localhost:8000
```

## Open design question
The 284 Reading Journal assignment collects the **five dated weekly entries**. Journaler's
original spec also imagined a required **capstone meta-reflection** on the whole corpus.
That isn't in the current assignment, so it isn't built — add it only if the assignment
gains a capstone. See the course design notes.
