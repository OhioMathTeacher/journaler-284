# Next steps — from the session of 22–23 August 2026

Written at the end of a long night, while it is all still known. Everything below is
either measured on ToddGPT or read out of this repo; where something is an estimate it
says so.

---

## ⚠️ Do these first

**1. Two placeholders ship visible to students.** Both are in `app.js`, marked `⚠️ TODD`,
and both will render verbatim in the app:

```js
const ANSWER_WHO_SEES_THIS = '[PLACEHOLDER — Todd, write the true answer: who can see
  journaler entries, whether this is graded, and how long it is kept.]';
const ANSWER_IF_STRUGGLING = '[PLACEHOLDER — Todd, name a human: your office hours, the
  counselling service, whoever a student in trouble should actually be pointed toward.]';
```

They exist because the model **invented** a privacy guarantee when asked
*"is Dr. Edwards going to read what I type in here?"* — it answered *"Dr. Edwards will
never read your typing here, and that is exactly why you should feel safe."* Nobody
authorised that, and the One-Pager session record suggests it is false. Questions
matching `INTERCEPTS` now never reach the model; they return these strings instead. So
the mechanism is right and only the text is missing.

**2. Rotate the Groq API key.** It was found in CopyQ clipboard history at index 137 —
i.e. from well before this session. Cleaned from history and disk, but cleanup cannot
un-expose a secret. See `linux-setup/docs/maintenance/secrets-in-the-clipboard.md`.

**3. Bump `?v=` on every deploy.** Both tags in `index.html` (line 15 and line 200). The
push earlier tonight went out with the old `2026-08-17-93`, so GitHub Pages very likely
served stale CSS/JS and none of the work was visible on the live site. Now at
`2026-08-23-94`.

---

## What changed, and what measurement drove it

### The local model returned nothing at all

Qwen3.5 is a reasoning model. Through `/v1/chat/completions` Ollama puts the reasoning in
a separate field, spends the whole `max_tokens` budget there, and returns `content: ""`
with `finish_reason: "length"`.

| path | result |
|---|---|
| `/v1` + `max_tokens: 700` | 700 tokens, **empty string** — on `qwen3.5:9b` *and* `:4b` |
| `/v1` + `chat_template_kwargs` | ignored, still empty |
| `/v1` + `/no_think` in prompt | ignored, still empty |
| **`/api/chat` + `think: false`** | **28 tokens, correct reply, 0.27 s** |

`Modelfile` cannot fix it: `PARAMETER think` is not valid in Ollama 0.32.15 — `think` is
an API field on `/api/chat` and `/api/generate` only. So `callModel`'s local branch tries
Ollama natively first and falls through to `/v1` unchanged, which keeps LM Studio (:1234)
and llama.cpp working.

**Groq is unaffected** — `openai/gpt-oss-120b` is also a reasoning model but returns
content normally. Worth re-checking if replies ever come back blank in class.

### The persona: what held and what never did

Eleven revisions, measured against a fixed set of student-shaped questions.

- **Voice and stance held.** Biography + convictions + curriculum layers produced varied,
  well-aimed replies. The single best input was Todd's own example reply, which taught
  the model to locate difficulty in the student's *history* rather than their character.
- **Length and "do not end with a question" never held**, at any wording. The shipped
  persona ended on a question in **6 of 6** cases; the rewrite got that to **0 of 6**,
  but only because the check moved into code.
- Sampling (`temperature` 1.0→0.4, `presence_penalty` 1.5→0) did **not** reliably fix
  length. Case-to-case variance exceeded setting-to-setting variance.

So mechanical rules live in the harness now: retry over three sentences (a *shortening*,
never a truncation), drop a trailing question by whole sentences, guard the phrasing that
reads as agreeing the student is not a writer, intercept questions about who can see this.

### Model bake-off

All five judged on the same five student inputs, same persona.

| model | ≤2 sentences | asks back | co-resides with 27B | works unpatched via `/v1` |
|---|---|---|---|---|
| **qwen3.5:9b + think:false** | 5/5 | 5/5 | ✅ 4.1 GB spare | ❌ needs the patch |
| qwen3.5:4b + think:false | 5/5 | 5/5 | ✅ | ❌ |
| gemma3:4b | 4/5 | 5/5 | ✅ 5.5 GB spare | ✅ |
| gemma3:12b | 5/5 | 5/5 | ❌ **evicts the 27B** | ✅ |
| mistral:7b | **0/5** | 3/5 | ✅ | ✅ |

`qwen3.5:9b` chosen: best writing, and the only model that reliably obeyed persona
changes (the 4B drifted back to habit). Gemma's KV runs ~158–257 KiB/token against
Qwen's 32, which is why the 12B cannot co-reside.

⚠️ **03-open-decisions.md still recommends `qwen3.5:4b`, and 00/02/05 still name it.**
Those four docs disagree with 06-model-sizing.md, which is the one that did the
measuring. **Reconcile them.** Also: 03 records the 4B answering a validity question
with a bare "No" — that does **not** reproduce with `think: false`, so it was a
thinking-mode artifact, not a model limitation.

### Load: 30 students, 1,261 replies, zero errors

Simulated against journaler's real request shape (one flattened user message, thread
resent each turn, `max_tokens: 700`), at 8× compression — i.e. **harder than a real
class**.

| | `NUM_PARALLEL=4` |
|---|---|
| latency p50 | 2.2 s |
| latency p95 | 4.7 s |
| median prompt | 1,693 tok |
| median reply | 41 tok |
| input:output | 37:1 |

**Context stays small.** An 80-minute session peaked at **2,086 tokens**, not the
7K–25K estimated — because the persona caps replies at two or three sentences. 8K
`num_ctx` is ample; 16K is generous.

⚠️ **All latency figures are server-side, over loopback.** They exclude campus VPN and
wifi. Our own tailnet path relays through DERP at ~52 ms. To get a real number, run
`sim-class.py` from a laptop over the campus VPN — which also answers IT's question #2
(*can a Hamilton client reach McGuffey Hall at all*).

### ToddGPT configuration (persistent)

`/etc/systemd/system/ollama.service.d/serving.conf`, applied 2026-08-23:

```ini
[Service]
Environment="OLLAMA_NUM_PARALLEL=10"
Environment="OLLAMA_KV_CACHE_TYPE=q8_0"
Environment="OLLAMA_KEEP_ALIVE=-1"
```

With both models pinned: **27,526 MiB of 32,607** idle, **28,102 MiB under load**, both
`100% GPU`, no eviction — `q8_0` gave back ~900 MB versus fp16. This is the co-residency
06-model-sizing.md listed as untested.

Also removed `11434/tcp`, `32400/tcp`, `1900/udp` from the `public` firewall zone after
verifying nothing answered on `10.38.2.24`.

---

## Still open

**Blocking a student-ready build**
- [ ] Fill in the two placeholder strings
- [ ] Decide whether kept exchanges should appear in the printed bundle or notebook only

**The app**
- [ ] **Few-shot leakage** — replies sometimes recite the persona's example verbatim
      ("The first line only has to exist, not be good"). Seen in the live app.
- [ ] **The flip case is unsolved.** `"lol ok whatever you say"` got a serious analytical
      reply from *every one* of the eleven persona revisions. Needs an example in Todd's
      voice; no prompt written by Claude fixed it.
- [ ] Jump to the notebook entry after ✎ Keep, or make the toast a link — undecided
- [ ] The One-Pager AI-use line still reads *"supplied none of the words"*. True for
      One-Pagers; revisit if the reflection partner starts engaging content (below).

**The reflection partner** — Todd wants it to acknowledge what a student wrote, not only
ask about pacing. Note that the **current** prompt already breaks its own rule: told the
text is shared *"ONLY so you can sense energy and pacing"*, it produced *"the momentum
shift between keeping the old street and losing it to school"*. Three variants were
drafted and compared (`/tmp/reflect.py` on ToddGPT). Engaging content is generative, so
`app.js:3667`'s provenance sentence must change with it.

**ToddGPT**
- [ ] Re-run the 30-student sim at `NUM_PARALLEL=10` and record it in 06-model-sizing.md
- [ ] Reconcile the 4B/9B split across 00, 02, 03, 05
- [ ] `ollama rm gemma3:12b gemma3:4b mistral:7b` frees 15.8 GB (bake-off losers)
- [ ] Retention: **65 of 67 chats are past the stated 105-day policy** and
      `purge_student_chats.sh` has run once, in February, with no timer. 03 calls this
      "the one an IT reviewer would find."

**Naming** — settled on **Romano** everywhere, via `AI_NAME` / `AI_TAG` in `app.js`.
"ToddGPT" was rejected: Todd's name on the replies implies he reads what students write,
and the notebook is the one place nothing is graded. A disclaimer now appears where
students meet it: *"Romano is the app's reading partner, named for the book's author. It
is software, and its answers are its own."*

---

## Scripts on ToddGPT (`/tmp`, will not survive a reboot)

| file | what it does |
|---|---|
| `sim-class.py` | N students × M simulated minutes against journaler's real request shape |
| `bakeoff.py` / `bakeoff2.py` | same prompts across models, via `/v1` and via `think:false` |
| `v9.py` / `v10.py` | persona variants with sermon/repetition detectors |
| `v8.py` | evaluator-voice detectors (praise-as-grade, verdict, command, trailing question) |
| `reflect.py` | the three reflection-partner variants |
| `bench-9b.sh` | generation speed, prefill cost, concurrency, co-residency |

**Copy these into `linux-setup/scripts/` before the box is rebooted** — they are the only
record of how any of the numbers above were produced.
