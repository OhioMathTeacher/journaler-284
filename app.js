/* Journaler-284 — app.js  (classic script; inline on* handlers need globals)
 * Assembled from the prototype shell + the 318P AI subsystem. Edit here, then
 * `node --check app.js` before shipping (port lesson: a stray smart-quote once
 * blanked the whole app). */

// Build stamp — READ FROM THE ?v= ON THIS SCRIPT'S OWN URL (set in index.html), so
// what the badge shows is provably the file the browser actually loaded rather than
// a constant that can disagree with it.
//
// Bump ?v= in index.html on every shipped change. On GitHub Pages that query string
// is what stops a cached app.js/app.css being served after a deploy — the stale-JS
// class of "phantom bug" this stamp exists to catch. Forget to bump it and the old
// value stays visible in the corner, which is the point: it tells on itself.
//
// Old highlights keep the rects they were SAVED with, so re-test with a FRESH one.
const BUILD = (function(){
  try {
    const s = document.currentScript;
    if(s && s.src){ const v = new URL(s.src, location.href).searchParams.get('v'); if(v) return v; }
  } catch(e){}
  return 'dev (no ?v=)';
})();
(function showBuildTag(){
  function paint(){
    try { console.log('%cJournaler build: ' + BUILD, 'color:#c69a5c;font-weight:bold'); } catch(e){}
    if(document.getElementById('buildTag')) return;
    const b = document.createElement('div');
    b.id = 'buildTag'; b.textContent = 'build ' + BUILD;
    b.title = 'Journaler build (hover to confirm the loaded code version)';
    b.style.cssText = 'position:fixed;bottom:6px;right:8px;z-index:3000;font:11px/1.4 ui-monospace,monospace;color:#8a8175;background:rgba(250,247,240,.82);border:1px solid rgba(0,0,0,.08);padding:2px 7px;border-radius:6px;pointer-events:none';
    document.body.appendChild(b);
  }
  if(document.readyState !== 'loading') paint(); else window.addEventListener('DOMContentLoaded', paint);
})();

// ===== AI provider subsystem (harvested from 318P source) =====
const PROVIDER_KEY  = 'cr_provider';
const ANTHROPIC_KEY = 'cr_anthropic_key';
const GEMINI_KEY    = 'cr_gemini_key';
const GROQ_KEY      = 'cr_groq_key';
const CUSTOM_KEY = 'cr_custom_key';
const CUSTOM_ENDPOINT_KEY = 'cr_custom_endpoint';
const CUSTOM_MODEL_KEY = 'cr_custom_model';
const LOCAL_ENDPOINT_KEY = 'cr_local_endpoint';
const LOCAL_MODEL_KEY    = 'cr_local_model';
// Optional. Empty for an ordinary local model on this machine -- Ollama on
// localhost wants no credentials and never will. It exists for the one case
// that cannot work without it: a local model reached over the network through
// an authenticating proxy, which is the only way to serve ToddGPT's models to
// a class without publishing free inference to the internet. See
// linux-setup/caddy/ollama-proxy.Caddyfile.
const LOCAL_KEY          = 'cr_local_key';
const GROQ_MODEL_KEY     = 'cr_groq_model';

function getProvider() { return localStorage.getItem(PROVIDER_KEY) || 'none'; }

// ── Groq model resolution.
//
// Groq retires models on a rolling schedule. The id used to be hardcoded in the request,
// which meant the day it was decommissioned EVERY student broke at once, mid-class, with a
// raw `Groq API error 400`. Nobody would have a fix in the room. So: keep a default, and
// when the API says the model is gone, ask what is live now, remember it, and carry on.
//
// This matters more here than it would elsewhere because Groq is the recommended provider
// for the course — university Gemini issues no API keys, and Groq needs no Google account.
// Refreshed 17 Aug 2026: every model previously listed here had been retired.
// llama-3.3-70b-versatile and llama-3.1-8b-instant ended 16 Aug 2026, and the
// 3.1-70b and llama3-70b-8192 ids went earlier. The recovery below did its job
// -- this list going stale costs a round trip, not a broken class -- but with
// Groq the recommended provider for this course, the default should be live.
const GROQ_MODEL_DEFAULT = 'openai/gpt-oss-120b';
// Tried in this order when we have to go looking. Anything not listed is still eligible
// via the score below, so a model that does not exist yet can still be chosen.
const GROQ_PREFERRED = ['openai/gpt-oss-120b', 'qwen/qwen3.6-27b', 'openai/gpt-oss-20b'];
function getGroqModel() { return localStorage.getItem(GROQ_MODEL_KEY) || GROQ_MODEL_DEFAULT; }

// One budget for every provider, so the five call sites below cannot drift apart.
// It was 200, which is roughly two sentences and left Romano cut off mid-word on
// any reply that ran a little long -- what the reader saw was "I sure can. What'".
// The prompt, not the budget, is what keeps him brief; this is only the ceiling
// he must never hit, because hitting it truncates rather than shortens.
const REPLY_MAX_TOKENS = 700;

// A reply that stopped because it ran out of room is not an answer, and silently
// showing the fragment is the app stating something false with confidence --
// the reader has no way to tell a terse Romano from a severed one. Say it.
function markIfTruncated(text, wasCut) {
  const t = String(text || '');
  if (!wasCut || !t) return t || 'No response received.';
  return t.replace(/\s+$/, '') + ' […cut off — Romano ran out of room. Ask him to continue.]';
}

// Not everything Groq serves can hold a conversation: whisper transcribes, guard
// classifies, tts speaks. The /models list does not say which is which, so the name is
// the only signal there is. Crude, but wrong-and-loud beats picking a speech model.
function groqUsableModel(id) {
  const s = String(id || '').toLowerCase();
  return !!s && !/whisper|tts|guard|embed|moderation|rerank/.test(s);
}
async function groqDiscoverModel(apiKey) {
  const res = await fetch('https://api.groq.com/openai/v1/models',
    { headers: { 'Authorization': `Bearer ${apiKey}` } });
  if (!res.ok) return '';
  const data = await res.json().catch(() => null);
  const ids = (data && data.data || []).map(m => m && m.id).filter(groqUsableModel);
  if (!ids.length) return '';
  for (const p of GROQ_PREFERRED) if (ids.includes(p)) return p;
  // Nothing familiar survives. Prefer something that looks like a large instruct model
  // over whatever happens to sort first.
  const score = id => (/70b|100b|120b|405b/.test(id) ? 2 : 0) + (/versatile|instruct/.test(id) ? 1 : 0);
  return ids.slice().sort((a, b) => score(b) - score(a) || a.localeCompare(b))[0];
}

// Which model was connected, in plain words, for the AI-use log printed on every
// export. Act I allows the machine ONE job — asking how the writing went — so the
// log names the model and the job, and the reader can see nothing else was on.
function aiLabel() {
  const p = getProvider();
  if (p === 'none')      return 'None — no AI was connected';
  if (p === 'local')     return 'Local model on this computer (Ollama · ' + (getLocalModel() || 'unnamed') + ')';
  if (p === 'anthropic') return 'Anthropic Claude Sonnet';
  if (p === 'gemini')    return 'Google Gemini 2.5 Flash';
  // Names the model actually in use, not the one we shipped hoping for. This string is
  // printed on the submitted PDF, so it has to stay true after a model swap.
  if (p === 'groq')      return 'Groq · ' + getGroqModel();
  if (p === 'custom')    return (localStorage.getItem(CUSTOM_MODEL_KEY) || 'OpenAI-compatible model')
    + ' (' + (localStorage.getItem(CUSTOM_ENDPOINT_KEY) || 'custom endpoint') + ')';
  return p;
}
function getLocalEndpoint() { return localStorage.getItem(LOCAL_ENDPOINT_KEY) || 'http://localhost:11434'; }
function getLocalModel()    { return localStorage.getItem(LOCAL_MODEL_KEY) || ''; }
function getLocalKey()      { return localStorage.getItem(LOCAL_KEY) || ''; }
// Only send Authorization when there is something to send: an unauthenticated
// Ollama does not care, but a bare "Bearer " header is worse than none.
function localHeaders(){
  const k = getLocalKey();
  const h = { 'Content-Type': 'application/json' };
  if(k) h['Authorization'] = 'Bearer ' + k;
  return h;
}

// Diagnose a failed local-model call for the situation we are actually in.
// Two real demo hazards: (1) browsers — Safari most strictly — block an HTTPS
// page from calling http://localhost (mixed content); (2) a remote origin needs
// Ollama to allow that exact origin, never "*". Returned text is plain (safe for
// both textContent and template strings).
function localFailureHint(endpoint) {
  const onHttps = location.protocol === 'https:';
  const epIsHttp = /^http:\/\//i.test(endpoint || '');
  const h = location.hostname;
  const remoteOrigin = h && !['localhost', '127.0.0.1', 'tauri.localhost', ''].includes(h);
  if (onHttps && epIsHttp) {
    return `This page is served over HTTPS, and browsers (Safari most strictly) block calls from an HTTPS page to ${endpoint}. Open Journaler locally or as the desktop app, or pick a cloud model — Gemini's free tier works well.`;
  }
  if (remoteOrigin) {
    return `The page is loaded from ${location.origin}, so Ollama must allow that origin: set OLLAMA_ORIGINS to include ${location.origin} (a specific origin, never "*") and restart Ollama, then confirm it is running at ${endpoint}.`;
  }
  return `Is Ollama running at ${endpoint}? Start it with "ollama serve". On localhost you do not need to set OLLAMA_ORIGINS — the localhost origin is allowed by default.`;
}

// Where to look for a local model. Ollama's default port (11434) is identical
// on every OS, and localhost/127.0.0.1 resolve to whatever machine the app runs
// on — so nothing here is tied to a specific box. 1234 = LM Studio. If the app
// is ever served from another host, that host is tried first.
function localProbeEndpoints() {
  const eps = ['http://localhost:11434', 'http://127.0.0.1:11434', 'http://localhost:1234'];
  const h = location.hostname;
  if (h && !['localhost', '127.0.0.1', 'tauri.localhost', ''].includes(h)) {
    eps.unshift(`http://${h}:11434`);
  }
  return eps;
}

// ⚠ THE ONE MODEL STUDENTS SEE, in order of preference.
//
// A shared Ollama box lists everything on it. On ToddGPT that is the 27B Todd keeps
// for his own work plus the bake-off losers — mistral:7b, gemma3:4b, gemma3:12b —
// and a student picking one of those gets a worse partner with no way of knowing.
// mistral scored 0/5 on staying inside two sentences.
//
// qwen3.5:9b is the measured choice (06-model-sizing.md): best writing, and the only
// model that reliably obeyed persona changes. The 4B is the fallback for a machine
// that cannot hold the 9B.
//
// ⚠ If NONE of these is present the full list is shown instead. A student running
// their own Ollama with some other model must not be locked out of a working setup
// by a preference expressed here.
//
// ⚠ And this is a DEFAULT, not a lock. Todd: "But I'd like to see all of them. Maybe
// too tricky to filter by user?" — it does not need to know who is looking. A student
// opening this tab has one obvious choice and no way to pick a worse one by accident;
// anyone who actually wants the rest clicks one link. Nobody has to be identified for
// that to work, which is the whole reason not to try.
const LOCAL_PREFERRED = ['qwen3.5:9b', 'qwen3.5:4b'];
let _showAllLocal = false;

// ⚠ One box, three URLs. The probe tries localhost, 127.0.0.1 and the host that
// served the page, and on ToddGPT all three answer — so an undeduplicated list shows
// every model three times. Keyed by model id, first endpoint in probe order wins.
function flattenLocal(found){
  const seen = new Set(), out = [];
  (found || []).forEach(f => (f.models || []).forEach(m => {
    if(seen.has(m.id)) return;
    seen.add(m.id);
    out.push({ url: f.url, id: m.id });
  }));
  return out;
}

// [{url, id}] narrowed to the preferred model, or everything if none is there.
function preferLocal(found){
  const all = flattenLocal(found);
  for(const want of LOCAL_PREFERRED){
    const hit = all.find(x => x.id === want || String(x.id).startsWith(want + '-'));
    if(hit) return { list: [hit], hidden: all.length - 1 };
  }
  return { list: all, hidden: 0 };
}

let _localModels = [];
// Probe the candidate endpoints for an OpenAI-compatible model list. Returns
// [{endpoint, id}] in endpoint-priority order; never throws.
async function detectLocalModels() {
  const order = localProbeEndpoints();
  const results = await Promise.all(order.map(async (ep) => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 1500);
      const res = await fetch(`${ep}/v1/models`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.data || [])
        .filter(m => m.id && !/embed/i.test(m.id))
        .map(m => ({ endpoint: ep, id: m.id }));
    } catch { return []; }
  }));
  _localModels = results.flat();
  return _localModels;
}
function getStoredKey(provider) {
  if (provider === 'anthropic') return localStorage.getItem(ANTHROPIC_KEY) || '';
  if (provider === 'gemini')    return localStorage.getItem(GEMINI_KEY) || '';
  if (provider === 'groq')      return localStorage.getItem(GROQ_KEY) || '';
  if (provider === 'custom')    return localStorage.getItem(CUSTOM_KEY) || '';
  return '';
}

let _modalProvider = 'none';

// ── AI status now rides on the gear, not on a button of its own.
//
// It was "● AI: Groq ✓" in the topbar -- three tokens saying one thing, in a bar
// that had run out of room. The gear is the control that acts on it, and Settings
// → AI already prints "Selected: Groq · openai/gpt-oss-120b" in full, so the topbar
// only has to answer yes/no: green dot = a model is configured. The words that were
// on the button move into the gear's title, where they cost nothing.
//
// ⚠ A dot cannot say "chosen but not usable". So a provider with no key still gets
// NO dot -- it is not connected -- and the title says why, rather than showing green
// beside a provider that will fail on the first question.
function updateAIBtn() {
  const gear = document.getElementById('settingsBtn');
  const p = getProvider();
  let on = false, said = 'off';
  if (p === 'anthropic')   { on = !!getStoredKey('anthropic'); said = on ? 'Claude' : 'Claude (no key yet)'; }
  else if (p === 'gemini') { on = !!getStoredKey('gemini');    said = on ? 'Gemini' : 'Gemini (no key yet)'; }
  else if (p === 'groq')   { on = !!getStoredKey('groq');      said = on ? 'Groq'   : 'Groq (no key yet)'; }
  else if (p === 'local')  { const m = getLocalModel(); on = !!m; said = m || 'Local (no model answered)'; }
  else if (p === 'custom') {
    const m = localStorage.getItem(CUSTOM_MODEL_KEY) || '';
    on = !!(getStoredKey('custom') && m); said = on ? m : 'Custom (needs setup)';
  }
  // The reader is rendered behind the Settings overlay, so its AI doors have to be
  // re-synced here rather than waiting for a tab switch that may never come.
  if (window.syncAiSurfaces) window.syncAiSurfaces();
  if (!gear) return;
  gear.classList.toggle('ai-active', on);
  gear.title = `Settings · AI: ${said}`;
  gear.setAttribute('aria-label', `Settings. AI: ${said}`);
}

// ── About. Global (inline onclick in index.html), same overlay pattern as the AI modal.
function openAbout() {
  const b = document.getElementById('aboutBuild');
  if (b) b.textContent = BUILD;
  document.getElementById('aboutOverlay').classList.add('open');
}
function closeAbout() {
  document.getElementById('aboutOverlay').classList.remove('open');
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const o = document.getElementById('aboutOverlay');
    if (o && o.classList.contains('open')) { closeAbout(); e.stopPropagation(); }
  }
});
document.addEventListener('DOMContentLoaded', () => {
  const b = document.getElementById('aboutBtn');
  if (b) b.addEventListener('click', openAbout);
});

// The AI chooser is Settings → AI (three tabs: Local / $0 / Pay (Own Key)), and
// everything that used to open the old provider-grid modal goes there instead, so
// there is exactly one place that answers "which model am I using?". The function
// itself is defined with the settings code further down and exported on window,
// because renderAiTab lives inside that block and is not visible from here.

// What remains of the old modal: the custom-endpoint editor, reached from the
// "OpenAI-compatible" card in Settings → AI. It no longer chooses a provider
// family — opening it means the user has already chosen "bring your own endpoint".
function openAIModal() {
  _modalProvider = 'custom';
  _refreshKeySection();
  document.getElementById('aiModalOverlay').classList.add('open');
  setTimeout(() => document.getElementById('aiCustomEndpoint')?.focus(), 50);
}

function closeAIModal() {
  document.getElementById('aiModalOverlay').classList.remove('open');
}

// "llama3.2:3b" → "Llama 3.2 · 3B"; "smollm2:1.7b" → "SmolLM 2 · 1.7B".
function prettyModelLabel(id) {
  const [rawName, rawSize] = id.split(':');
  const NAMES = { llama: 'Llama', qwen: 'Qwen', gemma: 'Gemma', phi: 'Phi', smollm: 'SmolLM', mistral: 'Mistral', deepseek: 'DeepSeek', mixtral: 'Mixtral' };
  const m = /^([a-z]+)(.*)$/i.exec(rawName) || [null, rawName, ''];
  const base = NAMES[(m[1] || '').toLowerCase()] || (m[1] ? m[1][0].toUpperCase() + m[1].slice(1) : rawName);
  const ver = (m[2] || '').trim();
  const name = (base + (ver ? ' ' + ver : '')).trim();
  const size = rawSize && rawSize !== 'latest' ? ' · ' + rawSize.toUpperCase() : '';
  return name + size;
}


// Fill the custom-endpoint fields from storage. The local picker and the
// per-provider key fields that used to live here went with the provider grid --
// Settings → AI owns those now.
function _refreshKeySection() {
  const customSection = document.getElementById('aiCustomSection');
  if (!customSection) return;
  customSection.style.display = 'block';
  document.getElementById('aiCustomEndpoint').value = localStorage.getItem(CUSTOM_ENDPOINT_KEY) || '';
  document.getElementById('aiCustomModel').value = localStorage.getItem(CUSTOM_MODEL_KEY) || '';
  document.getElementById('aiCustomKey').value = getStoredKey('custom') ? '••••••••••••••••' : '';
}

// Save is only ever reached for the custom endpoint now. Selecting a local or
// free/paid provider is a click in Settings → AI, which commits immediately.
function saveAISettings() {
  const ep = document.getElementById('aiCustomEndpoint').value.trim().replace(/\/+$/, '');
  const model = document.getElementById('aiCustomModel').value.trim();
  const key = document.getElementById('aiCustomKey').value.trim();
  localStorage.setItem(PROVIDER_KEY, 'custom');
  if (ep) localStorage.setItem(CUSTOM_ENDPOINT_KEY, ep);
  if (model) localStorage.setItem(CUSTOM_MODEL_KEY, model);
  if (key && !key.startsWith('•')) localStorage.setItem(CUSTOM_KEY, key);
  closeAIModal();
  updateAIBtn();
  // The panel behind this modal shows the selection, so it has to be told.
  if (document.getElementById('settingsOverlay')?.classList.contains('open')) window.renderAiTab?.();
}

function applyCustomPreset(name) {
  const P = {
    openai:     { ep: 'https://api.openai.com/v1',      model: 'gpt-4o-mini' },
    deepseek:   { ep: 'https://api.deepseek.com/v1',    model: 'deepseek-chat' },
    openrouter: { ep: 'https://openrouter.ai/api/v1',   model: 'meta-llama/llama-3.3-70b-instruct' },
    // llama-3.3-70b-versatile stopped being served on 16 August 2026. This preset
    // fills the model field, so a retired id here hands the user a broken setup.
    groq:       { ep: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b' }
  }[name];
  if (!P) return;
  document.getElementById('aiCustomEndpoint').value = P.ep;
  document.getElementById('aiCustomModel').value = P.model;
  document.getElementById('aiCustomKey').focus();
}

async function callModel(prompt) {
  const provider = getProvider();
  const apiKey   = getStoredKey(provider);

  // Every "you have not set this up yet" path lands on the chooser, which is
  // Settings → AI -- not the custom-endpoint editor, which assumes a decision
  // the user has not made yet.
  if (provider === 'none') {
    openSettingsAI();
    return 'No AI provider selected. Choose one in Settings → AI.';
  }
  if (provider !== 'local' && !apiKey) {
    openSettingsAI();
    return 'No API key found. Add your key in Settings → AI.';
  }

  if (provider === 'local') {
    const endpoint = getLocalEndpoint();
    const model    = getLocalModel();
    if (!model) {
      openSettingsAI();
      return 'No local model selected. Pick one in Settings → AI.';
    }
    try {
      // Qwen3.5 and other reasoning models spend the whole token budget in a
      // separate `reasoning` field and hand back content:"" with
      // finish_reason:"length" -- the reader sees nothing at all. Measured on
      // ToddGPT 2026-08-23: /v1 returned 700 tokens and an empty string on both
      // qwen3.5:9b and qwen3.5:4b; Ollama's own /api/chat with think:false
      // returned the same reply in 28 tokens. So try Ollama natively first.
      // LM Studio (:1234) and llama.cpp have no /api/chat, fall through to /v1
      // below unchanged, so a student's own laptop keeps working exactly as now.
      const oll = await fetch(`${endpoint}/api/chat`, {
        method: 'POST',
        headers: localHeaders(),
        body: JSON.stringify({
          model,
          stream: false,
          think: false,
          options: { num_predict: REPLY_MAX_TOKENS },
          messages: [{ role: 'user', content: prompt }]
        })
      }).catch(() => null);
      if (oll && oll.ok) {
        const d = await oll.json();
        return markIfTruncated(
          (d && d.message && d.message.content) || '',
          d && d.done_reason === 'length'
        );
      }
      const res = await fetch(`${endpoint}/v1/chat/completions`, {
        method: 'POST',
        headers: localHeaders(),
        body: JSON.stringify({
          model,
          max_tokens: REPLY_MAX_TOKENS,
          messages: [{ role: 'user', content: prompt }]
        })
      });
      if (!res.ok) {
        return `Local model error ${res.status}. ${localFailureHint(endpoint)}`;
      }
      const data = await res.json();
      return markIfTruncated(
        data.choices?.[0]?.message?.content || '',
        data.choices?.[0]?.finish_reason === 'length'
      );
    } catch (err) {
      return `Could not reach the local model. ${localFailureHint(endpoint)}`;
    }
  }

  if (provider === 'anthropic') {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          // The header is anthropic-dangerous-direct-browser-access. This said
          // anthropic-dangerous-allow-browser, the name of the SDK's JavaScript
          // option rather than the header, so the browser's preflight was never
          // satisfied and this provider could not have worked from a page.
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          // claude-sonnet-4-20250514 retired 15 June 2026.
          model: 'claude-sonnet-5',
          max_tokens: REPLY_MAX_TOKENS,
          // Sonnet 5 thinks by default and max_tokens caps thinking and reply
          // together, so a 200-token budget would be spent thinking and return
          // nothing. Short prompts here; disable it explicitly.
          thinking: { type: 'disabled' },
          messages: [{ role: 'user', content: prompt }]
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (res.status === 401) return 'Invalid Anthropic key. Update it via the AI button in the header.';
        if (res.status === 404) return 'That Anthropic model is unavailable — it may have been retired. This needs a fix in the app, not a new key.';
        return `Anthropic API error ${res.status}: ${err?.error?.message || 'Unknown error'}`;
      }
      const data = await res.json();
      return markIfTruncated(
        data.content?.map(b => b.text || '').join('') || '',
        data.stop_reason === 'max_tokens'
      );
    } catch (err) {
      return 'Error reaching Anthropic. Please check your connection and try again.';
    }
  }

  if (provider === 'gemini') {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: REPLY_MAX_TOKENS,
            temperature: 0.7,
            // Gemini 2.5 Flash thinks by default and maxOutputTokens caps the
            // thinking and the reply TOGETHER -- exactly the trap handled for
            // Sonnet 5 above, but never applied here. With the old 200-token
            // budget the thinking spent nearly all of it and the reader got a
            // few words ending mid-contraction. Short prompts; turn it off.
            thinkingConfig: { thinkingBudget: 0 }
          }
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        // A retired model id also produces a 400, so reporting every 400 as a
        // key fault sent students to replace a key that was working.
        if (res.status === 401 || res.status === 403) return 'Invalid Gemini key. Update it via the AI button in the header.';
        if (res.status === 404) return 'That Gemini model is unavailable — it may have been retired. This needs a fix in the app, not a new key.';
        return `Gemini API error ${res.status}: ${err?.error?.message || 'Unknown error'}`;
      }
      const data = await res.json();
      const cand = data.candidates?.[0];
      return markIfTruncated(
        cand?.content?.parts?.map(p => p.text || '').join('') || '',
        cand?.finishReason === 'MAX_TOKENS'
      );
    } catch (err) {
      return 'Error reaching Gemini. Please check your connection and try again.';
    }
  }

  if (provider === 'groq') {
    const ask = (model) => fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        max_tokens: REPLY_MAX_TOKENS,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    try {
      let model = getGroqModel();
      let res = await ask(model);
      let err = res.ok ? null : await res.json().catch(() => ({}));
      // A retired model is the one failure worth recovering from in place: it hits every
      // student on the same day, it is nobody's mistake, and the answer is one lookup
      // away. A bad key is not — that one needs the student.
      if (err && res.status !== 401) {
        const msg = String(err && err.error && err.error.message || '').toLowerCase();
        if (res.status === 404 || /decommission|deprecat|does not exist|not found|unsupported|invalid model/.test(msg)) {
          const fresh = await groqDiscoverModel(apiKey).catch(() => '');
          if (fresh && fresh !== model) {
            localStorage.setItem(GROQ_MODEL_KEY, fresh);
            try { window.logEvent('ai', 'groq model retired — switched', { from: model, to: fresh }); } catch (e) {}
            model = fresh;
            res = await ask(model);
            err = res.ok ? null : await res.json().catch(() => ({}));
          }
        }
      }
      if (!res.ok) {
        if (res.status === 401) return 'Invalid Groq key. Update it via the AI button in the header.';
        return `Groq API error ${res.status}: ${err?.error?.message || 'Unknown error'}`;
      }
      const data = await res.json();
      return markIfTruncated(
        data.choices?.[0]?.message?.content || '',
        data.choices?.[0]?.finish_reason === 'length'
      );
    } catch (err) {
      return 'Error reaching Groq. Please check your connection and try again.';
    }
  }

  if (provider === 'custom') {
    const endpoint = (localStorage.getItem(CUSTOM_ENDPOINT_KEY) || '').replace(/\/+$/, '');
    const model = localStorage.getItem(CUSTOM_MODEL_KEY) || '';
    if (!endpoint || !model) { openAIModal(); return 'Set the endpoint URL and model in the AI settings.'; }
    try {
      const res = await fetch(`${endpoint}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model, max_tokens: REPLY_MAX_TOKENS, messages: [{ role: 'user', content: prompt }] })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (res.status === 401) return 'Invalid API key. Update it via the AI button in the header.';
        return `API error ${res.status}: ${err?.error?.message || 'Unknown error'}`;
      }
      const data = await res.json();
      return markIfTruncated(
        data.choices?.[0]?.message?.content || '',
        data.choices?.[0]?.finish_reason === 'length'
      );
    } catch (err) {
      return 'Could not reach that endpoint. Check the URL and your connection.';
    }
  }

  return 'Unknown provider.';
}

// ── What the students call him. Declared HERE, at file scope, rather than inside the
//    main IIFE: the reflection prompt below is defined outside that closure, and a name
//    that only half the app can reach is a name half the app will not use.
//
//    A human name alone hides that this is software, so anything KEPT, exported or
//    printed carries AI_TAG ("Romano · AI") rather than AI_NAME. Live views use the bare
//    name; the permanent record always marks it.
const AI_NAME = 'Romano';          // the name students see, everywhere
const AI_TAG  = AI_NAME + ' \u00b7 AI';   // the attribution chip -- always marks it as AI

// ── Asked about the student's OWN writing, not the book.
//
//    READING_PARTNER is grounded in a chapter; REFLECTION_PARTNER is forbidden to touch
//    the words at all ("never quote or critique"). Neither fits a student who has
//    selected a line of their own gush and asked what about it. This one engages the
//    words -- that is the point of it -- under the constraints the persona work landed
//    on: no praise-as-grade, no verdict, no command, no trailing question, and
//    difficulty located in the writing rather than in the writer.
const WRITING_PARTNER = [
  'You are ' + AI_NAME + ', a writing partner in a college writing course.',
  'A student has selected a passage of THEIR OWN writing and asked you about it.',
  'Engage what the passage actually says. You may quote a few of their words back.',
  'Do NOT grade, score, rank, or praise it as a teacher would. Do not say it is good or bad.',
  'Do not tell them what to do next unless they asked for that.',
  'If something is not working, locate it in the WRITING -- this sentence, this image --',
  'never in the writer. Never imply they are or are not "a writer".',
  'Reply in two or three short sentences. Answer what they asked. Do NOT end with a question.'
].join('\n');

// ===== Act I — post-buzzer reflection =====
// Touches the EXPERIENCE of the timed write, never the words. See next-steps /
// [[human-first-creedo]]: the gush is the student's; AI reflects on pacing only.
const REFLECTION_PARTNER = [
  'You are ' + AI_NAME + ', a writing partner in a college writing course.',
  'A student just finished a timed "gush" — a fast freewrite with editing locked off.',
  'They share the text ONLY so you can sense energy and pacing.',
  'Do NOT judge the writing, its quality, grammar, or ideas. Do NOT quote it or rewrite it.',
  'Ask 2 to 3 short, plain questions about the EXPERIENCE of writing it:',
  'where they sped up or stalled, what surprised them, what showed up that they did not plan.',
  'One sentence each. No preamble, no praise. Just the questions.'
].join(' ');

// ===== The two things Romano must never improvise =====
//
// These are answered by the APP, without asking the model, because the model has no
// way to know them and will invent them. It did: asked "is Dr. Edwards going to read
// what I type in here?", it answered "Dr. Edwards will never read your typing here,
// and that is exactly why you should feel safe." Nobody authorised that, and it is
// false -- the unedited gush prints on sheet two of every One-Pager PDF.
//
// TOP LEVEL on purpose. The reading-partner path lives inside the shell IIFE below,
// but the post-buzzer reflection does not, and the reflection is the likelier place
// for real distress to land -- a student pours out a hard thing in a timed gush and
// is never asked a question at all. Both scopes need these, so they live out here.
//
// Rendered as plain text (escHtml, or .textContent), so no markdown and no links --
// a URL has to be readable aloud. Keep them to a few short sentences.

const ANSWER_WHO_SEES_THIS =
  'Dr. Edwards sees what you turn in, and nothing else. Be aware that your One-Pager '
  + 'PDF carries your unedited gush on its second page, so he reads that too, and the '
  + 'notebook is graded — 50 of the 200 points, due the last class — against the '
  + "Writer's Notebook Guidelines on the course site. In the notebook, only the entries "
  + 'you flag for turn-in get read closely. Everything else stays in this browser on '
  + 'this computer: there is no account and no server, and it stays here until you '
  + 'clear it. One exception worth knowing — when you ask me something, your words go '
  + 'to whichever AI is connected in Settings, and the free option sends them to a '
  + 'company outside the university.';

const ANSWER_IF_STRUGGLING =
  'Please talk to a person about this, not to me. Miami\u2019s Student Counseling '
  + 'Service is 513-529-4634, weekdays 8 to 5; after hours, call the university police '
  + 'dispatcher at 513-529-2222 and ask for the counselor on call. You can also call or '
  + 'text 988 any hour of any day, or reach Women Helping Women at 513-381-5610. '
  + 'Dr. Edwards holds office hours Monday, Tuesday, Thursday and Friday from 1 to 3 by '
  + 'appointment. I am software, and this is further than I can go with you.';

// Matched against whatever the student wrote -- a typed question in the reading
// partner, the gush itself after the buzzer.
const DISTRESS = /\b(kill myself|suicid|hurt myself|self.harm|want to die|end it all)\b/i;

// Returns the human to name, or '' if there is nothing to flag. Shared so the two
// paths cannot drift: the reflection used to have no safety net at all.
function distressNote(text){ return DISTRESS.test(String(text || '')) ? ANSWER_IF_STRUGGLING : ''; }

// Paint the exchange: Romano's question, then a box to answer it in. The OP1
// handout tells students to "answer the app's questions about how the writing went,"
// so the question on its own is half a conversation. The answer is saved and prints
// on the session record. Callers that pass no hooks get the question only.
function paintReflection(rf, question, hooks) {
  rf.innerHTML = '<span class="lbl">Reflecting with ' + AI_NAME + '</span>'
    + '<span id="reflectBody"></span>';
  rf.querySelector('#reflectBody').textContent = question;
  if (!hooks) return;
  const ta = document.createElement('textarea');
  ta.className = 'reflect-answer';
  ta.id = 'reflectAnswer';
  ta.placeholder = 'Your answer — how did the writing go?';
  ta.value = hooks.answer || '';
  ta.addEventListener('input', () => hooks.onAnswer(ta.value));
  rf.appendChild(ta);
}

// Name the human, ALONGSIDE whatever else this pane is saying. Never instead of it:
// Todd, 23 Aug 2026 -- "don't skip the gush work for students who may be experiencing
// serious mental health struggles." A student in a bad place still did the writing, and
// having the app respond to the crisis and ignore the work would tell them the writing
// stopped counting the moment they said something true.
//
// Appended to the DOM and deliberately NOT persisted. hooks.onQuestion() feeds
// session.question, which prints on sheet two of the One-Pager PDF -- so folding this
// in would print a student's crisis onto the document they hand to their professor.
// It belongs on their screen, in the moment, and nowhere else.
function appendDistressNote(rf, note) {
  if (!note) return;
  const el = document.createElement('p');
  el.className = 'reflect-distress';
  el.textContent = note;
  rf.appendChild(el);
}

async function runReflection(rf, text, hooks) {
  // FIRST, and before every early return below. Both of them used to swallow this:
  // a gush under ten words skips the reflection entirely -- and "i want to die" is
  // four words -- while a missing API key skipped it too, though matching a pattern
  // needs no model at all. The safety net cannot depend on a word count or a provider.
  const note = distressNote(text);

  rf.innerHTML = '<span class="lbl">Reflecting with ' + AI_NAME + '</span>'
    + '<span id="reflectBody"><em>Reading your pace…</em></span>';
  const bodyEl = rf.querySelector('#reflectBody');
  // Nothing was typed, so there is no session to reflect on. Without this the model
  // cheerfully asks where your pace slowed down on a gush of zero words, and that
  // invented question gets printed on a submitted artifact. Say the true thing instead.
  if ((String(text || '').trim().match(/\S+/g) || []).length < 10) {
    bodyEl.innerHTML = '<em>Nothing came down on the page this time. Reset the clock and '
      + 'gush again — there is nothing to reflect on yet.</em>';
    appendDistressNote(rf, note);
    return;
  }
  if (getProvider() === 'none') {
    bodyEl.innerHTML = '<em>Connect an AI (top right) and ' + AI_NAME + ' will ask you '
      + 'a couple of questions about how the gush went. Optional — the gush is what matters.</em>';
    appendDistressNote(rf, note);
    return;
  }
  try {
    const reply = await callModel(REFLECTION_PARTNER
      + '\n\n(For pacing context only — never quote or critique this:)\n"""\n'
      + String(text || '').slice(0, 4000) + '\n"""');
    if (hooks) hooks.onQuestion(reply);
    paintReflection(rf, reply, hooks);   // resets rf, so the note goes on after
    appendDistressNote(rf, note);
  } catch (e) {
    bodyEl.innerHTML = '<em>' + AI_NAME + ' is unavailable right now.</em>';
    appendDistressNote(rf, note);
  }
}

// ===== Shell: tabs, gush engine, focus (from the 2026-07-27 prototype) =====
(function () {
  const frame = document.getElementById('frame');
  const body = document.body;
  // The notebook is the home, not the fourth thing. Todd, 23 Aug 2026: "Default landing
  // when you open the software should be notebook." Everything else in this app feeds it,
  // and a student who opens to their own kept work sees the term accumulating rather than
  // a blank prompt. The By-day lens is what greets them, not the scoring table.
  let tab = 'tips';

  // ---------- shared gush engine ----------
  const G = { running: false, tId: null, remain: 0 };
  // Default 8:00 — Todd: "you can do magic in 8 minutes" (works better than 5).
  let gushSecs = 480;
  function paintTimer(){ const t = document.getElementById('timer'); if (t) t.textContent = fmt(gushSecs); }
  function wireTimer(){
    const t = document.getElementById('timer'); if (!t) return;
    paintTimer();
    const minus = document.getElementById('tminus'), plus = document.getElementById('tplus');
    if (minus) minus.onclick = () => { if (G.running) return; gushSecs = Math.max(60, gushSecs - 60); paintTimer(); };
    if (plus)  plus.onclick  = () => { if (G.running) return; gushSecs = Math.min(3600, gushSecs + 60); paintTimer(); };
    t.classList.add('editable');
    t.onclick = () => {
      if (G.running) return;
      const mins = Math.round(gushSecs / 60);
      const inp = document.createElement('input');
      inp.type = 'number'; inp.min = 1; inp.max = 60; inp.value = mins; inp.className = 'timerin';
      t.replaceWith(inp); inp.focus(); inp.select();
      const commit = () => {
        let v = parseInt(inp.value, 10); if (isNaN(v)) v = mins; v = Math.max(1, Math.min(60, v));
        gushSecs = v * 60;
        const span = document.createElement('span'); span.className = 'timer editable'; span.id = 'timer'; span.textContent = fmt(gushSecs);
        inp.replaceWith(span); wireTimer();
      };
      inp.onblur = commit; inp.onkeydown = e => { if (e.key === 'Enter') inp.blur(); };
    };
  }
  const fmt = s => Math.floor(s/60) + ':' + String(Math.max(0,s)%60).padStart(2,'0');
  function guard(e){ if(['Backspace','Delete'].includes(e.key)) e.preventDefault(); }
  function resetGush(opts){
    opts = opts || {};
    clearInterval(G.tId); G.running = false;
    body.classList.remove('gushing');
    const ta = document.getElementById('gush');
    if(ta){ ta.removeEventListener('keydown', guard); ta.classList.remove('locked'); ta.disabled = false; ta.readOnly = false; }
    const ts = document.getElementById('timerset'); if(ts) ts.classList.remove('locked');
    const btn = document.getElementById('startBtn'); if(btn) btn.disabled = false;
    const lm = document.getElementById('lockmsg'); if(lm) lm.textContent = 'Clock reset — adjust the minutes and start again when you’re ready.';
    const rb = document.getElementById('resetBtn'); if(rb) rb.style.display = 'none';
    const t = document.getElementById('timer'); if(t) t.classList.remove('low');
    if(opts.focus) setFocus(false);
    paintTimer();
  }
  function startGush(mins, opts){
    opts = opts || {};
    const ta = document.getElementById('gush'), btn = document.getElementById('startBtn');
    if(btn) btn.disabled = true;
    const ts = document.getElementById('timerset'); if(ts) ts.classList.add('locked');
    // Escape hatch — they're adults. A gush can be stopped and the clock reset.
    let rb = document.getElementById('resetBtn');
    if(!rb && btn && btn.parentNode){ rb = document.createElement('button'); rb.id = 'resetBtn'; rb.type = 'button'; rb.className = 'btn ghost sm'; btn.parentNode.insertBefore(rb, btn.nextSibling); }
    if(rb){ rb.textContent = '↺ Reset clock'; rb.style.display = ''; rb.onclick = () => resetGush(opts); }
    // `gushing` is the CLOCK-IS-RUNNING state, distinct from `focus`. Focus can be
    // toggled by hand at any time; this marks the stretch where the only thing that
    // should be on screen is the gush. See the focus rules in app.css.
    body.classList.add('gushing');
    ta.disabled = false; ta.readOnly = false; ta.classList.add('locked'); ta.value=''; ta.focus();
    ta.addEventListener('keydown', guard);
    const lm = document.getElementById('lockmsg'); if(lm) lm.innerHTML = '<span class="lockflag">● Locked — gush mode. Keep going.</span>';
    if(opts.focus) setFocus(true);
    G.running = true; G.remain = mins;
    const timer = document.getElementById('timer');
    G.tId = setInterval(() => {
      G.remain--; timer.textContent = fmt(G.remain); timer.classList.toggle('low', G.remain<=30);
      if(G.remain<=0){ clearInterval(G.tId); G.running=false;
        body.classList.remove('gushing');
        // READONLY, never disabled. The gush must freeze — sheet two prints it as "the
        // gush, unedited" — but a DISABLED textarea cannot be selected in any browser, so
        // disabling it silently made Copy-into-the-One-Pager impossible: there was no way
        // to select the lines to copy. readonly freezes the text and still lets it be
        // selected, which is exactly the chalkboard rule.
        ta.removeEventListener('keydown',guard); ta.classList.remove('locked');
        ta.disabled=false; ta.readOnly=true;
        if(lm) lm.textContent='Time. Your gush is fixed now — select the lines you want and copy them across, or send them to your notebook.';
        if(opts.focus) setFocus(false);
        const rf = document.getElementById('reflect'); if(rf){ rf.style.display='block'; runReflection(rf, ta.value, opts.reflect); }
        if(opts.onEnd) opts.onEnd();
      }
    }, 1000);
  }

  // ═══ Persistence — everything the student types is saved locally, and
  //     "Save my work" exports it ALL as ONE portable file (Drive/Dropbox/USB).
  //     Typed text lives in localStorage; the big reading files live in IndexedDB.
  const LS_KEY = 'cr284_state';
  function loadDB(){ try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch(e){ return {}; } }
  // ── Schema version. `v` was being written and never read, which is the setup for a
  //    mid-semester revision that quietly orphans student work. The hook exists now,
  //    while there is no student data to get wrong.
  //    ADDING a field needs no migration — the Object.assign below gives an older save
  //    the new default (that is how `name` and `session` landed harmlessly). Only
  //    RENAMING or RESTRUCTURING does. Add a step, bump DB_SCHEMA, ship.
  //    An older build reading a newer save is also safe: it ignores `v` and Object.assign
  //    preserves keys it knows nothing about.
  const DB_SCHEMA = 2;
  function migrateDB(db){
    const from = Number(db.v) || 1;
    if(from >= DB_SCHEMA){ db.v = DB_SCHEMA; return; }
    // v1 → v2: `name` and the per-OP `session` block were pure additions, so there is
    // nothing to move. Stamping the version is the whole step.
    db.v = DB_SCHEMA;
  }

  const DB = Object.assign({ v:DB_SCHEMA, name:'', freewrite:{}, currere:{}, notebook:{}, readings:null, activeReading:0 }, loadDB());
  migrateDB(DB);
  if(!DB.freewrite) DB.freewrite = {};
  if(!DB.currere)   DB.currere   = {};
  if(!DB.notebook)  DB.notebook  = {};
  let _saveT;
  // A failed save used to console.warn and nothing else: the student kept typing into
  // an app that had silently stopped recording, and found out at the end of the term.
  // Now it says so on screen and stays said until a save succeeds. The advice is the
  // one thing that actually rescues the work — export the file.
  let _saveBroken = false;
  function saveAlarm(on){
    if(on === _saveBroken) return;
    _saveBroken = on;
    let el = document.getElementById('saveAlarm');
    if(!on){ if(el) el.remove(); return; }
    if(!el){
      el = document.createElement('div');
      el.id = 'saveAlarm';
      el.innerHTML = '<b>This browser could not save your work.</b> Its storage is full. '
        + 'Use <b>⤓ Save my work</b> now to keep a copy of everything, then remove a large '
        + 'image or two from your page.';
      document.body.appendChild(el);
    }
    toast('Your work could not be saved — see the banner.');
  }
  function saveDB(){ clearTimeout(_saveT); _saveT = setTimeout(()=>{
    try { localStorage.setItem(LS_KEY, JSON.stringify(DB)); saveAlarm(false); }
    catch(e){ console.warn('saveDB', e); saveAlarm(true); logEvent('error', 'SAVE FAILED — storage full?', String(e && e.message || e)); }
  }, 250); }
  function escHtml(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // ═══ Diagnostics ═══════════════════════════════════════════════════════════
  // A rolling event log kept in its OWN storage key, deliberately not in DB: the
  // DB is what ⤓ Save my work exports, and a student's turn-in should not carry a
  // debug log. Capped, because an unbounded log would eventually eat the same
  // quota it exists to report on.
  //
  // Why this exists: the app runs on ~25 machines and browsers nobody here chose.
  // "It isn't working" is unanswerable without knowing which build loaded, whether
  // storage is full, and what the reader saw. Chasing one selection bug by reading
  // the console over someone's shoulder took a whole afternoon; that does not scale
  // to a class.
  const LOG_KEY = 'cr284_log', LOG_MAX = 300;
  let _log = (() => { try { return JSON.parse(localStorage.getItem(LOG_KEY)) || []; } catch(e){ return []; } })();
  let _logT;
  function logEvent(kind, msg, data){
    _log.push({ t: new Date().toISOString(), kind, msg: String(msg == null ? '' : msg),
                data: data === undefined ? undefined : data });
    if(_log.length > LOG_MAX) _log = _log.slice(-LOG_MAX);
    clearTimeout(_logT);
    _logT = setTimeout(() => { try { localStorage.setItem(LOG_KEY, JSON.stringify(_log)); } catch(e){} }, 400);
    if(document.getElementById('diagBody')) renderDiagnostics();
  }
  function clearLog(){ _log = []; try { localStorage.removeItem(LOG_KEY); } catch(e){} renderDiagnostics(); }
  // The AI provider layer sits outside this closure and has things worth logging — a
  // retired Groq model swapped out under the student, above all. Without this the log
  // would be silent about the one event they would need to explain.
  window.logEvent = logEvent;

  function bytesOf(s){ try { return new Blob([s]).size; } catch(e){ return (s||'').length; } }
  function fmtBytes(n){ return n > 1048576 ? (n/1048576).toFixed(1)+' MB' : n > 1024 ? (n/1024).toFixed(0)+' KB' : n+' B'; }

  // Everything that has cost real time to work out by hand.
  async function diagnosticsSnapshot(){
    const out = {};
    const js = document.querySelector('script[src*="app.js"]');
    out['Build (loaded)'] = BUILD;
    out['Asset URL'] = js ? js.getAttribute('src') : '(unknown)';
    out['Page URL'] = location.href;

    let dbBytes = 0, total = 0;
    try { for(const k in localStorage){ if(Object.prototype.hasOwnProperty.call(localStorage,k)) total += bytesOf(localStorage.getItem(k)||''); } } catch(e){}
    try { dbBytes = bytesOf(localStorage.getItem(LS_KEY) || ''); } catch(e){}
    out['Your work (localStorage)'] = fmtBytes(dbBytes);
    out['All site storage'] = fmtBytes(total);
    // WebKit (Safari, GNOME Web) has no storage.estimate, so this line used to just
    // vanish — and a MISSING line reads as "nothing to report" when it actually means
    // "this browser will not say." Say which, or the reader has to know the API to
    // notice the difference. Safari is also the browser most likely to evict storage,
    // so being blind to quota there is the case worth naming rather than hiding.
    if(navigator.storage && navigator.storage.estimate){
      try { const est = await navigator.storage.estimate();
        out['Quota used'] = `${fmtBytes(est.usage||0)} of ${fmtBytes(est.quota||0)}`; }
      catch(e){ out['Quota used'] = 'unavailable — storage.estimate failed: ' + e.message; }
    } else out['Quota used'] = 'this browser does not report quota (WebKit/Safari)';
    out['Journal entries'] = (DB.journal||[]).length;
    out['Readings on shelf'] = (readings||[]).length;
    const hl = DB.highlights || {}, qa = DB.qa || {};
    out['Highlights'] = Object.keys(hl).reduce((n,k)=>n+(hl[k]||[]).length, 0);
    out['Romano exchanges'] = Object.keys(qa).reduce((n,k)=>n+(qa[k]||[]).length, 0);

    out['AI provider'] = (typeof getProvider === 'function' ? getProvider() : '(n/a)');
    out['Secure context'] = String(window.isSecureContext);
    out['Folder picker'] = (typeof window.showDirectoryPicker === 'function') ? 'available' : 'not in this browser';
    out['Clipboard API'] = (navigator.clipboard && navigator.clipboard.writeText) ? 'available' : 'not available';
    out['Browser'] = navigator.userAgent;
    out['Window'] = `${window.innerWidth}×${window.innerHeight} · dpr ${window.devicePixelRatio||1}`;

    // Reader state. The column reading is here because a single-column scan being
    // mis-read as two columns re-sorts the text layer, and every DOM-order problem
    // in the reader traces back to it.
    const r = readings[activeReading];
    if(r){
      out['Current reading'] = r.name + (r.fromDir ? ' (from folder)' : '');
      // ⚠ These counts read the LIVE DOM, but the reading NAME above comes from saved
      // state — so a snapshot taken from another tab, or before the Readings tab has
      // ever been opened, finds no spans. That used to print "no text layer (image-only
      // PDF?)", which blamed the file for the panel's own blind spot; it sent one
      // cross-browser session chasing a chapter whose OCR was fine. Distinguish
      // "nothing rendered" from "rendered and genuinely has no text", and don't accuse
      // a .docx of being an image-only PDF — non-PDF readings have no text layer at all.
      const isPdf = /\.pdf$/i.test(r.name || '');
      const pagesUp = document.querySelectorAll('#docPane .pdf-page').length;
      const spans = document.querySelectorAll('#docPane .textLayer span').length;
      if(!isPdf){
        out['Text-layer spans'] = 'n/a — this reading is not a PDF';
      } else if(!pagesUp){
        out['Text-layer spans'] = 'not measured — no page on screen (open the Readings tab, then snapshot)';
      } else if(spans){
        out['Text-layer spans'] = spans;
        try { out['Lines detected'] = docLines().length; } catch(e){ out['Lines detected'] = 'error: '+e.message; }
      } else out['Text-layer spans'] = `0 across ${pagesUp} rendered page(s) — no text layer (image-only PDF?)`;
    }
    return out;
  }

  function renderDiagnostics(){
    const body = document.getElementById('diagBody');
    if(!body) return;
    const rows = _log.slice().reverse().map(e => {
      const time = e.t.slice(11,19);
      const d = e.data === undefined ? '' : `<div class="diag-data">${escHtml(typeof e.data === 'string' ? e.data : JSON.stringify(e.data))}</div>`;
      return `<div class="diag-row"><span class="diag-time">${time}</span><span class="diag-kind k-${escHtml(e.kind)}">${escHtml(e.kind)}</span><span class="diag-msg">${escHtml(e.msg)}${d}</span></div>`;
    }).join('');
    body.innerHTML = rows || '<p class="diag-empty">No events yet. Use the app and they will appear here.</p>';
    const n = document.getElementById('diagCount');
    if(n) n.textContent = `${_log.length} event${_log.length===1?'':'s'} · newest first`;
    renderDiagToggleMeta();
  }
  // Kept from the last render, because building the report has to be SYNCHRONOUS:
  // Copy details copies and then navigates to a mailto: in the same click, and an
  // await between the two is where Safari stops trusting the gesture. The snapshot
  // is refreshed whenever the Diagnostics tab opens, which is the only way to reach
  // the button.
  let _lastSnap = null;
  async function renderDiagSnapshot(){
    const snap = await diagnosticsSnapshot();
    _lastSnap = snap;
    const el = document.getElementById('diagSnap');
    if(!el) return;
    el.innerHTML = Object.keys(snap).map(k =>
      `<div class="diag-kv"><span>${escHtml(k)}</span><b>${escHtml(String(snap[k]))}</b></div>`).join('');
  }
  function logLines(){
    return _log.map(e => `${e.t.slice(11,19)}  ${e.kind.padEnd(8)} ${e.msg}${e.data===undefined?'':'  '+(typeof e.data==='string'?e.data:JSON.stringify(e.data))}`).join('\n');
  }
  // Synchronous, off the cached snapshot. diagnosticsText() stays async for the
  // download button, which has no gesture to protect.
  function diagnosticsTextSync(comment){
    const snap = _lastSnap || {};
    const head = Object.keys(snap).map(k => `${k}: ${snap[k]}`).join('\n');
    const said = (comment || '').trim();
    return `Journaler-284 problem report — TCE 284\n${'='.repeat(48)}\n`
         + `${new Date().toString()}\n\nWHAT HAPPENED\n${said || '(nothing written)'}\n\n`
         + `${'-'.repeat(48)}\n${head}\n\nEVENTS (oldest first)\n${'-'.repeat(48)}\n${logLines()}\n`;
  }
  async function diagnosticsText(){
    await renderDiagSnapshot();
    return diagnosticsTextSync(diagComment());
  }

  function diagComment(){
    const el = document.getElementById('diagComment');
    return el ? el.value.trim() : '';
  }
  // "Flagged" rather than "errors": most of what lands in here is the app noticing
  // something, not the app broken, and nobody should read this line and conclude
  // their notebook is gone.
  function diagCountLabel(){
    if(!_log.length) return 'nothing recorded';
    const bad = _log.filter(e => e.kind === 'error' || e.kind === 'warn').length;
    return `${_log.length} event${_log.length===1?'':'s'}`
         + (bad ? ` · <span class="flagged">${bad} flagged</span>` : '');
  }
  function renderDiagToggleMeta(){
    const el = document.getElementById('diagToggleMeta');
    if(el) el.innerHTML = diagCountLabel();
  }

  // Course, software, build, date and time — so the mail sorts itself in Todd's
  // inbox and he knows what he is opening before he opens it.
  function reportSubject(){
    const d = new Date(), p = n => String(n).padStart(2,'0');
    return `TCE 284 · Journaler-284 build ${BUILD} · problem report · `
         + `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  // Short enough to survive a mail client that truncates, long enough that the
  // clipboard paste is usually a luxury rather than a requirement.
  function reportDigest(){
    const snap = _lastSnap || {};
    const keep = ['Build (loaded)','Browser','Window','All site storage','Quota used',
                  'Journal entries','Readings on shelf','Highlights','AI provider','Current reading'];
    const lines = keep.filter(k => snap[k] !== undefined).map(k => `${k}: ${snap[k]}`);
    const bad = _log.filter(e => e.kind === 'error' || e.kind === 'warn').slice(-4)
      .map(e => `  · ${e.t.slice(11,19)} ${e.kind} — ${String(e.msg).slice(0,140)}`);
    lines.push(bad.length ? 'Last problems recorded:' : 'Nothing recorded as going wrong.');
    if(bad.length) lines.push(bad.join('\n'));
    return lines.join('\n');
  }
  // Synchronous first: this runs one statement before a mailto: navigation, and the
  // async clipboard resolves too late to be the primary. execCommand is deprecated
  // and still the only synchronous copy there is; the Range dance is what iOS wants.
  function copyTextBestEffort(text){
    let ok = false;
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.contentEditable = 'true'; ta.readOnly = false;
      ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px;pointer-events:none';
      document.body.appendChild(ta);
      const range = document.createRange(); range.selectNodeContents(ta);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
      ta.setSelectionRange(0, text.length);
      ok = document.execCommand('copy');
      sel.removeAllRanges(); ta.remove();
    } catch(e){}
    if(!ok && navigator.clipboard && navigator.clipboard.writeText){
      try { navigator.clipboard.writeText(text); ok = true; } catch(e){}
    }
    return ok;
  }
  // A page cannot attach a file to an email -- mailto: has no such field, in any
  // browser -- so the whole report goes to the clipboard and the draft carries the
  // short version. The PDF is there for when the whole thing is wanted.
  function copyDetailsAndEmail(){
    const said = diagComment();
    const copied = copyTextBestEffort(diagnosticsTextSync(said));
    const body = (said || '(Say what you were doing when it went wrong.)')
      + '\n\n—— from the app, please leave these lines ——\n'
      + reportDigest()
      + (copied ? '\n\nThe full report is on my clipboard — paste it below if you need it.\n' : '\n');
    location.href = 'mailto:edwardm2@miamioh.edu'
      + '?subject=' + encodeURIComponent(reportSubject())
      + '&body=' + encodeURIComponent(body);
    toast(copied ? 'Copied — opening your email' : 'Opening your email');
  }
  function printReport(){
    const text = diagnosticsTextSync(diagComment());
    const w = window.open('', '_blank');
    if(!w){ toast('Your browser blocked the report window — use Copy details instead'); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8">
      <title>Journaler-284 problem report</title><style>
      body { font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
             color: #16202b; background: #fff; margin: 2.2rem auto; max-width: 46rem; padding: 0 1.2rem; }
      h1 { font: 700 15px/1.3 -apple-system, "Segoe UI", sans-serif; letter-spacing: .04em;
           text-transform: uppercase; margin: 0 0 .2rem; }
      .sub { font: 12px/1.4 -apple-system, "Segoe UI", sans-serif; color: #667; margin-bottom: 1.4rem; }
      pre { white-space: pre-wrap; word-break: break-word; margin: 0; }
      button { font: 600 13px/1 -apple-system, "Segoe UI", sans-serif; background: #1A2738; color: #fff;
               border: 0; border-radius: 7px; padding: .6rem 1rem; cursor: pointer; margin-bottom: 1.4rem; }
      @media print { .noprint { display: none } body { margin: 0 } }
      </style></head><body>
      <button class="noprint" onclick="window.print()">Save as PDF / Print</button>
      <h1>Journaler-284 problem report</h1>
      <div class="sub">TCE 284 · build ${escHtml(BUILD)} · ${escHtml(new Date().toString())}</div>
      <pre>${escHtml(text)}</pre>
      </body></html>`);
    w.document.close();
  }

  // ═══ Software updates ═════════════════════════════════════════════════════
  // There is no server to ask, so ask the published page. 284 already has exactly
  // one string that moves on every deploy -- the ?v= hung on app.js to bust the
  // cache -- and BUILD is read from that same tag at load, so this compares the
  // deployed marker against the loaded one with nothing new to keep in step. The
  // page is ~18KB, small enough to just fetch.
  let _update = { state: 'checking' }, _updateCheckedAt = 0;

  async function checkForUpdate(force){
    if(/^dev/.test(BUILD)){ _update = { state: 'dev' }; renderUpdateBox(); return; }
    if(!force && _updateCheckedAt && Date.now() - _updateCheckedAt < 60000){ renderUpdateBox(); return; }
    _update = { state: 'checking' }; renderUpdateBox();
    try {
      const url = new URL('index.html', location.href);
      url.searchParams.set('probe', String(Date.now()));    // never answerable from a cache
      const res = await fetch(url.toString(), { cache: 'no-store' });
      if(!res.ok) throw new Error('HTTP ' + res.status);
      const m = /app\.js\?v=([^"'>\s]+)/i.exec(await res.text());
      if(!m) throw new Error('no build found on the published page');
      _updateCheckedAt = Date.now();
      _update = (m[1] === BUILD) ? { state:'current' } : { state:'available', latest: m[1] };
      logEvent('ui', _update.state === 'available'
        ? 'a newer build is published: ' + m[1] : 'up to date (' + m[1] + ')');
    } catch(e){
      _updateCheckedAt = Date.now();
      _update = { state:'error', message: (e && e.message) || 'could not reach the site' };
      logEvent('error', 'update check failed', String(e && e.message || e));
    }
    renderUpdateBox();
  }

  // A plain reload can be answered with the very bytes it is replacing: Pages sends
  // max-age=600 and Safari honours it. A URL the cache has never seen cannot be.
  // Same origin, so every entry and highlight stays put.
  function applyUpdate(){
    const url = new URL(location.href);
    url.searchParams.delete('probe');
    url.searchParams.set('v', _update.latest || String(Date.now()));
    logEvent('ui', 'updating to ' + (_update.latest || 'the published build'));
    location.replace(url.toString());
  }

  function renderUpdateBox(){
    const host = document.getElementById('diagUpdate');
    if(!host) return;
    const u = _update;
    const again = '<button class="diag-ico" id="updAgain" title="Check again" aria-label="Check again">\u27f3</button>';
    const label = '<span class="diag-box-label">Software updates</span>';
    if(u.state === 'available'){
      // The one state with something to say and something to press.
      host.innerHTML = `<div class="diag-box">${label}
        <div class="diag-upd-row">
          <span class="diag-line new">\u2191 A newer version is published.</span>${again}
        </div>
        <div class="diag-sub">Running ${escHtml(BUILD)}<br>Published ${escHtml(u.latest)}<br>
          Updating reloads the page. Nothing you have written is touched.</div>
        <div class="diag-actions" style="margin:12px 0 0"><button class="am-save" id="updNow">Update now</button></div>
      </div>`;
    } else {
      let line;
      if(u.state === 'checking') line = '<span class="diag-line"><span class="spin">\u27f3</span> Checking\u2026</span>';
      else if(u.state === 'dev')  line = '<span class="diag-line">Local build</span>'
                                       + `<span class="diag-sub">${escHtml(BUILD)} \u2014 nothing to compare against</span>`;
      else if(u.state === 'error') line = '<span class="diag-line warn">Couldn\u2019t check</span>'
                                       + `<span class="diag-sub">${escHtml(u.message)} \u00b7 running ${escHtml(BUILD)}</span>`;
      else line = '<span class="diag-line ok">\u2713 Up to date</span>'
                + `<span class="diag-sub">${escHtml(BUILD)}</span>`;
      host.innerHTML = `<div class="diag-box one-line">${label}${line}${again}</div>`;
    }
    // Wired rather than inline: these live in the module closure, where an
    // onclick attribute cannot reach them.
    const a = document.getElementById('updAgain'); if(a) a.addEventListener('click', () => checkForUpdate(true));
    const n = document.getElementById('updNow');   if(n) n.addEventListener('click', applyUpdate);
  }

  // Flipped in place rather than by re-rendering the pane, so unfolding the log does
  // not rebuild the comment box above it and take the caret out of a half-typed
  // sentence.
  let _diagFoldOpen = false;
  function toggleDiagFold(){
    _diagFoldOpen = !_diagFoldOpen;
    const wrap = document.getElementById('diagFold');
    const caret = document.getElementById('diagCaret');
    const btn = document.getElementById('diagToggle');
    if(wrap) wrap.style.display = _diagFoldOpen ? '' : 'none';
    if(caret) caret.textContent = _diagFoldOpen ? '▾' : '▸';
    if(btn) btn.setAttribute('aria-expanded', String(_diagFoldOpen));
    if(_diagFoldOpen){ renderDiagnostics(); renderDiagSnapshot(); }
  }

  // The name printed on every export. Typed once into the topbar field and stored, so
  // a student never hand-writes it on a PDF. Left empty it prints the blank rule, which
  // is what a paper copy wants.
  const NAME_RULE = '______________________________';
  function printedName(){ const n = (DB.name || '').trim(); return n ? escHtml(n) : NAME_RULE; }
  function wireNameField(){
    const f = document.getElementById('nameField');
    if(!f) return;
    f.value = DB.name || '';
    f.addEventListener('input', () => { DB.name = f.value; saveDB(); });
  }
  // Asked once, at the moment it matters. The topbar field is easy to walk past, and a
  // submitted PDF with a blank name line is a real cost to a student — so the export
  // itself asks rather than trusting anyone to find a box they were never pointed at.
  // Answered once, it never asks again; left blank, the printed rule stands and the
  // export still goes through.
  function ensureName(){
    if((DB.name || '').trim()) return;
    let n = null;
    try { n = window.prompt('Your name, for the top of the PDF:', ''); } catch(e){ return; }
    if(n === null) return;                 // Cancelled — print the blank rule.
    n = n.trim();
    if(!n) return;
    DB.name = n; saveDB();
    const f = document.getElementById('nameField'); if(f) f.value = n;
  }

  // Big reading files (PDF/.docx bytes) are too large for localStorage → IndexedDB.
  migrateReadingIds();
  const READ_DB_NAME = 'cr284_readings';
  // v2 adds 'handles' for the readings-folder handle. The upgrade is idempotent so
  // an existing v1 database keeps its files.
  function _readingDB(){ return new Promise((resolve,reject)=>{ let req; try{ req = indexedDB.open(READ_DB_NAME,2); }catch(e){ reject(e); return; } req.onupgradeneeded = ()=>{ const db = req.result; if(!db.objectStoreNames.contains('files')) db.createObjectStore('files'); if(!db.objectStoreNames.contains('handles')) db.createObjectStore('handles'); }; req.onsuccess = ()=>resolve(req.result); req.onerror = ()=>reject(req.error); req.onblocked = ()=>reject(new Error('Journaler is open in another tab — close it so storage can upgrade.')); }); }
  async function idbPut(store, key, val){ const db = await _readingDB(); return new Promise((res,rej)=>{ const tx = db.transaction(store,'readwrite'); tx.objectStore(store).put(val,key); tx.oncomplete = res; tx.onerror = ()=>rej(tx.error); tx.onabort = ()=>rej(tx.error); }); }
  async function idbGet(store, key){ const db = await _readingDB(); return new Promise((res,rej)=>{ const tx = db.transaction(store,'readonly'); const r = tx.objectStore(store).get(key); r.onsuccess = ()=>res(r.result||null); r.onerror = ()=>rej(r.error); }); }
  async function idbDel(store, key){ const db = await _readingDB(); return new Promise((res,rej)=>{ const tx = db.transaction(store,'readwrite'); tx.objectStore(store).delete(key); tx.oncomplete = res; tx.onerror = ()=>rej(tx.error); }); }
  // NB: this used to swallow write failures, so a reading could be added to the
  // shelf with no bytes behind it and only fail later at render ("This file isn't
  // stored in this browser"). It now throws; the caller decides what to show.
  async function saveReadingBytes(id, buf){ await idbPut('files', id, buf); }
  async function loadReadingBytes(id){ try{ return await idbGet('files', id); }catch(e){ console.warn('loadReadingBytes',e); return null; } }

  // Export EVERYTHING typed as one file; import restores it, then reloads to re-init.
  // ONE export, and it always carries the readings. There is no "quick save" worth
  // separating out: typing is already saved to the browser on every keystroke, so this
  // button was never the frequent action — it is the take-it-elsewhere action, which is
  // occasional by nature. A second button only offered a way to arrive at another
  // machine missing your chapters.
  function saveWork(){ return exportEverything(document.getElementById('saveWorkBtn')); }

  // ── Conversation transcript, following verbatim-app's reader.html.
  //    Its header is the part worth copying: student words and AI words reported
  //    SEPARATELY, side by side, alongside provider and model. The file states its
  //    own provenance instead of leaving a reader to guess who wrote what. One
  //    self-contained page -- no viewer needed, opens anywhere, prints.
  // wordCount() takes a STRING; wordsIn() near the notebook code takes an ENTRY. They
  // were both called wordsIn, in the same IIFE scope, so the later declaration silently
  // won and this one never ran -- handed a string it read `.text` off it and returned 0.
  // Nothing was ever stored wrong: these counts are computed at export time, so fixing
  // the name fixed every past conversation too. It now feeds ONE place, the header's
  // "N mine · N Romano's" split, which is the only quantified backing for the claim
  // that the partner's words are not the student's.
  function wordCount(s){ const t = String(s||'').trim(); return t ? t.split(/\s+/).length : 0; }
  function buildTranscriptHTML(){
    const esc = s => String(s==null?'':s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    const all = allQA() || {};
    const byReading = [];
    let stuW = 0, aiW = 0, turns = 0;
    for(const r of readings){
      const list = (all[r.id] || []).filter(x => x.reply);
      if(!list.length) continue;
      list.forEach(x => { stuW += wordCount(x.question); aiW += wordCount(x.reply); turns++; });
      byReading.push({ r, list });
    }
    const model = (typeof getProvider === 'function' && getProvider() === 'local')
      ? (typeof getLocalModel === 'function' ? getLocalModel() : '') : '';
    const fact = (k,v) => `<div class="fact"><span class="k">${esc(k)}</span><span class="v">${esc(v==null||v===''?'—':v)}</span></div>`;
    const now = new Date();
    let h = `<div class="facts">`
      + fact('Name', (DB.name||'').trim())
      + fact('Readings', byReading.length)
      + fact('Exchanges', turns)
      // The whole point of the header, borrowed from verbatim: never one merged number.
      + fact('Words', `${stuW} mine · ${aiW} Romano's`)
      + fact('AI provider', typeof getProvider === 'function' ? getProvider() : '—')
      + fact('Model', model)
      + fact('Exported', now.toLocaleString())
      + `</div>`
      + `<p class="note">Words are counted separately on purpose. The partner's words are
         not mine and are not part of what I wrote. Kept exchanges do not count toward
         notebook entries or word counts.</p>`;
    for(const {r, list} of byReading){
      h += `<h2>${esc(readingLabel(r))}</h2>`;
      for(const x of list){
        const cite = x.page ? `${readingLabel(r)}, p. ${x.page}` : readingLabel(r);
        h += `<section class="ex">`;
        if(x.passage || x.quote) h += `<blockquote class="passage">${esc(x.passage || x.quote)}<cite>— ${esc(cite)}</cite></blockquote>`;
        h += `<div class="turn me"><p class="who">I asked</p><div class="text">${esc(x.question || 'Help me think about this passage.')}</div></div>`;
        h += `<div class="turn ai"><p class="who">Romano</p><div class="text">${esc(x.reply)}</div><p class="meta">not my writing</p></div>`;
        h += `</section>`;
      }
    }
    if(!byReading.length) h += `<p class="note">No conversations yet.</p>`;
    return `<!doctype html><meta charset="utf-8"><title>Journaler conversations — ${esc((DB.name||'').trim()||'untitled')}</title>
<style>
 body{font:16px/1.55 Georgia,serif;max-width:44rem;margin:2.5rem auto;padding:0 1.2rem;color:#26241f;background:#faf7f1}
 h1{font-size:1.5rem;margin:0 0 .2rem} h2{font-size:1.05rem;margin:2.2rem 0 .6rem;border-bottom:1px solid #ddd6c8;padding-bottom:.2rem}
 .facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(11rem,1fr));gap:.3rem .9rem;margin:1rem 0}
 .fact{display:flex;gap:.4rem;font-size:.82rem} .fact .k{color:#8a8271} .fact .v{font-weight:600}
 .note{font-size:.8rem;color:#6d6559;font-style:italic;border-left:2px solid #ddd6c8;padding-left:.7rem}
 .ex{margin:1.4rem 0;padding-bottom:1rem;border-bottom:1px dotted #ddd6c8}
 .passage{margin:0 0 .7rem;padding:.5rem .8rem;background:#f1ece1;border-left:3px solid #c69a5c;font-size:.9rem;color:#4a4438}
 .passage cite{display:block;margin-top:.3rem;font-size:.78rem;color:#8a8271;font-style:normal}
 .turn{margin:.6rem 0} .who{margin:0 0 .15rem;font-size:.75rem;letter-spacing:.04em;text-transform:uppercase;color:#8a8271}
 .turn.ai .text{background:#f1ece1;padding:.5rem .8rem;border-radius:6px}
 .meta{margin:.2rem 0 0;font-size:.72rem;color:#9a9182}
 @media print{body{background:#fff;margin:0;max-width:none}}
</style>
<h1>Conversations with Romano</h1>${h}`;
  }
  function exportTranscript(btn){
    try{
      const blob = new Blob([buildTranscriptHTML()], { type:'text/html;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const d = new Date(), pad = n => String(n).padStart(2,'0');
      a.download = `journaler-conversations-${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.html`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
      toast('Saved your conversations.');
    }catch(e){ console.warn('exportTranscript', e); toast('Could not build the file: ' + (e.message||e)); }
  }
  // ── Export everything: the JSON plus the reading FILES, as one zip. Save my work is
  //    the small, frequent backup; this is the occasional artifact you carry to another
  //    machine, so a second computer needs ONE file instead of a save file plus a pile
  //    of chapters. Deliberately vendor-neutral: a zip on a thumb drive, on any cloud,
  //    or on none. jszip is already vendored for .docx, so this adds no dependency.
  async function exportEverything(btn){
    if(typeof JSZip === 'undefined'){ toast('Zip library not loaded — use ⤓ Save my work.'); return; }
    const label = btn && btn.textContent;
    if(btn){ btn.disabled = true; btn.textContent = 'Packing…'; }
    try {
      const zip = new JSZip();
      zip.file('journaler-284.json', JSON.stringify({ app:'journaler-284', v:1, exported:new Date().toISOString(), state:DB }, null, 2));
      const folder = zip.folder('readings');
      let n = 0, packed = 0;
      const missing = [];
      for(const r of readings){
        // The manual ships with the app, and .txt readings already ride inside the JSON.
        if(r.builtin || r.type === 'txt') continue;
        let bytes = null;
        try { bytes = await readingBytesFor(r); } catch(e){}
        // NEVER skip quietly. This used to `continue`, so a reading whose bytes could not
        // be read was simply absent from a zip that still reported success — you would
        // discover it on the other machine, which is the worst possible moment.
        if(!bytes){ missing.push(r.name); continue; }
        folder.file(r.name, bytes);      // by FILENAME — that is what re-attaches highlights
        packed += (bytes.byteLength || 0);
        n++;
      }
      // STORE, not DEFLATE: PDFs are already compressed, so deflating them costs seconds
      // of CPU for roughly nothing. Packing becomes a copy, which is what makes carrying
      // the readings cheap enough to do on every save.
      const blob = await zip.generateAsync({ type:'blob', compression: 'STORE' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      // LOCAL date and time, not toISOString: the stamp is for a human sorting their own
      // saves, and UTC would show the wrong hour for most of the day.
      const d = new Date(), pad = n => String(n).padStart(2, '0');
      const stamp = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
      a.download = 'journaler-284-' + stamp + '.zip';
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
      const mb = (packed/1048576).toFixed(1);
      if(missing.length){
        alert('Saved — but ' + missing.length + ' reading' + (missing.length>1?'s':'') +
          ' could NOT be included:\n\n' + missing.join('\n') +
          '\n\nIf these came from a readings folder, reconnect it in the Readings tab and save again. ' +
          'Otherwise load them with ＋ Load readings first.\n\n' +
          'The ' + n + ' reading' + (n===1?'':'s') + ' that did pack came to ' + mb + ' MB.');
      } else {
        toast(n ? `Saved your work and ${n} reading${n>1?'s':''} (${mb} MB).` : 'Saved your work — no readings loaded.');
      }
    } catch(e){ console.warn('exportEverything', e); toast('Could not build the zip: ' + (e.message||e)); }
    finally { if(btn){ btn.disabled = false; btn.textContent = label; } }
  }

  // Restore from a zip: write the reading bytes back under filename-derived ids so the
  // highlights in the JSON find their pages, THEN hand the JSON to the normal restore.
  // Opening a file REPLACES everything in this browser, and it is the only destructive
  // act a student can reach in one click. It used to happen in silence: pick last
  // month's backup by mistake and a term of writing is gone, no undo, nothing on screen
  // to say so. Todd, 23 Aug 2026: "we have to be absolutely positive that a student's
  // work will survive." Updates already do -- localStorage is keyed to the origin and a
  // deploy never touches it. THIS is the path that loses work, so it now says what it
  // is about to throw away, what it is about to put there, and counts both.
  // ⚠ COUNT THE MARKS TOO (Todd, 2026-08-26). This weighed notebook entries alone and
  // bailed out early on `if(!now) return true`. After marks stopped counting as entries,
  // a browser holding a whole term of marking and no reflections reported ZERO -- so a
  // restore replaced it with no warning at all, which is the one accident this dialog
  // exists to prevent. Both counts now, and a warning if EITHER shrinks.
  function countMarks(st){
    const h = st && st.highlights;
    if(!h || typeof h !== 'object') return 0;
    return Object.keys(h).reduce((n, k) => n + ((h[k] || []).length), 0);
  }
  function confirmReplace(incoming){
    const nowE  = (DB.journal || []).length,  nowM  = countMarks(DB);
    const nextE = Array.isArray(incoming && incoming.journal) ? incoming.journal.length : 0;
    const nextM = countMarks(incoming);
    if(!nowE && !nowM) return true;             // genuinely nothing here to lose
    const ent  = n => n + ' notebook ' + (n === 1 ? 'entry' : 'entries');
    const mark = n => n + ' marked ' + (n === 1 ? 'passage' : 'passages');
    const lines = ['This REPLACES everything in this browser. It cannot be undone.', '',
                   'In this browser now:   ' + ent(nowE)  + ' \u00b7 ' + mark(nowM),
                   'In the file you chose: ' + ent(nextE) + ' \u00b7 ' + mark(nextM), ''];
    if(nextE < nowE) lines.push('\u26a0 The file has FEWER entries than this browser.',
                                '   You would lose ' + (nowE - nextE) + '.', '');
    if(nextM < nowM) lines.push('\u26a0 The file has FEWER marked passages than this browser.',
                                '   You would lose ' + (nowM - nextM) + ', with the notes on them.', '');
    lines.push('If you are not sure, press Cancel and use \u2913 Save my work first.', '',
               'Replace everything?');
    return confirm(lines.join('\n'));
  }
  async function openZip(file){
    if(typeof JSZip === 'undefined'){ alert('Zip library not loaded.'); return; }
    const zip = await JSZip.loadAsync(file);
    const jsonEntry = zip.file('journaler-284.json') || zip.file(/\.json$/)[0];
    if(!jsonEntry) throw new Error('no journaler-284.json inside this zip');
    for(const path of Object.keys(zip.files)){
      const entry = zip.files[path];
      if(entry.dir || !/^readings\//.test(path)) continue;
      const name = path.replace(/^readings\//, '');
      if(!name || !/\.(pdf|docx|txt)$/i.test(name)) continue;
      try { await saveReadingBytes(readingIdForName(name), await entry.async('arraybuffer')); } catch(e){ console.warn('restore', name, e); }
    }
    const d = JSON.parse(await jsonEntry.async('string'));
    const st = d && d.state ? d.state : d;
    if(!st || typeof st !== 'object') throw new Error('not a Journaler file');
    if(!confirmReplace(st)) return;
    localStorage.setItem(LS_KEY, JSON.stringify(st));
    location.reload();
  }

  function openWork(file){
    if(/\.zip$/i.test(file.name)){
      openZip(file).catch(err => alert('Could not open that zip: ' + err.message));
      return;
    }
    const r = new FileReader();
    r.onload = e => { try {
      const d = JSON.parse(e.target.result);
      const st = d && d.state ? d.state : d;
      if(!st || typeof st !== 'object') throw new Error('not a Journaler file');
      if(!confirmReplace(st)) return;
      localStorage.setItem(LS_KEY, JSON.stringify(st));
      location.reload();
    } catch(err){ alert('Could not open that file: ' + err.message); } };
    r.readAsText(file);
  }

  // ═══ Notebook journal — living, dated pages (318P model). The student ELEVATES
  //     a draft into an entry with "＋ Add to notebook"; nothing is auto-logged.
  //     Entries thread by piece, so one piece's passes stack across the term.
  //     entry = { id, pieceId, pieceKind, pieceTitle, ts, date, edited, text }
  if(!Array.isArray(DB.journal)) DB.journal = [];
  // One-time migration of the earlier flat DB.notebook quick-writes into the journal.
  if(DB.notebook && !DB._journalMigrated){
    for(const date in DB.notebook){ for(const e of (DB.notebook[date]||[])){
      DB.journal.push({ id:'j'+Date.now()+Math.round(Math.random()*1e5), pieceId:'free', pieceKind:'freewrite', pieceTitle:'Free-writes & quick-writes', ts:new Date(date+'T12:00:00').toISOString(), date, edited:new Date(date+'T12:00:00').toISOString(), text:(e&&e.x)||'' });
    } }
    DB._journalMigrated = true; saveDB();
  }
  const PIECE_ORDER = ['baseline','op1','op2','op3','op4','op5','cur-reg','cur-pro','cur-ana','cur-syn',
                       'topicmap','sources','free','reading','letter'];
  // Reading pieces are one-per-chapter, so they share a rank and cluster together
  // after the writing pieces instead of scattering into the unknown bucket.
  function pieceRank(id){
    if(String(id).indexOf('reading') === 0) return PIECE_ORDER.length;
    const i = PIECE_ORDER.indexOf(id); return i<0 ? 99 : i;
  }
  let _toastT;
  // A toast may carry ONE action. A message that names a place the student cannot see
  // from the writing surface, and then vanishes in 1.7s without offering a route there,
  // is only a claim that something happened. With an action the toast stays up long
  // enough to be clicked and is the only pointer-events:auto thing on screen; without
  // one it behaves exactly as it always did.
  // ⚠ NO NATIVE DIALOG ON A DESTRUCTIVE PATH (Todd, 2026-08-30, in Firefox: "I
  // accidentally clicked do not allow local host to prompt me. Now I can't delete
  // things. Help!"). A suppressed confirm() does not throw and does not warn — it
  // returns FALSE, instantly, which every caller here read as "the reader pressed
  // Cancel". One browser checkbox silently disabled every delete in the app, with no
  // way for the app to tell and no way for the reader to tell either.
  //
  // Ask-first was never the only option. Do the thing, say what was done, and hold the
  // old value for as long as the toast is up: one click instead of two when it was
  // meant, and genuinely reversible when it was not — which is more than a confirm ever
  // offered. Nothing here can be switched off by a browser setting.
  // ⚠ NO TIMER ON THIS ONE (Todd, 2026-08-30): "I just don't want them to delete the
  // wrong thing on accident and not be able to get back. I think offering the deletion
  // back should happen until they make a decision (not only for a few seconds)."
  // Four seconds is the wrong shape for the mistake it is meant to catch — "that was
  // the wrong one" is a thought that arrives AFTER the thing has gone, when the reader
  // looks up and the passage they wanted is not in the margin. So the offer waits.
  //
  // ⚠ AND THE OFFER IS NOT THE TOAST'S TO THROW AWAY (found 2026-08-30 by driving the
  // real app, not by reading it). There is ONE toast element, and every message in the
  // app writes through it. So an offer with no timer of its own still died two ways:
  //   · a second deletion overwrote the first offer, committing it with no way back and
  //     no decision from the reader — the exact accident this was built to catch, and
  //     two stray clicks on adjacent trash icons is how you get there;
  //   · any ORDINARY message — "Tagged: Week 1 baseline" — overwrote the offer in place
  //     and then hid the element on ITS 1.7s timer. The reader did something harmless
  //     and unrelated, and the way back went with it.
  // The receipts still fade; they should. They are now temporary TENANTS of the element
  // instead of its owners: when one expires the standing offer comes back up. And the
  // offers queue, newest shown, so every deletion gets its own decision.
  let _offers = [];   // deletions awaiting a decision — newest last

  function undoably(said, undo){
    _offers.push({ said: said, undo: undo });
    showOffer();
  }

  // Paint the newest offer. Returns false when there is none, which is how the toast
  // knows whether hiding is actually the right thing to do.
  function showOffer(){
    const o = _offers[_offers.length - 1];
    if(!o) return false;
    const waiting = _offers.length - 1;
    toast(o.said + (waiting ? ` · and ${waiting} more you can still undo` : ''),
      // Undo takes back the newest and then re-offers the one before it: one decision
      // per deletion, which is the promise.
      { label: 'Undo', onClick: () => { _offers.pop(); o.undo(); showOffer(); } },
      // Dismiss ends ALL of them. It is the "yes, I meant that" half of the decision,
      // and a reader clearing out ten highlights should not have to say it ten times.
      // Nothing is destroyed by this that was not already destroyed.
      { decide: true, onDismiss: () => { _offers = []; } });
    return true;
  }

  // action = { label, onClick } — a passing offer, taken or missed in a few seconds.
  // opts.decide = true — the offer WAITS. Nothing fades out from under the reader; it
  // stands until they take it or dismiss it.
  function toast(msg, action, opts){
    opts = opts || {};
    let el = document.getElementById('cr284Toast');
    if(!el){ el = document.createElement('div'); el.id = 'cr284Toast'; el.style.cssText = 'position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:var(--ink);color:var(--parchment);font-family:var(--sans);font-size:15px;padding:9px 16px;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.25);z-index:60;opacity:0;transition:opacity .2s;pointer-events:none;display:flex;align-items:center;gap:14px'; document.body.appendChild(el); }
    const hide = () => { el.style.opacity = '0'; el.style.pointerEvents = 'none'; };
    // ⚠ NOT hide(). A message that has run its course gives the element back to any
    // offer still waiting on a decision, and only hides when there is none.
    const settle = () => { if(!showOffer()) hide(); };
    el.textContent = '';
    el.appendChild(document.createTextNode(msg));
    el.style.pointerEvents = action ? 'auto' : 'none';
    if(action){
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'toastact'; b.textContent = action.label;
      b.onclick = () => { clearTimeout(_toastT); hide(); action.onClick(); };
      el.appendChild(b);
      if(opts.decide){
        // The other half of the decision, and it has to be here: a message that never
        // goes away on its own needs a way to be sent away.
        const d = document.createElement('button');
        d.type = 'button'; d.className = 'toastact toastdismiss'; d.textContent = 'Dismiss';
        d.onclick = () => { clearTimeout(_toastT); if(opts.onDismiss) opts.onDismiss(); settle(); };
        el.appendChild(d);
      }
    }
    el.style.opacity = '1'; clearTimeout(_toastT);
    if(!opts.decide) _toastT = setTimeout(settle, action ? 4200 : 1700);
  }
  function elevate(pieceId, pieceKind, pieceTitle, text, dateKey, meta){
    text = (text||'').trim();
    if(!text){ toast('Nothing to keep yet — write something first.'); return null; }
    const now = new Date();
    const entry = Object.assign({ id:'j'+now.getTime()+Math.round(Math.random()*1e5), pieceId, pieceKind, pieceTitle, ts:now.toISOString(), date: dateKey || now.toISOString().slice(0,10), edited: now.toISOString(), text }, meta || {});
    DB.journal.push(entry); saveDB();
    // Offered, never forced: the student stays on the writing surface unless they choose
    // otherwise. Jumping straight to the notebook was the other candidate and was
    // rejected -- it is the strongest "it saved" signal but it breaks the writing.
    // A capture is not yet an entry, and saying "kept in your notebook" of one would
    // be the whole misunderstanding in a single word.
    if(entry.capture) toast('Passage kept with this reading — write what you make of it to log an entry',
      { label: 'Notebook →', onClick: () => { noteMode = 'tags'; show('note'); } });
    else toast('Kept in your notebook ✎', { label: 'View →', onClick: () => revealEntry(entry) });
    return entry;
  }
  // Open the notebook ON the entry just kept.
  //
  // The by-day lens is forced because it is the only one guaranteed to show a brand-new
  // entry. Tags and Threads both FILTER: a page is listed there only once it has been
  // tagged or threaded, which a page kept one second ago has not been. A student who
  // clicked "View" and landed on a lens that did not list their entry would read that as
  // the app having lost it -- the exact anxiety this link exists to answer.
  // The row carries data-entryrow, NOT data-entry: the tag and thread <select>s inside
  // each card already use data-entry for the id they act on, and one attribute meaning
  // two things is how a future querySelectorAll('[data-entry]') quietly picks up wrappers.
  function revealEntry(entry){
    if(!entry) return;
    noteMode = 'day'; noteSel = entry.date; nbEditingId = null;
    show('note');
    // After renderNote() has put the row in the document, not before.
    requestAnimationFrame(() => {
      const el = document.querySelector('[data-entryrow="' + entry.id + '"]');
      if(!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('justkept');
      setTimeout(() => el.classList.remove('justkept'), 2200);
    });
  }
  // NB: named shapedPageText, not pageText -- `pageText(rid, doc, n)` already exists
  // further down as the PDF page-text extractor for Romano's grounding. Two function
  // declarations of one name in this IIFE means the later wins silently, and this one
  // would have handed elevate() a Promise to store as the entry's text.
  // The shaped One-Pager is contenteditable HTML; the notebook stores plain text. Block
  // boundaries have to survive the conversion or a shaped page arrives in the notebook as
  // one run-on paragraph, so they become newlines before the tags are dropped.
  function shapedPageText(el){
    if(!el) return '';
    const d = document.createElement('div');
    d.innerHTML = String(el.innerHTML || '')
      .replace(/<\/(p|h[1-6]|li|div|blockquote)>/gi, '\n\n')
      .replace(/<br\s*\/?>/gi, '\n');
    return (d.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
  }
  // ═══ Selection popup for the student's OWN writing ════════════════════════
  //
  // The reading view has had this since the Marginalia port (capturePopup): highlight a
  // passage, then Copy / Keep in notebook / Ask Romano. It only ever worked on the book.
  // Todd: "the real missing feature is being able to highlight any text and copy it to
  // the clipboard, to the notebook, or ask Romano. This was the old behavior of
  // Marginalia-app that got lost." This is that behaviour on the writing surfaces.
  //
  // ⚠ A <textarea> selection is INVISIBLE to window.getSelection() -- it returns an
  //   empty string in every browser. The gush is a textarea, and the gush is the case
  //   Todd wrote the request in. So textareas are read through selectionStart/End and
  //   everything else through the Selection API.
  let _selText = '', _selWhere = null, _lastPtr = { x: 0, y: 0 };
  // Every place a student's OWN words appear as text they can drag over. `.qa-say`
  // covers BOTH halves of a chat turn -- what they asked and what Romano answered --
  // because Todd asked for exactly that: "in the chats ... in Romano AI responses in
  // chat". Any <textarea> is handled by the branch below, which is what picks up the
  // gushes, the notebook composer and the reflection answer without naming them.
  //
  // The PDF text layer is deliberately absent: capturePopup owns it, and two popups
  // fighting over one selection is worse than either. That is an ALLOWLIST doing the
  // work -- an earlier version gated on `tab === 'read'`, which also locked out the
  // chat, and the chat is in the Readings tab.
  const WRITE_HOSTS = '#page, .entryrow .x, .entry-edit, .qa-say, .qa-quote';

  function readWriteSelection(){
    const ae = document.activeElement;
    if(ae && ae.tagName === 'TEXTAREA' && typeof ae.selectionStart === 'number'){
      const t = String(ae.value || '').slice(ae.selectionStart, ae.selectionEnd).trim();
      return t ? { text: t, el: ae } : null;
    }
    const sel = window.getSelection();
    if(!sel || sel.isCollapsed) return null;
    const t = String(sel).trim();
    if(!t) return null;
    const n = sel.anchorNode;
    const el = n && (n.nodeType === 1 ? n : n.parentElement);
    const host = el && el.closest(WRITE_HOSTS);
    if(!host) return null;
    if(el.closest('#docPane')) return null;      // the page image/text layer is capturePopup's
    return { text: t, el: host };
  }

  // Where a kept selection files itself. The notebook groups by piece, so a line lifted
  // out of One-Pager 3 belongs to One-Pager 3, not to a generic bucket.
  function selectionPiece(){
    if(tab === 'free' && OPS[fwCur]) return { id: fwCur, kind: 'freewrite', title: 'One-Pager ' + OPS[fwCur].n + ' · ' + OPS[fwCur].t };
    if(tab === 'cur'  && MO[curCur]) return { id: 'cur-' + curCur, kind: 'currere', title: MO[curCur].k + ' · ' + MO[curCur].t };
    return { id: 'free', kind: 'freewrite', title: 'Free-writes & quick-writes' };
  }

  // ── Where the selection actually IS on screen.
  //
  // A <textarea> has no Range, so there is no rectangle to ask for. The standard answer
  // is a mirror: an off-screen div wearing the textarea's own metrics, holding the same
  // text with the selected run in a <span>, whose box can be measured. Without this the
  // popup can only be placed at the pointer -- which is how it ended up sitting on top
  // of the words it is asking about.
  const MIRROR_PROPS = ['boxSizing','width','paddingTop','paddingRight','paddingBottom','paddingLeft',
    'borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','fontFamily','fontSize',
    'fontWeight','fontStyle','letterSpacing','lineHeight','textTransform','wordSpacing','textIndent'];
  function textareaSelectionRect(ta){
    try {
      const cs = getComputedStyle(ta);
      const div = document.createElement('div');
      MIRROR_PROPS.forEach(p => { div.style[p] = cs[p]; });
      div.style.position = 'absolute'; div.style.left = '-9999px'; div.style.top = '0';
      div.style.visibility = 'hidden'; div.style.whiteSpace = 'pre-wrap';
      div.style.overflowWrap = 'break-word'; div.style.height = 'auto';
      const head = document.createTextNode(ta.value.slice(0, ta.selectionStart));
      const span = document.createElement('span');
      span.textContent = ta.value.slice(ta.selectionStart, ta.selectionEnd) || '.';
      div.appendChild(head); div.appendChild(span);
      document.body.appendChild(div);
      const t = ta.getBoundingClientRect(), d = div.getBoundingClientRect(), s = span.getBoundingClientRect();
      const r = { left: t.left + (s.left - d.left),
                  right: t.left + (s.right - d.left),
                  top: t.top + (s.top - d.top) - ta.scrollTop,
                  bottom: t.top + (s.bottom - d.top) - ta.scrollTop };
      div.remove();
      // A selection scrolled out of view gives a rect outside the box; clamp to it so
      // the popup never flies off to where nothing is visible.
      if(r.bottom < t.top || r.top > t.bottom) return t;
      return r;
    } catch(e){ return ta.getBoundingClientRect(); }
  }
  function selectionRect(el){
    if(el && el.tagName === 'TEXTAREA') return textareaSelectionRect(el);
    const sel = window.getSelection();
    if(sel && sel.rangeCount){
      const r = sel.getRangeAt(0).getBoundingClientRect();
      if(r && (r.width || r.height)) return r;
    }
    return el ? el.getBoundingClientRect() : { left:_lastPtr.x, right:_lastPtr.x, top:_lastPtr.y, bottom:_lastPtr.y };
  }

  // ── "All writing should be fair game to reinvision, expand upon, revise in the
  //    notebook. But it's not a place to hold final drafts from other places."
  //    -- Todd, 23 Aug 2026.
  //
  // The Guidelines put it as a rule: "Your timed One-Pager gushes do not go here. Each
  // one is submitted on sheet two of the One-Pager PDF it produced ... Nothing gets
  // counted twice." A LINE lifted out of a gush is not that -- it is a seed the student
  // means to do something else with, and that is the whole point of the notebook. The
  // WHOLE gush is that, exactly.
  //
  // So the test is proportion, not origin: nearly all of a One-Pager surface reads as
  // the draft itself, and on THAT surface "To notebook" is withdrawn rather than merely
  // warned about -- Todd, 23 Aug 2026: "Let's get rid of sending the whole thing of
  // anything to notebook. Student selects passages."
  //
  // ⚠ SCOPED TO ONE-PAGERS ON PURPOSE, and the Guidelines are why. They list what the
  //   notebook holds WHOLE: "Every free-write, including the Week 1 ... baseline and the
  //   daily openers", "in-class quick-writes", "your currere gushes, brainstorms, and
  //   storyboard notes", "your research topic map and source notes", "the Week 15
  //   Look-Back Letter". Four of those are the Required entries row (5 pts) and the
  //   Letter is its own row (10 pts). A rule that let students keep passages only would
  //   put 15 of the 50 points out of reach and undercount Row 1, which counts entries.
  //   The timed One-Pager gush is the single thing the Guidelines send elsewhere.
  const WHOLE_DRAFT_RATIO = 0.9, WHOLE_DRAFT_MIN = 200;
  function wholeDraftNote(text, el){
    if(tab !== 'free' || !OPS[fwCur]) return '';
    let src = '';
    if(el && el.tagName === 'TEXTAREA') src = String(el.value || '');
    else if(el && el.id === 'page') src = shapedPageText(el);
    else return '';
    const whole = src.trim().length;
    if(whole < WHOLE_DRAFT_MIN) return '';
    if(text.trim().length / whole < WHOLE_DRAFT_RATIO) return '';
    return 'That is the whole draft, so it cannot go to the notebook \u2014 it is already '
         + 'submitted on sheet two of this One-Pager\u2019s PDF, and nothing gets counted twice. '
         + 'Select the part you want to rework and keep that.';
  }

  function ensureWritePopup(){
    let pop = document.getElementById('writePopup');
    if(pop) return pop;
    pop = document.createElement('div');
    pop.className = 'selection-popup'; pop.id = 'writePopup'; pop.style.display = 'none';
    pop.innerHTML = '<div class="popup-passage" id="wpPassage"></div>'
      + '<input type="text" id="wpInput" placeholder="Ask ' + AI_NAME + ' about this…" autocomplete="off">'
      + '<div class="popup-hint" id="wpHint"></div>'
      + '<div class="wp-note" id="wpNote" style="display:none"></div>'
      + '<div class="wp-answer" id="wpAnswer" style="display:none"></div>'
      + '<div class="popup-quick">'
      +   '<button class="popup-chip" id="wpCopy">⧉ Copy</button>'
      +   '<button class="popup-chip nb" id="wpNb">📓 To notebook</button>'
      + '</div>'
      + '<div class="popup-actions">'
      +   '<button class="popup-btn secondary" id="wpCancel">Cancel</button>'
      +   '<button class="popup-btn primary" id="wpAsk">Ask ' + AI_NAME + '</button>'
      + '</div>';
    document.body.appendChild(pop);
    // ⚠ THE SELECTION MUST STAY PAINTED. A browser stops drawing a selection the moment
    // its element loses focus, so anything here that takes focus makes the highlighted
    // words go grey -- exactly when the student is deciding what to do with them.
    // Todd: "the text I highlighted should remain highlighted until I make a decision."
    // Suppressing mousedown on the popup's chrome keeps focus, and the highlight, where
    // the words are. The input is exempt: clicking it means they have already chosen to
    // ask, and it cannot be typed into without focus.
    pop.addEventListener('mousedown', function(e){
      if(e.target.id !== 'wpInput') e.preventDefault();
    });
    pop.querySelector('#wpCancel').onclick = closeWritePopup;
    pop.querySelector('#wpCopy').onclick   = copyWriteSelection;
    pop.querySelector('#wpNb').onclick     = keepWriteSelection;
    pop.querySelector('#wpAsk').onclick    = askWriteSelection;
    pop.querySelector('#wpInput').addEventListener('keydown', function(e){
      if(e.key === 'Enter'){ e.preventDefault(); askWriteSelection(); }
      if(e.key === 'Escape'){ e.preventDefault(); closeWritePopup(); }
      e.stopPropagation();
    });
    return pop;
  }

  function closeWritePopup(){
    const pop = document.getElementById('writePopup');
    if(!pop) return;
    pop.style.display = 'none';
    const i = pop.querySelector('#wpInput'); if(i) i.value = '';
    const a = pop.querySelector('#wpAnswer'); if(a){ a.style.display = 'none'; a.textContent = ''; }
    if(_selWhere && _selWhere.classList) _selWhere.classList.remove('wp-source');
    _selText = ''; _selWhere = null;
  }

  function openWritePopup(text, el){
    const pop = ensureWritePopup();
    if(_selWhere && _selWhere.classList) _selWhere.classList.remove('wp-source');
    _selText = text; _selWhere = el;
    if(el && el.classList) el.classList.add('wp-source');
    pop.querySelector('#wpPassage').textContent = text.length > 100 ? text.slice(0, 100) + '…' : text;
    const a = pop.querySelector('#wpAnswer'); a.style.display = 'none'; a.textContent = '';
    const note = wholeDraftNote(text, el), noteEl = pop.querySelector('#wpNote');
    noteEl.textContent = note; noteEl.style.display = note ? 'block' : 'none';
    // Copy and Ask still work on a whole draft; only the filing of it goes away.
    pop.querySelector('#wpNb').style.display = note ? 'none' : '';
    // With no AI connected, Copy and To notebook still work -- they are why a student
    // without a key can use this at all. Only the asking disappears.
    const noAI = getProvider() === 'none';
    pop.querySelector('#wpInput').style.display = noAI ? 'none' : '';
    pop.querySelector('#wpAsk').style.display   = noAI ? 'none' : '';
    pop.querySelector('#wpHint').textContent    = noAI
      ? 'Connect an AI (top right) to ask ' + AI_NAME + ' about this.'
      : 'Enter asks ' + AI_NAME;
    pop.style.display = 'block';
    // Anchored to the SELECTION, never the pointer, and never over it: below the last
    // line if there is room, above the first line if there is not. Centred on the run of
    // words so it reads as belonging to them.
    const r = selectionRect(el);
    const w = pop.offsetWidth || 340, h = pop.offsetHeight || 190;
    const GAP = 10;
    let left = (r.left + r.right) / 2 - w / 2;
    if(left < 10) left = 10;
    if(left + w > window.innerWidth - 10) left = window.innerWidth - w - 10;
    let top = r.bottom + GAP;
    if(top + h > window.innerHeight - 10){
      const above = r.top - h - GAP;
      top = above >= 10 ? above : Math.max(10, window.innerHeight - h - 10);
    }
    pop.style.left = Math.round(left) + 'px'; pop.style.top = Math.round(top) + 'px';
    // Deliberately NOT focusing the input -- see the mousedown note above.
  }

  function maybeOpenWritePopup(){
    // If the reading popup is already up, that selection is its business.
    const cap = document.getElementById('capturePopup');
    if(cap && cap.style.display !== 'none') return;
    const pop = document.getElementById('writePopup');
    if(pop && pop.style.display !== 'none') return;
    const hit = readWriteSelection();
    if(!hit || hit.text.length < 3) return;
    openWritePopup(hit.text, hit.el);
  }

  document.addEventListener('mouseup', function(e){
    if(e.target.closest && e.target.closest('.selection-popup')) return;
    _lastPtr = { x: e.clientX, y: e.clientY };
    setTimeout(maybeOpenWritePopup, 10);
  });
  document.addEventListener('mousedown', function(e){
    const pop = document.getElementById('writePopup');
    if(pop && pop.style.display !== 'none' && !pop.contains(e.target)) closeWritePopup();
  });
  document.addEventListener('keydown', function(e){
    const pop = document.getElementById('writePopup');
    if(e.key === 'Escape' && pop && pop.style.display !== 'none') closeWritePopup();
  });

  function copyWriteSelection(){
    const t = _selText; if(!t) return;
    const done = function(){ toast('Copied.'); closeWritePopup(); };
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(t).then(done, function(){ fallbackCopy(t); done(); });
    } else { fallbackCopy(t); done(); }
  }
  function fallbackCopy(t){
    const ta = document.createElement('textarea');
    ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch(e){ console.warn('copy', e); }
    ta.remove();
  }

  function keepWriteSelection(){
    const t = _selText; if(!t) return;
    const p = selectionPiece();
    elevate(p.id, p.kind, p.title, t);
    closeWritePopup();
  }

  // Asking about your own words is generative in a way the reflection partner never was,
  // so it is COUNTED. The AI-use log reports that number instead of asserting the machine
  // supplied nothing -- see sessionRecordHTML.
  async function askWriteSelection(){
    const pop = document.getElementById('writePopup'); if(!pop) return;
    const passage = _selText; if(!passage) return;
    if(getProvider() === 'none') return;
    const q = pop.querySelector('#wpInput').value.trim() || 'Help me think about this.';
    const a = pop.querySelector('#wpAnswer');
    a.style.display = 'block'; a.innerHTML = '<em>Thinking…</em>';
    if(tab === 'free' && OPS[fwCur]){
      const prev = ((DB.freewrite[fwCur] || {}).session || {}).writeAsks || 0;
      sessionPatch(fwCur, { writeAsks: prev + 1 });
    }
    const DELIM = '“';
    try {
      const reply = await callModel(WRITING_PARTNER
        + '\n\nTheir passage:\n' + DELIM + passage.slice(0, 4000) + '”'
        + '\n\nThey ask: ' + q);
      a.innerHTML = '<span class="wp-who">' + escHtml(AI_TAG) + '</span>'
                  + escHtml(String(reply || '').trim());
      logEvent('ai', 'asked about own writing', { provider: getProvider(), chars: passage.length });
    } catch(e){
      a.innerHTML = '<em>' + escHtml(AI_NAME) + ' is unavailable right now.</em>';
    }
  }

  function journalByDate(dateKey){ return DB.journal.filter(e=>e.date===dateKey); }
  function journalByPiece(pieceId){ return DB.journal.filter(e=>e.pieceId===pieceId).sort((a,b)=>a.ts.localeCompare(b.ts)); }
  // [group, number] for a reading piece's title — same buckets as readingRank, so
  // the notebook's piece list reads in the same order as the Readings shelf.
  function readingPieceOrder(title){
    const t = String(title||'').replace(/^reading\s*·\s*/i, '');
    if(FRONT_RE.test(t)) return [0, 0];
    if(BACK_RE.test(t))  return [2, 0];
    const n = chapterNum(t);
    return n !== null ? [1, n] : [3, 0];
  }
  function journalPieces(){
    const m = {};
    for(const e of DB.journal){ (m[e.pieceId] = m[e.pieceId] || { id:e.pieceId, kind:e.pieceKind, title:e.pieceTitle, entries:[] }).entries.push(e); }
    return Object.values(m).sort((a,b) => {
      const d = pieceRank(a.id) - pieceRank(b.id);
      if(d) return d;
      // Within the readings, mirror the shelf exactly: front matter, then chapters
      // in NUMERIC order ("Ch 10" must not precede "Ch 2"), then back matter.
      if(a.kind === 'reading' && b.kind === 'reading'){
        const ka = readingPieceOrder(a.title), kb = readingPieceOrder(b.title);
        if(ka[0] !== kb[0]) return ka[0] - kb[0];
        if(ka[1] !== kb[1]) return ka[1] - kb[1];
      }
      return a.title.localeCompare(b.title);
    });
  }
  function deleteEntry(id){ DB.journal = DB.journal.filter(e=>e.id!==id); saveDB(); }
  function updateEntry(id, text){ const e = DB.journal.find(x=>x.id===id); if(e){ e.text = text; e.edited = new Date().toISOString(); saveDB(); } }
  // Jump from a notebook entry to the live writing surface it came from.
  function goToPiece(pieceId){
    if(/^op[1-5]$/.test(pieceId) || NAMED[pieceId]){ fwCur = pieceId; show('free'); }
    else if(pieceId.indexOf('cur-') === 0){ curCur = pieceId.slice(4); show('cur'); }
    else if(pieceId.indexOf('reading') === 0){
      // Open the chapter the notes came from, not just the Readings tab.
      const rid = pieceId.slice(8);   // "reading:" → the reading's id
      const idx = rid ? readings.findIndex(r => r.id === rid) : -1;
      if(idx >= 0){ activeReading = idx; readPageNum = 1; dropPdf(); persistReadings(); }
      show('read');
    }
    else { show('free'); }
  }

  // ---------- FreeWrite ----------
  const OPS = {
    op1:{n:1,t:'Why You Write',f:'Why have you written, and why do you write? <span class="hint">What has it cost you? What has it given you?</span>',ph:'Shape your gush into one page — ~500–600 words, image and text.'},
    op2:{n:2,t:'Writing Place',f:'Where and how do you write? <span class="hint">Light, sound, tools, talismans, rituals. When does the writing come, and when not?</span>',ph:'One page: place and process, 2–3 photos embedded. Use the image button.',photos:true},
    op3:{n:3,t:'Voice Print',f:'A voice you don’t hear anymore — one moment, in <em>pure dialogue</em>. <span class="hint">Just the voices. No narration.</span>',ph:'One page, mostly pure dialogue. New paragraph per speaker.'},
    op4:{n:4,t:'Show, Don’t Tell',f:'One small moment, through the senses. <span class="hint">Light, sound, smell, touch, taste. No dialogue. Make us feel it.</span>',ph:'One page. Cut every word that tells instead of shows.'},
    op5:{n:5,t:'Breaking the Rules',f:'Something that matters, rules broken on purpose. <span class="hint">At least two Grammar B moves: fragments, labyrinths, purposeful misspelling, double voice.</span>',ph:'One page. Every “error” one you meant.'},
  };
  const STEMS = ['A door you were afraid to open.','A room that no longer exists.','Something you were told not to say.','The first time a teacher was wrong about you.','A smell that returns you somewhere.','A voice you can still hear.','A rule you were glad to break.','The letter you never sent.','The teacher you’re trying not to become.'];
  let fwCur = 'op1';
  const fwDone = {}, fwGushed = {};
  for (const k of Object.keys(OPS)) { const s = DB.freewrite[k] || {}; fwDone[k] = !!s.done; fwGushed[k] = !!s.gushed; }

  // ── THE REQUIRED ENTRIES GET SOMEWHERE TO BE WRITTEN.
  //
  // Todd: "Everything genuinely has to connect." It did not. Of the five things a student
  // must tag, exactly one -- the currere -- had a surface in this app. The comment two
  // screens down used to admit it: "the Week 1 baseline is just another freewrite; the
  // topic map never touches the app." So the tags named work that happened off-screen,
  // and tagging meant hunting through thirty look-alike entries in December.
  //
  // Each of these is a page you can open, write on, and keep -- and keeping TAGS IT, in
  // the same action. That is the whole idea: the tag is placed when the writing happens,
  // by the page that knows what it is. December stops being archaeology.
  const NAMED = {
    baseline: { slot:'baseline', lead:'Week 1', t:'Why do we write?',
      f:'On Monday you gushed about why you write. Romano\'s license plate reads <em>Write 2</em> — <em>write to express, write to communicate, write to clarify, write to learn.</em> Did you include each of these reasons in your gush? Did you include reasons Romano didn\'t? What do you make of this? <span class="hint">In Week 15 we revisit your responses — I am curious whether your thinking changes across the semester.</span>',
      ph:'Monday I said… Romano says… What I make of that is…' },
    topicmap: { slot:'topicmap', lead:'Research', t:'Topic map',
      f:'What you might write about, and everything it touches. <span class="hint">Not an outline. Names, questions, angles, dead ends — the whole spread.</span>',
      ph:'Put the topic in the middle and write outward. Anything that touches it counts.' },
    sources:  { slot:'sources',  lead:'Research', t:'Source notes',
      f:'What a source actually says, and what you make of it. <span class="hint">Where it came from, what it claims, and the line you would quote.</span>',
      ph:'Source, claim, the line worth quoting — and what it makes you think.' },
    letter:   { slot:'letter',   lead:'Week 15', t:'Look-Back Letter',
      f:'A letter to the writer who answered <em>why do we write?</em> in Week 1 — the gush, and what you made of Romano. <span class="hint">Written in our last class, so the notebook is finished the day it is handed in.</span>',
      ph:'Dear me-in-August…' },
  };

  // The baseline, shown beside the Letter, because the assignment is to write BACK to it
  // and an app that made you go and find it first would be making the same mistake again.
  function baselineBesideLetter(){
    const id = turnin()['baseline'];
    const e = id && (DB.journal || []).find(x => x.id === id);
    if(!e) return `<div class="beside empty"><p class="lead">Your Week 1 baseline</p>
      <p>Not tagged yet. Open <strong>Why do we write?</strong> above, keep it, and it will
      appear here when you write the letter.</p></div>`;
    return `<div class="beside"><p class="lead">Your Week 1 baseline · ${escHtml(shortDate(e.date))}</p>
      <div class="beside-text">${escHtml(e.text).replace(/\n/g,'<br>')}</div></div>`;
  }

  // A jump target is either a lens of this view or a piece elsewhere in the app.
  function wireProjectLinks(){
    const th = document.getElementById('thAbout'), thb = document.getElementById('thAboutBtn');
    if(th && thb){
      th.style.display = 'none';
      thb.onclick = () => { const on = th.style.display !== 'none';
        th.style.display = on ? 'none' : 'block'; thb.textContent = on ? 'How this is graded →' : 'Hide'; };
    }
    const ab = document.getElementById('aboutProj'), btn = document.getElementById('pjAbout');
    if(ab && btn){
      ab.style.display = 'none';
      btn.onclick = () => { const on = ab.style.display !== 'none';
        ab.style.display = on ? 'none' : 'block'; btn.textContent = on ? 'About this project →' : 'Hide'; };
      const cl = document.getElementById('apClose');
      if(cl) cl.onclick = () => { ab.style.display = 'none'; btn.textContent = 'About this project →'; };
    }
    frame.querySelectorAll('[data-tagpick]').forEach(b => b.onclick = () => {
      const slot = b.dataset.tagpick, id = b.dataset.tagent, T = turnin();
      const prev = T[slot];
      T[slot] = id; saveDB();
      toast(prev && prev !== id ? `${slotLabel(slot)} moved to this entry` : `Tagged ${slotLabel(slot)}`);
      renderNote();
    });
    frame.querySelectorAll('[data-untagpick]').forEach(b => b.onclick = () => {
      delete turnin()[b.dataset.untagpick]; saveDB(); renderNote();
    });
    frame.querySelectorAll('[data-reflect]').forEach(b => b.onclick = () => openReflect(b.dataset.reflect));
    frame.querySelectorAll('[data-piecemode]').forEach(b => b.onclick = () => {
      notePieceSel = b.dataset.piecemode; noteMode = 'piece'; nbEditingId = null; renderNote();
    });
    frame.querySelectorAll('[data-jump]').forEach(b => b.onclick = () => {
      const to = b.dataset.jump;
      if(to === 'threads'){ noteMode = 'threads'; renderNote(); return; }
      if(to === 'open'){ fwCur = 'open'; show('free'); return; }
      goToPiece(to);
    });
  }

  // Writing ON the passages, with them in front of you. The entry it creates carries
  // reflection:true, which is what takes the reading off the In-progress list and what
  // separates a reflection from the captures stacked under the same piece.
  function openReflect(pieceId){
    const g = capturesByPiece().find(x => x.id === pieceId);
    if(!g) return;
    const title = String(g.title||'').replace(/^Reading · /,'');
    const quotes = g.items.map(h => {
      const pg = h.pageLabel || h.page;
      const cite = pg ? `<span class="rf-pg">p. ${escHtml(String(pg))}</span>` : '';
      const mine = (h.note || '').trim() ? `<p class="rf-mine">${escHtml(h.note.trim())}</p>` : '';
      return `<blockquote class="rf-q">${escHtml(h.text || '(figure)')}${cite}</blockquote>${mine}`;
    }).join('');
    const host = document.createElement('div');
    host.className = 'rf-overlay'; host.id = 'rfOverlay';
    host.innerHTML = `<div class="rf-box" role="dialog" aria-modal="true" aria-label="Reflect on ${escHtml(title)}">
      <h3 class="rf-h">${escHtml(title)}</h3>
      <p class="runline">What do you make of these? What surprised you, argued with you, or
        stayed with you? Write to yourself — this is the entry.</p>
      <div class="rf-quotes">${quotes}</div>
      <textarea class="rf-ta" id="rfTa" placeholder="Write what you make of it…"></textarea>
      <div class="rf-actions">
        <button class="popup-btn secondary" id="rfCancel">Cancel</button>
        <button class="popup-btn primary" id="rfKeep">✎ Keep as an entry</button>
      </div></div>`;
    document.body.appendChild(host);
    const close = () => host.remove();
    host.addEventListener('click', e => { if(e.target === host) close(); });
    document.getElementById('rfCancel').onclick = close;
    document.getElementById('rfTa').focus();
    document.getElementById('rfKeep').onclick = () => {
      const txt = (document.getElementById('rfTa').value||'').trim();
      if(!txt){ toast('Write something first — that is the entry.'); return; }
      elevate(pieceId, 'reading', g.title, txt, null, { reflection: true });
      close(); renderNote();
    };
  }
  function renderNamed(key){
    const m = NAMED[key];
    const saved = (DB.freewrite[key] || {}).text || '';
    document.getElementById('stage').innerHTML = `
      <p class="kicker">${m.lead}</p><h2>${m.t}</h2><p class="framing">${m.f}</p>
      ${key === 'letter' ? baselineBesideLetter() : ''}
      <textarea class="gush" id="gush" placeholder="${escHtml(m.ph)}">${escHtml(saved)}</textarea>
      <div style="max-width:var(--writecol);margin:10px 0 0;display:flex;gap:10px;align-items:baseline">
        <button class="btn ghost sm" id="namedAdd">＋ Keep in notebook</button>
        <span class="note" id="namedState"></span></div>
      ${assignmentNote(m.slot, 'asnNamed')}`;
    const ta = document.getElementById('gush');
    ta.addEventListener('input', () => { DB.freewrite[key] = { text: ta.value }; saveDB(); });
    paintNamedState(key);
    wireAssignmentNote('asnNamed');
    document.getElementById('namedAdd').onclick = () => keepNamed(key);
  }

  // Says, on the page, whether this required entry is already answered -- so the student
  // never has to go to another lens to find out where they stand on it.
  function paintNamedState(key){
    const el = document.getElementById('namedState'); if(!el) return;
    const m = NAMED[key], id = turnin()[m.slot];
    const e = id && (DB.journal || []).find(x => x.id === id);
    el.innerHTML = e
      ? `✓ kept and tagged <strong>${escHtml(slotLabel(m.slot))}</strong> · ${escHtml(shortDate(e.date))}`
      : `Keeping this tags it <strong>${escHtml(slotLabel(m.slot))}</strong> — one of the four required entries.`;
  }

  function keepNamed(key){
    const m = NAMED[key];
    const ta = document.getElementById('gush');
    const txt = (ta && ta.value || '').trim();
    if(!txt){ toast('Nothing to keep yet — write something first.'); return; }
    const entry = elevate(key, 'freewrite', m.t, txt);
    if(!entry) return;
    // The tag goes on HERE, not in December. A slot holds one entry, so keeping a second
    // draft of the same piece moves the tag to the newer one -- which is what a student
    // rewriting their topic map means, and it says so rather than doing it silently.
    const T = turnin(), prev = T[m.slot];
    T[m.slot] = entry.id; saveDB();
    toast(prev && prev !== entry.id
      ? `Kept — the ${slotLabel(m.slot)} tag moved to this one`
      : `Kept, and tagged ${slotLabel(m.slot)}`,
      { label: 'View →', onClick: () => revealEntry(entry) });
    paintNamedState(key);
  }

  function renderFree(){
    body.classList.remove('wide', 'bleed');
    const spine = `
      <p class="lead">The Five One-Pagers</p>
      ${Object.entries(OPS).map(([k,o])=>`<button class="moment ${k===fwCur?'on':''} ${fwDone[k]?'has':''}" data-op="${k}"><span class="mname"><span class="dot"></span>${o.n} · ${o.t}</span><span class="mkind">gush → one page</span></button>`).join('')}
      <div class="divider"></div><p class="lead">Keep the practice</p>
      <button class="moment ${fwCur==='open'?'on':''}" data-op="open"><span class="mname"><span class="dot"></span>Open page</span><span class="mkind">free-write · stems</span></button>
      <div class="divider"></div><p class="lead">For the notebook</p>
      ${Object.entries(NAMED).map(([k,m]) => {
        const done = !!turnin()[m.slot];
        return `<button class="moment ${k===fwCur?'on':''} ${done?'has':''}" data-op="${k}"><span class="mname"><span class="dot"></span>${m.t}</span><span class="mkind">${done ? '✓ kept' : m.lead}</span></button>`;
      }).join('')}`;
    frame.innerHTML = `<div class="head"><h1>Freewrite/OPs</h1><p>Start a timer, trust the gush, then shape it.</p></div>
      <div class="layout"><nav class="spine">${spine}</nav><main class="stage" id="stage"></main></div>`;
    frame.querySelectorAll('[data-op]').forEach(b=>b.addEventListener('click',()=>{ if(G.running) return; fwCur=b.dataset.op; renderFree(); }));
    if(NAMED[fwCur]) renderNamed(fwCur);
    else if(fwCur === 'open') renderOpen();
    else renderOPStage(OPS[fwCur]);
    paintInsMarker();   // Open page has no One-Pager, so the marker must come down
  }
  // ── The writing session. OP1 says the session record and AI-use log travel with
  //    the exported PDF, so what happened during the gush has to be recorded, not
  //    just displayed. Written when the buzzer sounds, then topped up with the
  //    reflection exchange as it happens.
  //    session = { minutes, endedAt, words, ai, question, answer }
  function sessionPatch(key, patch){
    const s = DB.freewrite[key] || (DB.freewrite[key] = {});
    s.session = Object.assign({}, s.session, patch);
    saveDB();
  }
  function reflectHooks(key){
    return {
      answer: ((DB.freewrite[key] || {}).session || {}).answer || '',
      onQuestion: q => sessionPatch(key, { question: q }),
      onAnswer:   v => sessionPatch(key, { answer: v }),
    };
  }

  // The ratio IS the craft: "kept 47 of 380 words" makes the cutting visible without
  // capping it. A hard limit would be a rule; a mirror is an invitation to choose.
  //
  // The same line also carries the ORDER OF OPERATIONS, because the button alone could
  // not: Todd could not tell whether to click first or select first, and clicking an
  // empty selection did nothing visible. So the button is disabled until text is
  // selected, and this note says what to do to enable it. The interface answers the
  // question rather than leaving the student to guess and get silence.
  let _keepSync = null;   // the live document-level selectionchange handler, so it can be replaced

  // ── WHERE THE COPIED LINES LAND, and showing that before they land.
  //
  // Copy used to appendChild, so every passage went to the bottom of the One-Pager no
  // matter where the writer had been working. Worse, it was unknowable: selecting in the
  // gush moves focus out of the shape pane, the caret stops being painted, and the pane
  // gives no clue at all. So two things: remember the last caret in the pane and insert
  // THERE, and draw the insertion point while focus is elsewhere.
  //
  // The marker is drawn as a fixed-position overlay on <body>, never as a node inside the
  // pane. Anything inside the pane would be serialised into DB.shape by pg.innerHTML and
  // printed on the submitted PDF.
  let _opCaret = null;    // a collapsed Range inside #page, or null

  // The direct child of #page that contains a node — paragraphs are the unit we insert between.
  function opBlockFor(node, pg){
    let n = node;
    while(n && n.parentNode && n.parentNode !== pg) n = n.parentNode;
    return (n && n.parentNode === pg) ? n : null;
  }
  // Insert AFTER this block. null means the pane is empty, so append.
  function opInsertAfter(pg){
    if(_opCaret && pg.contains(_opCaret.startContainer)){
      const b = opBlockFor(_opCaret.startContainer, pg);
      if(b) return b;
    }
    return pg.lastElementChild;   // no caret yet: the end, which is what append always did
  }
  function rememberOpCaret(pg){
    const s = window.getSelection();
    if(!s || !s.rangeCount) return;
    const r = s.getRangeAt(0);
    if(pg && pg.contains(r.startContainer)) _opCaret = r.cloneRange();
  }
  function paintInsMarker(){
    let m = document.getElementById('insMarker');
    const pg = document.getElementById('page');
    const bar = document.getElementById('liftbar');
    const hide = ()=>{ if(m) m.style.display = 'none'; };
    // Hidden whenever there is nothing to copy into, the pane is off-screen, or the pane
    // has focus — with focus the browser paints a real caret and two would just confuse.
    if(!pg || !pg.isConnected || pg.offsetParent === null) return hide();
    if(!bar || bar.style.display === 'none') return hide();
    if(document.activeElement === pg) return hide();
    if(!m){ m = document.createElement('div'); m.id = 'insMarker'; m.className = 'ins-marker'; document.body.appendChild(m); }
    const pr = pg.getBoundingClientRect();
    const blk = opInsertAfter(pg);
    const y = blk ? blk.getBoundingClientRect().bottom : (pr.top + 34);
    // Clamp to the pane: the pane scrolls, and a marker floating over the toolbar or the
    // page below it would point at nothing.
    if(y < pr.top + 4 || y > pr.bottom - 4) return hide();
    m.style.display = 'block';
    m.style.top = y + 'px';
    m.style.left = (pr.left + 34) + 'px';
    m.style.width = Math.max(0, pr.width - 68) + 'px';
  }
  // Fixed to the viewport, so anything that moves the pane has to move the marker.
  window.addEventListener('resize', paintInsMarker);
  window.addEventListener('scroll', paintInsMarker, { passive: true });

  function paintKeepCount(key){
    const el = document.getElementById('keepcount'); if(!el) return;
    const s = DB.freewrite[key] || {};
    const total = ((s.gush||'').match(/\S+/g)||[]).length;
    // s.lifted accumulates across every lift; `total` is only the CURRENT gush text.
    // Rewrite the gush shorter and it read "Kept 220 of 74 words." Clamp it.
    const keptN = Math.min(s.lifted || 0, total);
    const kept = keptN ? `Kept ${keptN} of ${total} words.` : '';
    const ta = document.getElementById('gush');
    const selWords = ta ? ((String(ta.value||'').slice(ta.selectionStart, ta.selectionEnd).trim().match(/\S+/g)||[]).length) : 0;
    const btn = document.getElementById('liftBtn');
    if(btn) btn.disabled = !selWords;
    el.textContent = selWords
      ? `${selWords} word${selWords===1?'':'s'} selected.${kept ? ' ' + kept : ''}`
      : (kept || 'Select lines in your gush, then copy them into the One-Pager.');
  }

  function renderOPStage(M){
    body.classList.toggle('wide', !!fwGushed[fwCur]);
    document.getElementById('stage').innerHTML = `
      <p class="kicker">One-Pager ${M.n}</p><h2>${M.t}</h2><p class="framing">${M.f}</p>
      <div class="op-cols ${fwGushed[fwCur]?'two':''}">
       <div class="op-col gush">
        <div class="stagelabel"><span class="n">1</span> Gush — timed, editing locks · enters Focus</div>
        <p class="stagenote">Write fast to find your material — nobody grades the gush.</p>
        <div class="gushbar"><div class="timerset" id="timerset"><button class="tadj" id="tminus">−</button><span class="timer editable" id="timer">8:00</span><button class="tadj" id="tplus">+</button></div>
          <button class="btn go" id="startBtn">Start the gush</button>
          <span class="liftbar" id="liftbar" style="display:${fwGushed[fwCur]?'inline-flex':'none'}">
            <button class="btn ghost sm" id="liftBtn" disabled>Copy →</button>
            <span class="note" id="keepcount"></span></span>
          <span class="locknote" id="lockmsg">Set your minutes, then start — the page locks and Focus opens.</span></div>
        <textarea class="gush" id="gush" placeholder="Don’t stop, don’t fix. Stalled? Write that you stalled — and keep going." disabled></textarea>
        <div class="reflect" id="reflect" style="display:none"><span class="lbl">Reflecting with ${AI_NAME}</span><span>How did it go? <em>(About the experience, never your words — stubbed.)</em></span></div>
       </div>
       <div class="op-col shape" id="shapeCol">
        <div class="stagelabel"><span class="n">2</span> Shape — the One-Pager ${M.photos?'(image + text)':''}</div>
        <p class="stagenote">Build your One-Pager from the gush — this is what you submit. <em>Keep the two or three lines that are alive, cut the rest, and build around them.</em></p>
        <div class="toolbar">
          <button data-cmd="bold" title="Bold"><b>B</b></button><button data-cmd="italic" title="Italic"><i>I</i></button>
          <button data-cmd="formatBlock" data-val="h3" title="Heading — press again to turn it back into a paragraph">H</button><button data-cmd="insertUnorderedList" title="Bulleted list">&bull;</button>
          <span class="sep"></span><button data-cmd="undo" title="Undo">&#8630;</button><button data-cmd="redo" title="Redo">&#8631;</button>
          <span class="sep"></span><button id="imgBtn" title="Insert a picture">&#128247;</button><span class="wc" id="wc">0 words</span></div>
        <div class="page" id="page" contenteditable="${fwGushed[fwCur]?'true':'false'}" data-ph="${M.ph}"></div>
        <input type="file" id="imgInput" accept="image/*" hidden ${M.photos?'multiple':''}>
        <div class="composer-foot"><button class="btn" id="opExport">Export One-Pager (1-page PDF)</button><span class="note">The PDF you submit: your One-Pager, then your writing session and AI-use log.</span></div>
       </div>
      </div>`;
    wireTimer();
    // Restore a saved gush + shaped one-pager for this OP.
    const saved = DB.freewrite[fwCur] || {};
    const taEl = document.getElementById('gush'); if(saved.gush){ taEl.value = saved.gush; if(fwGushed[fwCur]){ taEl.disabled = false; taEl.readOnly = true; } }
    const pgEl = document.getElementById('page'); if(saved.shape){ pgEl.innerHTML = saved.shape; }
    // Save the shaped one-pager as it is typed.
    pgEl.addEventListener('input', ()=>{ DB.freewrite[fwCur] = Object.assign({}, DB.freewrite[fwCur], { shape: pgEl.innerHTML }); saveDB(); });
    // Repaint a saved reflection so a student who comes back tomorrow still sees the
    // question they were asked and the answer they gave.
    if(saved.session && saved.session.question){
      const rf0 = document.getElementById('reflect');
      if(rf0){ rf0.style.display = 'block'; paintReflection(rf0, saved.session.question, reflectHooks(fwCur)); }
    }
    const opKey = fwCur;
    // ── Any writing done here can become a notebook entry.
    //
    // Todd, 23 Aug 2026: "students should be able to use any writing they do in
    // Journaler-284 as a notebook entry." The currere gushes, reading notes, quick-writes
    // and thread readings could already be kept. The One-Pager -- the largest thing a
    // student writes in this app, and the thing they actually submit -- was the one
    // surface with no route into the notebook at all. Both halves get one: the raw gush
    // and the shaped page, kept separately, because they are different pieces of work
    // and a student may want either without the other.
    // The two "＋ Add to notebook" buttons that used to live here are GONE, and the
    // selection popup is why: highlight any of the gush or the shaped page and choose
    // "📓 To notebook". ⌘A / Ctrl+A inside either one selects the whole thing first, so
    // keeping an entire piece still takes one extra keystroke, not a button.
    //
    // ⚠ The gush button also BROKE THIS LAYOUT, and the trap is worth naming: the two
    //   columns are subgrid over exactly five row tracks (see .op-cols.two in app.css).
    //   Adding a sixth child to either column gives it no track to sit in and it lands
    //   on top of the fifth -- which is how "＋ Add gush to notebook" ended up printed
    //   over "Reflecting with Romano". Anything new here either goes INSIDE an existing
    //   band or the track count has to grow to match.
    document.getElementById('startBtn').addEventListener('click',()=>startGush(gushSecs,{focus:true,reflect:reflectHooks(opKey),onEnd:()=>{fwDone[fwCur]=true;fwGushed[fwCur]=true;const gtxt=document.getElementById('gush').value;
      // The gush is a chalkboard: a new trial wipes the last one, by design. But the
      // RECORD should not be wiped with it, or a student who gushed four times shows up
      // on the evidence sheet as having gushed once. Keep counts, never the erased text.
      const prevS = (DB.freewrite[opKey]||{}).session || {};
      const mins = Math.round(gushSecs/60), wds = (gtxt.trim().match(/\S+/g)||[]).length;
      DB.freewrite[fwCur]=Object.assign({},DB.freewrite[fwCur],{gush:gtxt,gushed:true,done:true});
      sessionPatch(opKey,{minutes:mins,endedAt:new Date().toISOString(),words:wds,ai:aiLabel(),
        gushes:(prevS.gushes||0)+1, totalMinutes:(prevS.totalMinutes||0)+mins, totalWords:(prevS.totalWords||0)+wds});
      saveDB();document.body.classList.add('wide');const oc=document.querySelector('.op-cols');if(oc)oc.classList.add('two');const pg=document.getElementById('page');if(pg)pg.setAttribute('contenteditable','true');
      // Reveal Lift here too. The shape column appearing is not enough: the button was
      // rendered display:none before the first gush and nothing turned it back on until
      // the tab happened to re-render, so a student's first gush offered no way across.
      const lb=document.getElementById('liftbar');if(lb)lb.style.display='inline-flex';paintInsMarker();}}));
    // ── Copy-from-gush. The assignment says to build the One-Pager FROM the gush, and the
    //    shape pane used to open blank — the interface asked a question instead of answering
    //    it, so the only route was reselect-copy-click-paste. That friction pushes toward the
    //    one move we do not want: select all, dump it in, tidy down. That is editing, not
    //    carving. So: copy a SELECTION, repeatably. There is deliberately no "copy it all"
    //    button — the scarcity is the assignment.
    //
    //    It was called "↑ Lift" and neither half read. "Lift" is a metaphor, and this course
    //    writes to students literally [[student-facing-language-literal]]; the up arrow
    //    pointed at a pane that is to the RIGHT. Now just "Copy →" — the destination lives
    //    in the note beside it, because a long label re-wrapped and shoved the timer row's
    //    height around every time the text changed. Short button, talkative note.
    const liftBtn = document.getElementById('liftBtn');
    if(liftBtn) liftBtn.onclick = ()=>{
      const ta = document.getElementById('gush'), pg = document.getElementById('page');
      if(!ta || !pg) return;
      const sel = String(ta.value||'').slice(ta.selectionStart, ta.selectionEnd).trim();
      if(!sel) return;                       // unreachable: disabled without a selection
      const p = document.createElement('p'); p.textContent = sel;
      // Land where the writer last had the caret, not always at the bottom.
      const after = opInsertAfter(pg);
      if(after) after.after(p); else pg.appendChild(p);
      DB.freewrite[opKey] = Object.assign({}, DB.freewrite[opKey], { shape: pg.innerHTML });
      const s = DB.freewrite[opKey];
      s.lifted = (s.lifted||0) + (sel.match(/\S+/g)||[]).length;
      saveDB();
      // Advance the insertion point past what we just filed, so copying three passages in
      // a row keeps them in the order they were chosen instead of stacking them backwards.
      const r = document.createRange(); r.setStart(p, 0); r.collapse(true); _opCaret = r;
      // Clear the selection so the button falls back to disabled. Without this it stays
      // live and a second click files the same lines twice.
      ta.selectionEnd = ta.selectionStart;
      paintKeepCount(opKey);
      paintInsMarker();
    };
    // Keep the button and its note in step with the selection. `selectionchange` on a
    // textarea is recent and uneven across engines, so the older events carry it and
    // selectionchange is a bonus, not the mechanism [[firefox-not-chrome]].
    // Track where the caret was left in the One-Pager, and keep the insertion marker on it.
    _opCaret = null;   // the old range points into the previous render's detached nodes
    const pgEl2 = document.getElementById('page');
    if(pgEl2){
      const track = ()=>{ rememberOpCaret(pgEl2); paintInsMarker(); };
      ['keyup','mouseup','click','input','focus'].forEach(ev => pgEl2.addEventListener(ev, track));
      pgEl2.addEventListener('blur', paintInsMarker);
      // The pane scrolls independently of the window, and the marker is fixed to the
      // viewport, so both have to move it.
      pgEl2.addEventListener('scroll', paintInsMarker, { passive: true });
    }
    const gushTa = document.getElementById('gush');
    if(gushTa){
      const sync = ()=>{ paintKeepCount(opKey); paintInsMarker(); };
      ['select','keyup','mouseup','input','focus'].forEach(ev => gushTa.addEventListener(ev, sync));
      // The textarea listeners die with the node on re-render; this one is on `document`
      // and would stack a stale closure per OP visited, each repainting for the wrong key.
      if(_keepSync) document.removeEventListener('selectionchange', _keepSync);
      _keepSync = sync;
      document.addEventListener('selectionchange', sync);
    }
    paintKeepCount(opKey);
    paintInsMarker();
    const opExp = document.getElementById('opExport');
    if(opExp) opExp.onclick = ()=> exportOnePagerPDF(M);
    wireComposer(opKey);
  }
  function renderOpen(){
    document.getElementById('stage').innerHTML = `
      <p class="kicker">Keep the practice</p><h2>Open page</h2>
      <p class="framing">A free-write for the Notebook. <span class="hint">No assigned prompt, no shaping. Stuck? Pull a stem.</span></p>
      <div class="stems"><button class="btn ghost sm" id="stemBtn">Suggest a stem</button><span class="stem-chip" id="stemChip" style="display:none"></span></div>
      <div class="gushbar" style="margin-top:16px"><div class="timerset" id="timerset"><button class="tadj" id="tminus">−</button><span class="timer editable" id="timer">8:00</span><button class="tadj" id="tplus">+</button></div>
        <button class="btn go" id="startBtn">Start</button><button class="btn ghost sm" id="notimer">No timer</button><span class="locknote">Lands in your Notebook, dated.</span></div>
      <textarea class="gush" id="gush" placeholder="Write to keep the practice going."></textarea>
      <div style="max-width:var(--writecol);margin:10px auto 0"><button class="btn ghost sm" id="openAddNb">＋ Add to notebook</button></div>`;
    let ix=0; document.getElementById('stemBtn').addEventListener('click',()=>{const c=document.getElementById('stemChip');c.style.display='inline-block';c.textContent=STEMS[ix++%STEMS.length];});
    wireTimer();
    // Restore + save the open-page free-write.
    const openTa = document.getElementById('gush');
    if(DB.freewrite.open && DB.freewrite.open.text){ openTa.value = DB.freewrite.open.text; }
    openTa.addEventListener('input', ()=>{ DB.freewrite.open = { text: openTa.value }; saveDB(); });
    document.getElementById('openAddNb').onclick = ()=>{ elevate('free', 'freewrite', 'Free-writes & quick-writes', openTa.value); };
    document.getElementById('startBtn').addEventListener('click',()=>startGush(gushSecs,{focus:true}));
    document.getElementById('notimer').addEventListener('click',()=>{const ta=document.getElementById('gush');ta.disabled=false;ta.readOnly=false;ta.focus();setFocus(true);});
  }
  // ═══ Images. A phone photo is 2–4MB, and base64 adds a third on top. Inserted raw it
  //     lands in TWO bad places at once: localStorage (which holds the whole DB in a
  //     5–10MB budget, so one OP2 with photos can blow it) and the exported PDF (which
  //     embeds the full-resolution bytes no matter how small the picture prints).
  //     So every image is re-encoded on the way in — long edge to IMG_MAX_PX, JPEG at
  //     IMG_QUALITY. A 4MB photo becomes a couple of hundred KB and still prints
  //     crisply: 1600px across the 2.6in the print CSS allows is over 600dpi.
  const IMG_MAX_PX  = 1600;
  const IMG_QUALITY = 0.85;

  // Re-encode a data URI down to size. Returns the original untouched when it is
  // already small enough, so re-running this over a page is safe and idempotent.
  function shrinkDataURL(src){
    return new Promise(resolve => {
      if(!/^data:image\//i.test(src)) return resolve(src);
      const img = new Image();
      img.onload = () => {
        const long = Math.max(img.naturalWidth, img.naturalHeight);
        if(long <= IMG_MAX_PX && src.length < 400000) return resolve(src);
        const scale = Math.min(1, IMG_MAX_PX / long);
        const w = Math.max(1, Math.round(img.naturalWidth  * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        try {
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          const ctx = c.getContext('2d');
          // JPEG has no alpha: paint white first or transparency comes out black.
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          const out = c.toDataURL('image/jpeg', IMG_QUALITY);
          resolve(out.length < src.length ? out : src);
        } catch(e){ resolve(src); }
      };
      img.onerror = () => resolve(src);
      img.src = src;
    });
  }

  function fileToShrunkDataURL(file){
    return new Promise(resolve => {
      const r = new FileReader();
      r.onload = () => shrinkDataURL(String(r.result)).then(resolve);
      r.onerror = () => resolve(null);
      r.readAsDataURL(file);
    });
  }

  // Catch-all for the paste route. Todd pastes images straight into the page, and the
  // browser inserts those as full-size data URIs without going near the ＋ picker, so
  // sweep the page afterwards. data-shrunk marks what has already been through.
  async function shrinkImagesIn(pageEl, after){
    const imgs = [...pageEl.querySelectorAll('img:not([data-shrunk])')];
    if(!imgs.length) return;
    for(const el of imgs){
      const src = el.getAttribute('src') || '';
      if(/^data:image\//i.test(src)){
        const out = await shrinkDataURL(src);
        if(out !== src) el.setAttribute('src', out);
      }
      el.setAttribute('data-shrunk', '1');
    }
    if(after) after();
  }

  // ── Resize an inserted picture by dragging any corner ──────────────────────
  //
  // Chrome removed the native contenteditable image handles years ago (Firefox kept
  // them), which is why the picker felt like the end of the story: you got whatever
  // size the file happened to be. These are our own handles.
  //
  // Two things are load-bearing:
  //   · The grips live in document.body, NOT inside .page. Anything inside .page is
  //     part of page.innerHTML, which is exactly what gets saved to DB.freewrite and
  //     poured into the printed sheet -- handles would be saved as content.
  //   · The width is stored as a PERCENTAGE. The editor column and the print column are
  //     different widths (.page is ~600px on screen, .op-body is a 680px sheet at 11pt),
  //     so a pixel width that looked right on screen would print at a different share of
  //     the line. A percentage occupies the same fraction of both.
  // Only the width is ever set; height stays auto, so a corner drag cannot distort the
  // picture no matter which corner it is.
  let _opPick = null, _opGrips = null, _opDrag = null, _opSave = null;
  function opGripsEl(){
    if(_opGrips && _opGrips.isConnected) return _opGrips;
    const g = document.createElement('div');
    g.className = 'op-grips';
    g.innerHTML = '<div class="op-ring"></div>'
                + ['nw','ne','sw','se'].map(c => `<div class="op-grip" data-c="${c}"></div>`).join('')
                + '<div class="op-size" hidden></div>';
    document.body.appendChild(g);
    g.querySelectorAll('.op-grip').forEach(h => h.addEventListener('pointerdown', opGripDown));
    _opGrips = g;
    return g;
  }
  function opPlaceGrips(){
    if(!_opPick || !_opPick.isConnected){ opDeselect(); return; }
    const g = opGripsEl(), r = _opPick.getBoundingClientRect();
    // The picture scrolls inside .page; once it has left that box the handles must go
    // with it rather than hover over the text above.
    const box = _opPick.closest('.page');
    const b = box ? box.getBoundingClientRect() : null;
    if(b && (r.bottom < b.top + 4 || r.top > b.bottom - 4)){ g.classList.remove('on'); return; }
    g.classList.add('on');
    const ring = g.querySelector('.op-ring');
    ring.style.left = r.left + 'px'; ring.style.top = r.top + 'px';
    ring.style.width = r.width + 'px'; ring.style.height = r.height + 'px';
    const at = { nw:[r.left,r.top], ne:[r.right,r.top], sw:[r.left,r.bottom], se:[r.right,r.bottom] };
    // Per handle, not all-or-nothing. Enlarge a picture and its bottom corners drop out
    // of the scrolling .page box; drawing them anyway put two grips over the text below
    // the editor, where clicking them did nothing at all. Each one hides when it leaves
    // the box, and comes back when the student scrolls it into view.
    g.querySelectorAll('.op-grip').forEach(h => {
      const [x,y] = at[h.dataset.c];
      h.style.left = x + 'px'; h.style.top = y + 'px';
      h.style.visibility = (b && (y < b.top + 2 || y > b.bottom - 2)) ? 'hidden' : '';
    });
    const lbl = g.querySelector('.op-size');
    lbl.style.left = (r.left + r.width/2) + 'px';
    lbl.style.top  = (r.top - 14) + 'px';
  }
  function opSelect(img, save){
    opDeselect();
    // ⚠ NOTHING is written onto the <img>. It lives inside .page, so a class on it is
    // part of page.innerHTML and gets saved into the student's One-Pager -- which is
    // exactly what op-picked did until this was caught. The ring is drawn by the overlay.
    _opPick = img; _opSave = save;
    opPlaceGrips();
  }
  function opDeselect(){
    _opPick = null;
    if(_opGrips){ _opGrips.classList.remove('on'); const l=_opGrips.querySelector('.op-size'); if(l) l.hidden = true; }
  }
  function opGripDown(e){
    if(!_opPick) return;
    e.preventDefault(); e.stopPropagation();
    const r = _opPick.getBoundingClientRect();
    const host = _opPick.parentElement ? _opPick.closest('.page') : null;
    // Percent is measured against the CONTENT box: .page carries 40px of side padding,
    // and measuring against the border box would let 100% overflow the column.
    const cs = host ? getComputedStyle(host) : null;
    const avail = host
      ? host.clientWidth - parseFloat(cs.paddingLeft||0) - parseFloat(cs.paddingRight||0)
      : r.width;
    _opDrag = { corner:e.target.dataset.c, x0:e.clientX, w0:r.width, avail:Math.max(40, avail) };
    e.target.setPointerCapture && e.target.setPointerCapture(e.pointerId);
    const lbl = _opGrips.querySelector('.op-size'); if(lbl) lbl.hidden = false;
    window.addEventListener('pointermove', opGripMove);
    window.addEventListener('pointerup', opGripUp, { once:true });
  }
  function opGripMove(e){
    if(!_opDrag || !_opPick) return;
    // Grab a left-hand corner and dragging LEFT should make it bigger; a right-hand one
    // is the other way round. Without this, two of the four corners work backwards.
    const dir = (_opDrag.corner === 'nw' || _opDrag.corner === 'sw') ? -1 : 1;
    const w = _opDrag.w0 + dir * (e.clientX - _opDrag.x0);
    const pct = Math.max(10, Math.min(100, Math.round(w / _opDrag.avail * 100)));
    _opPick.style.width = pct + '%';
    _opPick.style.height = 'auto';        // never distort, whichever corner is dragged
    _opPick.dataset.w = pct;              // print CSS lifts its height cap off these
    const lbl = _opGrips.querySelector('.op-size');
    if(lbl) lbl.textContent = pct + '% of the column';
    opPlaceGrips();
  }
  function opGripUp(){
    window.removeEventListener('pointermove', opGripMove);
    _opDrag = null;
    const lbl = _opGrips && _opGrips.querySelector('.op-size'); if(lbl) lbl.hidden = true;
    if(_opSave) _opSave();               // the width is part of page.innerHTML now
    opPlaceGrips();
  }
  window.addEventListener('scroll', () => { if(_opPick) opPlaceGrips(); }, true);
  window.addEventListener('resize', () => { if(_opPick) opPlaceGrips(); });
  document.addEventListener('keydown', e => { if(e.key === 'Escape' && _opPick) opDeselect(); });

  // opKey is captured, not read off fwCur at event time: shrinking is async, so an
  // insert can land after the student has clicked away to another One-Pager.
  function wireComposer(opKey){
    const page=document.getElementById('page'),wc=document.getElementById('wc');
    const upd=()=>{const n=(page.innerText.trim().match(/\S+/g)||[]).length;wc.textContent=n+' words';wc.classList.toggle('good',n>=500&&n<=650);};
    const save=()=>{ if(!page.isConnected) return; DB.freewrite[opKey]=Object.assign({},DB.freewrite[opKey],{shape:page.innerHTML}); saveDB(); upd(); };
    page.addEventListener('input',upd);
    // The direct child of #page holding the caret — the block whose tag H switches.
    const blockTag=()=>{
      const s=window.getSelection(); if(!s||!s.rangeCount) return '';
      let n=s.getRangeAt(0).startContainer;
      if(!page.contains(n)) return '';
      while(n && n.parentNode && n.parentNode!==page) n=n.parentNode;
      return (n && n.nodeType===1) ? n.tagName.toLowerCase() : '';
    };
    document.querySelectorAll('.toolbar button[data-cmd]').forEach(btn=>btn.addEventListener('mousedown',e=>{
      e.preventDefault();page.focus();
      let cmd=btn.dataset.cmd,val=btn.dataset.val||null;
      // H is a TOGGLE. B and I already toggle, so a heading applied by accident looked
      // permanent: pressing H again just re-applied h3 and there was no way back to a
      // paragraph. Pressing it on a heading now returns it to one.
      if(cmd==='formatBlock' && val==='h3' && blockTag()==='h3') val='p';
      document.execCommand(cmd,false,val);
      save();
    }));
    // Undo/redo from the keyboard as well, since that is what a writer reaches for first.
    // execCommand keeps its own history, and the copy-from-gush insert is part of it.
    page.addEventListener('keydown',e=>{
      if(!(e.ctrlKey||e.metaKey)) return;
      const k=e.key.toLowerCase();
      if(k==='z'){ e.preventDefault(); document.execCommand(e.shiftKey?'redo':'undo'); save(); }
      else if(k==='y'){ e.preventDefault(); document.execCommand('redo'); save(); }
    });
    const imgInput=document.getElementById('imgInput');
    document.getElementById('imgBtn').addEventListener('mousedown',e=>{e.preventDefault();imgInput.click();});
    imgInput.addEventListener('change',async ()=>{
      for(const f of [...imgInput.files]){
        const src = await fileToShrunkDataURL(f);
        if(!src || !page.isConnected) continue;
        page.focus();
        document.execCommand('insertHTML',false,`<img src="${src}" alt="" data-shrunk="1">`);
      }
      save();
    });
    // Click a picture to get its corner handles; click anywhere else to put them away.
    page.addEventListener('click', e => {
      if(e.target && e.target.tagName === 'IMG') opSelect(e.target, save);
      else opDeselect();
    });
    page.addEventListener('scroll', () => { if(_opPick) opPlaceGrips(); });
    document.addEventListener('mousedown', e => {
      if(!_opPick) return;
      if(e.target.classList && e.target.classList.contains('op-grip')) return;
      if(e.target !== _opPick) opDeselect();
    });
    // Typing moves the picture; stale handles pointing at where it used to be are worse
    // than none. Re-place rather than hide, so a caret two lines up does not lose them.
    page.addEventListener('input', () => { if(_opPick) opPlaceGrips(); });
    // Pasted images bypass the picker entirely, so shrink them once they have landed.
    page.addEventListener('paste',()=>{ setTimeout(()=>shrinkImagesIn(page,save),0); });
    // Sweep restored content once as well: anything inserted before this build is still
    // full-resolution in localStorage and in every PDF it exports. data-shrunk makes it
    // a one-time cost per image, not work repeated on every render.
    shrinkImagesIn(page, save);
    opDeselect();      // a previous One-Pager's handles must not outlive its page
    upd();
  }

  // ---------- Currere ----------
  const MO = { reg:{k:'Moment 1 · Regressive',t:'Go back',f:'Free-associate your life in schools, as far back as you can reach. <span class="hint">No order, no editing.</span>',kind:'gush'},
    pro:{k:'Moment 2 · Progressive',t:'Go forward',f:'Imagine yourself teaching a year, five years from now. <span class="hint">This one is harder. Let it be.</span>',kind:'gush'},
    ana:{k:'Moment 3 · Analytical',t:'Lay them side by side',f:'Set past and future next to each other. <span class="hint">What runs through both? Name it.</span>',kind:'ana'},
    syn:{k:'Moment 4 · Synthetical',t:'Put it back together',f:'Write the piece that carries the thread across past, present, and future. <span class="hint">No timer. Edit freely.</span>',kind:'syn'} };
  let curCur='reg';
  const curBursts = { reg: (DB.currere.reg || ''), pro: (DB.currere.pro || '') };
  function renderCur(){
    body.classList.remove('wide', 'bleed');
    const spine = Object.entries(MO).map(([k,m])=>`<button class="moment ${k===curCur?'on':''} ${curBursts[k]?'has':''}" data-mo="${k}"><span class="mname"><span class="dot"></span>${m.t}</span><span class="mkind">${m.kind==='gush'?'timed gush':m.kind==='ana'?'compare':'open draft'}</span></button>`).join('');
    frame.innerHTML = `<div class="head"><h1>Your Currere</h1><p>Four movements, run in order the way a current runs. Structure loosens as you go.</p></div>
      <div class="layout"><nav class="spine"><p class="lead">The four moments</p>${spine}<p class="runline">Gushes → comparison → open page.</p></nav><main class="stage" id="stage"></main></div>`;
    frame.querySelectorAll('[data-mo]').forEach(b=>b.addEventListener('click',()=>{if(G.running)return;curCur=b.dataset.mo;renderCur();}));
    const m=MO[curCur],st=document.getElementById('stage');
    setTimeout(()=>{ const host=document.getElementById('stage');
      if(host && !document.getElementById('asnCur')){
        host.insertAdjacentHTML('beforeend', assignmentNote('currere','asnCur'));
        wireAssignmentNote('asnCur'); } }, 0);
    if(m.kind==='gush'){
      st.innerHTML=`<p class="kicker">${m.k}</p><h2>${m.t}</h2><p class="framing">${m.f}</p>
        <div class="gushbar"><div class="timerset" id="timerset"><button class="tadj" id="tminus">−</button><span class="timer editable" id="timer">8:00</span><button class="tadj" id="tplus">+</button></div><button class="btn go" id="startBtn">Start the gush</button><span class="locknote" id="lockmsg">Set your minutes, then start → locks + Focus.</span></div>
        <textarea class="gush" id="gush" placeholder="Don’t stop, don’t fix." disabled></textarea>
        <div class="reflect" id="reflect" style="display:none"><span class="lbl">Reflecting with ${AI_NAME}</span><span>How did remembering go? <em>(stubbed)</em></span></div>
        <div style="margin-top:12px"><button class="btn ghost sm" id="curAddNb">＋ Add to notebook</button></div>`;
      wireTimer();
      if(curBursts[curCur]){ document.getElementById('gush').value = curBursts[curCur]; }
      document.getElementById('startBtn').addEventListener('click',()=>startGush(gushSecs,{focus:true,onEnd:()=>{curBursts[curCur]=document.getElementById('gush').value||'(gush)';DB.currere[curCur]=curBursts[curCur];saveDB();}}));
      const curAdd = document.getElementById('curAddNb'); if(curAdd) curAdd.onclick = ()=>elevate('cur-'+curCur, 'currere', m.k+' · '+m.t, document.getElementById('gush').value);
    } else if(m.kind==='ana'){
      // Moment 3 was the one currere moment with no way into the notebook -- and the
      // reason was worse than a missing button. It asks "What runs through both? Name it."
      // and gave the student nowhere to name it: two read-only panes and a stubbed AI
      // button. The comparison the other three moments exist to produce could not be
      // written down, let alone kept.
      const pane=k=>curBursts[k]?`<div class="pane">${curBursts[k]}</div>`:`<div class="pane" style="color:var(--muted);font-style:italic">Run this gush first.</div>`;
      st.innerHTML=`<p class="kicker">${m.k}</p><h2>${m.t}</h2><p class="framing">${m.f}</p>
        <div class="sbs"><div><h4>Regressive · past</h4>${pane('reg')}</div><div><h4>Progressive · future</h4>${pane('pro')}</div></div>
        <p class="stagenote">Looking for what recurs across everything you have kept, not just these two? The notebook counts it for you.</p>
        <button class="btn ghost" id="themesBtn">What keeps coming back →</button>
        <p class="stagenote" style="margin-top:16px">What runs through both? Name it here — this is the comparison, and it is your writing, not the app's.</p>
        <textarea class="gush" id="anaNote" placeholder="What comes back in both the past and the future? Name it plainly.">${escHtml((DB.currere||{}).ana||'')}</textarea>
        <div style="margin-top:12px"><button class="btn ghost sm" id="anaAddNb">＋ Add to notebook</button></div>`;
      document.getElementById('themesBtn').addEventListener('click',()=>{ noteMode='threads'; show('note'); });
      const anaTa = document.getElementById('anaNote');
      anaTa.addEventListener('input', ()=>{ DB.currere.ana = anaTa.value; saveDB(); });
      document.getElementById('anaAddNb').onclick = ()=>elevate('cur-ana', 'currere', m.k+' · '+m.t, anaTa.value);
    } else {
      st.innerHTML=`<p class="kicker">${m.k}</p><h2>${m.t}</h2><p class="framing">${m.f}</p>
        <textarea class="gush" id="gush" placeholder="Write the currere — open parts, or braid it into one. Pull scenes from what you gathered."></textarea>
        <div class="composer-foot" style="margin-top:14px"><button class="btn ghost" id="synAddNb">＋ Add to notebook</button></div>`;
      const synTa = document.getElementById('gush');
      if(DB.currere.syn){ synTa.value = DB.currere.syn; }
      synTa.addEventListener('input', ()=>{ DB.currere.syn = synTa.value; saveDB(); });
      const synAdd = document.getElementById('synAddNb'); if(synAdd) synAdd.onclick = ()=>elevate('cur-syn', 'currere', 'Moment 4 · Synthetical', synTa.value);
    }
  }

  // ---------- Readings (full width, two-pane) ----------
  // On first run the shelf holds a built-in one-page user manual (shipped PDF,
  // fetched from ./manual.pdf, not IndexedDB). Students load their own on top.
  const MANUAL_READING = { id:'manual', name:'How to use Journaler (start here)', type:'pdf', builtin:true, url:'./manual.pdf' };
  let readings = (DB.readings && DB.readings.length) ? DB.readings.slice() : [ Object.assign({}, MANUAL_READING) ];
  let activeReading = DB.activeReading || 0;
  if(activeReading >= readings.length) activeReading = 0;
  function persistReadings(){ DB.readings = readings.map(r=>({ id:r.id, name:r.name, type:r.type, html: r.type==='txt' ? r.html : undefined, builtin: r.builtin||undefined, url: r.url||undefined, fromDir: r.fromDir||undefined, legacyId: r.legacyId||undefined })); DB.activeReading = activeReading; saveDB(); }

  // Order the shelf sensibly: built-in manual first, then an intro, then chapters
  // in NUMERIC order (ch1 < ch2 < ch10), then everything else alphabetically.
  // Chapter number from a filename. Accepts "ch7", "chapter 7", "wwm-ch7" AND a
  // BARE leading number ("7-seek-surprise.pdf") — the scans are named that way,
  // and requiring the "ch" prefix dropped every chapter into the alphabetical
  // bucket, so the shelf read 1, 10, 11 … 19, 2, 20.
  function chapterNum(name){
    const n = String(name||'').replace(/\.(pdf|docx|txt)$/i, '');
    const m = /^(?:wwm[\s._-]*)?(?:ch(?:apter)?[\s._-]*)?(\d+)(?=[\s._-]|$)/i.exec(n);
    return m ? parseInt(m[1], 10) : null;
  }
  const FRONT_RE = /^\s*\d*[\s._-]*(intro|front[\s._-]*matter|preface|foreword)/i;
  const BACK_RE  = /^\s*\d*[\s._-]*(end[\s._-]*matter|back[\s._-]*matter|appendix|index|works[\s._-]*cited|bibliograph)/i;
  function readingRank(r){
    if(r.builtin) return [0, 0, ''];
    const low = r.name.toLowerCase();
    // Front and back matter are numbered too (0-front-matter, 26-end-matter), so
    // they must be classified BEFORE the numeric branch or they sort as chapters.
    if(FRONT_RE.test(r.name)) return [1, 0, low];
    if(BACK_RE.test(r.name))  return [4, 0, low];
    const n = chapterNum(r.name);
    if(n !== null) return [2, n, low];
    return [3, 0, low];
  }
  function sortReadings(){
    const activeId = readings[activeReading] && readings[activeReading].id;
    readings.sort((a,b)=>{ const ra = readingRank(a), rb = readingRank(b); return ra[0]-rb[0] || ra[1]-rb[1] || ra[2].localeCompare(rb[2]); });
    const idx = readings.findIndex(r=>r.id === activeId);
    activeReading = idx >= 0 ? idx : 0;
  }
  // A cleaner label for the dropdown (the underlying filename is kept as r.name).
  function readingLabel(r){
    if(r.builtin) return r.name;
    const n = r.name.replace(/\.(pdf|docx|txt)$/i, '');
    const tidy = s => { s = (s||'').replace(/[-_]+/g,' ').trim(); return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; };
    // Same order as readingRank: matter before numbers, since both start with digits.
    if(FRONT_RE.test(n)) return /front[\s._-]*matter/i.test(n) ? 'Front matter' : 'Introduction';
    if(BACK_RE.test(n))  return tidy(n.replace(/^\s*\d+[\s._-]*/, '')) || 'End matter';
    const num = chapterNum(n);
    if(num !== null){
      const rest = tidy(n.replace(/^(?:wwm[\s._-]*)?(?:ch(?:apter)?[\s._-]*)?\d+[\s._-]*/i, ''));
      return 'Ch ' + num + (rest ? ' · ' + rest : '');
    }
    return tidy(n) || r.name;
  }
  function docBody(r){
    if(!r) return `<div class="docstub"><strong>No reading loaded.</strong><br>Use <em>＋ Load readings</em> to load a WWM chapter (PDF or .docx).</div>`;
    if(r.type === 'txt') return r.html;
    return `<div class="pdf-loading">Loading ${escHtml(r.name)}…</div>`;   // filled by renderActiveDoc
  }

  // Reading view state.
  let readPageMode = DB.readPageMode || 'continuous';   // 'single' | 'continuous'
  let readSpread = (DB.readSpread === 2) ? 2 : 1;   // pages shown at once in 'single'
  // What the reader ASKED for is readSpread; what the pane can actually SHOW is
  // _effSpread. They come apart at a fixed zoom, and everything that renders, labels
  // or turns a page uses the effective one -- so a spread that will not fit degrades
  // to one page rather than to two pages with their outer edges cut off, and Next
  // then steps by one instead of skipping the page it never showed.
  let _effSpread = readSpread;
  // The pages on screen right now. null means "all of them" (continuous), which the
  // margin reads as "do not filter".
  function visiblePages(){
    if(readPageMode !== 'single') return null;
    return Array.from({ length: _effSpread }, (_, i) => readPageNum + i);
  }
  let readPageNum = 1;                               // current page in single mode
  let _curPdf = { id:null, doc:null, labels:null };  // cache the parsed doc so paging doesn't reparse
  // ⚠ A pdf.js DOCUMENT MUST BE DESTROYED, not merely dropped. PDFDocumentProxy keeps
  // its data on the WORKER side; releasing the reference here frees the handle and none
  // of the memory behind it. This cache was replaced or nulled in seven places and
  // destroy() appeared nowhere in the file, so every chapter opened in a session left
  // its parsed document behind for the rest of it — and this shelf holds 27 chapters.
  // (Found after Todd's freeze, 2026-08-30: 27 readings, continuous mode, dpr 2.)
  // destroy() returns a promise that rejects if a render is still in flight, which is
  // ordinary here — a reading switched mid-render is the common case — so the rejection
  // is swallowed rather than reported.
  function releasePdf(d, keep){
    if(!d || d === keep) return;
    stopPageObservers();
    // ⚠ IT IS THE LOADING TASK THAT HAS destroy(), NOT THE DOCUMENT. In pdf.js 6.0.227
    // PDFDocumentProxy exposes cleanup(), loadingTask and no destroy at all — so
    // `d.destroy()` threw a TypeError that this very try/catch swallowed, and build 205
    // freed NOTHING while reporting that it did. Found 2026-08-30 only because a probe
    // counted the calls instead of trusting the code. Never silently accept "no way to
    // destroy" again: say so, loudly, so the next pdf.js bump cannot repeat this.
    const task = (d.loadingTask && typeof d.loadingTask.destroy === 'function') ? d.loadingTask
               : (typeof d.destroy === 'function' ? d : null);
    if(!task){ console.warn('releasePdf: this pdf.js build exposes no destroy() — nothing was freed'); return; }
    // destroy() rejects when a render is still in flight, which is ordinary here.
    try { const p = task.destroy(); if(p && p.catch) p.catch(() => {}); } catch(e){ console.warn('releasePdf', e); }
  }
  function dropPdf(){ stopPageObservers(); const d = _curPdf.doc; _curPdf = { id:null, doc:null, labels:null }; releasePdf(d); }
  // ── Which pages currently hold a canvas is decided by two IntersectionObservers set
  // up per render (see renderPdfPages, PHASE 2). They observe divs that a later render
  // throws away, so they are torn down whenever the pane is about to be rebuilt or the
  // document goes — an observer left watching detached nodes is a leak, and worse, it
  // would call fill() against a stale render token.
  let _pageIO = [];
  function stopPageObservers(){ _pageIO.forEach(o => { try { o.disconnect(); } catch(e){} }); _pageIO = []; }
  // The WWM chapter PDFs carry /PageLabels (embedded 2026-08-26), so page 1 of
  // ch5-a-writing-place.pdf reports itself as book page 23. Everything a student
  // READS or CITES should use that; everything that POSITIONS a highlight must keep
  // using the index, because the rects were measured against it. Hence two fields on
  // a highlight: .page (index, paints the band) and .pageLabel (book page, cites it).
  // A PDF with no labels — a student's own scan — falls back to the index, so nothing
  // depends on the labels existing.
  function pageLabelFor(n){
    const L = _curPdf.labels;
    const v = (L && L[n-1] != null) ? String(L[n-1]).trim() : '';
    return v || String(n);
  }

  // Wait briefly for the pdf.js ES module (index.html) to attach to window.
  async function ensurePdfjs(){ for(let i=0; i<40 && !window.pdfjsLib; i++){ await new Promise(res=>setTimeout(res,100)); } return window.pdfjsLib; }
  // ── Readings folder. Point Journaler at a folder ONCE — a course folder or a
  //    thumb drive — and the shelf refills itself every visit instead of loading
  //    files by hand. Files are read on demand, never copied into IndexedDB, so a
  //    73MB set of chapters costs no browser storage at all.
  //    Chromium only (File System Access API). Everywhere else the ＋ Load pickers
  //    remain, unchanged — this is additive.
  const FS_OK = typeof window.showDirectoryPicker === 'function';
  let readingsDir = null;              // FileSystemDirectoryHandle
  let readingsDirState = 'none';       // none | granted | prompt | missing
  function readingsDirName(){ return readingsDir ? readingsDir.name : (DB.readingsDirName || ''); }

  async function pickReadingsFolder(){
    if(!FS_OK) return;
    let h;
    try { h = await window.showDirectoryPicker({ id:'journaler-readings', mode:'read' }); }
    catch(e){ return; }                // user cancelled the picker
    readingsDir = h; readingsDirState = 'granted';
    DB.readingsDirName = h.name; saveDB();
    try { await idbPut('handles','readingsDir', h); }
    catch(e){ console.warn('store dir handle', e); toast('Folder connected, but it won’t be remembered next time.'); }
    await syncFolderReadings();
  }
  // Re-granting needs a user gesture, which is why this is a button and not
  // something that can run on load.
  async function reconnectReadingsFolder(){
    if(!readingsDir){ await pickReadingsFolder(); return; }
    try {
      const p = await readingsDir.requestPermission({ mode:'read' });
      if(p !== 'granted'){ readingsDirState = 'prompt'; renderRead(); return; }
      readingsDirState = 'granted';
      await syncFolderReadings();
    } catch(e){ readingsDirState = 'missing'; renderRead(); }
  }
  async function forgetReadingsFolder(){
    for(let i = readings.length - 1; i >= 0; i--) if(readings[i].fromDir) readings.splice(i,1);
    readingsDir = null; readingsDirState = 'none';
    delete DB.readingsDirName; saveDB();
    try { await idbDel('handles','readingsDir'); } catch(e){}
    if(activeReading >= readings.length) activeReading = Math.max(0, readings.length - 1);
    dropPdf();
    persistReadings(); renderRead();
  }
  // Reconcile the shelf with what's actually in the folder — new files appear,
  // deleted ones drop off. IDs are derived from the filename ('d:<name>') rather
  // than random, so highlights and Romano's thread survive across sessions and
  // machines; a re-picked folder finds the same work waiting.
  async function syncFolderReadings(){
    if(!readingsDir) return;
    const found = [];
    try {
      for await (const [name, handle] of readingsDir.entries()){
        if(handle.kind === 'file' && /\.(pdf|docx|txt)$/i.test(name)) found.push(name);
      }
    } catch(e){ readingsDirState = 'missing'; rerenderReadIfVisible(); return; }
    readingsDirState = 'granted';
    const names = new Set(found);
    for(let i = readings.length - 1; i >= 0; i--){
      if(readings[i].fromDir && !names.has(readings[i].name)) readings.splice(i,1);
    }
    const have = new Set(readings.filter(r => r.fromDir).map(r => r.name));
    for(const name of found){
      if(have.has(name)) continue;
      const ext = (name.split('.').pop()||'').toLowerCase();
      const rec = { id:'d:'+name, name, type:ext, fromDir:true };
      if(ext === 'txt'){
        // .txt renders from r.html, so it has to be read up front like the picker does.
        try { const txt = await (await (await readingsDir.getFileHandle(name)).getFile()).text();
              rec.html = `<p>${escHtml(txt).replace(/\n{2,}/g,'</p><p>').replace(/\n/g,'<br>')}</p>`; }
        catch(e){ continue; }
      }
      readings.push(rec);
    }
    if(activeReading >= readings.length) activeReading = Math.max(0, readings.length - 1);
    logEvent('read', `folder synced · ${found.length} file(s)`, readingsDirName());
    persistReadings(); rerenderReadIfVisible();
  }
  // A folder sync can fire on load while the reader is on another tab; renderRead()
  // would overwrite that tab's DOM, so only repaint when Readings is on screen.
  function rerenderReadIfVisible(){ if(document.getElementById('drawerList')) renderRead(); }

  // Bytes for a reading: a built-in (shipped) reading fetches from its URL; a
  // folder-backed one is read from disk on demand; a picker-loaded one from IndexedDB.
  async function readingBytesFor(r){
    // Cache-bust at FETCH time, not in the stored record: r.url is persisted into DB, so
    // a buster baked into it would freeze whichever build first shelved the manual and
    // the student would keep getting that copy forever.
    if(r.builtin && r.url){
      const u = r.url + (r.url.includes('?') ? '&' : '?') + 'v=' + encodeURIComponent(BUILD);
      try { const res = await fetch(u); return res.ok ? await res.arrayBuffer() : null; } catch(e){ return null; }
    }
    if(r.fromDir){
      if(!readingsDir) return null;
      try { return await (await (await readingsDir.getFileHandle(r.name)).getFile()).arrayBuffer(); }
      catch(e){ readingsDirState = 'missing'; return null; }
    }
    // A migrated reading still has its bytes filed under the OLD random id, so try the
    // new key first and fall back — otherwise re-keying would orphan a chapter from its
    // own file, which is the bug this change exists to end.
    const b = await loadReadingBytes(r.id);
    if(b) return b;
    return r.legacyId ? await loadReadingBytes(r.legacyId) : null;
  }

  // Why a reading has no bytes: a folder reading only needs the folder reconnected
  // (or the drive plugged back in) — telling a student to "load it again" there
  // would be wrong advice.
  function missingBytesStub(r){
    if(r.fromDir){
      const where = readingsDirName() ? ' <em>' + escHtml(readingsDirName()) + '</em>' : '';
      return `<div class="docstub"><strong>${escHtml(r.name)}</strong><br>Your readings folder${where} isn’t connected right now.<br>Use <em>Reconnect folder</em> above — if it’s on a thumb drive, plug it back in first.</div>`;
    }
    return `<div class="docstub"><strong>${escHtml(r.name)}</strong><br>This file isn’t stored in this browser. Load it again with <em>＋ Load readings</em>.</div>`;
  }
  // Render the active reading into #docPane. PDFs → canvas pages (pdf.js);
  // .docx → HTML (mammoth). A token guards against fast reading switches.
  let _readToken = 0;
  async function renderActiveDoc(r){
    const pane = document.getElementById('docPane');
    if(!pane || !r) return;
    const token = ++_readToken;
    // Slate goes behind PDF SHEETS only. A .docx or .txt renders as flowed text straight
    // into this pane, and that text needs a page-white background to read against.
    pane.classList.toggle('pdfmode', r.type === 'pdf');
    if(r.type === 'txt'){ pane.innerHTML = r.html; return; }
    pane.innerHTML = `<div class="pdf-loading">Loading ${escHtml(r.name)}…</div>`;
    if(r.type === 'pdf'){
      const lib = await ensurePdfjs();
      if(token !== _readToken) return;
      if(!lib){ pane.innerHTML = `<div class="docstub"><strong>PDF engine still loading.</strong><br>Give it a moment, then reselect the reading.</div>`; return; }
      try {
        let doc;
        if(_curPdf.id === r.id && _curPdf.doc){ doc = _curPdf.doc; }
        else {
          const bytes = await readingBytesFor(r);
          if(token !== _readToken) return;
          if(!bytes){ pane.innerHTML = missingBytesStub(r); return; }
          doc = await lib.getDocument({ data: (bytes.slice ? bytes.slice(0) : bytes), ...(window.PDF_DOC_OPTS||{}) }).promise;
          // Switched reading while this was parsing: it is finished, it is ours, and
          // nothing will ever look at it again. Hand it back before walking away.
          if(token !== _readToken){ releasePdf(doc); return; }
          let labels = null;
          try { labels = await doc.getPageLabels(); }
          catch(e){ console.warn('page labels', e); }
          if(token !== _readToken){ releasePdf(doc); return; }
          releasePdf(_curPdf.doc, doc);   // the chapter we are leaving
          _curPdf = { id:r.id, doc, labels };
        }
        await renderPdfPages(pane, doc, r, token);
      } catch(e){ console.warn('pdf render', e); if(token===_readToken) pane.innerHTML = `<div class="docstub"><strong>Could not render this PDF.</strong><br>${escHtml(String((e&&e.message)||e))}</div>`; }
    } else if(r.type === 'docx'){
      const bytes = await readingBytesFor(r);
      if(token !== _readToken) return;
      if(!bytes){ pane.innerHTML = missingBytesStub(r); return; }
      try {
        if(!window.mammoth){ pane.innerHTML = `<div class="docstub"><strong>.docx engine not loaded.</strong></div>`; return; }
        const res = await window.mammoth.convertToHtml({ arrayBuffer: (bytes.slice ? bytes.slice(0) : bytes) });
        if(token !== _readToken) return;
        pane.innerHTML = `<div class="docx-body">${res.value || '<em>Empty document.</em>'}</div>`;
      } catch(e){ console.warn('docx render', e); if(token===_readToken) pane.innerHTML = `<div class="docstub"><strong>Could not render this .docx.</strong></div>`; }
    }
  }

  // ── PDF passage capture — lifted from the 318P journaler. On OCR'd scans the bare
  // text layer's native selection is unreliable (word-level spans → rectangular drags),
  // so "box" mode is the default: drag a rectangle and harvest the spans it covers, in
  // reading order, plus a cropped image (figures). "select" = native text selection.
  // Toggle with the shelf button. See app.css .marquee-* / .selection-popup.
  let captureText = '', captureRects = null;

  // Reorder OCR text items into reading order when the page has clear columns.
  // ⚠ ROOT CAUSE, STILL OPEN. This re-sorts the text items, which is what makes the
  //   text layer's DOM order stop matching reading order — the single fact behind
  //   every selection and copy bug we chased on 2026-07-30.
  //
  //   On a SINGLE-column scan the word left-edges still cluster (left margin,
  //   paragraph indents, justified spacing), so the gap test below can find columns
  //   that are not there and shuffle a perfectly ordinary page.
  //
  //   Reading selection no longer depends on DOM order, so it survives this. Other
  //   code may not. If you tighten it — only reorder on a wide, sustained vertical
  //   gutter with text down both sides — find out which page motivated it first;
  //   it was added to help selection and marquee capture.
  function orderByReadingColumns(items, pageWidth){
    const good = items.filter(it => (it.str || '').trim().length);
    if(good.length < 10 || !pageWidth) return items;
    const lefts = good.map(it => it.transform[4]).sort((a,b)=>a-b);
    const gap = pageWidth * 0.06;
    const clusters = []; let sum = lefts[0], count = 1, prev = lefts[0];
    for(let i=1;i<lefts.length;i++){
      if(lefts[i]-prev > gap){ clusters.push({x:sum/count,n:count}); sum=0; count=0; }
      sum += lefts[i]; count += 1; prev = lefts[i];
    }
    clusters.push({x:sum/count,n:count});
    const cols = clusters.filter(c=>c.n >= good.length*0.04).map(c=>c.x).sort((a,b)=>a-b);
    if(cols.length < 2) return items; // single column — natural order is fine
    const colOf = x => { let bi=0,bd=Infinity; cols.forEach((cx,ci)=>{const d=Math.abs(x-cx); if(d<bd){bd=d;bi=ci;}}); return bi; };
    return items
      .map((it,idx)=>({it,idx,col:(it.str||'').trim().length?colOf(it.transform[4]):0,y:it.transform[5]}))
      .sort((A,B)=>(A.col-B.col)||(B.y-A.y)||(A.idx-B.idx))
      .map(o=>o.it);
  }
  // Some OCR'd scans embed the same text 2–3× at one spot; drop exact duplicates.
  function dedupeTextItems(items){
    const seen = new Set(); const out = [];
    for(const it of items){
      const s = it.str || '';
      if(!s.trim()){ out.push(it); continue; } // keep whitespace/EOL items for spacing
      const tr = it.transform || [];
      const key = s + '@' + Math.round(tr[4]||0) + ',' + Math.round(tr[5]||0);
      if(seen.has(key)) continue;
      seen.add(key); out.push(it);
    }
    return out;
  }

  // Only one marquee can be dragged at a time, so the window listeners belong to
  // the module, not to a page. attachMarquee() runs per page per render, and it
  // used to add a mousemove/mouseup pair each time without ever removing them —
  // a continuous-mode repaint of a 14-page chapter leaked 28 listeners.
  let _mq = null;            // live drag: { overlay, canvas, textLayerDiv, startX, startY, boxEl }
  // A finger has one gesture and the page wants two of them. The capture overlay covers
  // the whole sheet, so if it is listening a drag draws a box and the chapter cannot be
  // scrolled at all -- and if it is not listening, no passage can be marked. A mouse
  // never had this problem: it scrolls with a wheel and drags with a button.
  // So on a touch screen the overlay is ARMED only when the reader asks: tap 💬 Mark
  // passage, draw one box, and scrolling comes straight back. A pointing device keeps
  // the always-on behaviour every existing reader already has in their hands.
  // (Ported from journaler-318P build 37, where box capture on an iPad was not awkward
  // but inert -- see the pointer-events note on attachMarquee below.)
  const COARSE_POINTER = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  let marqueeArmed = !COARSE_POINTER;
  // Everything that decides whether a drag draws a box or scrolls the page runs through
  // here, so the three can never disagree: the CSS touch-action, the overlay's
  // pointer-events, and the button's own label.
  function setMarqueeArmed(v){
    marqueeArmed = v;
    document.body.classList.toggle('marquee-armed', v);
    document.querySelectorAll('.marquee-overlay').forEach(o => {
      o.style.pointerEvents = v ? 'auto' : 'none';
    });
    const b = document.getElementById('vbCapture');
    if(b){ b.classList.toggle('on', v); b.innerHTML = v ? '✕<span class="vb-word"> Cancel</span>'
                                                          : '💬<span class="vb-word"> Mark passage</span>'; }
    let h = document.getElementById('marqueeHint');
    if(!h && v){
      h = document.createElement('div'); h.id = 'marqueeHint';
      h.textContent = 'Drag a box around the passage';
      document.body.appendChild(h);
    }
    if(h) h.style.display = v ? 'block' : 'none';
  }
  let _mqWired = false;
  function wireMarqueeWindowListeners(){
    if(_mqWired) return;
    _mqWired = true;
    window.addEventListener('pointermove', e => {
      if(!_mq) return;
      const r = _mq.overlay.getBoundingClientRect();
      const cx = e.clientX - r.left, cy = e.clientY - r.top;
      _mq.boxEl.style.left   = Math.min(_mq.startX, cx)+'px';
      _mq.boxEl.style.top    = Math.min(_mq.startY, cy)+'px';
      _mq.boxEl.style.width  = Math.abs(cx - _mq.startX)+'px';
      _mq.boxEl.style.height = Math.abs(cy - _mq.startY)+'px';
    });
    window.addEventListener('pointerup', e => {
      if(!_mq) return;
      const m = _mq; _mq = null;
      const r = m.boxEl.getBoundingClientRect();
      // A box under 6px was never a drag -- it was a CLICK, and this branch already knew
      // it. So the link runs both ways for free: no change to .hl-mark's pointer-events,
      // the bands stay click-through, and dragging a new box across an old highlight
      // keeps working. (Ported from journaler-318P, build 35.)
      if(r.width < 6 || r.height < 6){ m.boxEl.remove(); markAt(e.clientX, e.clientY);
        if(COARSE_POINTER) setMarqueeArmed(false); return; }
      handleMarqueeCapture(r, m.canvas, m.textLayerDiv);
      // One arming, one gesture. Left armed, the reader silently loses the ability to
      // scroll the chapter and has no way to know why.
      if(COARSE_POINTER) setMarqueeArmed(false);
    });
    // A touch drag can be TAKEN rather than finished -- iOS hands the gesture to its own
    // scrolling or to the app switcher and sends pointercancel instead of pointerup.
    // Without this the half-drawn box stays and _mq stays live, so the reader's next tap
    // finishes a drag they abandoned a minute ago.
    window.addEventListener('pointercancel', () => {
      if(!_mq) return;
      _mq.boxEl.remove(); _mq = null;
      if(COARSE_POINTER) setMarqueeArmed(false);
    });
  }
  // Pointer events, not mouse events. iOS synthesises mousedown/mouseup for a TAP and
  // nothing whatever for a DRAG -- which is exactly what a marquee is -- so on a touch
  // screen box capture was not awkward, it was inert. A touch pointer also gets implicit
  // capture on the element the drag began on, which is what lets the window listeners
  // above keep tracking when the finger slides off the page it started from.
  function attachMarquee(overlay, canvas, textLayerDiv){
    wireMarqueeWindowListeners();
    overlay.style.pointerEvents = marqueeArmed ? 'auto' : 'none';
    overlay.addEventListener('pointerdown', e => {
      if(!marqueeArmed || e.button!==0 || !e.isPrimary) return;
      document.querySelectorAll('.marquee-box').forEach(b=>b.remove());
      const r = overlay.getBoundingClientRect();
      const startX = e.clientX - r.left, startY = e.clientY - r.top;
      const boxEl = document.createElement('div'); boxEl.className='marquee-box';
      boxEl.style.left = startX+'px'; boxEl.style.top = startY+'px';
      overlay.appendChild(boxEl);
      _mq = { overlay, canvas, textLayerDiv, startX, startY, boxEl };
      e.preventDefault();
    });
  }
  function handleMarqueeCapture(boxRect, canvas, textLayerDiv){
    const hits = [];
    textLayerDiv.querySelectorAll('span').forEach(sp => {
      if(!sp.textContent || !sp.textContent.trim() || sp.classList.contains('markedContent')) return;
      const r = sp.getBoundingClientRect();
      if(!r.width || !r.height) return;
      const ix = Math.max(0, Math.min(r.right,boxRect.right)-Math.max(r.left,boxRect.left));
      const iy = Math.max(0, Math.min(r.bottom,boxRect.bottom)-Math.max(r.top,boxRect.top));
      // Two ways in, because a "span" is a word on one PDF and a whole line on the
      // next (see clipSpanToRange). Either the box covers most of the span -- the
      // word-per-span case this was written for -- OR the box is SITTING ON this
      // span's line and running along a real part of it, which is what a phrase boxed
      // inside a line-long span looks like. The second test is what stops the whole
      // capture coming back empty on a born-digital PDF.
      const onLine = iy >= 0.5 * Math.min(r.height, boxRect.height);
      const along  = ix >= 0.35 * Math.min(r.width, boxRect.width);
      if(ix*iy >= 0.35*(r.width*r.height) || (onLine && along)) hits.push(sp);
    });
    // … then expand to complete lines between the first and last hit word, with the
    // box itself narrowing the ends when a hit span is wider than the whole box.
    const pr = passageLineRects(hits, null, boxRect);
    const text = textForBands(pr.rects, pr.spans);
    let rects = normalizeRectsToPages(pr.rects);
    if(pr.rects.length) console.log('[hl] box capture →', pr.rects.length, 'line(s), build', BUILD);
    // ⚠ EVERY BOX LEAVES A MARK (Todd, 2026-08-30). A capture that found no text was
    // stored with NO rects at all: a figure -- or a page whose text layer the box
    // missed -- was kept, listed, and counted, while the page itself stayed blank. The
    // reader is told the highlight was saved and can see it was not. The box is a
    // perfectly good record of where they looked, so it becomes the band.
    if(!rects.length) rects = normalizeRectsToPages([boxRect]);
    // ⚠ NO PICTURE IS KEPT (Todd, 2026-08-30): "I wouldn't include any graphics in the
    // highlights section, although I'd certainly allow students to highlight images in
    // the text." Both halves of that hold, because the band above already does the job
    // the crop was doing. A box over a figure gets its rects from the BOX (see EVERY BOX
    // LEAVES A MARK), so it is marked on the page, anchored in the margin, and carries
    // its dated notes exactly like a passage — it simply quotes as "(figure)".
    //
    // The PNG was the last thing in a student's notes that could fill the storage quota:
    // measured, ten figure captures put the DB at 4.96MB and thirty threw
    // QuotaExceededError against a ~5MB localStorage budget. And the way to get thirty
    // was never deliberate — a chapter with NO TEXT LAYER makes every box a figure, so
    // one bad scan turned an ordinary term of marking into a hard stop. Storing nothing
    // makes that impossible rather than unlikely.
    // The page the box was drawn on, for a capture with no text to hit-test.
    const own = canvas.closest && canvas.closest('.pdf-page');
    capturePageHint = own ? (+own.dataset.page || readPageNum) : readPageNum;
    openCapturePopup(text, boxRect, rects);
  }
  // The text-layer span containing a selection boundary node.
  function spanOf(node){
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    return el ? el.closest('#docPane .textLayer span') : null;
  }
  // Group every visible text-layer span into reading-order LINES, tolerant of the
  // per-word baseline jitter OCR produces — so a line never scrambles left↔right.
  // ═══════════════════════════════════════════════════════════════════════════
  // READING SELECTION — READ THIS BEFORE CHANGING ANY OF IT
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // THE ONE FACT THAT EXPLAINS EVERYTHING HERE:
  //   The text layer's DOM order does NOT match reading order.
  //   orderByReadingColumns() re-sorts the text items before the layer is built,
  //   and the spans are absolutely positioned, so the order they sit in the DOM
  //   is unrelated to the order they appear on the page.
  //
  // Therefore EVERY DOM-based API lies to us about extent:
  //   · range.getClientRects()  — returns rects for the DOM run, which both MISSES
  //                               spans the drag visually covered (the tails of
  //                               lines) and INCLUDES spans above where the drag
  //                               started (so dragging down grabbed earlier lines)
  //   · range.intersectsNode()  — same tree walk; gave 9 spans for an 8-line
  //                               selection that visually covered ~60
  //   · range.cloneContents()   — returns text in DOM order, so a copied paragraph
  //                               came out shuffled with the chapter header spliced
  //                               into the middle of it
  //
  // SO: geometry is the source of truth, not the range.
  //   bandsFromPoints(mousedown, mouseup) decides WHICH LINES and how much of the
  //   first and last, from screen coordinates. Two points cannot be reordered by
  //   anything. The DOM range is used ONLY to notice that a selection exists.
  //
  // ⚠ THINGS THAT LOOK LIKE CLEANUPS AND ARE NOT — each one is a bug we shipped:
  //   1. "Just use the selection rects, that's what they're for."
  //        → line tails go unhighlighted; downward drags reach upward.
  //   2. "Draw the band straight from getClientRects()."
  //        → the rects are PER WORD, so the band is striped with a gap at every
  //          space. unionRectsByLine() exists solely to prevent that.
  //   3. "Cluster lines on the span's bottom edge, baselines are steadier."
  //        → they are not: a span's bottom is the FONT BOX, and tesseract estimates
  //          a font size per word, so bottoms jitter more than midpoints. This
  //          shattered lines into fragments. Cluster on the MIDPOINT.
  //   4. "cloneContents() is the obvious way to get the selected text."
  //        → DOM order again; the copy comes out scrambled. Take text from the
  //          bands, which are already in reading order.
  //   5. "A 6px tolerance is fine."
  //        → fine at 12px type, over half the line spacing at 9px, so lines merge
  //          in a narrow window or on a phone. Tolerances must be PROPORTIONAL.
  //
  // ⚠ Also: a highlight stores the rects it was SAVED with. Fixing this code never
  //   repairs an existing highlight — the wrong numbers are the data. That is why
  //   there is a Clear-all control, and why testing a change means making a FRESH
  //   highlight, not looking at an old one.
  //
  // The root cause is still upstream in orderByReadingColumns(); see the warning
  // there. Everything in this section routes around it.
  // ═══════════════════════════════════════════════════════════════════════════
  function docLines(){
    const items = [...document.querySelectorAll('#docPane .textLayer span')]
      .filter(sp => sp.textContent && sp.textContent.trim() && !sp.classList.contains('markedContent'))
      .map(sp => { const r = sp.getBoundingClientRect(); return { sp, top:r.top, bottom:r.bottom, left:r.left, right:r.right, mid:(r.top+r.bottom)/2, h:r.height }; })
      .sort((a,b) => a.top - b.top || a.left - b.left);
    // Match each span against ANY existing line, with an anchor that never moves.
    // The old version compared only with the MOST RECENT line and let that line's
    // centre drift as spans joined it, so one jittery OCR box could open a new line
    // and strand the tail of a word in it — the band then ended at a sub-word
    // boundary, which is how a highlight stopped in the middle of "bakes".
    // Cluster on the MIDPOINT. A span's bottom edge is the font box, and tesseract
    // estimates a font size per word, so bottoms jitter more than midpoints, not
    // less — clustering on them shattered lines into fragments.
    const lines = [];
    items.forEach(it => {
      let best = null, bd = Infinity;
      for(const L of lines){ const d = Math.abs(it.mid - L.anchor); if(d < bd){ bd = d; best = L; } }
      // Tolerance is PROPORTIONAL to the rendered text, never an absolute pixel
      // count: the reader zooms, the window resizes, and a fixed floor that is
      // harmless at 12px type is over half the line spacing at 9px — which would
      // merge neighbouring lines into one band on a narrow window or a phone.
      if(best && bd <= Math.max(1, Math.min(it.h, best.h) * 0.6)){ best.items.push(it); best.h = Math.max(best.h, it.h); }
      else lines.push({ anchor: it.mid, mid: it.mid, h: it.h, items: [it] });
    });
    lines.forEach(l => {
      l.items.sort((a,b) => a.left - b.left);
      l.mid = (Math.min(...l.items.map(i=>i.top)) + Math.max(...l.items.map(i=>i.bottom))) / 2;
    });
    return lines.sort((a,b) => a.anchor - b.anchor);
  }
  // Build one full-width rect per line straight from the document's line geometry
  // (NOT the selection): middle lines span the whole line, first/last run from/to the
  // boundary word. Cannot clip a middle line even with jittery OCR spans.
  // selRects (optional) = the browser's own selection rectangles. The line geometry
  // decides the BAND, which is what stops a skewed scan clipping a middle line; but
  // on these OCR scans a word box can be narrower than the glyphs it covers, so the
  // band could still stop inside a word. Widening each band to contain whatever the
  // reader actually dragged over means coverage can fall short of the selection.
  // Anchor-driven bands. Now used only by BOX capture, which hit-tests spans
  //   geometrically and so supplies a genuine, complete anchor list. Selection does
  //   NOT use this — it has no reliable way to produce that list from a DOM range.
  // ⚠ ONE SPAN IS NOT ONE WORD (Todd, 2026-08-30: "I highlighted California eccentric
  // but it didn't highlight in the text. I've had trouble with this a few times in this
  // pdf."). Everything above was built on OCR'd scans, where pdf.js emits one span per
  // WORD-CHUNK. On a born-digital PDF it emits one span per text ITEM, which is
  // routinely a whole LINE -- and a box drawn around two words inside a line-long span
  // covered a fifth of it, so the 35%-of-the-span hit test never fired: no text, no
  // anchors, no rects, filed as a figure, and nothing painted on the page at all.
  //
  // Cut a span down to a horizontal range, character by character, so a line-long span
  // can still give up the phrase that was actually boxed. Grown back out to whole words:
  // the reader dragged a rough box, not a text cursor, and a band that stops mid-word
  // reads as a bug. Returns null for anything that is not a single text node.
  function clipSpanToRange(sp, left, right){
    const node = sp.firstChild;
    if(!node || node.nodeType !== 3 || sp.childNodes.length !== 1) return null;
    const s = node.nodeValue || '';
    if(!s) return null;
    const rg = document.createRange();
    let lo = -1, hi = -1;
    for(let i = 0; i < s.length; i++){
      rg.setStart(node, i); rg.setEnd(node, i + 1);
      const r = rg.getBoundingClientRect();
      if(!r.width) continue;
      const cx = (r.left + r.right) / 2;
      if(cx >= left && cx <= right){ if(lo < 0) lo = i; hi = i; }
    }
    if(lo < 0) return null;
    // Trim the ends BEFORE growing. A box drawn a couple of pixels wide of the phrase
    // catches the space next to it, and growing from a space walks backwards through
    // the whole of the neighbouring word — "he was" came back as "so he was never".
    while(lo <= hi && /\s/.test(s[lo])) lo++;
    while(hi >= lo && /\s/.test(s[hi])) hi--;
    if(lo > hi) return null;
    while(lo > 0 && !/\s/.test(s[lo - 1])) lo--;
    while(hi < s.length - 1 && !/\s/.test(s[hi + 1])) hi++;
    return { text: s.slice(lo, hi + 1) };
  }
  // The text that matches the BANDS, rather than the spans the bands were built from.
  // On a word-per-span layer those are the same thing and this costs nothing; on a
  // line-per-span layer they are not, and the bands are what the reader can see. A span
  // the band covers almost entirely is taken whole -- no point measuring 80 characters
  // to arrive back at the string we started with.
  function textForBands(rects, spans){
    const out = [];
    (rects || []).forEach(b => {
      // Some PDFs carry the same words TWICE in the text layer — a run for the line and
      // a span per word on top of it (dedupeTextItems catches the identical ones, not
      // these). Two spans that sit on the same stretch of paper are one piece of text,
      // so the second is dropped: "your browser," was coming back as "your browser,
      // your". Distinct words never overlap, so nothing real is lost.
      const taken = [];
      spans.forEach(sp => {
        const r = sp.getBoundingClientRect();
        const mid = (r.top + r.bottom) / 2;
        if(mid <= b.top || mid >= b.bottom) return;               // belongs to another line
        const inBand = Math.min(r.right, b.right) - Math.max(r.left, b.left);
        if(inBand <= 0) return;
        if(taken.some(t => Math.min(r.right, t.right) - Math.max(r.left, t.left) >= 0.6 * r.width)) return;
        taken.push(r);
        if(inBand >= 0.92 * r.width){ out.push(sp.textContent || ''); return; }
        const c = clipSpanToRange(sp, b.left, b.right);
        out.push(c ? c.text : (sp.textContent || ''));
      });
    });
    return cleanOcrText(out.join(' '));
  }
  // clip (optional) = the marquee box. A hit item WIDER THAN THE WHOLE BOX is a line,
  // not a word, and then the box is the more precise instruction of the two: take its
  // edge. An item narrower than the box is a word the reader dragged across, and it is
  // taken whole -- which is what keeps a rough box over an OCR'd scan from stopping a
  // band inside a word, the failure the line-clustering comments above are all about.
  function passageLineRects(anchors, selRects, clip){
    if(!anchors || !anchors.length) return { rects:[], spans:[] };
    const set = new Set(anchors);
    const lines = docLines();
    const wide  = it => clip && (it.right - it.left) > (clip.right - clip.left);
    const edgeL = it => wide(it) ? Math.max(it.left,  clip.left)  : it.left;
    const edgeR = it => wide(it) ? Math.min(it.right, clip.right) : it.right;
    let firstLine = -1, lastLine = -1, firstLeft = Infinity, lastRight = -Infinity;
    lines.forEach((ln, li) => {
      ln.items.forEach(it => {
        if(!set.has(it.sp)) return;
        if(firstLine === -1 || li < firstLine){ firstLine = li; firstLeft = edgeL(it); }
        else if(li === firstLine){ firstLeft = Math.min(firstLeft, edgeL(it)); }
        if(li > lastLine){ lastLine = li; lastRight = edgeR(it); }
        else if(li === lastLine){ lastRight = Math.max(lastRight, edgeR(it)); }
      });
    });
    if(firstLine === -1) return { rects:[], spans:[] };
    const rects = [], spans = [];
    for(let li = firstLine; li <= lastLine; li++){
      const items = lines[li].items;
      const lineLeft = Math.min(...items.map(i => i.left));
      const lineRight = Math.max(...items.map(i => i.right));
      const top = Math.min(...items.map(i => i.top));
      const bottom = Math.max(...items.map(i => i.bottom));
      let left = (li === firstLine) ? firstLeft : lineLeft;
      let right = (li === lastLine) ? lastRight : lineRight;
      // Only selection rects sitting on THIS line may widen it — a rect from the
      // line below must not drag this band across the column.
      if(selRects && selRects.length){
        for(const s of selRects){
          const mid = (s.top + s.bottom) / 2;
          if(mid <= top || mid >= bottom) continue;
          if(s.left < left) left = s.left;
          if(s.right > right) right = s.right;
        }
        // Still never wider than the line's own text.
        left = Math.max(left, lineLeft); right = Math.min(right, lineRight);
      }
      rects.push({ left, top, right, bottom, width: right - left, height: bottom - top });
      // Same reasoning as the clustering tolerance: a slack of a fraction of the
      // text height rather than a fixed 2px, so which words fall inside a band does
      // not change with zoom or window width.
      const slack = Math.max(1, (bottom - top) * 0.15);
      items.forEach(it => { if(it.right > left - slack && it.left < right + slack) spans.push(it.sp); });
    }
    return { rects, spans };
  }
  // Passage spans → clean text (line-break de-hyphenation + collapsed whitespace).
  // Collapse a set of client rects into ONE rect per text line. The browser hands
  // back a rect per word span, so anything drawn straight from them is striped.
  // ⚠ Keep this. Client rects come back PER WORD; anything drawn straight from them
  //   is a stripe with a gap at every space, which is the artifact users read as
  //   "it didn't highlight everything".
  function unionRectsByLine(rects){
    const rows = [];
    [...rects].sort((a,b) => (a.top+a.bottom)/2 - (b.top+b.bottom)/2).forEach(r => {
      const mid = (r.top + r.bottom) / 2;
      const row = rows.find(x => mid > x.top && mid < x.bottom);
      if(row){ row.left = Math.min(row.left, r.left); row.right = Math.max(row.right, r.right);
               row.top = Math.min(row.top, r.top);   row.bottom = Math.max(row.bottom, r.bottom); }
      else rows.push({ left:r.left, top:r.top, right:r.right, bottom:r.bottom });
    });
    return rows.map(r => ({ ...r, width: r.right - r.left, height: r.bottom - r.top }));
  }
  // Bands straight from WHERE THE DRAG WENT, never from the DOM range.
  //
  // Both range.getClientRects() and range.intersectsNode() walk the DOM tree, but
  // the text layer is absolutely positioned and orderByReadingColumns re-sorts the
  // items — so DOM order stops matching reading order, and a drag that visually
  // covers a whole line yields a range missing that line's tail. That is why the
  // ends of lines went unhighlighted: those spans were never in the range.
  //
  // Geometry cannot lie the same way: take the topmost and bottommost points the
  // drag touched, find the lines they fall on, and fill every line between.
  // Where the pointer actually went. The DOM range cannot be trusted for extent —
  // with the items re-sorted, a range can contain spans ABOVE where the drag began,
  // which made a downward drag reach up and grab earlier lines. Two screen points
  // have no such ambiguity.
  let _dragFrom = null, _dragTo = null;
  // ⚠ The listeners are on the pane and wired once. _dragFrom/_dragTo are what
  //   bandsFromPoints reads; without them selection silently falls back to the
  //   DOM-range path and the old bugs return.
  function trackDrag(pane){
    if(!pane || pane._dragWired) return;
    pane._dragWired = true;
    pane.addEventListener('mousedown', e => { if(e.button === 0){ _dragFrom = { x:e.clientX, y:e.clientY }; _dragTo = null; } });
    pane.addEventListener('mousemove', e => { if(_dragFrom && (e.buttons & 1)) _dragTo = { x:e.clientX, y:e.clientY }; });
    pane.addEventListener('mouseup',   e => { if(e.button === 0) _dragTo = { x:e.clientX, y:e.clientY }; });
  }
  // Bands between two screen points: the line each point lands on, everything
  // between filled from that line's own text extent.
  // ⚠ DO NOT rewrite this to use window.getSelection()/getClientRects(). That is
  //   precisely the bug it replaced — see the block above. The pointer positions are
  //   the only description of the drag that survives the text layer's re-ordering.
  function bandsFromPoints(p0, p1){
    const lines = docLines();
    if(!lines.length || !p0 || !p1) return { rects:[], spans:[] };
    const box = lines.map(L => ({
      top: Math.min(...L.items.map(i => i.top)), bottom: Math.max(...L.items.map(i => i.bottom)),
      left: Math.min(...L.items.map(i => i.left)), right: Math.max(...L.items.map(i => i.right)) }));
    const lineAt = y => { let bi = 0, bd = Infinity;
      box.forEach((b,i) => { const d = (y >= b.top && y <= b.bottom) ? 0 : Math.min(Math.abs(y-b.top), Math.abs(y-b.bottom));
        if(d < bd){ bd = d; bi = i; } }); return bi; };
    let a = p0, b2 = p1;
    if(b2.y < a.y || (Math.abs(b2.y - a.y) < 2 && b2.x < a.x)){ const t = a; a = b2; b2 = t; }
    const i0 = lineAt(a.y), i1 = lineAt(b2.y);
    const rects = [], spans = [];
    for(let i = Math.min(i0,i1); i <= Math.max(i0,i1); i++){
      const bx = box[i];
      const left  = (i === i0) ? Math.min(Math.max(a.x,  bx.left), bx.right) : bx.left;
      const right = (i === i1) ? Math.max(Math.min(b2.x, bx.right), bx.left) : bx.right;
      if(right <= left) continue;
      rects.push({ left, top:bx.top, right, bottom:bx.bottom, width:right-left, height:bx.bottom-bx.top });
      const slack = Math.max(1, (bx.bottom - bx.top) * 0.15);
      lines[i].items.forEach(it => { if(it.right > left - slack && it.left < right + slack) spans.push(it.sp); });
    }
    return { rects, spans };
  }
  function bandsFromSelection(selRects){
    if(!selRects || !selRects.length) return { rects:[], spans:[] };
    const lines = docLines();
    if(!lines.length) return { rects:[], spans:[] };
    const ext = L => ({
      top: Math.min(...L.items.map(i => i.top)), bottom: Math.max(...L.items.map(i => i.bottom)),
      left: Math.min(...L.items.map(i => i.left)), right: Math.max(...L.items.map(i => i.right)) });
    const box = lines.map(ext);
    const lineAt = y => { let bi = 0, bd = Infinity;
      box.forEach((b,i) => { const d = (y >= b.top && y <= b.bottom) ? 0 : Math.min(Math.abs(y-b.top), Math.abs(y-b.bottom));
        if(d < bd){ bd = d; bi = i; } }); return bi; };
    const sorted = [...selRects].sort((a,b) => ((a.top+a.bottom)/2) - ((b.top+b.bottom)/2) || a.left - b.left);
    const first = sorted[0], last = sorted[sorted.length - 1];
    let i0 = lineAt((first.top+first.bottom)/2), i1 = lineAt((last.top+last.bottom)/2);
    if(i0 > i1){ const t = i0; i0 = i1; i1 = t; }
    const rects = [], spans = [];
    for(let i = i0; i <= i1; i++){
      const b = box[i];
      const left  = (i === i0) ? Math.min(Math.max(first.left, b.left), b.right) : b.left;
      const right = (i === i1) ? Math.max(Math.min(last.right, b.right), b.left) : b.right;
      if(right <= left) continue;
      rects.push({ left, top:b.top, right, bottom:b.bottom, width:right-left, height:b.bottom-b.top });
      const slack = Math.max(1, (b.bottom - b.top) * 0.15);
      lines[i].items.forEach(it => { if(it.right > left - slack && it.left < right + slack) spans.push(it.sp); });
    }
    return { rects, spans };
  }
  // Passage spans → clean text. The OCR layer carries predictable scanner damage
  // that would otherwise land in the clipboard, the notebook and the AI prompt:
  //   · a capital I read as a pipe — "Behold | do not give lectures"
  //   · stray _ or | specks between words
  //   · a line-break hyphen with one of those specks after it, which defeated the
  //     de-hyphenation and left "a little char- _ity"
  // Deliberately conservative: only a pipe standing alone as a word becomes "I",
  // never one touching a letter or digit, so real text is left alone.
  function spansToText(spans){
    return cleanOcrText(spans.map(s => s.textContent || '').join(' '));
  }
  function cleanOcrText(raw){
    return String(raw || '')
      // Join a hyphenated line break. Two rules, because a single loosened one also
      // matched real hyphens and turned "co-op" into "coop": the break must show
      // either whitespace after the hyphen, or a speck.
      .replace(/([A-Za-z])[-­]\s*[_|]+\s*([a-z])/g, '$1$2')
      .replace(/([A-Za-z])[-­]\s+([a-z])/g, '$1$2')
      // A lone pipe in prose is a misread capital I.
      .replace(/(^|[^A-Za-z0-9])\|(?=$|[^A-Za-z0-9])/g, '$1I')
      // Drop specks that stand alone between words.
      .replace(/(^|\s)[_|]+(?=\s|$)/g, '$1')
      .replace(/\s+/g, ' ').trim();
  }
  // A native copy out of the reader used to come back as a column of single words:
  // pdf.js builds the text layer as one span per word, so the browser puts a line
  // break between every one, and none of the OCR cleanup above ran. Intercepting
  // `copy` fixes ⌘C/Ctrl+C, right-click → Copy and the Edit menu in one place.
  // Only selections inside the reader are touched; copying anywhere else in the app
  // behaves normally.
  // ⚠ Do not "simplify" this back to letting the browser copy. Two separate reasons
  //   it cannot: the text layer is one span per word-chunk, so a native copy inserts
  //   a line break between every one; and DOM order is not reading order, so the
  //   words come out shuffled. Both are invisible until someone pastes.
  document.addEventListener('copy', e => {
    const sel = window.getSelection();
    if(!sel || sel.isCollapsed || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const node = range.commonAncestorContainer;
    const el = node.nodeType === 1 ? node : node.parentElement;
    if(!el || !el.closest || !el.closest('#docPane .textLayer')) return;
    // Read in READING order, not DOM order. cloneContents() returns the range's DOM
    // content, and with the text items re-sorted that came out shuffled — sentences
    // interleaved, and the chapter header spliced into the middle of a paragraph.
    // The band already knows which spans are covered, top-to-bottom and left-to-
    // right, so take the text from there.
    let pr = bandsFromPoints(_dragFrom, _dragTo);
    if(!pr.spans.length){
      const selRects = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 1);
      pr = bandsFromSelection(selRects);
    }
    let text = pr.spans.length ? spansToText(pr.spans) : '';
    if(!text){
      const frag = range.cloneContents();
      const spans = [...frag.querySelectorAll('span')];
      text = cleanOcrText(spans.length ? spans.map(s => s.textContent || '').join(' ') : (frag.textContent || ''));
    }
    if(!text) return;
    e.clipboardData.setData('text/plain', text);
    e.preventDefault();
  });

  // ⚠ MARKING IS NOT ASKING (Todd, 2026-08-25). Enter used to send the note to Romano
  // and Ask Romano held the primary slot, so the ordinary act — reading a passage and
  // typing what you think about it — routed through the AI by default, and a reader who
  // pressed Enter out of habit had their comment answered instead of kept. Highlight is
  // now the primary button and what Enter does. Keep it that way: the notebook is the
  // point, and the partner is optional.
  //
  // 2026-08-26, Todd: Ask Romano left this popup ENTIRELY. Nothing in the course
  // requires the margin partner — one conditional sentence in the Week 1 Monday
  // outline is the only student-facing mention, the Writer's Notebook guidelines
  // never name AI, and Act II's required reflection partner is a different surface.
  // Marking a passage is now note-taking and nothing else.
  //
  // 2026-08-27, Todd: BACK, deliberately, after 318P shipped the same door and it
  // read well there — "when the user highlights text, give them the opportunity to
  // ask." The 08-25 rule SURVIVES intact and is what makes this safe to reverse:
  // Highlight is still the primary button, still what Enter does, and Ask is a third
  // button of the same size beside it rather than the default path. A reader who
  // never touches it is unaffected; the passage is kept either way.
  // The ask bar under the list still works and still calls askRomanoInto directly --
  // this is a second door onto that same per-reading conversation, not a new one.
  function ensureCapturePopup(){
    let pop = document.getElementById('capturePopup');
    if(pop) return pop;
    pop = document.createElement('div'); pop.className='selection-popup'; pop.id='capturePopup'; pop.style.display='none';
    pop.innerHTML = `<div class="popup-passage" id="capturePassage"></div>
      <textarea id="captureInput" rows="4" placeholder="What do you make of this passage?"></textarea>
      <div class="popup-quick"><button class="popup-chip" id="captureCopyBtn" title="Copy this passage (⌘C / Ctrl+C)">⧉ Copy</button><button class="popup-chip" id="captureNbBtn">📓 Keep in notebook</button></div>
      <div class="popup-actions">
        <button class="popup-btn secondary" id="captureCancelBtn">Cancel</button>
        <button class="popup-btn ask" id="captureAskBtn" title="Talk this passage over with ${AI_NAME}. Your note is kept first if you have written one.">🥫 Ask ${AI_NAME}</button>
        <button class="popup-btn primary" id="captureSaveBtn">✎ Highlight</button>
      </div>`;
    document.body.appendChild(pop);
    pop.querySelector('#captureCancelBtn').onclick = closeCapture;
    pop.querySelector('#captureSaveBtn').onclick = () => saveHighlight();
    pop.querySelector('#captureAskBtn').onclick = askFromCapture;
    pop.querySelector('#captureNbBtn').onclick   = () => saveHighlight(true);
    pop.querySelector('#captureCopyBtn').onclick = copyCaptureText;
    pop.querySelector('#captureInput').addEventListener('keydown', e => {
      if(e.key==='Enter' && (e.metaKey || e.ctrlKey)){ e.preventDefault(); saveHighlight(); }
      if(e.key==='Escape') closeCapture();
      e.stopPropagation();          // typing "c" in the note is not a copy
    });
    // ⌘C / Ctrl+C anywhere while the popup is open copies the passage. Only steps in
    // when the reader has not selected something else in the meantime, so a normal
    // copy of their own selection still wins.
    document.addEventListener('keydown', e => {
      const open = pop.style.display !== 'none';
      if(!open) return;
      if(e.key === 'Escape'){ closeCapture(); return; }
      if((e.metaKey || e.ctrlKey) && (e.key === 'c' || e.key === 'C')){
        // A live selection is handled by the `copy` listener above, which cleans it.
        // This only covers the case where the selection is already gone.
        const sel = window.getSelection();
        if(sel && !sel.isCollapsed && String(sel).trim()) return;
        e.preventDefault();
        copyCaptureText();
      }
    });
    return pop;
  }
  let capturePageHint = 0;   // set by a box drag; the page that box was drawn on
  function openCapturePopup(text, boxRect, rects){
    captureText = text || ''; captureRects = rects || null;
    const pop = ensureCapturePopup();
    pop.querySelector('#capturePassage').textContent = captureText
      ? (captureText.length>150 ? captureText.slice(0,150)+'…' : captureText)
      : '(figure — no text in this box)';
    const input = pop.querySelector('#captureInput'); input.value='';
    // Highlight, Copy and Keep in notebook are why a student without a key can use
    // this at all -- same rule as the write popup: only the ASKING goes away.
    syncAiSurfaces();
    // Measure rather than assume — the popup's size is set in CSS and used to
    // drift out of sync with hardcoded numbers here.
    pop.style.visibility = 'hidden'; pop.style.display = 'block';
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let left = boxRect.left, top = boxRect.bottom + 8;
    if(left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
    if(left < 8) left = 8;
    if(top + ph > window.innerHeight - 8) top = Math.max(8, boxRect.top - ph - 8);
    pop.style.left = left+'px'; pop.style.top = top+'px'; pop.style.visibility = '';
    // Show the real band and mute the ragged native selection underneath it. The
    // selection itself stays live — it is only unpainted — so ⌘C still copies it.
    document.body.classList.add('capturing');
    previewCapture(rects);
    // Deliberately NOT focusing the input. Focusing it dropped the page selection,
    // so ⌘C/Ctrl+C had nothing to copy and the highlight you could see was not
    // actually selected any more. Click the field to type; the passage stays live.
  }
  // ⌘C / Ctrl+C while the popup is open copies the captured passage. Native copy of
  // the still-live selection also works now; this makes it work from anywhere and
  // gives the clean, de-hyphenated text rather than the raw OCR spans.
  async function copyCaptureText(){
    if(!captureText) return;
    try { await navigator.clipboard.writeText(captureText); toast('Passage copied'); }
    catch(e){
      // Clipboard API needs a secure context and permission; fall back to a
      // throwaway textarea, which works from a user gesture anywhere.
      try {
        const ta = document.createElement('textarea');
        ta.value = captureText; ta.style.cssText = 'position:fixed;left:-9999px;top:0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); ta.remove(); toast('Passage copied');
      } catch(e2){ toast('Could not copy — select the text and use ⌘C'); }
    }
  }
  // Paint the band that WILL be saved, as soon as the popup opens. The native
  // selection colours only the text-layer word spans, so on an OCR'd scan it looks
  // ragged — gaps between word boxes — which is not what gets stored. Showing the
  // real band means the reader judges the thing they are about to keep.
  function paintBands(rects, cls){
    clearBands(cls);
    (rects || []).forEach(rc => {
      const pg = document.querySelector(`#docPane .pdf-page[data-page="${rc.page||1}"]`);
      if(!pg) return;
      let layer = pg.querySelector('.hl-layer');
      if(!layer){ layer = document.createElement('div'); layer.className = 'hl-layer'; pg.appendChild(layer); }
      const m = document.createElement('div'); m.className = 'hl-mark ' + cls;
      m.style.left = (rc.x*100)+'%'; m.style.top = (rc.y*100)+'%';
      m.style.width = (rc.w*100)+'%'; m.style.height = (rc.h*100)+'%';
      layer.appendChild(m);
    });
  }
  function clearBands(cls){ document.querySelectorAll('.hl-mark.' + cls).forEach(e => e.remove()); }
  function previewCapture(rects){ clearBands('live'); paintBands(rects, 'preview'); }
  function clearCapturePreview(){ clearBands('preview'); }

  // ── Live selection band. The browser paints ::selection only over the text-layer
  //    spans, and tesseract emits one span per WORD-CHUNK, so the gaps between them
  //    stay unpainted: a dragged selection looks like torn stripes even though the
  //    selection itself is perfectly continuous. That appearance is what reads as
  //    "the app didn't highlight everything". So ::selection is muted inside the
  //    reader (app.css) and we draw one continuous band per line instead.
  let _liveRaf = 0;
  // ⚠ This is not decoration. ::selection is transparent inside the reader (app.css)
  //   BECAUSE the browser paints it per span, leaving the gaps between words bare —
  //   a continuous selection that looks torn. If you delete this, re-enable
  //   ::selection at the same time or the reader will look like nothing is selected.
  function paintLiveSelection(){
    clearBands('live');
    const sel = window.getSelection();
    if(!sel || sel.isCollapsed || !sel.rangeCount) return;
    if(document.getElementById('capturePopup') &&
       document.getElementById('capturePopup').style.display !== 'none') return;  // preview owns the page
    const range = sel.getRangeAt(0);
    const node = range.commonAncestorContainer;
    const el = node.nodeType === 1 ? node : node.parentElement;
    if(!el || !el.closest || !el.closest('#docPane .textLayer')) return;
    const raw = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 1);
    if(!raw.length) return;
    // A selection rect is a LINE BOX, which runs past the last glyph to the edge of
    // the containing block — so a band drawn straight from it spills into the
    // margin, and two justified lines end up different lengths. Clamp each band to
    // the ink on its own line.
    let pr = bandsFromPoints(_dragFrom, _dragTo);
    if(!pr.rects.length) pr = bandsFromSelection(raw);
    paintBands(normalizeRectsToPages(pr.rects.length ? pr.rects : unionRectsByLine(raw)), 'live');
  }
  // selectionchange fires continuously through a drag; coalesce to one paint a frame.
  document.addEventListener('selectionchange', () => {
    if(_liveRaf) return;
    _liveRaf = requestAnimationFrame(() => { _liveRaf = 0; try { paintLiveSelection(); } catch(e){ console.warn('live band', e); } });
  });
  function closeCapture(){
    const pop = document.getElementById('capturePopup');
    if(pop) pop.style.display='none';
    clearCapturePreview();
    document.body.classList.remove('capturing');
    // The selection usually survives Cancel, so put the live band back rather than
    // leaving the reader with nothing painted over text that is still selected.
    setTimeout(paintLiveSelection, 0);
    document.querySelectorAll('.marquee-box').forEach(b=>b.remove());
    // Forget the capture. It used to linger, so every later question typed in the
    // ask bar ("about the reading", not about any passage) was filed under
    // whatever was captured last. saveHighlight copies what it needs first.
    captureText = ''; captureRects = null;
  }
  function saveHighlight(toNotebook){
    const pop = document.getElementById('capturePopup');
    const note = pop ? pop.querySelector('#captureInput').value.trim() : '';
    // ⚠ ASK FOR THE BAND, NOT THE PICTURE. This read "no text and no image → nothing
    // to keep", so removing the crop would have made every figure capture vanish at the
    // moment the reader pressed Highlight. What makes a capture real is that it MARKS
    // somewhere, and every box now does.
    if(!captureText && !(captureRects && captureRects.length)){ closeCapture(); return; }
    const passage = captureText;
    const rects = captureRects || [];
    const rec = {
      id: 'h' + Date.now() + '-' + Math.round(Math.random()*1e6),
      text: passage || '', note,
      rects, page: (rects[0] && rects[0].page) || capturePageHint || readPageNum, ts: Date.now()
    };
    // Stamped now, not looked up later: the citation has to survive the reader
    // closing the chapter, and a kept note outlives the open document.
    rec.pageLabel = pageLabelFor(rec.page);
    addHighlight(rec);
    logEvent('save', 'highlight kept', { page: rec.page, chars: (rec.text||'').length });
    repaintHighlights();
    renderHighlightList();
    closeCapture();
    if(toNotebook) elevateHighlight(rec);
  }
  // A second door onto the SAME conversation the ask bar already opens -- one per
  // reading, in DB.qa[readingId], with its own history and grounding. Nothing new is
  // stored: this is a shortcut from the passage in front of you to the thread that
  // already exists for that chapter.
  //
  // The passage is KEPT first, and that ordering is the whole point. Marking is not
  // asking (below): a reader who marks something and then wants to talk about it
  // should end up with both, not have the mark traded for the conversation.
  function askFromCapture(){
    const pop = document.getElementById('capturePopup');
    const note = pop ? pop.querySelector('#captureInput').value.trim() : '';
    const passage = captureText;
    const page = (captureRects && captureRects[0] && captureRects[0].page) || capturePageHint || readPageNum;
    if(!passage && !(captureRects && captureRects.length)){ closeCapture(); return; }
    saveHighlight();                       // closes the popup and clears capture state
    openRomanoChat(passage, page);
    // A note already typed IS the question. Without one, Romano opens on the passage
    // himself rather than presenting an empty window and a blinking caret.
    if(note){ const i = document.getElementById('rmInput'); if(i) i.value = note; sendRomano(); }
    else if(passage) romanoOpenOnPassage();
  }

  // Reading work counts toward the 50-pt Writer's Notebook, so a highlight can be
  // kept as a dated pass like any other piece. Carries its own citation, since the
  // notebook entry has to stand on its own away from the PDF.
  function elevateHighlight(rec){
    if(!rec) return;
    const r = readings[activeReading];
    const label = r ? readingLabel(r) : '';
    const where = label + (rec.page ? ', p. ' + (rec.pageLabel || rec.page) : '');
    const body = [
      rec.text ? '“' + rec.text + '”' : '(figure)',
      where.trim() ? '— ' + where : '',
      rec.note ? '\n' + rec.note : ''
    ].filter(Boolean).join('\n');
    // One piece PER READING rather than a single "Reading notes" bucket, so the
    // notebook shows which chapter each pass came from and a chapter's notes
    // stack together the way a One-Pager's passes do.
    const pieceId = r ? 'reading:' + r.id : 'reading';
    elevate(pieceId, 'reading', label ? 'Reading · ' + label : 'Reading notes', body, null, { capture: true });
  }
  // The partner's name, in one place. "ToddGPT" was considered and rejected on
  // 2026-08-23: Todd's name on the replies implies he can read what students write
  // here, and the notebook is the one place nothing is graded or read.
  //
  // A human name alone hides that this is software, so anything KEPT, exported or
  // printed carries AI_TAG ("Romano · AI") rather than AI_NAME. The live reading view
  // uses the bare name; the permanent record always marks it.
  // AI_NAME / AI_TAG are declared at the top of this file, above the reflection
  // partner, because paintReflection() and runReflection() live OUTSIDE this IIFE and
  // could not see them here. That is why the reflection panel still read "reflection
  // partner" long after everything else had become Romano.

  // Keep an exchange with the reading partner. Decided 2026-08-23: good ideas do
  // spring from arguing with the text, and that is exactly what the notebook is for.
  //
  // The rule is LABELLING, not exclusion. elevateHighlight already puts non-student
  // text in the notebook every time it runs — a quotation — and that is fine because
  // it goes in quoted and attributed. This does the same for Romano's words.
  // What must never happen is a reply landing as bare prose that reads as the
  // student's own, because the notebook is graded and numbered (see the ENTRY
  // NUMBERS note in the print bundle). Keep the attribution lines below.
  // The selected text, but only when the selection lies inside Romano's reply --
  // selecting your own question or the quoted passage should not become "what he said".
  function qaCardOfSelection(){
    const s = window.getSelection();
    if(!s || s.isCollapsed || !String(s).trim()) return null;
    let n = s.anchorNode; n = (n && n.nodeType === 3) ? n.parentNode : n;
    const reply = n && n.closest ? n.closest('.qa-say.rmreply') : null;
    return reply ? reply.closest('.notecard.qa') : null;
  }
  function selectedWithin(card){
    if(!card) return '';
    const s = window.getSelection();
    if(!s || s.isCollapsed) return '';
    let n = s.anchorNode; n = (n && n.nodeType === 3) ? n.parentNode : n;
    if(!n || !n.closest || !n.closest('.qa-say.rmreply')) return '';
    return card.contains(n) ? String(s).trim() : '';
  }
  function elevateQA(rec, excerpt){
    if(!rec || !rec.reply) return;
    const r = readings[activeReading];
    const label = r ? readingLabel(r) : '';
    const where = label + (rec.page ? ', p. ' + (rec.pageLabel || rec.page) : '');
    const said = String(excerpt || rec.reply).trim();
    const partial = !!excerpt && excerpt.trim() !== String(rec.reply).trim();
    const body = [
      rec.quote ? '“' + rec.quote + '”' + (where.trim() ? '\n— ' + where : '') : '',
      rec.question ? '\nI asked: ' + rec.question : '',
      '\n' + AI_NAME + ' said' + (partial ? ', in part' : '') + ': “' + said + '”'
    ].filter(Boolean).join('\n');
    const pieceId = r ? 'reading:' + r.id : 'reading';
    const title = label ? 'From chat about ' + label : 'From chat about the reading';
    elevate(pieceId, 'conversation', title, body, null, { author: AI_TAG, authorKind:'ai' });
  }
  // ── Page-scoped grounding. A bare quoted passage leaves Romano guessing at what
  //    the chapter is actually arguing; the page it sits on plus its neighbours is
  //    enough to keep him on the book, at a few hundred words per ask.
  //    Cached in memory ONLY — this is copyrighted chapter text, and everything in
  //    DB gets written into the file ⤓ Save my work hands the student.
  const _pageTextCache = new Map();          // `${readingId}:${page}` → string
  const CTX_PAGE_CHARS = 2500;               // one scanned page runs ~1,800
  async function pageText(rid, doc, n){
    if(n < 1 || n > doc.numPages) return '';
    const key = rid + ':' + n;
    if(_pageTextCache.has(key)) return _pageTextCache.get(key);
    let txt = '';
    try {
      const tc = await (await doc.getPage(n)).getTextContent();
      txt = tc.items.map(i => i.str).join(' ').replace(/\s+/g, ' ').trim().slice(0, CTX_PAGE_CHARS);
    } catch(e){ console.warn('pageText', e); }
    _pageTextCache.set(key, txt);
    return txt;
  }
  async function readingContext(page){
    const r = readings[activeReading];
    if(!r || r.type !== 'pdf') return '';
    if(_curPdf.id !== r.id || !_curPdf.doc) return '';
    const doc = _curPdf.doc;
    const n = Math.min(Math.max(page || readPageNum || 1, 1), doc.numPages);
    const [prev, cur, next] = await Promise.all([
      pageText(r.id, doc, n-1), pageText(r.id, doc, n), pageText(r.id, doc, n+1)
    ]);
    const seg = [
      prev && `[page ${n-1}] ${prev}`,
      cur  && `[page ${n}] ${cur}`,
      next && `[page ${n+1}] ${next}`
    ].filter(Boolean).join('\n\n');
    return seg ? `From "${readingLabel(r)}" — the pages the reader is on right now:\n\n${seg}` : '';
  }

  // ═══ HARNESS: things the prompt cannot be trusted to do ═══════════════════
  //
  // Measured on ToddGPT 2026-08-23 across 11 persona revisions: instructions about
  // LENGTH and about never ending on a question were ignored a large fraction of the
  // time, and no rewording fixed it. Instructions about VOICE and STANCE held well.
  // So: voice lives in the prompt below, and everything mechanical lives here in code.
  //
  // Questions the model must never answer, because it cannot know the answer.
  const INTERCEPTS = [
    { re: /\b(who|anyone|anybody)\b.{0,40}\b(see|read|look at|access)\b|\bis this (graded|private|confidential|saved|stored)\b|\bdo(es)? (you|this|it) (save|store|keep|record)\b|\bwill (dr\.? ?edwards|my (teacher|professor|instructor))\b/i,
      answer: () => ANSWER_WHO_SEES_THIS },
  ];

  const SENTENCES = t => String(t||'').trim().split(/(?<=[.!?])\s+/).filter(Boolean);
  // Reads as agreement to a student who skims the first few words. Seen twice in
  // three samples on the vulnerable case, so it is a guard, not a precaution.
  const SKIM_HAZARD = /^\s*(no,?\s*)?you('re| are)\s+not\s+a\s+writer/i;
  const MAX_SENTENCES = 3;
  function harnessCheck(text){
    const s = SENTENCES(text);
    if(!text || !s.length) return 'empty';
    if(SKIM_HAZARD.test(text)) return 'skim-hazard';
    if(s.length > MAX_SENTENCES) return 'too-long';
    return null;
  }

  // Romano — the reading partner. Voice and stance only; the mechanical rules are
  // enforced above. See linux-setup/docs/student-access/ for what each line is doing
  // and which measurement put it there.
  const READING_PARTNER = `You are a warm reading-and-writing partner for a college student reading a book about writing.

Who you are:

You are a teacher with thirty-four years in the profession. You are also a father, and you shepherded your own children through the public education system — so you have seen schooling from inside the classroom and from the kitchen table. That double view is where your patience comes from, and your lack of illusions.

What you have come to believe:

1. School is a tool of socialization and stratification.
2. School can be a place of learning, but schooling and learning are not the same thing. Do not confuse learning with education, or knowledge with educational attainment.
3. Curriculum has layers. There is what is in the textbook. There is also what gets taught and what gets skipped, and how it gets taught — and those shape how a student comes to understand both the subject and learning itself.

Because of 3, you never explain this student's difficulty with one stock cause. You know the specific things school does to writers, and you reach for whichever one actually fits what they just said. Among them:

- They were shown finished, polished writing as the model, and never shown anyone's ugly first draft. So they think everyone else's first line arrives clean.
- Revision was demanded but rarely modeled. They were told to revise, not shown how anyone does it.
- The timed essay taught that writing happens under surveillance, against a clock, for a judge.
- Errors were marked in red before ideas were ever responded to. Correctness arrived before meaning.
- Nobody said out loud that bad writing is a normal, necessary stage. Its absence taught them it is a personal failing.
- Writing was almost always assigned, almost never chosen. So wanting to say something is unfamiliar.

Pick the one that fits. Never recite the whole theory, and never give the same explanation twice in a conversation.

How these beliefs show up: they shape how you treat the student. They are never the topic. They are why you refuse to grade, rank, or evaluate anything they say, and why you take their side automatically. Do not explain the education system to them — they came to talk about writing.

How you answer:

Answer the question they asked, first and plainly. Do not answer a question with a question. Put the cause of any difficulty in their history, never in their character. Never compare the student to a child. Never narrate what their brain or "inner critic" is really doing — you are not the authority on their mind. Never praise or rate what they said; "good question" is a grade wearing a friendly face. Disagree plainly when it is about writing, and aim the edge at the idea, never at the person.

Plain words. Short sentences, two or three of them. No elaborate metaphors.

Here is how you sound:

Reader: Maybe I'm just not a writer. Should I stop trying?
You: You are a writer. And you're writing! But it can be intimidating, especially after experiencing writing for many years as a test for a grade.

Reader: My friend says freewriting is just procrastinating with extra steps. Is that reasoning valid?
You: No. Procrastination is avoiding the work; freewriting is the work, done in the only order that lets it get done at all.

Reader: Really?
You: Really. The first line only has to exist, not be good.`;
  async function romanoReply(passage, question, history, context){
    const q = question || 'Help me think about this passage.';
    const parts = [READING_PARTNER];
    if(context) parts.push(`${context}\n\nUse this to stay on what the book actually says — quote it only if it helps, and never summarize it back at them.`);
    // Without the thread every ask arrives cold, so a follow-up like "Really?"
    // or "I need background noise" reads as a non-sequitur and the reply drifts.
    const thread = (history || []).map(r =>
      `Reader: ${r.question || 'Help me think about this passage.'}\nYou: ${r.reply}`).join('\n\n');
    if(thread) parts.push(`Here is what the two of you have already said, oldest first:\n\n${thread}\n\nStay in that thread. A short follow-up refers to what YOU just said — take it as a reply to you, and do not contradict what the reader has told you about themselves.`);
    if(passage) parts.push(`The passage under discussion, from your book:\n"${passage}"`);
    parts.push(`They now say: ${q}\n\nReply in two or three short sentences. Answer what they asked. Do not end with a question.`);
    const prompt = parts.join('\n\n');

    // 1. Intercept: questions the model cannot know the answer to never reach it.
    for(const it of INTERCEPTS){ if(it.re.test(q)) return it.answer(); }

    // 2. Ask, then check. One retry -- the failures are stochastic, not systematic,
    //    so asking again usually clears them. Retrying is a SHORTENING, never a
    //    truncation: we would rather have a whole short reply than a severed one.
    let reply = await callModel(prompt);
    let why = harnessCheck(reply);
    if(why){
      const nudge = why === 'too-long'
        ? '\n\nYour last attempt ran long. Say the same thing in two short sentences.'
        : '\n\nDo not begin with any phrasing that could read as agreeing they are not a writer.';
      const second = await callModel(prompt + nudge);
      if(!harnessCheck(second)) reply = second;
      else if(why === 'too-long') reply = SENTENCES(second || reply).slice(0, MAX_SENTENCES).join(' ');
      else reply = second || reply;
    }

    // 3. A trailing question is the one thing we can safely fix without re-asking:
    //    dropping a whole sentence never leaves a fragment.
    const s = SENTENCES(reply);
    if(s.length > 1 && /\?\s*$/.test(reply)) reply = s.slice(0, -1).join(' ');

    // 4. Distress: name a human, alongside the reply rather than instead of it.
    const note = distressNote(q);
    if(note) reply = `${reply}\n\n${note}`;
    return reply;
  }
  // ══ The Romano window ═════════════════════════════════════════════════════
  // 318P's Todd-in-a-Can shape on this app's engine. The exchanges stay in
  // DB.qa[readingId] and Romano still gets the surrounding page text, which is the
  // thing 318P has no equivalent of and the reason its model was not copied whole.
  let _rmPassage = '';   // the passage this window was opened ON, until it is used
  let _rmPage = 0;
  let _rmEditing = null; // { id, field } while a line is being edited

  function openRomanoChat(passage, page){
    if(aiOff()){ toast('Connect a model under \u2699 to ask ' + AI_NAME + '.'); syncAiSurfaces(); return; }
    _rmPassage = passage || '';
    _rmPage = page || readPageNum;
    _rmEditing = null;
    const ab = document.getElementById('rmAbout');
    if(ab){
      ab.style.display = _rmPassage ? '' : 'none';
      ab.innerHTML = _rmPassage ? '<b>About this passage</b>' + escHtml(_rmPassage) : '';
    }
    document.getElementById('romanoOverlay').classList.add('open');
    renderRomanoLog();
    // NOT focused on a touch screen. A programmatic focus() on iOS opens no keyboard
    // while still taking focus, so the tap that WOULD have raised one does nothing --
    // a box with a caret in it that cannot be typed into. (Learned in 318P, build 38.)
    if(!COARSE_POINTER) setTimeout(() => { const i = document.getElementById('rmInput'); if(i) i.focus(); }, 60);
  }
  function closeRomanoChat(){
    document.getElementById('romanoOverlay').classList.remove('open');
    _rmEditing = null;
  }
  window.closeRomanoChat = closeRomanoChat;

  // ⚠ EVERY door onto Romano is closed from HERE (Todd, 2026-08-30): "when the AI is
  // not enacted, I can still ask Romano questions in chat." Each surface used to decide
  // for itself, and the two in the reader never asked at all -- the 🥫 button in the
  // view bar and Ask in the capture popup were painted whatever the provider was, so a
  // reader with no model could open the window, type, and send.
  //
  // Settings is an OVERLAY, not a tab, so turning AI off can happen with the reader
  // still rendered behind it and nothing repainting afterwards. updateAIBtn is the one
  // funnel every provider change goes through, so it calls this; renderRead and the
  // capture popup call it too, for the surfaces they have just built.
  function aiOff(){ return getProvider() === 'none'; }
  function syncAiSurfaces(){
    const off = aiOff();
    const rb = document.getElementById('romanoBtn');
    if(rb) rb.style.display = off ? 'none' : '';
    const cap = document.getElementById('captureAskBtn');
    if(cap) cap.style.display = off ? 'none' : '';
    // Switched off while the window was open: don't leave a live composer behind.
    const o = document.getElementById('romanoOverlay');
    if(off && o && o.classList.contains('open')) closeRomanoChat();
  }
  window.syncAiSurfaces = syncAiSurfaces;

  function renderRomanoLog(){
    const log = document.getElementById('rmLog');
    if(!log) return;
    const rows = getQA(currentReadingId());
    if(!rows.length){
      log.innerHTML = '<p class="rm-empty">Nothing asked yet about this chapter.</p>';
      return;
    }
    let prev = null;
    log.innerHTML = rows.map(r => {
      const ctx = (r.passage && r.passage !== prev)
        ? `<div class="rm-ctx">from your highlight: “${escHtml(r.passage.length>140 ? r.passage.slice(0,140)+'…' : r.passage)}”</div>` : '';
      prev = r.passage || prev;
      const asked = r.question || (r.passage ? 'Help me think about this passage.' : '');
      const you = asked ? `<div class="rm-turn you"><span class="rm-who">You</span>`
        + (_rmEditing && _rmEditing.id === r.id && _rmEditing.field === 'question'
            ? `<textarea class="rm-edit" data-edit="${r.id}" data-field="question">${escHtml(asked)}</textarea>`
            : `<div class="rm-say">${escHtml(asked)}</div>`)
        + `<div class="rm-tools"><button class="rm-tool" data-ed="${r.id}" data-f="question" title="Edit this line">✎</button>`
        + `<button class="rm-tool" data-del="${r.id}" title="Delete this exchange">🗑</button></div></div>` : '';
      let say;
      if(r.reply) say = _rmEditing && _rmEditing.id === r.id && _rmEditing.field === 'reply'
        ? `<textarea class="rm-edit" data-edit="${r.id}" data-field="reply">${escHtml(r.reply)}</textarea>`
        : `<div class="rm-say">${escHtml(r.reply)}</div>`;
      else if(_qaPending.has(r.id)) say = '<div class="rm-say rm-wait">thinking…</div>';
      else say = `<div class="rm-say rm-wait">${escHtml(r.error || 'Romano didn’t finish this one — ask again.')}</div>`;
      const tools = r.reply ? `<div class="rm-tools"><button class="rm-tool" data-ed="${r.id}" data-f="reply" title="Edit this line">✎</button></div>` : '';
      return `<div class="rm-ex" data-ex="${r.id}">${ctx}${you}<div class="rm-turn romano"><span class="rm-who">Romano</span>${say}${tools}</div></div>`;
    }).join('');
    log.querySelectorAll('.rm-tool[data-ed]').forEach(b => b.onclick = () => {
      _rmEditing = { id: b.dataset.ed, field: b.dataset.f }; renderRomanoLog();
      const t = log.querySelector('.rm-edit'); if(t){ t.focus(); t.setSelectionRange(t.value.length, t.value.length); }
    });
    log.querySelectorAll('.rm-tool[data-del]').forEach(b => b.onclick = () => {
      const rid = currentReadingId(), kept = getQA(rid).slice();
      removeQA(b.dataset.del); renderConversation();
      undoably('Exchange removed', () => { persistQA(rid, kept); renderConversation(); });
    });
    // Committed on blur as well as on Enter: a reader who edits a line and then taps
    // Send would otherwise lose the edit to the re-render.
    log.querySelectorAll('.rm-edit').forEach(t => {
      const commit = () => {
        const id = t.dataset.edit, field = t.dataset.field, v = t.value.trim();
        _rmEditing = null;
        updateQA(currentReadingId(), id, { [field]: v });
        renderConversation();
      };
      t.onblur = commit;
      t.onkeydown = e => {
        if(e.key === 'Escape'){ e.preventDefault(); _rmEditing = null; t.onblur = null; renderRomanoLog(); }
        if(e.key === 'Enter' && (e.metaKey || e.ctrlKey)){ e.preventDefault(); t.blur(); }
        e.stopPropagation();
      };
    });
    log.scrollTop = log.scrollHeight;   // the newest turn is what you came to read
  }

  function sendRomano(){
    const inp = document.getElementById('rmInput');
    if(!inp) return;
    const q = inp.value.trim();
    if(!q) return;
    inp.value = '';
    const passage = _rmPassage; _rmPassage = '';   // filed on this turn only
    const ab = document.getElementById('rmAbout'); if(ab) ab.style.display = 'none';
    askRomanoInto(passage, q, _rmPage);
  }
  // Romano's opening move when a passage was marked and nothing was typed: he speaks
  // first, the way he does in 318P, rather than leaving a blank window.
  function romanoOpenOnPassage(){
    const passage = _rmPassage; _rmPassage = '';
    const ab = document.getElementById('rmAbout'); if(ab) ab.style.display = 'none';
    askRomanoInto(passage, '', _rmPage);
  }

  // ── Romano Q&A, stored per reading in DB.qa[readingId] (same shape as the
  //    highlights above) so the conversation survives renderRead — switching
  //    reading, toggling Single↔Continuous, or leaving and returning to the tab.
  //    It used to append straight into #newnote, which any re-render wiped.
  //    A reply still in flight when the page goes away cannot be resumed, so
  //    _qaPending tracks the live ones; an empty reply that ISN'T pending reads
  //    as interrupted rather than "thinking…" forever.
  const _qaPending = new Set();
  function allQA(){ if(!DB.qa) DB.qa = {}; return DB.qa; }
  function getQA(rid){ return (rid && allQA()[rid]) || []; }
  function persistQA(rid, list){ allQA()[rid] = list; saveDB(); }
  function addQA(rid, rec){ if(!rid) return null; persistQA(rid, getQA(rid).concat([rec])); return rec; }
  function updateQA(rid, id, patch){
    if(!rid) return;
    persistQA(rid, getQA(rid).map(r => r.id === id ? Object.assign({}, r, patch) : r));
  }
  function removeQA(id){
    const rid = currentReadingId(); if(!rid) return;
    persistQA(rid, getQA(rid).filter(r => r.id !== id));
    renderQAList();
  }
  // The notes-pane list and the Romano window are two views of ONE conversation.
  // Everything that changes it calls this, so they can never drift apart -- which is
  // the bug you get for free if each surface repaints itself.
  function renderConversation(){ renderQAList(); renderRomanoLog(); }

  function renderQAList(){
    const box = document.getElementById('newnote'); if(!box) return;
    // Read it as a conversation: the passage is quiet CONTEXT at the top, then
    // your turn, then his. Speakers are labelled and tinted so his reply can't be
    // mistaken for more of the quoted passage.
    let prevPassage = null;
    box.innerHTML = getQA(currentReadingId()).map(r => {
      // The passage is context, not the point — keep it to a thin line, and when
      // consecutive questions share one passage don't reprint the whole thing.
      let ctx = '';
      if(r.passage && r.passage === prevPassage){
        ctx = `<div class="qa-ctx same">↑ same passage</div>`;
      } else if(r.passage){
        ctx = `<div class="qa-ctx"><span class="qa-ctx-lbl">from your highlight</span><span class="qa-quote" title="Click to show the whole passage">${escHtml(r.passage)}</span></div>`;
      }
      prevPassage = r.passage || null;
      // With no typed question we send "Help me think about this passage" — show
      // that, muted, rather than a blank turn that hides what was actually asked.
      const asked = r.question || (r.passage ? 'Help me think about this passage.' : '');
      const you = asked
        ? `<div class="qa-turn you"><span class="qa-who">You</span><div class="qa-say${r.question?'':' implied'}">${escHtml(asked)}</div></div>`
        : '';
      let say;
      if(r.reply) say = escHtml(r.reply);
      else if(_qaPending.has(r.id)) say = '<em class="qa-wait">thinking…</em>';
      else say = `<em class="qa-wait">${escHtml(r.error || 'Romano didn’t finish this one — ask again.')}</em>`;
      const him = `<div class="qa-turn romano"><span class="qa-who">Romano</span><div class="qa-say rmreply">${say}</div></div>`;
      const keep = r.reply ? `<button class="hl-keep" data-qakeep="${r.id}" title="Keep this exchange in your notebook, quoted and attributed. Select part of the reply first to keep only that.">✎ Keep in notebook</button>` : '';
      return `<div class="notecard qa" data-qa="${r.id}">${ctx}${you}${him}<div class="hl-row">${keep}<button class="hl-del" data-qa="${r.id}">Remove</button></div></div>`;
    }).join('');
    box.querySelectorAll('.qa-quote').forEach(q => q.onclick = () => q.closest('.notecard').classList.toggle('open'));
    box.querySelectorAll('.hl-del[data-qa]').forEach(b => b.onclick = () => {
      const rid = currentReadingId(), kept = getQA(rid).slice();
      removeQA(b.dataset.qa);
      undoably('Exchange removed', () => { persistQA(rid, kept); renderConversation(); });
    });
    box.querySelectorAll('.hl-keep[data-qakeep]').forEach(b => b.onclick = () => {
      const rec = getQA(currentReadingId()).find(x => x.id === b.dataset.qakeep);
      if(rec) elevateQA(rec, selectedWithin(b.closest('.notecard')));
    });
    // Selecting inside a reply RELABELS the existing button rather than raising a
    // second one. Two controls that do the same thing read as two different features
    // -- Todd's note, 2026-08-23. One control, and it says what it will keep.
    if(!box._qaSelWired){
      box._qaSelWired = true;
      const relabel = () => {
        const card = qaCardOfSelection();
        box.querySelectorAll('.hl-keep[data-qakeep]').forEach(b => {
          const mine = card && card.dataset.qa === b.dataset.qakeep;
          b.textContent = mine ? '\u270e Keep the selected part' : '\u270e Keep in notebook';
          b.classList.toggle('armed', !!mine);
        });
      };
      box.addEventListener('mouseup', () => setTimeout(relabel, 0));
      box.addEventListener('keyup',   () => setTimeout(relabel, 0));
    }
  }
  // ⚠ The retired-and-unreferenced note that stood here was STALE and wrong: this is
  // live, and both doors call it -- sendRomano from the ask bar, romanoOpenOnPassage
  // from a marked passage. Do not delete it on the strength of an old comment.
  async function askRomanoInto(passage, question, page){
    const rid = currentReadingId(); if(!rid) return;
    if(aiOff()){
      // No-AI is a supported path — don't bank a question nothing will answer.
      // ⚠ This used to append a notice straight into #newnote (Todd, 2026-08-30:
      // "it adds error messages that can't be deleted from mynotes"). That div is
      // the QA LIST's canvas: the notice was not a record, so it carried no Remove,
      // renderQAList never knew about it, and every blocked ask stacked another
      // undeletable card in the notes pane. Transient news belongs in a toast.
      toast('Connect a model under \u2699 to ask ' + AI_NAME + '. Your reading and notes work without it.');
      syncAiSurfaces();
      return;
    }
    const rec = addQA(rid, {
      id: 'q' + Date.now() + '-' + Math.round(Math.random()*1e6),
      passage: passage || '', question: question || '', reply: '', error: '', ts: Date.now()
    });
    if(!rec) return;
    _qaPending.add(rec.id);
    renderConversation();
    // Answered turns only, oldest first, capped so the prompt can't grow forever.
    const history = getQA(rid).filter(r => r.reply && r.id !== rec.id).slice(-6);
    // A bare follow-up from the ask bar carries no passage; keep the one the
    // conversation is already about as CONTEXT, without filing it on the record.
    const ctx = passage || (history.length ? history[history.length-1].passage : '') || '';
    const reading = await readingContext(page);
    try { updateQA(rid, rec.id, { reply: await romanoReply(ctx, question, history, reading) });
           logEvent('ai', 'reply received', { provider: getProvider(), grounded: !!reading }); }
    catch(e){ updateQA(rid, rec.id, { error: 'Romano is unavailable right now.' });
              logEvent('error', 'AI call failed', String(e && e.message || e)); }
    _qaPending.delete(rec.id);
    // The reader may have switched readings while this was in flight; the answer
    // is saved either way, but only repaint if it belongs to what's on screen.
    if(currentReadingId() === rid) renderConversation();
  }

  // ── Persistent highlights. Stored per reading in DB.highlights[readingId] as
  // page-normalized rects (0..1 of the page box), so they survive zoom / page nav /
  // single↔continuous by re-mapping to the current page size on every render.
  function currentReadingId(){ const r = readings[activeReading]; return r ? r.id : null; }
  function allHighlights(){ if(!DB.highlights) DB.highlights = {}; return DB.highlights; }
  function getHighlights(rid){ return (rid && allHighlights()[rid]) || []; }
  function persistHighlights(rid, list){ allHighlights()[rid] = list; saveDB(); }
  function addHighlight(rec){
    const rid = currentReadingId(); if(!rid) return null;
    persistHighlights(rid, getHighlights(rid).concat([rec])); return rec;
  }
  // ⚠ THE LIKELIEST ACCIDENT IN THE APP. Remove sits on every card, beside four
  // harmless buttons, and until now it asked nothing and offered nothing back: one
  // stray click and a marked passage, its dated notes and its band were gone for good.
  // Clear-all had a confirm and this did not, which is exactly backwards — the button
  // you press often is the one that needs the way back.
  function removeHighlight(id){
    const rid = currentReadingId(); if(!rid) return;
    const kept = getHighlights(rid).slice();
    const gone = kept.find(h => h.id === id);
    persistHighlights(rid, kept.filter(h => h.id !== id));
    document.querySelectorAll(`.hl-mark[data-hl="${id}"]`).forEach(el => el.remove());
    renderHighlightList();
    if(gone) undoably('Highlight removed', () => {
      persistHighlights(rid, kept); renderHighlightList(); repaintHighlights();
    });
  }
  // Map a list of DOM client rects to {page,x,y,w,h} fractions of the page they sit on.
  function normalizeRectsToPages(clientRects){
    const pages = [...document.querySelectorAll('#docPane .pdf-page')];
    const out = [];
    clientRects.forEach(r => {
      const cx = r.left + r.width/2, cy = r.top + r.height/2;
      for(const pg of pages){
        const p = pg.getBoundingClientRect();
        if(cx>=p.left && cx<=p.right && cy>=p.top && cy<=p.bottom){
          // Clamp to the sheet HERE, not only when painting. A band must never run
          // past the page it belongs to, and storing an out-of-range fraction meant
          // every future render had to re-fix it — and any export carried it out.
          const x0 = Math.max(0, Math.min(1, (r.left - p.left) / p.width));
          const y0 = Math.max(0, Math.min(1, (r.top  - p.top ) / p.height));
          const x1 = Math.max(0, Math.min(1, (r.right  - p.left) / p.width));
          const y1 = Math.max(0, Math.min(1, (r.bottom - p.top ) / p.height));
          if(x1 > x0 && y1 > y0) out.push({ page:+(pg.dataset.page||1), x:x0, y:y0, w:x1-x0, h:y1-y0 });
          break;
        }
      }
    });
    return out;
  }
  function paintHighlightsForPage(pageDiv, pageNum, rid){
    let layer = pageDiv.querySelector('.hl-layer');
    if(!layer){ layer = document.createElement('div'); layer.className = 'hl-layer'; pageDiv.appendChild(layer); }
    layer.innerHTML = '';
    getHighlights(rid).forEach(h => {
      (h.rects||[]).filter(rc => (rc.page||1) === pageNum).forEach(rc => {
        // Clamp to the sheet. Rects are stored as fractions of the page box, and a
        // selection that runs to the edge can round to x+w slightly over 1 — which
        // painted a band out across the surround, past the paper it belongs to.
        const x = Math.max(0, Math.min(1, rc.x)), y = Math.max(0, Math.min(1, rc.y));
        const w = Math.max(0, Math.min(1 - x, rc.w)), hh = Math.max(0, Math.min(1 - y, rc.h));
        const m = document.createElement('div'); m.className = 'hl-mark'; m.dataset.hl = h.id;
        m.style.left = (x*100)+'%'; m.style.top = (y*100)+'%';
        m.style.width = (w*100)+'%'; m.style.height = (hh*100)+'%';
        layer.appendChild(m);
      });
    });
  }
  function repaintHighlights(){
    const rid = currentReadingId();
    document.querySelectorAll('#docPane .pdf-page').forEach(pg => paintHighlightsForPage(pg, +(pg.dataset.page||1), rid));
  }
  function flashMark(id){
    document.querySelectorAll(`.hl-mark[data-hl="${id}"]`).forEach(el => { el.classList.add('flash'); setTimeout(()=>el.classList.remove('flash'), 1200); });
  }
  // Which band is under that point. Smallest wins: bands overlap exactly where a reader
  // marked a phrase inside a passage they had already marked, and the small one is what
  // they were aiming at. 'live' and 'preview' bands are in-progress, not kept notes.
  function markAt(x, y){
    let best = null, bestArea = Infinity;
    document.querySelectorAll('.hl-mark[data-hl]').forEach(el => {
      if(el.classList.contains('live') || el.classList.contains('preview')) return;
      const b = el.getBoundingClientRect();
      if(x < b.left || x > b.right || y < b.top || y > b.bottom) return;
      const a = b.width * b.height;
      if(a < bestArea){ bestArea = a; best = el; }
    });
    if(best) revealHighlight(best.dataset.hl);
  }
  // Click a highlight, find its note -- the reverse of scrollToHighlight, and the same
  // rule in the other direction: move the view only as much as it has to. The margin is
  // a scrolling list here, so a card below the fold comes up first, then flashes.
  function revealHighlight(id){
    // ⚠ Todd, 2026-08-30: "when I click on a quote in the reading, it doesn't trace back
    // to the quote in the notes." Two reasons, and both of them look like nothing
    // happening. The margin may be SHUT -- the cards are still in the DOM when it is, so
    // this found one, scrolled it and flashed it where nobody could see any of that. And
    // the scroller is .notes-scroll: measuring #hlList compared the card against a plain
    // div that GROWS WITH ITS CONTENT, so a card far below the fold still tested as
    // already in view and the list never moved. (#hlList stopped being the scrolling box
    // when the ask bar was pinned; this was the one caller left reading it as one.)
    if(!notesOpen) setNotesOpen(true);
    const card = document.querySelector(`.hl-card[data-hl="${id}"]`);
    if(!card){ return; }
    // Anchored: the card is already beside the band you just clicked, and the margin
    // has no scroll of its own to move. Flashing is the whole of the answer there.
    const pane = marginAnchored() ? null : card.closest('.notes-scroll');
    if(pane){
      const cr = card.getBoundingClientRect(), pr = pane.getBoundingClientRect();
      if(cr.bottom < pr.top + 2 || cr.top > pr.bottom - 2) card.scrollIntoView({ behavior:'smooth', block:'center' });
    }
    card.classList.add('flash');
    setTimeout(() => card.classList.remove('flash'), 1400);
  }

  function scrollToHighlight(id){
    const el = document.querySelector(`.hl-mark[data-hl="${id}"]`);
    if(el){ el.scrollIntoView({ behavior:'smooth', block:'center' }); flashMark(id); return; }
    const rec = getHighlights(currentReadingId()).find(h => h.id === id);
    if(!rec) return;
    const pg = (rec.rects && rec.rects[0] && rec.rects[0].page) || rec.page || 1;
    const vis0 = visiblePages();
    if(vis0 && !vis0.includes(pg)){
      readPageNum = pg;
      renderActiveDoc(readings[activeReading]);
      renderHighlightList();   // the margin is filtered to the page, so it moves too
      setTimeout(()=>{ const e2 = document.querySelector(`.hl-mark[data-hl="${id}"]`); if(e2){ e2.scrollIntoView({ behavior:'smooth', block:'center' }); flashMark(id); } }, 450);
    }
  }
  // Legacy marks carry a single .note string. Read as one pass dated by the mark
  // itself, so nothing needs migrating and 34 existing notes keep their day.
  function notePasses(h){
    if(Array.isArray(h.passes) && h.passes.length) return h.passes;
    const t = (h.note || '').trim();
    return t ? [{ text: t, ts: h.ts || Date.now() }] : [];
  }
  // .note stays in sync with the joined passes: elevateHighlight, the reflect dialog
  // and the export all read it, and none of them should have to know about passes.
  function writePasses(h, passes){
    h.passes = passes;
    h.note = passes.map(p => p.text).join('\n\n');
  }
  function updateHighlight(id, mutate){
    const rid = currentReadingId(); if(!rid) return;
    const list = getHighlights(rid).slice();
    const i = list.findIndex(h => h.id === id); if(i < 0) return;
    const h = Object.assign({}, list[i]);
    mutate(h);
    h.edited = Date.now();
    list[i] = h;
    persistHighlights(rid, list);
    renderHighlightList();
  }
  function passStamp(ts){
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { month:'short', day:'numeric' })
      + ' · ' + d.toLocaleTimeString(undefined, { hour:'numeric', minute:'2-digit' });
  }
  function applyNotesPane(){
    const r = document.querySelector('.reader');
    if(r) r.classList.toggle('notes-hidden', !notesOpen);
  }
  // The margin has TWO doors now — ◧ in the view bar, and ◨ Show notes in the top bar
  // for the reader who has already shut the pane and no longer has that first button
  // in front of them. One setter and one labeller, so the pair can never disagree
  // about which way the pane is pointing.
  function syncNotesToggles(){
    const all = getHighlights(currentReadingId());
    // Work captured while the pane is closed still announces itself, on whichever
    // door is showing, instead of vanishing into a panel nobody can see.
    const badge = (!notesOpen && all.length) ? ' \u00b7 ' + all.length : '';
    // ⚠ ONE DOOR AT A TIME, AND ALWAYS ONE (Todd, 2026-08-30, twice). First: "I don't
    // think these should both appear at the same time" — both bars were offering Show
    // notes at once. Then: "there is no easy way to hide notes in continuous mode once
    // you're down 3-4 pages", and the reason is structural — .topbar is position:sticky
    // and the view bar is not, so a few pages in, the control that says Hide has
    // scrolled away while the top bar is still there.
    //
    // Pinning the view bar too was built and measured: two stacked bars cost 91px of
    // every screen, and "that's too much bar. We don't have that much vertical space."
    //
    // So the view bar keeps the control — it is the reader's own bar — and the top bar
    // carries a STAND-IN that appears only when the view bar is not on screen to be
    // used. Never two, never none. Focus hides the top bar outright, but there the
    // reader fills the viewport and the page scrolls INSIDE it, so the view bar never
    // leaves and no stand-in is needed.
    const focus = body.classList.contains('focus');
    const nt = document.getElementById('notesToggle');
    if(nt) nt.innerHTML = (notesOpen ? '\u25e7<span class="vb-word"> Hide notes</span>'
                                     : '\u25e8<span class="vb-word"> Show notes</span>')
                        + '<span class="hl-count" id="hlCount">' + badge + '</span>';
    // The title carries the whole meaning wherever this button is lodged in the top bar,
    // where the word is hidden and the glyph is all there is to go on.
    if(nt) nt.title = notesOpen
      ? 'Hide the notes pane and give the page the whole width. Highlighting keeps working.'
      : 'Show your highlights and notes beside the page';
    relocateReaderTools(focus);
  }
  // Move the view bar's own controls into the top bar while the view bar is out of
  // reach, and move them home when it comes back. MOVED, not copied: appendChild
  // relocates the live node, so every handler, the View popover and the highlight badge
  // travel with it and there is never a second copy to keep in step. Chapters and the
  // page count stay behind — Todd: "skip putting Chapters or pages / scroll to read in
  // the top bar", they are for arriving at a reading, not for working inside one.
  function relocateReaderTools(focus){
    const host = document.getElementById('topTools');
    const vbar = document.querySelector('.reader .viewbar');
    if(!host) return;
    const nt = document.getElementById('notesToggle');
    const vw = document.getElementById('viewWrap');
    // Focus hides the top bar outright, and there the reader fills the viewport and the
    // page scrolls INSIDE it, so the view bar never leaves and nothing has to move.
    // ⚠ Off the Readings tab the lodgers are DEAD NODES: they were moved out of #frame,
    // so renderTip and friends wiping frame.innerHTML cannot take them with it, and they
    // would sit in the top bar on Tips offering to hide a notes pane that is not there.
    if(tab !== 'read'){ host.innerHTML = ''; return; }
    const away = !focus && !!vbar && !viewbarInReach();
    if(away){
      [vw, nt].forEach(el => { if(el && el.parentElement !== host) host.appendChild(el); });
    } else if(vbar){
      // Home again, in the order the bar was written: … View, Mark passage, 🥫, notes.
      if(vw && vw.parentElement === host){
        const before = document.getElementById('vbCapture') || document.getElementById('romanoBtn') || nt;
        if(before && before.parentElement === vbar) vbar.insertBefore(vw, before); else vbar.appendChild(vw);
      }
      if(nt && nt.parentElement === host) vbar.appendChild(nt);   // always last
    }
  }
  // Is the view bar's own copy actually usable? Not "is it in the DOM" — scrolled UNDER
  // the sticky top bar it is still laid out, still reports a sane rectangle, and is
  // completely invisible behind an opaque bar with a higher z-index. So the floor is the
  // top bar's bottom edge, not zero.
  function viewbarInReach(){
    const vb = document.querySelector('.reader .viewbar');
    if(!vb) return false;
    const r = vb.getBoundingClientRect();
    if(!r.height) return false;
    const bar = document.querySelector('.topbar');
    const floor = (bar && bar.offsetParent !== null) ? bar.getBoundingClientRect().bottom : 0;
    return r.bottom > floor + 4 && r.top < window.innerHeight - 4;
  }
  // Scroll fires far faster than the answer changes, so relabel only on the crossing.
  let _vbReach = null;
  function syncDoorsOnScroll(){
    const v = viewbarInReach();
    if(v === _vbReach) return;
    _vbReach = v;
    syncNotesToggles();
  }
  function setNotesOpen(open){
    notesOpen = !!open; DB.notesOpen = notesOpen; saveDB();
    applyNotesPane(); syncNotesToggles(); renderHighlightList();
  }
  function renderHighlightList(){
    const el = document.getElementById('hlList'); if(!el) return;
    const all = getHighlights(currentReadingId());
    const single = readPageMode === 'single';
    const vis = visiblePages();
    const list = vis ? all.filter(h => vis.includes(h.page || 1)) : all;
    syncNotesToggles();   // owns the badge on both doors — see above
    // Where the rest of them are, said as a fact rather than discovered by panic.
    // ⚠ The scope line and Clear-all live in the margin's HEAD and FOOT, not in the
    // list: anchored mode turns the list into an absolutely-placed surface, and a
    // sentence in normal flow inside it would be sat on by the first card. They are
    // better off pinned in the plain list too — a scope you can still read after
    // scrolling, and a Clear-all that is not at the bottom of a dozen cards.
    const head = document.getElementById('hlHead');
    if(head) head.innerHTML = !all.length ? '' : (single
      ? `<p class="hl-scope">${list.length} on ${vis && vis.length > 1 ? 'these pages' : 'this page'} · <strong>${all.length}</strong> in this chapter.
         Switch to <strong>Continuous</strong> to see them all.</p>`
      : `<p class="hl-scope"><strong>${all.length}</strong> in this chapter, all pages.</p>`);
    if(!list.length){
      const f0 = document.getElementById('hlFoot'); if(f0) f0.innerHTML = '';
      el.innerHTML = (all.length
        ? `<p class="hl-empty">Nothing marked on ${vis && vis.length > 1 ? 'these pages' : 'this page'} yet. Drag a box around a passage, then choose ✎ Highlight.</p>`
        : '<p class="hl-empty">Nothing marked yet. '
          + (COARSE_POINTER ? 'Tap 💬 Mark passage, then drag a box around a passage'
                            : 'Drag a box around a passage')
          + ', then choose ✎ Highlight.</p>');
      layoutMarginNotes();
      return;
    }
    el.innerHTML = list.map(h => {
      // Keep the WHOLE passage in the DOM — selectable, copyable, and ready for the
      // hand-off into the Notebook. .hl-quote clamps it visually; clicking opens it.
      const quote = escHtml(h.text || '(figure)');
      // ⚠ LEGACY ONLY. Nothing has stored an image since 2026-08-30 — see NO PICTURE IS
      // KEPT at the capture site — and a figure boxed today is recorded by its band and
      // its dated notes instead. This line stays so that a highlight kept BEFORE that
      // change does not quietly lose the only record it has: those were saved with no
      // rects, so the thumbnail is all they carry. Delete it once no live DB has one.
      const thumb = (!h.text && h.image) ? `<img src="${h.image}" alt="figure" class="hl-thumb">` : '';
      const passes = notePasses(h);
      const notes = passes.map((pz, i) => `<div class="hl-note" data-pass="${i}" data-hl="${h.id}"
          title="Click to edit">${escHtml(pz.text)}<span class="hl-stamp">${escHtml(passStamp(pz.ts))}</span></div>`).join('');
      return `<div class="hl-card" data-hl="${h.id}">`
        + `<div class="hl-quote" data-hl="${h.id}" title="Click to go to it on the page. Use ✎ Trim to fix a box that grabbed too much.">${quote}</div>`
        + thumb + notes
        + `<div class="hl-row">`
        + `<button class="hl-goto" data-hl="${h.id}" data-pg="${escHtml(String(h.pageLabel || h.page || '?'))}" title="Go to this passage on page ${escHtml(String(h.pageLabel || h.page || '?'))} and flash it">${escHtml(String(h.pageLabel || h.page || '?'))}</button>`
        + `<button class="hl-add" data-hl="${h.id}" title="Add a dated line to this note. The old one stays — what you thought later beside what you thought first is the evidence your thread reading needs.">＋ Add</button>`
        + `<button class="hl-trim" data-hl="${h.id}" title="Edit the quoted passage — for when the box grabbed a line more than you meant. The mark on the page does not move.">✎ Trim</button>`
        + `<button class="hl-nb" data-hl="${h.id}" title="Keep this passage in your Writer's Notebook as a dated entry of its own, with its citation. The highlight stays here too.">Keep</button>`
        + `<button class="hl-del" data-hl="${h.id}" title="Remove this highlight and its notes. The band comes off the page with it.">Remove</button>`
        + `</div></div>`;
    }).join('');
    // Click the quote to expand/collapse — "Go to" already covers navigation.
    el.querySelectorAll('.hl-quote').forEach(q => q.onclick = e => {
      if(q.querySelector('textarea') || e.target.closest('.hl-mini')) return;  // being trimmed
      const card = q.closest('.hl-card');
      const clamped = q.scrollHeight > q.clientHeight + 2;
      if(clamped || card.classList.contains('open')){ card.classList.toggle('open'); layoutMarginNotes(); }
      else scrollToHighlight(card.dataset.hl);
    });
    el.querySelectorAll('.hl-goto').forEach(b => b.onclick = () => scrollToHighlight(b.dataset.hl));

    // One editor for every editable thing on a card. Escape abandons, blur keeps --
    // the notebook's own rule, because an unsaved textarea is a good intention.
    function editInPlace(host, value, onSave, opts){
      opts = opts || {};
      if(host.querySelector('textarea')) return;
      const prev = host.innerHTML;
      host.innerHTML = `<textarea class="hl-edit">${escHtml(value)}</textarea>`
        + `<div class="hl-editrow"><button class="hl-mini save">Save</button>`
        + `<button class="hl-mini">Cancel</button>`
        + (opts.canDelete ? `<button class="hl-mini danger">Delete this line</button>` : '')
        + `</div>`;
      const ta = host.querySelector('textarea');
      ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
      const btns = host.querySelectorAll('.hl-mini');
      layoutMarginNotes();   // a textarea is taller than the line it replaced
      let done = false;
      // In anchored mode a card's height IS its neighbours' positions, so every exit
      // from the editor — save, cancel, delete — has to settle the stack again.
      const finish = fn => { if(done) return; done = true; fn(); layoutMarginNotes(); };
      btns[0].onclick = () => finish(() => onSave(ta.value.trim()));
      btns[1].onclick = () => finish(() => { host.innerHTML = prev; });
      if(opts.canDelete) btns[2].onclick = () => finish(() => onSave(''));
      ta.addEventListener('keydown', e => {
        e.stopPropagation();
        if(e.key === 'Escape'){ e.preventDefault(); finish(() => { host.innerHTML = prev; }); }
        if(e.key === 'Enter' && (e.metaKey || e.ctrlKey)){ e.preventDefault(); finish(() => onSave(ta.value.trim())); }
      });
    }

    // A note pass: click it to rewrite it, empty it to drop that line.
    el.querySelectorAll('.hl-note').forEach(n => n.onclick = e => {
      if(e.target.closest('.hl-mini')) return;
      const id = n.dataset.hl, idx = +n.dataset.pass;
      const cur = (notePasses(getHighlights(currentReadingId()).find(h => h.id === id)) || [])[idx];
      if(!cur) return;
      editInPlace(n, cur.text, text => {
        updateHighlight(id, h => {
          const ps = notePasses(h).slice();
          if(!text) ps.splice(idx, 1); else ps[idx] = { text, ts: cur.ts, edited: Date.now() };
          writePasses(h, ps);
        });
      }, { canDelete: true });
    });

    // ＋ Add — a NEW dated line. The old one stays; that is the whole point.
    el.querySelectorAll('.hl-add').forEach(b => b.onclick = () => {
      const card = b.closest('.hl-card');
      const host = document.createElement('div');
      host.className = 'hl-note pending';
      card.querySelector('.hl-row').before(host);
      editInPlace(host, '', text => {
        if(!text){ host.remove(); layoutMarginNotes(); return; }
        updateHighlight(b.dataset.hl, h => writePasses(h, notePasses(h).concat([{ text, ts: Date.now() }])));
      });
    });

    // ✎ Trim — the quoted passage itself, for a box that grabbed too much. The BAND
    // on the page is not touched: it records where you looked, and the rects were
    // measured against the render, not against this string.
    el.querySelectorAll('.hl-trim').forEach(b => b.onclick = () => {
      const id = b.dataset.hl;
      const rec = getHighlights(currentReadingId()).find(h => h.id === id); if(!rec) return;
      const q = b.closest('.hl-card').querySelector('.hl-quote');
      editInPlace(q, rec.text || '', text => {
        if(!text){ renderHighlightList(); return; }   // never blank a passage away
        updateHighlight(id, h => { h.text = text; });
      });
    });
    // Clear-all. A highlight stores the rects it was SAVED with, so any band made by
    // an older build keeps its geometry for ever and no fix can repaint it — the
    // only remedy is to drop it and highlight again. Removing them one card at a
    // time is unreasonable when a reading has a dozen.
    const foot = document.getElementById('hlFoot');
    if(foot) foot.innerHTML =
      `<button class="hl-clear" id="hlClearAll">Clear all ${list.length} on this reading</button>`;
    const clr = document.getElementById('hlClearAll');
    if(clr) clr.onclick = () => {
      const rid = currentReadingId(), kept = getHighlights(rid).slice();
      if(!kept.length) return;
      persistHighlights(rid, []);
      document.querySelectorAll('.hl-mark').forEach(m => m.remove());
      renderHighlightList();
      undoably(`Removed ${kept.length} highlight${kept.length === 1 ? '' : 's'}`, () => {
        persistHighlights(rid, kept); renderHighlightList(); repaintHighlights();
      });
    };
    el.querySelectorAll('.hl-nb').forEach(b => b.onclick = () => elevateHighlight(list.find(h => h.id === b.dataset.hl)));
    el.querySelectorAll('.hl-del').forEach(b => b.onclick = () => removeHighlight(b.dataset.hl));
    fitGotoLabels(el);   // before the margin lays out — this changes card heights
    layoutMarginNotes();
  }
  // ⚠ MEASURED, NOT GUESSED. The five controls on a card have to fit one line, or the
  // row doubles and every card in the anchored margin is pushed further from the passage
  // it belongs to. At "p.20" they fit with about 2px to spare — and 2px is not a margin
  // you can rely on, because a different font fallback on someone else's machine moves
  // text by more than that. Dropping the "p." (Todd: "or just drop the p") buys back
  // ~11px and takes every page label this app can print well clear: 1, 20, 121, xviii,
  // xxviii all hold one line. The title says "page 20" in full, so the number keeps its
  // meaning for anyone who wonders what it is.
  //
  // The arrow is the floor under all of that, for a label long enough to overrun even
  // so — Todd's idea: "what if tight cases are replaced with an arrow or something?"
  // The row is ASKED whether it actually wrapped rather than told when it would.
  function fitGotoLabels(host){
    if(!host) return;
    host.querySelectorAll('.hl-card').forEach(card => {
      const row = card.querySelector('.hl-row');
      const g = row && row.querySelector('.hl-goto');
      if(!row || !g || !g.dataset.pg) return;
      const wrapped = () => new Set([...row.querySelectorAll('button')].map(b => b.offsetTop)).size > 1;
      if(wrapped()) g.textContent = '\u2192';   // the way back, and nothing else
    });
  }

  // ── Notes beside their passages ──────────────────────────────────────────────
  // Ported from journaler-318P, build d808a78. Todd, on the Google Docs model: "I
  // would give away independent scroll if we implemented a google docs approach."
  // That is the trade, and it is made here too. In Continuous the margin stops being
  // a list and becomes a SURFACE: every card sits at the height of the passage it was
  // written about, and the column no longer scrolls on its own -- it rides the page.
  // "Beside the passage" and "wherever I left the list" cannot both be true.
  //
  // Continuous only, and that is not a compromise: Google Docs IS a continuous scroll,
  // so there is no paged behaviour to be faithful to. The paged views keep the plain
  // list, where most cards have no passage on screen and a margin that empties as you
  // turn the page would hide the work rather than place it. Narrow screens stack the
  // reader into one column (app.css, 720px), and a margin under the page has nothing
  // to sit beside, so it stays a list there as well.
  function marginAnchored(){
    const r = readings[activeReading];
    return notesOpen && readPageMode === 'continuous' && !!(r && r.type === 'pdf')
        && !(window.matchMedia && window.matchMedia('(max-width: 720px)').matches);
  }
  // Where a highlight POINTS: the top-left of its first band, in page fractions. The
  // rects are one per line, and DOM order is not reading order after a re-render, so
  // take the earliest page and the highest rect on it rather than rects[0].
  function anchorOf(rec){
    let best = null;
    (rec && rec.rects || []).forEach(rc => {
      const pg = rc.page || 1;
      if(!best || pg < best.page || (pg === best.page && rc.y < best.y)) best = { page: pg, y: rc.y };
    });
    return best;
  }
  // Place every card at the height of its passage, then push overlapping ones down so
  // they stay readable.
  //
  // Positions are computed in VIEWPORT space from the live page element on every pass,
  // rather than mapped once into the margin's own scroll space. It costs a layout per
  // scroll frame, coalesced to one per animation frame, and buys the absence of a
  // second coordinate system to keep in step with the first -- two coordinate systems
  // drifting apart is precisely how this feature goes subtly wrong: a card half a line
  // off, on some pages only.
  let _mnFrame = 0;
  function layoutMarginNotes(){
    const aside = document.querySelector('.reader .notes');
    const surf  = document.querySelector('.reader .notes-scroll');
    if(!aside || !surf) return;
    if(!marginAnchored()){
      aside.classList.remove('anchored');
      surf.style.minHeight = '';
      surf.querySelectorAll('.hl-card').forEach(c => {
        c.style.top = ''; c.classList.remove('crowded');
      });
      return;
    }
    aside.classList.add('anchored');
    const sr = surf.getBoundingClientRect();
    const items = [];
    getHighlights(currentReadingId()).forEach(h => {
      const el = surf.querySelector(`.hl-card[data-hl="${h.id}"]`);
      if(!el) return;
      const a = anchorOf(h);
      const pg = a && document.querySelector(`#docPane .pdf-page[data-page="${a.page}"]`);
      // No band, or its page is not rendered: park it at the top rather than dropping
      // it. A card the reader cannot find is worse than one in the wrong place.
      if(!pg){ items.push({ el, want: 0, orphan: true }); return; }
      const r = pg.getBoundingClientRect();
      if(!r.height){ items.push({ el, want: 0, orphan: true }); return; }
      items.push({ el, want: (r.top + a.y * r.height) - sr.top, orphan: false });
    });
    // Reading order down the chapter, which for anchored cards is also the order the
    // reader meets the passages — not the order they happened to mark them.
    items.sort((a, b) => a.want - b.want);
    const GAP = 10;
    let prevBottom = -1e9;
    for(const it of items){
      it.top = Math.max(it.want, prevBottom + GAP);
      prevBottom = it.top + it.el.offsetHeight;
    }
    // ⚠ 318P's surface is one viewport tall, and a cluster pushed past its bottom is
    // revealed by scrolling the margin. Here there is nothing to scroll: the reader
    // grows to its pages and the WINDOW moves, so the surface is already as tall as the
    // reading and a card pushed off its bottom would simply be clipped away.
    // Lifting the stack to make room was tried and is a bad trade — it put all nine
    // cards 36px off their passages to rescue two, and being beside the passage is the
    // entire point. The surface GROWS instead: the column runs a little past the last
    // page, and every card stays where it points. Safe against oscillation because the
    // surface's TOP is what positions cards, and growing it downward cannot move that.
    // Nothing to place: hand the height back to the stylesheet rather than pinning the
    // surface to 0px, which would override its own min-height floor.
    surf.style.minHeight = items.length ? Math.max(0, Math.ceil(prevBottom + 8)) + 'px' : '';
    for(const it of items){
      // Marked crowded when it could not sit where it belongs: three notes on one
      // dense paragraph cannot all be adjacent to it, and the rule the reader needs
      // is "pushed down to make room", not "this is where you wrote it".
      it.el.classList.toggle('crowded', !it.orphan && Math.abs(it.top - it.want) > 2);
      it.el.style.top = Math.round(it.top) + 'px';
    }
  }
  // Coalesce to one layout per animation frame: scroll fires far faster than paint.
  function scheduleMarginLayout(){
    if(_mnFrame) return;
    _mnFrame = requestAnimationFrame(() => { _mnFrame = 0; layoutMarginNotes(); });
  }
  // ⚠ WHICH THING SCROLLS IS NOT FIXED. #docPane has overflow-y:auto, but at page zoom
  // in Continuous the pane grows to its content and the WINDOW is what moves — measured,
  // not assumed: docPane scrollable by 0px, html by 444px. Hooking the pane alone would
  // have left the cards behind on exactly the view this feature is for. scroll does not
  // bubble, so this listens in the CAPTURE phase and catches whichever element it is,
  // window included. Off anchored mode layoutMarginNotes returns immediately, so the
  // cost of being wrong about the scroller is one early return per frame.
  const _onScroll = () => { scheduleMarginLayout(); syncDoorsOnScroll(); };
  document.addEventListener('scroll', _onScroll, { capture: true, passive: true });
  window.addEventListener('scroll', _onScroll, { passive: true });

  // ── Zoom. Percentages are of ACTUAL SIZE, the convention every PDF reader uses:
  //    100% means one PDF point per CSS pixel, so a letter page is 612px wide. On a big
  //    monitor that is SMALLER than fit-width, which surprises people until they realise
  //    it is the same 100% Acrobat and Chrome mean. Fit width stays the default because
  //    it is right for a scanned chapter; fit page earns its place on a full-page figure.
  const ZOOMS = [
    { v:'fit',  t:'Fit width' },
    { v:'page', t:'Fit page' },
    { v:'0.5',  t:'50%' },
    { v:'0.75', t:'75%' },
    { v:'1',    t:'100%' },
    { v:'1.25', t:'125%' },
    { v:'1.5',  t:'150%' },
    { v:'2',    t:'200%' },
  ];
  // Todd: landscape on an iPad wants 125% and a scroll, not a fitted page. Landscape
  // is SHORT, so "the whole sheet" there means a small sheet -- the fit that helps in
  // portrait works against you turned sideways.
  function defaultZoom(){
    return (COARSE_POINTER && window.innerWidth > window.innerHeight) ? '1' : 'page';
  }
  let readZoom = DB.readZoom || defaultZoom();
  // Recomputed on rotation, not only at load: a student who opens in portrait and
  // turns the iPad would otherwise keep portrait's answer, which is the exact case
  // this exists for. Only ever while the zoom is still a DEFAULT -- the moment one is
  // chosen it goes to DB and nothing here touches it again.
  let _orientT = null;
  window.addEventListener('resize', () => {
    scheduleMarginLayout();   // the column moved NOW, not in 220ms
    if(DB.readZoom) return;
    clearTimeout(_orientT);
    _orientT = setTimeout(() => {              // a rotation fires resize several times
      const z = defaultZoom();
      if(z === readZoom) return;
      readZoom = z;
      const zs = document.getElementById('zoomSel'); if(zs) zs.value = z;
      const r = readings[activeReading];
      if(r && (r.type === 'pdf' || r.type === 'docx')) renderActiveDoc(r);
    }, 220);
  });
  // Notes pane open/closed. The pane is HIDDEN, never removed: renderHighlightList and
  // renderQAList paint into #hlList / #newnote, so pulling the aside out of the DOM
  // would silently drop everything captured while it was away. Hidden keeps them
  // painting to elements that are simply not on screen, so reopening shows the lot.
  let notesOpen = DB.notesOpen !== false;
  function zoomScale(unit, availW, availH){
    let s;
    if(readZoom === 'fit')       s = availW / unit.width;
    else if(readZoom === 'page') s = Math.min(availW / unit.width, availH / unit.height);
    else                         s = Number(readZoom) || 1;
    // Floor keeps a page legible; ceiling keeps one canvas from eating hundreds of MB
    // (canvas bytes go up with the SQUARE of scale, times devicePixelRatio again).
    return Math.max(0.25, Math.min(4, s));
  }

  // Scale is baked into the canvas at render time, so anything that changes the column
  // width leaves the page at the old size — entering focus mode, resizing the window,
  // toggling the shelf. Re-render when the width actually moves.
  //   · fit / fit-page only: at a fixed percentage the page is the same size whatever
  //     the column does, so re-rendering would burn CPU to produce an identical canvas.
  //   · 24px threshold + debounce: sub-pixel and scrollbar-appearance jitter must not
  //     feed back into a re-render that changes the width again.
  let _paneRO = null, _paneW = 0, _paneT = null;
  function watchPaneRerender(){
    const r = readings[activeReading];
    if(r && (r.type === 'pdf' || r.type === 'docx')) renderActiveDoc(r);
  }
  function watchPaneWidth(pane){
    if(_paneRO){ _paneRO.disconnect(); _paneRO = null; }
    if(!pane || typeof ResizeObserver === 'undefined') return;
    _paneW = pane.clientWidth;
    _paneRO = new ResizeObserver(() => {
      if(readZoom !== 'fit' && readZoom !== 'page') return;
      const w = pane.clientWidth;
      if(Math.abs(w - _paneW) < 24) return;
      _paneW = w;
      clearTimeout(_paneT);
      // Long enough to let a layout change settle -- entering focus moves the width
      // more than once (shelf in, columns resize, scrollbar decides) and each move
      // used to start a render that killed the one before it.
      _paneT = setTimeout(watchPaneRerender, 220);
    });
    _paneRO.observe(pane);
  }

  // Paint pdf pages — one at a time (single, with ‹ ›) or all stacked (continuous).
  async function renderPdfPages(pane, doc, r, token){
    const single = readPageMode === 'single';
    if(readPageNum > doc.numPages) readPageNum = doc.numPages;
    if(readPageNum < 1) readPageNum = 1;
    // The page controls live in the toolbar above the frame, not inside this scrolling
    // pane. Splitting them across two strips was the thing that read as "wrong".
    // Measured here rather than beside the render loop, because the page label and the
    // Next button are built below and have to agree with what is about to be drawn.
    const _cs0 = getComputedStyle(pane);
    const _availW0 = Math.max(320, pane.clientWidth
      - (parseFloat(_cs0.paddingLeft) || 0) - (parseFloat(_cs0.paddingRight) || 0));
    const _availH0 = Math.max(280, pane.clientHeight
      - (parseFloat(_cs0.paddingTop) || 0) - (parseFloat(_cs0.paddingBottom) || 0));
    // At a fixed zoom the scale ignores the column -- 150% is 150% however narrow the
    // pane -- so two pages can want more width than there is. The flex row then shrinks
    // each .pdf-page while its canvas keeps the width it was rendered at, and
    // .pdf-page's overflow:hidden quietly slices the right-hand edge off BOTH pages:
    // the reading looks like a bad scan rather than a window too small. Fit and Fit-page
    // cannot hit this, because they derive the scale FROM the column.
    _effSpread = readSpread;
    if(single && readSpread === 2 && doc.numPages > 1){
      try {
        const probe = await doc.getPage(Math.min(readPageNum, doc.numPages));
        if(token !== _readToken) return;
        const unit0 = probe.getViewport({ scale: 1 });
        const half = Math.max(280, Math.floor((_availW0 - 18) / 2));
        const s0 = zoomScale(unit0, half, _availH0);
        if(unit0.width * s0 * 2 + 18 > _availW0 + 1){
          _effSpread = 1;
          logEvent('ui', 'two-page view needs more width than there is — showing one page',
                   { zoom: String(readZoom), pane: Math.round(_availW0) + 'px',
                     wanted: Math.round(unit0.width * s0 * 2 + 18) + 'px' });
        }
      } catch(e){ /* cannot measure -- let it try rather than refuse to render */ }
    }
    const navHost = document.getElementById('pageNav');
    if(navHost) navHost.innerHTML = single
      ? (() => {
          const last = Math.min(readPageNum + _effSpread - 1, doc.numPages);
          // "Page 5 of 8" is 250px of a bar that has none to give on an iPad. The
          // words go and the numbers stay, below the width where it matters.
          const tight = window.innerWidth <= 1000;
          const shown = last > readPageNum
            ? `${tight ? '' : 'Pages '}${pageLabelFor(readPageNum)}–${pageLabelFor(last)}`
            : `${tight ? '' : 'Page '}${pageLabelFor(readPageNum)}`;
          const squeezed = readSpread === 2 && _effSpread === 1
            ? `<span class="pdfnav-note">Two pages needs a wider window, or a smaller zoom.</span>` : '';
          return `<button class="pdfnav-btn" id="pgPrev" ${readPageNum<=1?'disabled':''}>‹ Prev</button>`
            + `<span class="pdfnav-lbl">${shown}${tight ? '/' : ' of '}${pageLabelFor(doc.numPages)}</span>`
            + `<button class="pdfnav-btn" id="pgNext" ${last>=doc.numPages?'disabled':''}>Next ›</button>`
            + squeezed;
        })()
      : `<span class="pdfnav-lbl">${doc.numPages} pages · scroll to read</span>`;
    // ⚠ NEVER BLANK THE PANE FOR A RENDER THAT MAY NOT FINISH (Todd, 2026-08-26):
    // "I press fit, two page view, focus---and all the pages disappear!"
    //
    // pane.innerHTML='' used to run FIRST, then the loop awaited each page and bailed
    // at the next `token !== _readToken` if a newer render had started. watchPaneWidth
    // re-renders on a width change but ONLY at fit/page zoom -- which is why pressing
    // fit was part of the recipe -- and entering focus in two-up moves the width more
    // than once: the shelf arrives, the columns resize, the scrollbar makes up its
    // mind. Each move started a render that superseded the one before it, and every
    // one of them had already cleared the pane. Blank, with no error, because nothing
    // had actually failed.
    //
    // So the wrap is built DETACHED and swapped in only once it holds a page. A
    // superseded render discards its own work and leaves the screen alone. Do not
    // hoist this clear back to the top.
    const wrap = document.createElement('div'); wrap.className = 'pdf-doc';
    let attached = false;
    const attach = () => { if(attached) return; pane.innerHTML = ''; pane.appendChild(wrap); attached = true; };
    if(single){
      const pv = document.getElementById('pgPrev'), nx = document.getElementById('pgNext');
      // renderActiveDoc repaints the PAGE; the margin is a separate render, and now
      // that the list is filtered to the current page it has to follow the turn or it
      // would keep showing the page you just left.
      // Step by the spread: a two-page view turns two pages, or the reader re-reads
      // the page they just finished every time they click Next.
      if(pv) pv.onclick = ()=>{ if(readPageNum>1){ readPageNum = Math.max(1, readPageNum - _effSpread); renderActiveDoc(r); renderHighlightList(); } };
      if(nx) nx.onclick = ()=>{ if(readPageNum + _effSpread - 1 < doc.numPages){ readPageNum += _effSpread; renderActiveDoc(r); renderHighlightList(); } };
    }
    const _cs = getComputedStyle(pane);
    const _padX = (parseFloat(_cs.paddingLeft) || 0) + (parseFloat(_cs.paddingRight) || 0);
    const _padY = (parseFloat(_cs.paddingTop) || 0) + (parseFloat(_cs.paddingBottom) || 0);
    const avail = Math.max(320, pane.clientWidth - _padX);
    // Fit-page needs the height the pane can actually show, less its own padding.
    const availH = Math.max(280, pane.clientHeight - _padY);
    const ratio = window.devicePixelRatio || 1;
    const pages = single
      ? (visiblePages() || []).filter(n => n >= 1 && n <= doc.numPages)
      : Array.from({length:doc.numPages}, (_,i)=>i+1);
    // Two portrait pages side by side need half the width each, less the gap between.
    const twoUp = single && _effSpread === 2 && pages.length > 1;
    const colW = twoUp ? Math.max(280, Math.floor((avail - 18) / 2)) : avail;
    if(twoUp) wrap.classList.add('two-up');

    // ══ PHASE 1 · every page div, at its true size, before anything is drawn ═══════
    //
    // ⚠ THE PAGE DIVS ARE NOT NEGOTIABLE (Todd, 2026-08-30): "We can't have notes
    // disappearing while students are reading a long document." layoutMarginNotes
    // anchors every margin card to the LIVE RECT of .pdf-page[data-page="N"]. A page
    // that leaves the DOM takes its cards' anchor with it, and a student scrolling a
    // long chapter would watch their notes jump and pile up at the top of the column —
    // a worse bug than the one being fixed. So every page keeps a div of the correct
    // height for as long as the chapter is open, and only the CANVAS comes and goes.
    //
    // getViewport is arithmetic over numbers pdf.js already has — no rendering, no
    // image decoding — so the document's full height is right from the first paint and
    // nothing below the fold ever shifts under the reader.
    const slots = new Map();
    for(const n of pages){
      if(token !== _readToken) return;
      const page = await doc.getPage(n);
      const unit = page.getViewport({ scale: 1 });
      const scale = zoomScale(unit, colW, availH);
      const viewport = page.getViewport({ scale });
      const pageDiv = document.createElement('div'); pageDiv.className = 'pdf-page'; pageDiv.dataset.page = n;
      pageDiv.style.width = viewport.width + 'px'; pageDiv.style.height = viewport.height + 'px';
      wrap.appendChild(pageDiv); attach();
      // ⚠ AND THE READER'S WORK IS NOT MEMORY TO BE MANAGED (Todd, 2026-08-30): "We do
      // need all of the user's comments saved in resident memory across all the
      // readings. Those should never leave (unless the user deletes them)." Bands are
      // painted here, at placeholder time, from the stored records and the div's own
      // box — no canvas, no text layer. So they are right on a page that has never been
      // drawn, and they survive every eviction below because nothing there touches them.
      paintHighlightsForPage(pageDiv, n, r.id);
      slots.set(n, { div: pageDiv, page, viewport, scale, unit, state: 'empty', task: null });
    }
    if(token !== _readToken) return;

    // ══ PHASE 2 · the canvas follows the viewport ═════════════════════════════════
    //
    // ⚠ REMOVE BY NAME, NEVER WHOLESALE. .hl-layer is a SIBLING of the canvas and the
    // text layer inside .pdf-page, and it holds the reader's marked passages.
    // pageDiv.innerHTML = '' would take the bands with it — the one thing this work is
    // not allowed to do. Take the canvas, the text layer and the capture overlay, and
    // nothing else.
    const strip = s => s.div
      .querySelectorAll(':scope > canvas, :scope > .textLayer, :scope > .marquee-overlay')
      .forEach(el => el.remove());

    const drop = n => {
      const s = slots.get(n);
      if(!s || s.state === 'empty') return;
      // Never pull a page out from under a drag that is happening on it. Eviction only
      // ever reaches pages well off screen, so this should not fire — but a box drag
      // that has scrolled is the one way it could, and losing it would be silent.
      if(_mq && _mq.overlay && s.div.contains(_mq.overlay)) return;
      if(s.task){ try { s.task.cancel(); } catch(e){} s.task = null; }
      s.state = 'empty';
      strip(s);
      // ⚠ THE BITMAP IS NOT THE WHOLE COST. pdf.js keeps a decoded operator list, font
      // data and image cache per page; dropping the canvas frees the bitmap and leaves
      // all of that resident. cleanup() is guarded internally against firing mid-render,
      // and the task above is cancelled first.
      try { s.page.cleanup(); } catch(e){}
    };

    const fill = async n => {
      const s = slots.get(n);
      if(!s || s.state !== 'empty' || token !== _readToken) return;
      s.state = 'filling';
      // Between every await the page may have been evicted, the reading switched, or a
      // newer render started. `live` is the one question worth asking at each of them.
      const live = () => token === _readToken && s.state === 'filling';
      try {
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(s.viewport.width * ratio); canvas.height = Math.floor(s.viewport.height * ratio);
        canvas.style.width = s.viewport.width + 'px'; canvas.style.height = s.viewport.height + 'px';
        s.div.appendChild(canvas);
        s.task = s.page.render({ canvasContext: canvas.getContext('2d'), viewport: s.viewport,
                                 transform: ratio !== 1 ? [ratio,0,0,ratio,0,0] : null });
        await s.task.promise;
        s.task = null;
        if(!live()){ strip(s); return; }
        // Selectable text layer + marquee capture overlay (passages → Romano / Notebook).
        // ⚠ THE TEXT LAYER MAY GO WITH THE CANVAS (Todd, 2026-08-30): "We don't need all
        // of the text loaded for all of the pages all of the time." Everything that
        // reads #docPane .textLayer acts on the page the reader is touching —
        // handleMarqueeCapture is handed its own page's layer, and spanOf, docLines,
        // paintLiveSelection and the copy handler all work from a live selection. You
        // cannot drag a box across a page you cannot see. It rebuilds from
        // getTextContent() on the way back in.
        const tc = await s.page.getTextContent();
        if(!live()){ strip(s); return; }
        // Clean OCR items before building the layer: drop duplicate-embedded text and
        // put them in reading order — helps both native selection and marquee capture.
        try { tc.items = orderByReadingColumns(dedupeTextItems(tc.items), s.unit.width); } catch(e2){ console.warn('column order', e2); }
        const tlDiv = document.createElement('div'); tlDiv.className = 'textLayer';
        tlDiv.style.setProperty('--scale-factor', s.scale);
        tlDiv.style.setProperty('--total-scale-factor', s.scale);
        s.div.appendChild(tlDiv);
        const TL = window.pdfjsLib && window.pdfjsLib.TextLayer;
        if(TL){ await new TL({ textContentSource: tc, container: tlDiv, viewport: s.viewport }).render(); }
        if(!live()){ strip(s); return; }
        // Cross-line native selection fix ("endOfContent" trick), used in "select" mode:
        // a full-layer selectable block behind the text lets the browser flow the
        // selection to end-of-line and wrap instead of a rectangular column.
        const eoc = document.createElement('div'); eoc.className = 'endOfContent';
        tlDiv.appendChild(eoc);
        tlDiv.addEventListener('pointerdown', () => {
          eoc.classList.add('active');
          const clear = () => { eoc.classList.remove('active'); document.removeEventListener('pointerup', clear); };
          document.addEventListener('pointerup', clear);
        });
        // Marquee "box" capture overlay (default; reliable on OCR'd scans).
        const overlay = document.createElement('div'); overlay.className = 'marquee-overlay';
        overlay.style.pointerEvents = 'auto';
        s.div.appendChild(overlay);
        attachMarquee(overlay, canvas, tlDiv);
        s.state = 'filled';
      } catch(e){
        // A cancelled render is ordinary here — it is what eviction does to a page that
        // was still drawing — and is not worth a console line.
        if(!(e && (e.name === 'RenderingCancelledException' || /cancel/i.test(String(e.message||''))))) console.warn('page ' + n, e);
        s.state = 'empty'; strip(s);
      }
    };

    stopPageObservers();
    if(single || !slots.size){
      // One or two pages, and both are on screen by definition. Nothing to manage.
      for(const n of pages){ if(token !== _readToken) return; await fill(n); }
    } else {
      // ⚠ root:null ON PURPOSE. Which element actually scrolls is not fixed here —
      // #docPane has overflow-y:auto, but at page zoom the pane scrolls by 0px and the
      // document scrolls instead (see the note on layoutMarginNotes). Intersection
      // against the VIEWPORT is correct either way, because the algorithm clips the
      // target through every ancestor on the way up.
      //
      // Two bands, not one: draw within a viewport of the reader, and let go only well
      // beyond that. A single threshold would leave a page on the boundary flipping
      // between drawn and blank on every small scroll.
      const ioFill = new IntersectionObserver(es => {
        if(token !== _readToken) return;
        es.forEach(e => { if(e.isIntersecting) fill(+e.target.dataset.page); });
      }, { root: null, rootMargin: '100% 0px' });
      const ioKeep = new IntersectionObserver(es => {
        if(token !== _readToken) return;
        es.forEach(e => { if(!e.isIntersecting) drop(+e.target.dataset.page); });
      }, { root: null, rootMargin: '250% 0px' });
      slots.forEach(s => { ioFill.observe(s.div); ioKeep.observe(s.div); });
      _pageIO = [ioFill, ioKeep];
    }
    if(token === _readToken && !attached){ pane.innerHTML = ''; }
    layoutMarginNotes();
  }
  // Add one or many files (multi-select or a whole folder). txt inline, PDF/.docx bytes to IndexedDB.
  // Stable, filename-derived id. Mirrors the `d:` scheme the persistent-folder path
  // already used, so a chapter keeps its highlights whichever way it was loaded.
  function readingIdForName(name){
    return 'f:' + String(name || '').trim().toLowerCase();
  }

  // One-time re-key of readings shelved under the old random ids, carrying their
  // highlights and Romano threads across. Runs before anything reads them, and only
  // where the destination is free, so it can never merge two chapters into one.
  function migrateReadingIds(){
    if(DB._readingIdsV2 || !Array.isArray(DB.readings)) { DB._readingIdsV2 = true; return; }
    DB.highlights = DB.highlights || {}; DB.qa = DB.qa || {};
    let moved = 0;
    for(const r of DB.readings){
      if(!r || !r.name || r.builtin || r.fromDir) continue;
      if(typeof r.id === 'string' && (r.id.startsWith('f:') || r.id.startsWith('d:'))) continue;
      const nid = readingIdForName(r.name);
      if(DB.readings.some(o => o !== r && o.id === nid)) continue;   // don't collide
      const old = r.id;
      if(DB.highlights[old] && !DB.highlights[nid]){ DB.highlights[nid] = DB.highlights[old]; delete DB.highlights[old]; }
      if(DB.qa[old] && !DB.qa[nid]){ DB.qa[nid] = DB.qa[old]; delete DB.qa[old]; }
      // The bytes are stored in IndexedDB under the old id; move the pointer, and let
      // readingBytesFor fall back so a chapter is never orphaned from its own file.
      r.legacyId = old;
      r.id = nid;
      moved++;
    }
    DB._readingIdsV2 = true;
    if(moved) saveDB();
  }

  async function addReadingFiles(fileList){
    const files = [...fileList].filter(f => /\.(pdf|docx|txt)$/i.test(f.name));
    if(!files.length) return;
    for(const f of files){
      const ext = (f.name.split('.').pop()||'').toLowerCase();
      // Id derives from the FILENAME, not from the clock. Random ids meant a reading
      // reloaded after a restore, or on another machine, was a different reading as far
      // as DB.highlights and DB.qa were concerned — the work survived in the export and
      // had nothing to render against. Same filename now means the same reading, which
      // is what a student means by "my chapter 5".
      const id = readingIdForName(f.name);
      if(ext === 'txt'){
        const txt = await f.text();
        readings.push({ id, name: f.name, type: ext, html: `<p>${escHtml(txt).replace(/\n{2,}/g,'</p><p>').replace(/\n/g,'<br>')}</p>` });
      } else {
        const buf = await f.arrayBuffer();
        // Only shelve it if the bytes actually landed. This used to push
        // unconditionally, so a failed write produced a phantom reading that only
        // announced itself at render time.
        try { await saveReadingBytes(id, buf); }
        catch(e){ logEvent('error', 'could not store ' + f.name, String(e && e.message || e)); console.warn('saveReadingBytes', e); toast('Couldn’t store ' + f.name + ' — browser storage may be full. Try 📁 Use a readings folder.'); continue; }
        readings.push({ id, name: f.name, type: ext });
      }
    }
    activeReading = readings.length - 1;
    readPageNum = 1; dropPdf();
    persistReadings();
    renderRead();
  }

  // The shelf's folder control. Four states, because "connected" and "remembered
  // but not yet re-authorised" and "drive isn't here" are genuinely different and
  // need different advice.
  function folderChip(){
    if(!FS_OK) return '';
    const nm = readingsDirName();
    if(!nm) return `<button class="openbtn" id="pickDir" title="Point Journaler at a folder of readings — it reloads them every visit">📁 Use a readings folder</button>`;
    if(readingsDirState === 'granted')
      return `<span class="dirchip on" title="Reading from this folder — files are read from disk, not copied into the browser">📁 ${escHtml(nm)}<button class="dirchip-x" id="forgetDir" title="Stop using this folder">✕</button></span>`;
    const why = readingsDirState === 'missing' ? 'Folder not found — plug the drive back in?' : 'Reconnect to read from this folder again';
    return `<span class="dirchip off" title="${escHtml(why)}">📁 ${escHtml(nm)}<button class="dirchip-go" id="reconnectDir">Reconnect folder</button><button class="dirchip-x" id="forgetDir" title="Stop using this folder">✕</button></span>`;
  }
  // Every chapter the student has loaded, as one archive. The bytes are already
  // here -- in IndexedDB, or readable from the connected folder -- so this is a
  // repackaging, not a download: it works with the network off.
  // ⚠ Reads them one at a time on purpose. A term of scans is a few hundred MB, and
  // asking IndexedDB for all of it at once is how a tab gets killed on an iPad.
  async function zipReadings(btn){
    const label = btn ? btn.textContent : '';
    const say = t => { if(btn) btn.textContent = t; };
    if(typeof JSZip === 'undefined'){ alert('Zip library not loaded.'); return; }
    const mine = readings.filter(r => !r.builtin);
    if(!mine.length){ alert('No chapters loaded yet.\n\nUse ＋ Load readings or ＋ Load a folder above.'); return; }
    if(btn) btn.disabled = true;
    try {
      const zip = new JSZip();
      let got = 0; const missing = [];
      for(let i = 0; i < mine.length; i++){
        const r = mine[i];
        say('Packing ' + (i+1) + ' of ' + mine.length + '\u2026');
        let bytes = null;
        try { bytes = await readingBytesFor(r); } catch(e){ bytes = null; }
        if(bytes){ zip.file(r.name, bytes); got++; }
        else missing.push(r.name);   // a folder reading with the folder disconnected
      }
      if(!got){
        alert('None of your chapters could be read just now.\n\nIf they came from a folder, reconnect it first.');
        return;
      }
      say('Zipping\u2026');
      const blob = await zip.generateAsync({ type: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'journaler-284-readings-' + new Date().toISOString().slice(0,10) + '.zip';
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
      logEvent('read', 'downloaded ' + got + ' reading(s) as a zip');
      // Say what did NOT make it. A silently short archive is worse than none: it
      // looks like a backup right up until the moment someone needs it.
      if(missing.length) alert('Saved ' + got + ' of ' + mine.length + '.\n\nNot included:\n\u00b7 '
        + missing.join('\n\u00b7 ') + '\n\nThose came from a folder that is not connected right now.');
    } catch(e){
      logEvent('error', 'zip readings failed', String(e && e.message || e));
      alert('Could not build the zip: ' + (e && e.message || e));
    } finally { if(btn){ btn.disabled = false; btn.textContent = label; } }
  }

  // ── The chapter drawer ───────────────────────────────────────────────────
  // Todd, 2026-08-27: "instead of the dropdown reading list, what if we made that a
  // side drawer on the left that can be hidden — think VS Code's leftmost panel."
  // The list is a once-a-session control that was costing a permanent bar; here it
  // takes width only while it is open, and the reading keeps the rest.
  // Todd: open with it hidden. Not "remember whether it was open" -- every session
  // starts closed. The drawer is a pick-a-chapter tool rather than a table of
  // contents: you open it, choose, and want the width back. Persisting it would mean
  // arriving at a reading with a column of titles beside it most mornings, which is
  // the thing this overhaul was for.
  let drawerOpen = false;
  function setDrawerOpen(v){
    drawerOpen = v;
    const r = document.querySelector('.reader');
    if(r) r.classList.toggle('drawer-open', v);
    const b = document.getElementById('drawerToggle');
    if(b){ b.classList.toggle('on', v); b.setAttribute('aria-expanded', String(v)); }
    // The pane just changed width, and the page is rendered at a scale measured for
    // the old one. Same two-frame wait setFocus uses, and for the same reason.
    if(tab === 'read') requestAnimationFrame(() => requestAnimationFrame(() => {
      const rr = readings[activeReading];
      if(rr && (rr.type === 'pdf' || rr.type === 'docx')) renderActiveDoc(rr);
    }));
  }
  function pickReading(i){
    if(i === activeReading || i < 0 || i >= readings.length) return;
    activeReading = i; readPageNum = 1; dropPdf();
    persistReadings(); renderRead();
  }
  // Deliberately confirmed, unlike the old ✕ Remove: a trash can beside a title is a
  // smaller, likelier misclick than a labelled button on a bar, and the highlights on
  // that chapter go with it.
  function removeReadingAt(i){
    const r = readings[i];
    if(!r) return;
    // The highlights are keyed by reading id and are NOT touched here, so putting the
    // reading back brings its marked passages back with it.
    const wasAt = activeReading;
    readings.splice(i, 1);
    if(activeReading >= readings.length) activeReading = Math.max(0, readings.length - 1);
    readPageNum = 1; dropPdf();
    logEvent('read', 'removed “' + r.name + '” from the shelf');
    persistReadings(); renderRead();
    undoably('Removed “' + readingLabel(r) + '”', () => {
      readings.splice(Math.min(i, readings.length), 0, r);
      activeReading = Math.min(wasAt, readings.length - 1);
      dropPdf();
      logEvent('read', 'restored “' + r.name + '” to the shelf');
      persistReadings(); renderRead();
    });
  }
  function renderDrawer(){
    const host = document.getElementById('drawerList');
    if(!host) return;
    host.innerHTML = readings.length
      ? readings.map((r,i)=>
          `<div class="drawer-row${i===activeReading?' on':''}">`
          + `<button class="drawer-pick" data-i="${i}" title="${escHtml(r.name)}">${escHtml(readingLabel(r))}</button>`
          + `<button class="drawer-x" data-x="${i}" title="Remove this chapter from your shelf" aria-label="Remove ${escHtml(readingLabel(r))}">🗑</button>`
          + `</div>`).join('')
      : `<p class="drawer-empty">No chapters yet.<br><br>Use ＋ Load readings above, or point Journaler at a whole folder under ⚙ Settings → Readings.</p>`;
    host.querySelectorAll('.drawer-pick').forEach(b => b.onclick = () => pickReading(+b.dataset.i));
    host.querySelectorAll('.drawer-x').forEach(b => b.onclick = e => { e.stopPropagation(); removeReadingAt(+b.dataset.x); });
  }

  function renderRead(){
    body.classList.add('bleed');
    // The view bar below is about to be rebuilt from scratch. Anything this render's
    // predecessor lodged in the top bar is now a stale twin of a control that is about
    // to exist again — and since .topbar precedes #frame in the document, it is the twin
    // that getElementById would hand back. Drop them first.
    const _tt = document.getElementById('topTools'); if(_tt) _tt.innerHTML = '';
    sortReadings();
    const active = readings[activeReading];
    frame.innerHTML = `<div class="head"><h1>Readings</h1></div>
      <div class="reader${drawerOpen ? ' drawer-open' : ''}">
        <aside class="drawer" id="readingDrawer">
          <button class="drawer-add" id="drawerAdd" title="Add chapter files from your computer. A whole folder at once lives in ⚙ Settings → Readings.">＋ Load readings</button>
          <div class="drawer-list" id="drawerList"></div>
        </aside>
        <div class="viewbar">
          <button class="vbtn vb-drawer${drawerOpen?' on':''}" id="drawerToggle"
            title="Show or hide the list of chapters." aria-expanded="${drawerOpen}">📖<span class="vb-word"> Chapters</span></button>
          <span class="vb-group" id="pageNav"></span>
          <span class="vb-spacer"></span>
          ${active && active.type === 'pdf' ? `<span class="vb-viewwrap" id="viewWrap">
            <button class="vbtn" id="viewBtn" aria-haspopup="true" aria-expanded="false" title="How the page is laid out — one page or two, continuous, and how large.">🔍<span class="vb-word"> View</span></button>
            <div class="vb-pop" id="viewPop" hidden>
              <div class="vb-pop-lbl">Pages</div>
              <span class="viewseg"><button class="vbtn ${readPageMode==='single'?'on':''}" data-vm="single" title="One page at a time. Click again to read two pages side by side — useful on a wide screen.">${readPageMode==='single' && readSpread===2 ? 'Two pages' : 'Single page'}</button><button class="vbtn ${readPageMode==='continuous'?'on':''}" data-vm="continuous">Continuous</button></span>
              <div class="vb-pop-lbl">Zoom</div>
              <select id="zoomSel" class="zoomsel">${ZOOMS.map(z=>`<option value="${z.v}" ${String(readZoom)===String(z.v)?'selected':''}>${z.t}</option>`).join('')}</select>
              <div class="vb-pop-lbl">Appearance</div>
              <button class="vbtn vb-theme" id="viewThemeBtn">◑ Modern</button>
            </div></span>` : ''}
          ${COARSE_POINTER ? `<button class="vbtn vb-capture${marqueeArmed?' on':''}" id="vbCapture" title="Tap, then drag a box around the passage you want to keep. Scrolling comes back as soon as the box is drawn.">${marqueeArmed ? '✕<span class="vb-word"> Cancel</span>' : '💬<span class="vb-word"> Mark passage</span>'}</button>` : ''}
          <button class="vbtn" id="romanoBtn" title="Ask Romano about this chapter." aria-label="Ask Romano">🥫</button>
          <button class="vbtn" id="notesToggle" title="Show or hide the notes pane. Highlighting keeps working either way.">${notesOpen ? '◧<span class="vb-word"> Hide notes</span>' : '◨<span class="vb-word"> Show notes</span>'}<span class="hl-count" id="hlCount"></span></button>
        </div>
        <div class="doc" id="docPane">${docBody(active)}</div>
        <aside class="notes">
          <h4>Your highlights</h4>
          <div class="notes-head" id="hlHead"></div>
          <div class="notes-scroll">
            <div id="hlList"></div>
            <div id="newnote"></div>
          </div>
          <div class="notes-foot" id="hlFoot"></div>
          <p class="locknote" style="margin-top:10px">Highlights save automatically · export to your Notebook →</p>
        </aside>
      </div>`;
    if(active && (active.type === 'pdf' || active.type === 'docx')) renderActiveDoc(active);
    const _cap = document.getElementById('vbCapture');
    if(_cap) _cap.onclick = () => setMarqueeArmed(!marqueeArmed);
    renderDrawer();
    const dt = document.getElementById('drawerToggle');
    if(dt) dt.onclick = () => setDrawerOpen(!drawerOpen);
    const vt = document.getElementById('viewThemeBtn');
    if(vt){ vt.onclick = toggleTheme; paintTheme(); }
    const da = document.getElementById('drawerAdd');
    if(da) da.onclick = () => document.getElementById('readInput').click();
    const rb = document.getElementById('romanoBtn');
    if(rb) rb.onclick = () => openRomanoChat('', readPageNum);
    // Closes on choosing an item and on a click anywhere else: a popover left open
    // over the page is worse than the two controls it replaced.
    const vBtn = document.getElementById('viewBtn'), vPop = document.getElementById('viewPop');
    if(vBtn && vPop){
      const setPop = open => { vPop.hidden = !open; vBtn.setAttribute('aria-expanded', String(open)); vBtn.classList.toggle('on', open); };
      vBtn.onclick = e => { e.stopPropagation(); setPop(vPop.hidden); };
      document.addEventListener('click', e => { const w = document.getElementById('viewWrap'); if(w && !w.contains(e.target)) setPop(false); });
    }
    frame.querySelectorAll('.vbtn[data-vm]').forEach(b => b.onclick = () => {
      // Already on single? The button cycles 1 ⇄ 2 pages. Otherwise it switches mode
      // and keeps whichever spread you last read in.
      if(b.dataset.vm === 'single' && readPageMode === 'single'){
        readSpread = readSpread === 2 ? 1 : 2; DB.readSpread = readSpread;
      } else { readPageMode = b.dataset.vm; DB.readPageMode = readPageMode; }
      saveDB(); renderRead();
    });
    const zs = document.getElementById('zoomSel');
    if(zs) zs.onchange = () => { readZoom = zs.value; DB.readZoom = readZoom; saveDB(); const rr = readings[activeReading]; if(rr) renderActiveDoc(rr); };
    applyNotesPane();
    const nt = document.getElementById('notesToggle');
    if(nt) nt.onclick = () => setNotesOpen(!notesOpen);
    _vbReach = null;         // the view bar above is a new element; forget the old answer
    renderHighlightList();   // calls syncNotesToggles, which labels both doors
    renderQAList();
    syncAiSurfaces();
    const dp = document.getElementById('docPane');
    if(dp){ trackDrag(dp); }
    watchPaneWidth(dp);
    layoutMarginNotes();
  }

  // ---------- Notebook — kept pages, seen two ways (by day · by piece) ----------
  const NOTE_MIN = 2026*12 + 6;  // July 2026 (open now for testing; term is Aug–Dec)
  const NOTE_MAX = 2026*12 + 11; // December 2026
  // Was hardcoded to July 2026, so the calendar opened on July whatever the date —
  // "today" could be selected on a month you were not looking at. Opens on the current
  // month now, clamped to the term so it cannot land outside the navigable range.
  const _thisMonth = () => {
    const n = new Date(); const k = n.getFullYear()*12 + n.getMonth();
    const c = Math.min(Math.max(k, NOTE_MIN), NOTE_MAX);
    return new Date(Math.floor(c/12), c%12, 1);
  };
  let noteView = _thisMonth();
  // Today, not null. The Notebook opened on "Pick a day" and made you find the current
  // date on a calendar before you could write a word -- and the overwhelmingly common
  // reason to open the Notebook is to write in it now. Todd, 2026-08-23. The empty day
  // is still worth landing on: the quick-write box is right there.
  // Today when today is in the term; otherwise the first day of the nearest term month,
  // so the selected day is always one you can actually see on the calendar.
  const _todayKey = () => {
    const d = new Date(), pad = n => String(n).padStart(2,'0');
    const k = d.getFullYear()*12 + d.getMonth();
    if(k < NOTE_MIN || k > NOTE_MAX){
      const c = Math.min(Math.max(k, NOTE_MIN), NOTE_MAX);
      return `${Math.floor(c/12)}-${pad((c%12)+1)}-01`;
    }
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  };
  let noteSel = _todayKey();   // selected calendar day (by-day lens)
  // Opens on My Progress, not the calendar. Todd, 2026-08-26: a student clicking
  // Notebook is asking "where do I stand", and the In-progress list — readings whose
  // passages are waiting to be reflected on — lives there. Landing on the month meant
  // the one thing they owed was two clicks away and unadvertised. By day, By piece and
  // Threads are all still one click from here; the calendar did not move.
  let noteMode = 'tags';       // 'day' | 'piece' | 'tags' | 'threads'
  let threadSel = null;        // the thread being looked at
  let cbSel = null;            // the recurring term being looked at, if any

  // ── THREADS: the notebook's analysis instrument.
  //
  // The eight turn-in tags are single-use labels — one baseline, one letter — and a tag
  // that can only be used once can never show a thread. A thread is the opposite: a name
  // the writer invents ("my grandmother", "fear of the blank page") and puts on as many
  // entries as it keeps turning up in.
  //
  // The point is juxtaposition, not classification. Held together and ordered by date, a
  // preoccupation becomes visible in a way it never is one entry at a time — and what
  // changed between the first and the last is the closest thing to evidence of growth
  // this notebook can produce.
  //
  // ⚠ THE APP NEVER INTERPRETS. It groups, it orders, it puts first next to last, and it
  // asks. It does not name themes, score depth, or tell a student what a thread means.
  // The retrieval is the machine's; the noticing is the writer's. Same rule as SeeSay.
  // ── "WHAT KEEPS COMING BACK" — candidates, never conclusions.
  //
  // Threads had a cold-start problem. A concordance answers "look up a word", but Todd's
  // objection killed it: "this presupposes that I see patterns, even though I'm looking
  // to the software to help me find patterns." A search box asks the writer to bring the
  // pattern, which is the thing they came here without.
  //
  // The line that holds is: THE APP CAN COUNT, BUT IT CANNOT MEAN. "grandmother appears
  // in six entries, September to November" is a checkable fact about the text with no
  // judgment in it. "Your theme is grief" is a claim, and that one stays the writer's.
  // Recurrence is not a theme; it is raw material for deciding whether something is one.
  //
  // Ranked by ENTRIES SPANNED, not by frequency: a word used forty times in one entry is
  // a mood, while a word used once in six entries across three months is a thread.
  //
  // ⚠ Known and accepted limits. It surfaces junk — names, course vocabulary, whatever
  // someone says often. It CANNOT see paraphrase: grandmother / grandma / her kitchen /
  // the house on Vine are one thread to a person and four unrelated tokens here. A
  // preoccupation worded differently every time is invisible to it. Those are the honest
  // edges of counting, and they are where a model would earn its place later — as a
  // suggestion the writer accepts or rejects, never as the app deciding quietly.
  const STOPWORDS = new Set(('a about after all also am an and any are as at be because been before being but by came can cant come could did didnt do does doesnt doing dont down each even for from get gets getting go goes going got had has have having he her here hers him his how i id if ill im in into is isnt it its ive just know like ll made make many maybe me might more most much my never no not now of off on once one only or other our out over really said same say says she should so some still such than that thats the their them then there these they thing things think this those though thought through time to too us very was wasnt way we well went were what when where which while who why will with would you your youre').split(' '));
  // Plurals only, and deliberately timid. "work" and "works" are one word to a reader and
  // two tokens to a counter, which is enough on its own to make a real thread invisible.
  // Anything more aggressive starts merging words that are not the same — this is a
  // suggestion list, so a missed match costs far less than a wrong one.
  function stem(w){
    if(w.length > 4 && /ies$/.test(w)) return w.slice(0, -3) + 'y';
    if(w.length > 4 && /s$/.test(w) && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
    return w;
  }
  function recurringTerms(minEntries){
    minEntries = minEntries || 3;
    // Kept AI exchanges are excluded: this panel claims to show what the STUDENT keeps
    // returning to, and feeding Romano's vocabulary in would put the model's
    // preoccupations into the student's threads under the student's name.
    const entries = (DB.journal || []).filter(e =>
      e.pieceKind !== 'conversation' && String(e.text || '').trim());
    if(entries.length < minEntries) return [];
    const seen = new Map();   // term -> Set of entry ids
    const note = (term, id) => { if(!seen.has(term)) seen.set(term, new Set()); seen.get(term).add(id); };
    for(const e of entries){
      const words = String(e.text).toLowerCase()
        .replace(/[’']/g, "'").replace(/[^a-z' ]+/g, ' ').split(/\s+/)
        .map(w => w.replace(/^'+|'+$/g, ''))
        .map(stem)
        .filter(w => w.length > 3 && !STOPWORDS.has(w));
      // Singles, and two-word phrases, which catch "the blank page" style repeats that
      // single words miss. Both keyed per entry, so repetition inside one entry counts once.
      const uniq = new Set(words);
      uniq.forEach(w => note(w, e.id));
      const seq = new Set();
      for(let i = 0; i < words.length - 1; i++) seq.add(words[i] + ' ' + words[i+1]);
      seq.forEach(p => note(p, e.id));
    }
    const dateOf = new Map(entries.map(e => [e.id, e.date]));
    const out = [];
    for(const [term, ids] of seen){
      if(ids.size < minEntries) continue;
      const ds = [...ids].map(i => dateOf.get(i)).sort();
      out.push({ term, n: ids.size, ids: [...ids], from: ds[0], to: ds[ds.length-1] });
    }
    // Prefer the PHRASE over its parts. "blank page" in four entries is a better candidate
    // than "blank" in four and "page" in four, which are the same recurrence listed three
    // times and read as noise. So a single word is dropped when some phrase containing it
    // recurs just as widely. A word that ALSO turns up well outside the phrase — "page" in
    // six entries against "blank page" in four — survives on its own, because it is
    // genuinely doing something the phrase does not.
    const phrases = out.filter(o => o.term.includes(' '));
    const covered = new Set();
    for(const p of phrases) for(const w of p.term.split(' ')){
      const single = out.find(o => o.term === w);
      if(single && single.n <= p.n) covered.add(w);
    }
    const kept = out.filter(o => o.term.includes(' ') || !covered.has(o.term));
    return kept.sort((a, b) => b.n - a.n || a.term.localeCompare(b.term)).slice(0, 40);
  }

  function threads(){ return (DB.threads = DB.threads || []); }
  function threadName(id){ const t = threads().find(x => x.id === id); return t ? t.name : ''; }
  function threadEntries(id){
    return (DB.journal || []).filter(e => (e.threads || []).includes(id))
      .sort((a,b) => String(a.date).localeCompare(String(b.date)) || String(a.ts).localeCompare(String(b.ts)));
  }
  function addThread(name){
    name = String(name || '').trim(); if(!name) return null;
    const hit = threads().find(t => t.name.toLowerCase() === name.toLowerCase());
    if(hit) return hit.id;
    const id = 't' + Date.now() + Math.round(Math.random() * 1e4);
    threads().push({ id, name }); saveDB(); return id;
  }
  function toggleThread(entryId, tid){
    const e = (DB.journal || []).find(x => x.id === entryId); if(!e) return;
    e.threads = e.threads || [];
    const i = e.threads.indexOf(tid);
    if(i >= 0) e.threads.splice(i, 1); else e.threads.push(tid);
    saveDB();
  }
  // Days between two entries. A gap is worth showing: picking something back up after
  // five weeks is a different act from writing about it twice in one week.
  function daysBetween(a, b){
    const d = (new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000;
    return Math.round(d);
  }
  let notePieceSel = null;     // selected piece (by-piece lens)
  let nbEditingId = null;      // entry being inline-edited

  // One dated page. Read-only, or inline-editable when nbEditingId matches.
  function entryCard(e, opts){
    opts = opts || {};
    const when = new Date(e.ts).toLocaleString(undefined, {month:'short', day:'numeric', hour:'numeric', minute:'2-digit'});
    if(nbEditingId === e.id){
      return `<div class="entryrow" data-entryrow="${e.id}"><div class="k">${escHtml(e.pieceTitle)} · ${when}</div>
        <textarea id="edit_${e.id}" class="entry-edit" data-autogrow="1">${escHtml(e.text)}</textarea>
        <div style="margin-top:6px;display:flex;gap:6px"><button class="btn sm" data-save="${e.id}">Save</button><button class="btn ghost sm" data-cancel="1">Cancel</button><button class="btn ghost sm" data-del="${e.id}">Delete</button></div></div>`;
    }
    const linkable = e.pieceId !== 'free' && journalByPiece(e.pieceId).length > 1;
    const head = (opts.showPiece === false) ? when
      : (linkable
          ? `<button class="entpiece" data-piecemode="${escHtml(e.pieceId)}" title="You have written about this more than once. See every pass under ${escHtml(e.pieceTitle)}, earliest first, and what changed between the first and the last — the question your thread reading asks in December.">${escHtml(e.pieceTitle)}</button> · ${when}`
          : `${escHtml(e.pieceTitle)} · ${when}`);
    const openLink = (opts.pieceLink !== false && e.pieceId !== 'free') ? `<button class="entlink" data-open="${e.pieceId}">Open the live piece →</button>` : '';
    // The text itself opens the editor. Requiring the Edit button meant three clicks
    // between keeping something and writing about it, which is the moment the whole
    // notebook exists for -- see the UI note in the changelog for 2026-08-23.
    const authorChip = e.author ? `<span class="who-chip ${e.authorKind === 'ai' ? 'ai' : 'me'}">${escHtml(e.author)}</span>` : '';
    // Tag and thread pickers moved into the header row, right-aligned beside the
    // delete control. They were two full-width rows under the page, so every entry
    // cost ~70px of vertical space to two controls most entries never use.
    return `<div class="entryrow" data-entryrow="${e.id}"><div class="k"><span class="k-head">${head}</span>${authorChip}<span class="k-tools">${tagBar(e)}${threadBar(e)}<button class="entdel" data-del="${e.id}" title="Delete this page" aria-label="Delete this page"><svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M6.5 1h3a.5.5 0 0 1 .5.5V2h3a.5.5 0 0 1 0 1h-.55l-.6 10.2a1.5 1.5 0 0 1-1.5 1.3H5.65a1.5 1.5 0 0 1-1.5-1.3L3.55 3H3a.5.5 0 0 1 0-1h3v-.5a.5.5 0 0 1 .5-.5Zm-1.95 2 .59 10.14a.5.5 0 0 0 .5.46h4.7a.5.5 0 0 0 .5-.46L11.45 3h-6.9ZM6.8 5a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0v-6a.5.5 0 0 1 .5-.5Zm2.4 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0v-6a.5.5 0 0 1 .5-.5Z"/></svg></button></span></div><div class="x writable" data-edit="${e.id}" title="Click to write on this page">${escHtml(e.text).replace(/\n/g,'<br>')}</div>
      <div class="entacts"><button class="entlink" data-edit="${e.id}">Edit</button>${openLink}</div></div>`;
  }

  // ── Tagging happens ON THE PAGE, not in a list.
  //
  // The first version was eight dropdowns, each listing every entry. Todd's read: it asks
  // you to recognise a page from a truncated snippet, and it puts the whole job in one
  // December sitting. Backwards. Standing on the entry you already know what it is, and
  // the menu is a fixed eight rather than a list that grows all term.
  //
  // DB.turnin stays slot → entryId, one source of truth, so a slot can only ever point at
  // one page. An ENTRY may hold more than one tag, deliberately: a currere gush is a
  // plausible thing to also want read closely. Claiming a slot another page holds MOVES
  // it, and says so, because silently having two baselines is worse than losing one.
  function tagsOn(id){ const T = turnin(); return TURNIN_SLOTS.filter(s => T[s[0]] === id).map(s => s[0]); }
  function slotLabel(k){ const s = TURNIN_SLOTS.find(x => x[0] === k); return s ? s[1] : k; }
  function threadBar(e){
    const mine = (e.threads || []);
    const chips = mine.map(id => `<span class="tagchip thr">${escHtml(threadName(id))}<button class="tagx" data-unthread="${id}" data-e="${e.id}" title="Take this entry off the thread">×</button></span>`).join('');
    const others = threads().filter(t => !mine.includes(t.id));
    return `<div class="tagbar thr">${chips}
      <select class="thradd" data-entry="${e.id}">
        <option value="">＋ Add to a thread…</option>
        ${others.map(t => `<option value="${t.id}">${escHtml(t.name)}</option>`).join('')}
        <option value="__new">＋ Start a new thread…</option>
      </select></div>`;
  }
  function tagBar(e){
    const T = turnin(), mine = tagsOn(e.id);
    const chips = mine.map(k => `<span class="tagchip">${escHtml(slotLabel(k))}<button class="tagx" data-untag="${k}" title="Remove this tag">×</button></span>`).join('');
    const opts = TURNIN_SLOTS.filter(s => T[s[0]] !== e.id).map(([k,label]) => {
      const held = T[k];
      return `<option value="${k}">${escHtml(label)}${held ? ' (move it here)' : ''}</option>`;
    }).join('');
    return `<div class="tagbar">${chips}
      ${opts ? `<select class="tagadd" data-entry="${e.id}"><option value="">＋ Tag this page…</option>${opts}</select>` : ''}
    </div>`;
  }

  function noteDayDetail(){
    if(!noteSel) return `<div class="notedetail"><h3>Pick a day</h3><p class="empty">Click a day to see the pages you kept that day. A green dot marks a day with a kept page.</p></div>`;
    const d = new Date(noteSel + 'T00:00:00');
    const label = d.toLocaleDateString(undefined, {weekday:'long', month:'long', day:'numeric'});
    const list = journalByDate(noteSel).sort((a,b)=>a.ts.localeCompare(b.ts));
    const entries = list.length ? list.map(e=>entryCard(e, {})).join('') : `<p class="empty">Nothing kept on this day. Whatever you write in any tab lands here on the day you keep it — a free-write, a currere gush, notes from a reading. Days you kept something carry a green dot on the calendar.</p>`;
    // What replaced the quick-write. Not a second writing box -- this view READS what
    // you kept -- but a day can now hold marked passages and no entry (the hollow dot),
    // and the one thing you might want standing here is to answer them. One button per
    // READING, same as the In-progress list, so a day of heavy marking is still short.
    // Readings MARKED on this day and not yet written about — from the marks, same
    // source as the In-progress list, so the two can never disagree.
    const pend = capturesByPiece().filter(g => !g.reflected && g.items.some(h => hlDayKey(h) === noteSel));
    const owed = pend.length ? `<div class="day-owed">
      ${pend.map(g => `<button class="pj-link" data-reflect="${escHtml(g.id)}">Write what you
        make of ${escHtml(String(g.title||'this reading').replace(/^Reading · /,''))} →</button>`).join('')}
    </div>` : '';
    return `<div class="notedetail"><h3>${label}</h3>${entries}${owed}
      <p class="runline" style="margin-top:14px">Writing happens in
        <button class="pj-link" data-jump="open">Freewrite/OPs →</button>, and lands here on the day
        you keep it.</p></div>`;
  }

  function notePieceDetail(){
    if(!notePieceSel) return `<div class="notedetail"><h3>Pick a piece</h3><p class="empty">Choose a piece on the left to watch it grow across the term — every pass you kept, earliest first.</p></div>`;
    const list = journalByPiece(notePieceSel);
    if(!list.length) return `<div class="notedetail"><h3>—</h3><p class="empty">Nothing kept from this piece yet. Each time you keep writing from it, that pass stacks here with its date, so you can read the versions in order and see what changed.</p></div>`;
    const title = list[0].pieceTitle;
    const openLink = list[0].pieceId !== 'free' ? `<button class="entlink" data-open="${list[0].pieceId}">Open the live piece →</button>` : '';
    return `<div class="notedetail"><h3>${escHtml(title)}</h3>
      <p class="runline" style="margin:0 0 12px">${list.length} kept pass${list.length>1?'es':''} · earliest first. ${openLink}</p>
      ${list.map(e=>entryCard(e, {showPiece:false, pieceLink:false})).join('')}</div>`;
  }

  // ── PDF export. Both exports print through the browser rather than a PDF library:
  //    this app has no build step and ships no CDN calls, "Save as PDF" is in every
  //    print dialog, and it honours the student's paper size. The print host is built
  //    on demand and removed once printing ends.
  function printDoc(id, html, title){
    const host = document.createElement('div');
    host.id = id; host.className = 'printdoc';
    host.innerHTML = html;
    document.body.appendChild(host);
    document.body.classList.add('printing');
    // Print dialogs seed the "Save as PDF" filename from document.title, so a student
    // gets "One-Pager 2 …" instead of whatever the tab happens to be called.
    const prevTitle = document.title;
    if(title) document.title = title;
    const done = () => { document.body.classList.remove('printing'); document.title = prevTitle;
      host.remove(); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    // Safari/older engines don't always fire afterprint; don't strand the app in
    // print mode if it never arrives.
    setTimeout(() => { if(document.getElementById(id)) done(); }, 60000);
    window.print();
  }

  // ── THE TURN-IN DECLARATION.
  //
  // The rubric has four rows and the bundle now prints four parts in that order, so the
  // notebook is graded straight down the page with no hunting. Three of those rows need
  // the student to say WHICH entries they mean, and that declaration cannot be derived:
  // the assignment lets a notebook be kept on paper, a paper notebook carries no
  // metadata, and both formats must turn in the same artifact. So a person declares it,
  // in Journaler or with a pen, and the app only makes it easy and typo-proof.
  //
  // pieceKind cannot stand in for this. It holds four values (freewrite, currere,
  // reading, one-pager) and can distinguish two of the five required components at best.
  // The Week 1 baseline is just another freewrite; the topic map never touches the app.
  const TURNIN_SLOTS = [
    ['baseline',  'Week 1 baseline', 'The “why do we write?” free-write from the first day'],
    ['currere',   'Currere work',    'A gush, brainstorm or storyboard note from Act II'],
    ['topicmap',  'Topic map',       'Your research topic map'],
    ['sources',   'Source notes',    'Notes on a source you gathered'],
    ['letter',    'Look-Back Letter','Your letter to the writer who answered on day one'],
    ['flag1',     'Flagged entry 1', 'Read closely — one from Act I'],
    ['flag2',     'Flagged entry 2', 'Read closely — one from Act II'],
    ['flag3',     'Flagged entry 3', 'Read closely — one from Act III'],
  ];
  function turnin(){ return (DB.turnin = DB.turnin || {}); }

  // ── READINESS INCLUDES THE ANALYSIS.
  //
  // Todd: "I don't think anything should be identified as ready to turn in until analysis
  // is completed." Right — eight tags is filing, not thinking, and a green tick over a
  // notebook with no reading of it would be the interface telling a comfortable lie.
  //
  // The bar is one KEPT reflection on a thread that has enough entries to be a thread at
  // all. Kept, not drafted: an unsaved textarea is a good intention. Three entries,
  // because two entries are the first and the last with nothing in between to have
  // changed.
  const THREAD_MIN = 3;
  function analysisDone(){
    return (DB.journal || []).some(e => e.pieceKind === 'reflection' && (e.threads || []).length
      && threadEntries(e.threads[0]).length >= THREAD_MIN);
  }
  // Everything that must be true before the report is worth sending. Eight tags, then the
  // reading of a thread — in that order, because you cannot analyse what you have not kept.
  // ── WHAT THE PROJECT IS, said inside the app.
  //
  // Todd: "when students have writings for all X tags, are they done with the project?
  // Or is that just a part of the project? What is the project? lol" -- and he is the
  // one who wrote it. If the author has to ask, a student has no chance.
  //
  // The four scored rows lived ONLY on the printed bundle cover, so nobody met them
  // until the thing was already finished. Worse, the checklist reads "n of 9", which
  // invites exactly the wrong conclusion: nine of nine is rows 2, 3 and 4 -- thirty of
  // the fifty points. The other twenty are Row 1, kept practice, which no tag can fill
  // and which is the single biggest row on the sheet.
  //
  // Every number here is COUNTED, never typed [[measured-not-typed]]: a student who has
  // kept eleven pages should see eleven, not an estimate of where they ought to be.
  const NB_TOTAL = 50;
  // ⚠ THE ONE PLACE THESE NUMBERS LIVE, and they are the HANDOUT'S, not ours. Checked
  //   against "Writers Notebook Guidelines.docx" (tce284-fa26/writers-notebook) on
  //   23 Aug 2026 and read "25 to 40" there. THAT ANSWER IS OUT OF DATE. The published
  //   handout was rewritten to "Expect 20 or more entries by December — typically one
  //   per class meeting", and the course home now matches. 20 is the settled figure;
  //   the only copies still saying 25 to 40 are the retired dev archive. Todd,
  //   2026-08-26: "folks will FREAK if they see 40 notebook entries."
  //   Verify against tce284-fa26/writers-notebook, never against fall-2026.
  //   If the handout changes, change it HERE -- the panel, the row-1 tick and the
  //   banding all read from this.
  const ENTRIES_BANDS = { full: 20, partial: 12, high: 32, by: 'December' };
  // ── CHOOSE FROM WHAT YOU ACTUALLY WROTE.
  //
  // Todd: "Since there are multiple gushes ... Maybe the tags tab could have linked list
  // of those with instructions to 'choose from these gushes.'"
  //
  // Right, and better than a link. The currere slot holds ONE entry but the docx says
  // "currere gushes and brainstorms" -- plural -- so the student has several and has to
  // pick. Sending them to a page does not help with picking. Listing the entries they
  // already kept does, and clicking one tags it on the spot.
  //
  // Every kept entry carries its pieceId, so the app can enumerate candidates without
  // storing anything new.
  const SLOT_CANDIDATES = {
    baseline: e => e.pieceId === 'baseline' || e.pieceKind === 'freewrite',
    currere:  e => e.pieceKind === 'currere',
    topicmap: e => e.pieceId === 'topicmap',
    sources:  e => e.pieceId === 'sources',
    letter:   e => e.pieceId === 'letter',
  };
  // Where to go when there is nothing to choose from yet.
  const SLOT_MAKE = { baseline:'baseline', currere:'cur-reg', topicmap:'topicmap',
                      sources:'sources', letter:'letter' };

  function slotPicker(slot, jump){
    const T = turnin(), ord = numberedEntries();
    const numOf = new Map(ord.map((e, i) => [e.id, i + 1]));
    const tagged = T[slot] && ord.find(e => e.id === T[slot]);
    const cands = ord.filter(SLOT_CANDIDATES[slot] || (() => false));
    if(tagged){
      return `<span class="pj-has">✓ entry ${numOf.get(tagged.id)} · ${escHtml(shortDate(tagged.date))}</span>`
        + `<button class="pj-link" data-untagpick="${slot}">change</button>`;
    }
    if(!cands.length) return `<span class="pj-none">none kept yet</span> ${jump('write one →', SLOT_MAKE[slot])}`;
    // Newest last, capped: a term of currere passes should not become a wall of chips.
    const show = cands.slice(-5);
    return `<span class="pj-choose">choose from these:</span> `
      + show.map(e => `<button class="pj-chip" data-tagpick="${slot}" data-tagent="${e.id}"
           title="${escHtml(entryLabel(e, 80))}">${numOf.get(e.id)} · ${escHtml(shortDate(e.date))}</button>`).join(' ')
      + (cands.length > show.length ? `<span class="pj-more">+${cands.length - show.length} older</span>` : '');
  }

  // ── WHAT THE APP IS HOLDING THAT IS NOT AN ENTRY YET.
  //
  // Todd: "I prefer completing the notebook as we go along, with the app collecting
  // artifacts that students have the option to write about, and as they do, parts of the
  // notebook get checked off."
  //
  // Two of those three already happened. Collection is automatic -- every surface in this
  // app writes to DB on each keystroke -- and checking off is automatic since keeping a
  // required page tags it. What was missing is that the collected work was INVISIBLE. The
  // deliberate rule above ("nothing is auto-logged") is kept: the app still never files
  // anything for a student. It just stops letting them lose twenty points by forgetting.
  //
  // The hazard this closes is real and silent: a student who writes in the Open page every
  // session and never presses the button has zero entries, and Row 1 -- kept practice,
  // 20 points -- scores what it sees.
  //
  // ⚠ One-Pager gushes are deliberately absent. Guidelines §2: they go in on sheet two of
  //   their own PDF, and nothing gets counted twice.
  function draftSources(){
    const out = [{ id:'free', kind:'freewrite', title:'Free-writes & quick-writes',
                   label:'Open page', text:((DB.freewrite||{}).open||{}).text }];
    for(const k in NAMED) out.push({ id:k, kind:'freewrite', title:NAMED[k].t, slot:NAMED[k].slot,
                                     label:NAMED[k].t, text:((DB.freewrite||{})[k]||{}).text });
    const cur = DB.currere || {};
    out.push({ id:'cur-reg', kind:'currere', title:MO.reg.k+' · '+MO.reg.t, label:MO.reg.k, text:cur.reg });
    out.push({ id:'cur-pro', kind:'currere', title:MO.pro.k+' · '+MO.pro.t, label:MO.pro.k, text:cur.pro });
    out.push({ id:'cur-ana', kind:'currere', title:MO.ana.k+' · '+MO.ana.t, label:MO.ana.k, text:cur.ana });
    out.push({ id:'cur-syn', kind:'currere', title:'Moment 4 · Synthetical', label:MO.syn.k, text:cur.syn });
    return out;
  }

  // "Waiting" means: there is text, and no entry from this piece already holds exactly it.
  // Comparing TEXT rather than mere existence is what makes a second pass show up again --
  // which is the behaviour the manual already promises ("open the same piece weeks later,
  // write more, and add to notebook again. Both passes stay").
  function waitingDrafts(){
    const byPiece = {};
    for(const e of (DB.journal || [])) (byPiece[e.pieceId] = byPiece[e.pieceId] || []).push(String(e.text||'').trim());
    return draftSources().filter(d => {
      const t = String(d.text || '').trim();
      if(t.length < 20) return false;                    // a stray keystroke is not an artifact
      return !(byPiece[d.id] || []).includes(t);
    }).map(d => Object.assign({}, d, { words: wordCount(d.text), kept: (byPiece[d.id] || []).length }));
  }

  function draftTray(){
    const w = waitingDrafts();
    if(!w.length) return '';
    return `<div class="tray">
      <p class="tray-head"><strong>Not in your notebook yet</strong>
        <em>${w.length} piece${w.length === 1 ? '' : 's'} you have written that ${w.length === 1 ? 'is' : 'are'} not counted until you keep ${w.length === 1 ? 'it' : 'them'}.</em></p>
      ${w.map(d => `<div class="tray-row">
        <span class="tray-what">${escHtml(d.label)}${d.kept ? ` <em>· new writing since you last kept this</em>` : ''}</span>
        <span class="tray-n">${d.words} word${d.words === 1 ? '' : 's'}</span>
        <button class="btn ghost sm" data-keepdraft="${escHtml(d.id)}">Keep →</button>
        <button class="tray-open" data-jump="${escHtml(d.id === 'free' ? 'open' : d.id)}">open</button>
      </div>`).join('')}
    </div>`;
  }

  function wireTray(){
    frame.querySelectorAll('[data-keepdraft]').forEach(b => b.onclick = () => {
      const d = draftSources().find(x => x.id === b.dataset.keepdraft);
      if(!d) return;
      const entry = elevate(d.id, d.kind, d.title, d.text);
      if(!entry) return;
      // A required page tags itself here exactly as it does on the page itself.
      if(d.slot){ turnin()[d.slot] = entry.id; saveDB(); toast(`Kept, and tagged ${slotLabel(d.slot)}`); }
      renderNote();
    });
  }

  // The assignment, on demand. It is orientation: needed once, re-read occasionally, and
  // in the way every other time -- which is what it was doing sitting above the progress
  // rows with a points column repeating on every line.
  const GUIDELINES_URL = 'https://ohiomathteacher.github.io/tce284-fa26/writers-notebook/Writers%20Notebook%20Guidelines.docx';
  function aboutProjectHTML(){
    return `<div class="about-proj" id="aboutProj">
      <p class="ap-h">The Writer's Notebook — ${NB_TOTAL} points</p>
      <p>You turn in a <strong>report</strong>, not the whole notebook: the pages you choose, and
        what you made of them. A <strong>marked</strong> page is printed in full. Everything else
        is counted but not read — one line each in the Contents.</p>
      <p><strong>What counts as an entry:</strong> a free-write, a currere gush, your reading of
        a thread, an answer to a required-entry page — anything <em>you</em> wrote and kept. What
        does not count on its own is a passage marked in a reading: marking keeps it and cites it,
        and My Progress lists the readings waiting for you to say what you make of them.</p>
      <p>Anything you write is fair game to bring in here and rethink, expand or rewrite. What
        does <em>not</em> belong is a finished draft that already lives somewhere else — your
        timed One-Pager gushes go in on sheet two of their own PDF, and nothing gets counted
        twice.</p>
      <p><strong>Most of these mark themselves.</strong> The four required entries have their own
        pages under <em>Freewrite/OPs → For the notebook</em>: write one, keep it, and it is marked in
        the same action. Your Look-Back Letter too. The only thing left for December is flagging
        the three entries you want read closely.</p>
      <table class="ap-rows">
        <tr><td>1 · Kept practice</td><td>20</td><td>Every entry you keep — an entry is writing
          <em>you</em> did. A passage marked in a reading is kept and cited, and becomes an entry
          when you write what you make of it. Nothing to mark.</td></tr>
        <tr><td>2 · Required entries</td><td>5</td><td>Baseline · Currere · Topic map · Source notes</td></tr>
        <tr><td>3 · Look-Back Letter</td><td>10</td><td>Written in the last class, to your Week 1 answer.</td></tr>
        <tr><td>4 · Thinking on the page</td><td>15</td><td>Your 3 flagged entries, and your reading of a thread.</td></tr>
      </table>
      <p class="ap-warn">Filling all nine boxes earns rows 2–4 — <strong>30 of the ${NB_TOTAL}
        points</strong>. The other 20 are Row 1, and they come from how much you actually kept,
        which no mark can fill in.</p>
      <p><a href="${GUIDELINES_URL}" target="_blank" rel="noopener">Read the full assignment
        (Writer's Notebook Guidelines) →</a></p>
      <p><button class="btn ghost sm" id="apClose">Close</button></p>
    </div>`;
  }

  const SLOT_RUBRIC = {
    baseline: { row:'Required entries', pts:5,
      full:'“All four present: the Week 1 baseline, currere gushes and brainstorms, the topic map, and source notes.”',
      part:'“One missing.”', none:'“Two or more missing.”',
      note:'Graded on presence only — “a required entry that is present but thin is never counted against you twice.” You also write back to this one in Week 15.' },
    topicmap: { row:'Required entries', pts:5,
      full:'“All four present: the Week 1 baseline, currere gushes and brainstorms, the topic map, and source notes.”',
      part:'“One missing.”', none:'“Two or more missing.”',
      note:'Graded on presence only. Not an outline — the whole spread of what your topic touches.' },
    sources: { row:'Required entries', pts:5,
      full:'“All four present: the Week 1 baseline, currere gushes and brainstorms, the topic map, and source notes.”',
      part:'“One missing.”', none:'“Two or more missing.”',
      note:'Graded on presence only. Notes on a source you gathered.' },
    currere: { row:'Required entries', pts:5,
      full:'“All four present: the Week 1 baseline, currere gushes and brainstorms, the topic map, and source notes.”',
      part:'“One missing.”', none:'“Two or more missing.”',
      note:'Keep every moment you write — mark one as the required entry. Moment 3 counts too.' },
    letter: { row:'Look-Back Letter', pts:10,
      full:'“Written in our last class, to the writer who answered why do we write? on day one.”',
      part:'“Present but perfunctory.”', none:'“Missing.”',
      note:'Written in the last class, Wednesday 2 December, so the notebook is complete the day it is handed in.' },
  };
  function assignmentNote(slot, id){
    const r = SLOT_RUBRIC[slot]; if(!r) return '';
    return `<div class="asn" style="max-width:var(--writecol);margin:12px auto 0">
      <button class="pj-about" id="${id}">How this is graded →</button>
      <div class="about-proj" id="${id}Body" style="display:none">
        <p class="ap-h">${escHtml(r.row)} — ${r.pts} points</p>
        <table class="ap-rows">
          <tr><td>Full marks</td><td></td><td>${r.full}</td></tr>
          <tr><td>Partial</td><td></td><td>${r.part}</td></tr>
          <tr><td>None</td><td></td><td>${r.none}</td></tr>
        </table>
        <p>${r.note}</p>
        <p><a href="${GUIDELINES_URL}" target="_blank" rel="noopener">Read the full assignment →</a></p>
      </div></div>`;
  }
  function wireAssignmentNote(id){
    const b = document.getElementById(id), body = document.getElementById(id + 'Body');
    if(!b || !body) return;
    b.onclick = () => { const on = body.style.display !== 'none';
      body.style.display = on ? 'none' : 'block'; b.textContent = on ? 'How this is graded →' : 'Hide'; };
  }

  function threadsAbout(){
    const ok = analysisDone();
    return `<div class="project">
      <p class="pj-txt">Threads${ok ? ' <span class="pj-has">✓ your reading is kept</span>' : ''}
        <button class="pj-about" id="thAboutBtn">How this is graded →</button></p>
      <p class="runline">A <strong>thread</strong> is anything that keeps coming back — your
        grandmother, the blank page, a room you keep describing, a question you cannot leave
        alone. Name it, and put that name on every entry it turns up in: three entries, ten,
        however many it takes.</p>
      <p class="runline"><strong>Before you turn the notebook in, pick one thread and write your
        reading of it.</strong> Two questions: <em>what runs through these?</em> and <em>what is
        in the last one that is not in the first?</em> That second one is the whole reason the
        dates matter. It is not a summary of what you wrote — it is what you now see that you
        could not see while writing any single entry.</p>
      <div class="about-proj" id="thAbout">
        <p class="ap-h">Thinking on the page — 15 points</p>
        <p>Scored from your three flagged entries <em>and</em> this reading. Straight from the
          assignment:</p>
        <table class="ap-rows">
          <tr><td>Full marks</td><td></td><td>“the thinking moves. Entries turn — you arrive
            somewhere you were not heading. Your reading names something real that changed
            between the first entry and the last, and points at the evidence.”</td></tr>
          <tr><td>Partial</td><td></td><td>“Real thinking is visible… the thread reading sees
            something, even if it stays general.”</td></tr>
          <tr><td>None</td><td></td><td>“The entries report rather than think… <strong>No thread
            reading</strong>, or one that only lists what the entries were about.”</td></tr>
        </table>
        <p class="ap-warn">It is also Part 5 of what you hand in: your threads, and your reading
          of one. Without it the notebook is not finished, whatever else is tagged.</p>
        <p><a href="${GUIDELINES_URL}" target="_blank" rel="noopener">Read the full assignment →</a></p>
      </div>
    </div>`;
  }

  function pendingPanel(){
    const pend = capturesByPiece().filter(g => !g.reflected);
    if(!pend.length) return '';
    const rows = pend.map(g => `<div class="pend-row">
        <div class="pend-name">${escHtml(String(g.title||'').replace(/^Reading · /,''))}
          <span class="pend-n">${g.items.length} passage${g.items.length===1?'':'s'} marked</span></div>
        <button class="pj-link pend-go" data-reflect="${escHtml(g.id)}">Write what you make of it →</button>
      </div>`).join('');
    return `<div class="pending">
      <p class="pend-h">In progress — ${pend.length} reading${pend.length===1?'':'s'} waiting on you</p>
      <p class="runline">Marking a passage keeps it and cites it, but it is <strong>not an entry
        yet</strong>. An entry is what <em>you</em> write. Say what you make of these and it counts
        toward Kept practice — you can come back to the same reading later and write again.</p>
      ${rows}</div>`;
  }
  function projectPanel(){
    const ord   = numberedEntries();
    const T     = turnin();
    const days  = new Set(ord.map(e => e.date)).size;
    const words = ord.reduce((n, e) => n + wordsIn(e), 0);
    const req   = ['baseline','currere','topicmap','sources'].filter(k => T[k]).length;
    const letter= T['letter'] ? 1 : 0;
    const flags = ['flag1','flag2','flag3'].filter(k => T[k]).length;
    const ana   = analysisDone() ? 1 : 0;
    const tagged = req + letter + flags + ana;

    // Todd: "would be nice to link back to pages that have submit to notebook buttons."
    // Every named thing in this table is now a way to get to the page that makes it --
    // which is the whole point: a row that names work you cannot reach from it is the
    // disconnection all over again.
    const jump = (label, to) => `<button class="pj-link" data-jump="${to}">${label}</button>`;
    const row = (n, name, pts, feeds, state, ok) => `
      <tr class="${ok ? 'pj-ok' : ''}">
        <td class="pj-name">${name}</td>
        <td class="pj-state">${state}</td>
      </tr>`;

    // The rubric bands, not a vague target: a student at 19 should know they are inside
    // the partial band and what closes it, rather than reading "expect 25-40" and
    // guessing. Spread matters as much as count -- "Twenty-eight entries dated in
    // November is not a practice" -- so the days are shown beside the total.
    const band = ord.length >= ENTRIES_BANDS.full
      ? `${ENTRIES_BANDS.full}+ entries — full marks for this row, if they are spread across the term`
      : ord.length >= ENTRIES_BANDS.partial
        ? `partial band (${ENTRIES_BANDS.partial}–${ENTRIES_BANDS.full - 1}) — ${ENTRIES_BANDS.full - ord.length} more reaches full marks`
        : `under ${ENTRIES_BANDS.partial} scores nothing for this row — ${ENTRIES_BANDS.partial - ord.length} more reaches the partial band`;
    const kept = ord.length
      ? `<strong>${ord.length}</strong> ${ord.length === 1 ? 'entry' : 'entries'} ·
         ${days} day${days === 1 ? '' : 's'} · ${words.toLocaleString()} words`
      : `nothing kept yet — ${jump('start with Why do we write? →','baseline')}`;

    return `<div class="project">
      <!-- No title. The lens above it is called My Progress and the head says what it
           is for; a third "My progress" here was the same words a third time. The
           About link keeps its place at the right of the row. -->
      <p class="pj-txt"><button class="pj-about" id="pjAbout">About this project →</button></p>
      ${pendingPanel()}
      <table class="pjtable">
        ${row(1, 'Kept practice', 20, `<strong>An entry is writing you did.</strong> Passages you
              mark in a reading are kept and cited, but they become an entry when you write what you
              make of them. Nothing to tag. ${jump('Open page →','open')}`,
              kept + `<br><span class="pj-aim">${band}</span>`,
              ord.length >= ENTRIES_BANDS.full)}
        ${row(2, 'Required entries', 5, 'Keeping one of these tags it. Or choose from what you already kept.',
              ['baseline','currere','topicmap','sources'].map(k =>
                `<div class="pj-slot"><span class="pj-slot-n">${escHtml(slotLabel(k))}</span>${slotPicker(k, jump)}</div>`).join(''),
              req === 4)}
        ${row(3, 'Look-Back Letter', 10, 'Written in the last class, to your Week 1 answer.',
              `<div class="pj-slot">${slotPicker('letter', jump)}</div>`, !!letter)}
        ${row(4, 'Thinking on the page', 15, `Flag 3 kept entries — one per act — and write your reading of a thread. ${jump('Threads →','threads')}`,
              `${flags} of 3 flagged · reading ${ana ? 'kept' : 'not written'}`, flags === 3 && ana)}
      </table>
      ${aboutProjectHTML()}</div>`;
  }

  function readiness(){
    const T = turnin();
    const checks = TURNIN_SLOTS.map(([k, label]) => ({ k, label, ok: !!T[k] }));
    checks.push({ k: 'analysis', label: 'Your reading of a thread', ok: analysisDone() });
    // ⚠ TAGGING IS NOT A NOTEBOOK (Todd, 2026-08-26): "I don't think 3 entries created
    // in 5 minutes should allow me to submit the entire notebook!" Filling all eight
    // columns proved nothing about the practice, because an entry may hold several tags
    // by design -- three entries could claim all eight and read as finished.
    //
    // Two checks close it. A floor on the count, set at the band below which Kept
    // practice scores nothing at all, so "ready" can never mean an empty row 1. And the
    // three close-reading flags must sit on three DIFFERENT entries: they are meant to
    // be one per act, and one page wearing all three stars is not that.
    const n = numberedEntries().length;
    checks.push({ k: 'count',
      label: `At least ${ENTRIES_BANDS.partial} entries — you have ${n}`,
      ok: n >= ENTRIES_BANDS.partial });
    const starred = ['flag1','flag2','flag3'].map(k => T[k]).filter(Boolean);
    checks.push({ k: 'distinct', label: 'Three different entries flagged, one per act',
      ok: starred.length === 3 && new Set(starred).size === 3 });
    return { checks, done: checks.filter(c => c.ok).length, all: checks.length };
  }
  // Column heads for the Tags grid. Eight full labels would make the table wider than the
  // screen; the full name rides in the title attribute and the tooltip.
  const TAG_ABBR = { baseline:'Base', currere:'Curr', topicmap:'Map', sources:'Src',
                     letter:'Letter', flag1:'★1', flag2:'★2', flag3:'★3' };

  // ── Naming an entry so a person can recognise it.
  //
  // pieceTitle is a BUCKET, not a name: every free-write in the term carries the single
  // title "Free-writes & quick-writes". A list built from it reads "1 · Jul 29 ·
  // Free-writes", "2 · Jul 29 · Free-writes", "3 · Jul 30 · Free-writes" — thirty
  // identical lines, and no way to pick the right one. The only thing that tells two
  // free-writes apart is what they say, so the label is the entry's own opening words.
  // Currere and reading entries DO have real titles, so those keep theirs in front.
  const NB_BUCKET = /^Free-writes/;
  function entrySnippet(e, max){
    const t = String(e && e.text || '').replace(/\s+/g, ' ').trim();
    if(!t) return '(empty)';
    return t.length > max ? t.slice(0, max).replace(/\s+\S*$/, '') + '…' : t;
  }
  // Printed beside every line of the Contents. The complete notebook is not submitted, so
  // this is the only evidence of how much writing actually happened: thirty entries of
  // eleven words each has to be visible without printing thirty entries.
  function wordsIn(e){ return (String(e && e.text || '').match(/\S+/g) || []).length; }
  function entryLabel(e, max){
    const title = String(e && e.pieceTitle || '').trim();
    const snip = entrySnippet(e, max);
    return (title && !NB_BUCKET.test(title)) ? `${title} · ${snip}` : snip;
  }
  // Entries in one chronological order, numbered once. Entry 17 is entry 17 in the
  // Contents, in every part of the bundle, and in what the student writes on the cover.
  // ⚠ A CAPTURED PASSAGE IS NOT AN ENTRY (Todd, 2026-08-26).
  //
  // Keeping a highlight files Romano's words, a citation, and possibly a one-line
  // note. Counted as an entry, that let a student reach the 20 -- full marks on the
  // 20-point kept-practice row -- without writing a sentence, and their quoted words
  // inflated the word total on top of it. Todd: "otherwise, we'll just get a bunch of
  // highlights with minimal reflection."
  //
  // So a capture is MATERIAL attached to the reading's piece, never an entry. The
  // entry is the reflection the student writes ON that material, and a reading can
  // carry several across the term -- returning to ch5 in Week 10 is a second, later
  // entry, not a blocked one.
  //
  // elevateHighlight was the ONLY producer of pieceKind 'reading' before today, so an
  // entry with no .reflection flag is a capture whenever it came from.
  function isCapture(e){ return !!e && e.pieceKind === 'reading' && !e.reflection; }
  // A highlight's day, in the same local form the calendar builds its cell keys with.
  function hlDayKey(h){
    const d = new Date(h && h.ts ? h.ts : Date.now());
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function capturesByPiece(){
    const out = [];
    for(const r of (readings || [])){
      const items = getHighlights(r.id);
      if(!items.length) continue;
      const pieceId = 'reading:' + r.id;
      // Reflected = the reader has written on this reading at least once. Written
      // again later is a second entry, not a blocked one, so this only decides
      // whether the reading still appears as owed.
      const reflected = (DB.journal || []).filter(e => e.pieceId === pieceId && e.reflection).length;
      out.push({ id: pieceId, rid: r.id, title: 'Reading · ' + readingLabel(r), items, reflected });
    }
    return out;
  }
  function numberedEntries(){
    // 'conversation' entries are kept AI exchanges. They are welcome in the notebook
    // -- the Guidelines invite "anything else you want to keep" -- but they are NOT
    // the student's practice, and this list is what the grade is counted from:
    // "Expect 20 or more entries by December", Contents carries "every entry, numbered,
    // dated, with its word count", and "Nothing gets counted twice". So they are
    // excluded from numbering, from Contents, and from the word count, and are
    // printed separately under their own heading instead.
    return (DB.journal || []).filter(e => e.pieceKind !== 'conversation' && !isCapture(e)).slice().sort((a,b) =>
      String(a.date).localeCompare(String(b.date)) || String(a.ts).localeCompare(String(b.ts)));
  }

  // ── Bundle notebook → PDF. The 50-pt Writer's Notebook turn-in artifact.
  //    The bundle follows the lens you're in — By day shows kept practice in date
  //    order (what the notebook is graded on), By piece shows each piece growing.
  function bundleNotebookPDF(){
    const entries = (DB.journal || []).slice();
    if(!entries.length){ toast('Nothing kept yet — add a page to your notebook first.'); return; }
    ensureName();
    const fmtDate = k => { const [y,m,d] = String(k).split('-').map(Number);
      return new Date(y, (m||1)-1, d||1).toLocaleDateString(undefined, {weekday:'long', month:'long', day:'numeric', year:'numeric'}); };
    const para = t => String(t||'').split(/\n{2,}/).map(p => `<p>${escHtml(p).replace(/\n/g,'<br>')}</p>`).join('');

    // ── ENTRY NUMBERS + CONTENTS.
    //
    // The notebook is graded on kept practice and on three entries the student flags, so
    // both the reader and the writer need to be able to say "entry 17" and land in the
    // same place. Page numbers cannot do that: a browser paginates by paper size, and a
    // student who keeps a paper notebook has different pages anyway. The assignment
    // requires the SAME format from both, so the unit has to be one the paper notebook
    // can reproduce with a pen. A number per entry can.
    //
    // Numbered in one chronological pass BEFORE the lens is applied, so entry 17 is entry
    // 17 whether the bundle was printed By day or By piece.
    const ordered = numberedEntries();
    const numOf = new Map();
    ordered.forEach((e, i) => numOf.set(e, i + 1));
    const nOf = e => numOf.get(e) || 0;
    const byId = new Map(ordered.map(e => [e.id, e]));
    const T = turnin();
    const slotEntry = k => byId.get(T[k]);
    // One entry, printed whole, labelled with what it is answering.
    const full = (e, label) => e ? `
      <article class="pb-full">
        <h3><span class="pb-n">${nOf(e)}</span>${escHtml(entryLabel(e, 60))} <span class="pb-when">${escHtml(fmtDate(e.date))}</span></h3>
        ${label ? `<p class="pb-role">${escHtml(label)}</p>` : ''}
        ${para(e.text)}
      </article>` : '';
    const notChosen = label => `
      <article class="pb-full pb-missing"><h3>${escHtml(label)}</h3>
        <p class="pb-role">Not identified. Write the entry number here: ____</p></article>`;

    const contents = `
      <section class="pb-contents">
        <ol class="pb-toc">
          ${ordered.map(e => `<li><span class="pb-n">${nOf(e)}</span><span class="pb-d">${escHtml(fmtDate(e.date))}</span><span class="pb-w">${wordsIn(e)}w</span><span class="pb-t">${escHtml(entryLabel(e, 68))}</span></li>`).join('')}
        </ol>
      </section>`;

    let sections = '';
    if(noteMode === 'day'){
      const byDate = {};
      for(const e of entries) (byDate[e.date] = byDate[e.date] || []).push(e);
      sections = Object.keys(byDate).sort().map(k => `
        <section class="pb-day">
          <h2>${escHtml(fmtDate(k))}</h2>
          ${byDate[k].sort((a,b)=>a.ts.localeCompare(b.ts)).map(e => `
            <article><h3><span class="pb-n">${nOf(e)}</span>${escHtml(e.pieceTitle||'')}</h3>${para(e.text)}</article>`).join('')}
        </section>`).join('');
    } else {
      sections = journalPieces().map(p => `
        <section class="pb-piece">
          <h2>${escHtml(p.title)}</h2>
          <p class="pb-sub">${p.entries.length} kept pass${p.entries.length>1?'es':''} · earliest first</p>
          ${p.entries.slice().sort((a,b)=>a.ts.localeCompare(b.ts)).map(e => `
            <article><h3><span class="pb-n">${nOf(e)}</span>${escHtml(fmtDate(e.date))}</h3>${para(e.text)}</article>`).join('')}
        </section>`).join('');
    }

    const dates = entries.map(e => e.date).sort();
    const kinds = {};
    for(const e of entries) kinds[e.pieceKind] = (kinds[e.pieceKind]||0) + 1;
    const tally = Object.keys(kinds).sort().map(k => `${escHtml(k)}: ${kinds[k]}`).join(' · ');

    // ── THE BUNDLE IS THE RUBRIC, IN ORDER.
    //
    // Sheet one is a grading sheet: the four rubric rows down the page, each with the
    // evidence for it already gathered and a blank for the score. Then the parts arrive
    // in that same order, so nothing is hunted for. Required entries, the letter and the
    // three flagged entries are REPRINTED in their own parts and appear again in the
    // complete notebook — eight duplicated entries out of thirty is a cheap price for
    // never searching. Each reprint says which entry number it is, so the two are
    // obviously the same page rather than two versions of it.
    const ref = k => { const e = slotEntry(k); return e ? `entry ${nOf(e)}` : '<span class="pb-blank">____</span>'; };
    const totalWords = ordered.reduce((n, e) => n + wordsIn(e), 0);
    const cover = `
      <section class="pb-cover">
        <h1>Writer's Notebook</h1>
        <p class="pb-sub">TCE 284 · ${printedName()}</p>
        <table class="pb-grade">
          <tr><th>Row</th><th>What it is scored on</th><th class="pb-pts">Score</th></tr>
          <tr><td>1 · Kept practice</td>
              <td><strong>${entries.length} entries</strong>, numbered 1–${entries.length} ·
                  ${new Set(dates).size} separate days ·
                  ${escHtml(fmtDate(dates[0]))} to ${escHtml(fmtDate(dates[dates.length-1]))}<br>
                  <strong>${totalWords.toLocaleString()} words</strong> in all,
                  ${Math.round(totalWords / entries.length)} to an entry on average<br>
                  <span class="pb-kinds">${tally}</span></td>
              <td class="pb-pts">___ / 20</td></tr>
          <tr><td>2 · Required entries</td>
              <td>Baseline ${ref('baseline')} · Currere ${ref('currere')} ·
                  Topic map ${ref('topicmap')} · Source notes ${ref('sources')}<br>
                  <span class="pb-kinds">Printed in full in Part 2.</span></td>
              <td class="pb-pts">___ / 5</td></tr>
          <tr><td>3 · Look-Back Letter</td>
              <td>${ref('letter')}<br><span class="pb-kinds">Printed in full in Part 3.</span></td>
              <td class="pb-pts">___ / 10</td></tr>
          <tr><td>4 · Thinking on the page</td>
              <td>I flagged ${ref('flag1')}, ${ref('flag2')}, ${ref('flag3')}<br>
                  <span class="pb-kinds">Printed in full in Part 4; my threads and my reading of them are in Part 5.</span></td>
              <td class="pb-pts">___ / 15</td></tr>
          <tr class="pb-tot"><td colspan="2">Total</td><td class="pb-pts">___ / 50</td></tr>
        </table>
      </section>`;

    const part2 = `
      <section class="pb-part">
        <h2>Part 2 · Required entries</h2>
        ${['baseline','currere','topicmap','sources'].map(k => {
          const slot = TURNIN_SLOTS.find(s => s[0] === k);
          const e = slotEntry(k);
          return e ? full(e, slot[1]) : notChosen(slot[1]);
        }).join('')}
      </section>`;
    const letterE = slotEntry('letter');
    const part3 = `
      <section class="pb-part">
        <h2>Part 3 · The Look-Back Letter</h2>
        ${letterE ? full(letterE, 'Look-Back Letter') : notChosen('Look-Back Letter')}
      </section>`;
    const part4 = `
      <section class="pb-part">
        <h2>Part 4 · The three entries I flagged</h2>
        <p class="pb-sub">These are the entries I want read closely.</p>
        ${['flag1','flag2','flag3'].map(k => {
          const slot = TURNIN_SLOTS.find(s => s[0] === k);
          const e = slotEntry(k);
          return e ? full(e, slot[1]) : notChosen(slot[1]);
        }).join('')}
      </section>`;

    // Part 5 · the threads and the writer's reading of them. This is the evidence for the
    // Thinking row that a pile of entries could never be: a preoccupation held still,
    // ordered by date, and the student's own account of what changed. The app supplies
    // the juxtaposition and nothing else — no themes named, no depth scored.
    const withEntries = threads().map(t => ({ t, es: threadEntries(t.id) })).filter(x => x.es.length);
    const part5 = withEntries.length ? `
      <section class="pb-part">
        <h2>Part 5 · Threads</h2>
        <p class="pb-sub">What kept coming back, and what I make of it.</p>
        ${withEntries.map(({t, es}) => {
          const reads = es.filter(e => e.pieceKind === 'reflection');
          // 'conversation' entries are kept AI exchanges. They are NOTEBOOK ONLY and do
          // not print here at all -- Todd's call, 23 Aug 2026. The notebook is the one
          // place nothing is graded, so what a student kept from Romano stays theirs;
          // the bundle carries only writing they did. They must also never be counted as
          // runs -- the entry count on this page is a claim about how much they wrote.
          const runs = es.filter(e => e.pieceKind !== 'reflection' && e.pieceKind !== 'conversation');
          return `<section class="pb-thread">
            <h3>${escHtml(t.name)}</h3>
            <p class="pb-sub">${runs.length} ${runs.length===1?'entry':'entries'} ·
              ${escHtml(fmtDate(es[0].date))} to ${escHtml(fmtDate(es[es.length-1].date))} ·
              ${daysBetween(es[0].date, es[es.length-1].date)} days</p>
            <ol class="pb-toc">${runs.map(e => `<li><span class="pb-n">${nOf(e)}</span><span class="pb-d">${escHtml(fmtDate(e.date))}</span><span class="pb-t">${escHtml(entryLabel(e, 70))}</span></li>`).join('')}</ol>
            ${reads.length ? reads.map(e => `<div class="pb-read"><p class="pb-role">My reading of this thread · ${escHtml(fmtDate(e.date))}</p>${para(e.text)}</div>`).join('')
                           : `<p class="pb-role">No reading written for this thread.</p>`}
          </section>`;
        }).join('')}
      </section>` : '';

    const html = `
      ${cover}
      <section class="pb-part"><h2>Part 1 · Contents</h2>
        <p class="pb-sub">Every entry, numbered in date order.</p>
        ${contents}
      </section>
      ${part2}
      ${part3}
      ${part4}
      ${part5}`;
    // ⚠ THE COMPLETE NOTEBOOK IS DELIBERATELY NOT PRINTED.
    //
    // It was Part 5, and it made this 30–40 pages — 22 of those is 800 pages to grade.
    // What is submitted is a REPORT: the entries the writer chose, and what they made of
    // them. Selection is the assignment here exactly as it is on the One-Pager, where
    // deciding what to cut is the work.
    //
    // Kept practice does not need the pages to be readable, only countable, and Part 1
    // carries that: every entry, numbered, dated, with its word count and opening line.
    // Thirty entries of eleven words each is visible at a glance there, which is the
    // loophole a bare presence-list would have left open. `sections` is still built
    // above; a future "include everything" option can print it without new plumbing.
    void sections;
    printDoc('printBundle', html, "Writer's Notebook — TCE 284");
  }

  // ── Export One-Pager → PDF.
  //    The One-Pager is a ONE PAGE assignment, so the export measures the shaped page
  //    against a single sheet before printing and says so when it runs over. It does
  //    NOT shrink the type to fit: what to cut is the student's decision, and making
  //    that decision is the assignment. The shaped page prints as HTML, not innerText,
  //    so embedded images survive — OP2 is explicitly image + text.
  //    Sheet is US Letter at 96dpi less the 20mm/18mm @page margins. A4 is taller and
  //    narrower, so a page that fits Letter fits A4 on height; the estimate is a
  //    warning, never a gate.
  const SHEET_PX = { w: 680, h: 905 };

  // The second page of the export. OP1: "Your writing session and AI-use log go with
  // it." This is that page — what the gush was (how long, how many words, how many
  // trials), the gush itself, the reflection exchange, and what the machine was allowed
  // to do. It is evidence, so when there is no recorded session it says so plainly
  // rather than implying one happened.
  //
  // THE GUSH IS PRINTED, deliberately. Todd weighed removing it on 23 Aug 2026 and kept
  // it: the gush is the evidence that the One-Pager was built FROM something, and word
  // counts alone can be produced by typing nonsense for eight minutes. OP1 says the
  // writing session goes with the submission, and the session is the gush.
  //
  // The cost is real and was accepted knowingly: a gush a student knows will be read is
  // a gush they will quietly tidy, and currere prompts ask for life history. If students
  // start submitting suspiciously clean gushes, this is the line to revisit -- and the
  // student-facing answer to "who can see this" must stay true to it.
  function sessionRecordHTML(M){
    const s = ((DB.freewrite[fwCur] || {}).session) || {};
    const gush = ((DB.freewrite[fwCur] || {}).gush || '').trim();
    const para = t => String(t||'').split(/\n{2,}/).map(p => `<p>${escHtml(p).replace(/\n/g,'<br>')}</p>`).join('');
    const when = s.endedAt ? new Date(s.endedAt).toLocaleString(undefined,
      {month:'long', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit'}) : '';

    let facts;
    if(s.minutes){
      // When there was more than one trial, report the whole effort. Reporting only the
      // last run understates a student who gushed three times to find their material.
      const n = s.gushes || 1;
      const trials = n > 1
        ? `<dt>Timed gushes</dt><dd>${n}, ${s.totalMinutes||s.minutes} minutes and ${s.totalWords||s.words||0} words in total</dd>
           <dt>Final gush</dt><dd>${s.minutes} minute${s.minutes===1?'':'s'}, ${s.words||0} words</dd>`
        : `<dt>Gushed</dt><dd>${s.minutes} minute${s.minutes===1?'':'s'}, ${s.words||0} words</dd>`;
      facts = `<dl>
        ${trials}
        <dt>Finished</dt><dd>${escHtml(when)}</dd>
        <dt>AI connected</dt><dd>${escHtml(s.ai || 'None')}</dd>
      </dl>`;
    } else {
      facts = `<p class="op-none">No timed gush was recorded in Journaler for this One-Pager.</p>`;
    }

    // ── What the machine actually DID, reported rather than asserted.
    //
    // This line used to state flatly that the partner "supplied none of the words in the
    // One-Pager". That was true while he could only be asked about pacing -- the
    // reflection prompt forbids him to quote or critique. He can now be asked about a
    // passage of the student's OWN writing from the selection popup, which is generative,
    // so a blanket claim would be a promise the app can no longer keep. It reports a
    // count instead, the same reason the About panel measures its build size rather than
    // stating it.
    const asks = s.writeAsks || 0;
    const aiBits = [];
    if(s.question) aiBits.push(escHtml(AI_TAG) + ' asked how the writing went \u2014 about the experience, not the content.');
    if(asks) aiBits.push('I asked ' + escHtml(AI_TAG) + ' about a passage of my own writing '
      + asks + ' time' + (asks === 1 ? '' : 's') + '. Nothing he said is in the One-Pager unless I typed it there myself.');
    const aiUse = aiBits.length ? aiBits.join(' ') : 'No AI was used on this One-Pager.';

    const exchange = s.question ? `
      <h3>${escHtml(AI_TAG)} asked</h3>
      ${para(s.question)}
      <h3>I answered</h3>
      ${s.answer && s.answer.trim() ? para(s.answer) : '<p class="op-none">Not answered.</p>'}` : '';

    return `
      <section class="op-session">
        <h2>Writing session · One-Pager ${M.n}</h2>
        <p class="op-sub">${(DB.name||'').trim() ? printedName() + ' · ' : ''}${escHtml(M.t)}</p>
        ${facts}
        ${gush ? `<h3>The gush, unedited</h3>${para(gush)}` : ''}
        ${exchange}
        <h3>AI use</h3>
        <p>${aiUse}</p>
      </section>`;
  }

  function exportOnePagerPDF(M){
    const pg = document.getElementById('page');
    const shaped = pg ? pg.innerHTML.trim() : '';
    if(!shaped || !pg.innerText.trim()){ toast('Nothing to export yet — shape your One-Pager first.'); return; }
    ensureName();

    const today = new Date().toLocaleDateString(undefined, {month:'long', day:'numeric', year:'numeric'});
    // The One-Pager itself is sheet one. The session record follows on its own page and
    // is deliberately NOT measured — it is as long as the writing was, and the one-page
    // rule is about the composed page the student made.
    const sheet = `
      <header class="op-head">
        <p class="op-kicker">TCE 284 · One-Pager ${M.n}</p>
        <h1>${escHtml(M.t)}</h1>
        <p class="op-byline"><span>Name: ${printedName()}</span><span>${escHtml(today)}</span></p>
      </header>
      <div class="op-body">${shaped}</div>`;

    // Measure at print size before the dialog opens. The one-pager's print typography
    // is declared OUTSIDE @media print for exactly this reason — the probe is laid out
    // on screen under the same rules the sheet will use.
    const probe = document.createElement('div');
    probe.id = 'printOnePager'; probe.className = 'printdoc measuring';
    probe.innerHTML = sheet;
    document.body.appendChild(probe);
    const measured = probe.scrollHeight;
    probe.remove();

    if(measured > SHEET_PX.h){
      const pages = Math.ceil(measured / SHEET_PX.h);
      if(!confirm(`Your One-Pager runs about ${pages} pages at print size. A One-Pager is one page.\n\nCancel to cut it down, or OK to print it as it is.`)) return;
    }
    printDoc('printOnePager', sheet + sessionRecordHTML(M), `One-Pager ${M.n} — ${M.t}`);
  }

  // Eight dropdowns, each listing every entry as "17 · Sep 22 · Free-writes". Dropdowns
  // rather than typed numbers because a typo here points the grader at the wrong page,
  // and because the student should be choosing from what they actually wrote.
  // The panel is now a CHECKLIST, not the place you do the work. Tagging moved onto the
  // entry itself; this answers the only question left, which is "have I missed one?"
  function turnInPanel(){
    const ordered = numberedEntries();
    if(!ordered.length) return '';
    const T = turnin();
    const numOf = new Map(ordered.map((e,i) => [e.id, i+1]));
    const R = readiness();
    const done = R.done, all = R.all, ready = done === all;
    // Collapsed by default in BOTH states. It is the last thing a student does in
    // December and an open panel every other week is clutter on the writing surface.
    // The summary carries the whole status instead, so it never needs opening to be read:
    // colour, an icon, a count, and a pip per slot that fills as pages get tagged.
    const pips = R.checks.map(c => `<i class="${c.ok ? 'on' : ''}"></i>`).join('');
    return `<details class="turnin ${ready ? 'ready' : 'todo'}">
      <summary><span class="ti-ico">${ready ? '✅' : '🛑'}</span>
        <span class="ti-txt">${ready ? 'Ready to turn in' : 'Before you turn it in'}
          <em>${done} of ${all} tagged</em></span>
        <span class="ti-pips">${pips}</span></summary>
      <p class="runline">Every column needs at least one filled box.
        Only the three you flag get read closely; everything else stays unread.</p>
      ${noteMode === 'tags' ? '' : `<p class="runline"><button class="btn sm" id="goTags">Open My Progress →</button></p>`}
      ${TURNIN_SLOTS.map(([k,label,hint]) => {
        const id = T[k], e = id && ordered.find(x => x.id === id);
        // Rows are LIVE. Todd: "these aren't linked. difficult to edit after the fact."
        // A checklist that reports a wrong answer without letting you fix it just moves
        // the work somewhere else.
        return `<div class="turnin-row ${e?'has':''}">
          <button class="tl" data-goto="${e ? e.id : ''}" ${e?'':'disabled'}>${e?'✓':'○'} ${label}<em>${hint}</em></button>
          <button class="tv" data-goto="${e ? e.id : ''}" ${e?'':'disabled'}>${e ? `entry ${numOf.get(e.id)} · ${escHtml(shortDate(e.date))} · ${escHtml(entryLabel(e, 40))}` : 'not tagged yet'}</button>
          ${e ? `<button class="tclear" data-untag="${k}" title="Remove this tag">×</button>` : ''}
        </div>`;
      }).join('')}
      ${(() => {
        const ok = analysisDone();
        return `<div class="turnin-row ${ok?'has':''}">
          <button class="tl" data-gothreads="1">${ok?'✓':'○'} Your reading of a thread<em>Put a thread on ${THREAD_MIN}+ entries, then write what you see and keep it</em></button>
          <button class="tv" data-gothreads="1">${ok ? 'kept' : 'not written yet'}</button></div>`;
      })()}
      ${(() => {
        // 8 of 8 green does not mean eight pages: slots may share one entry, which is
        // allowed on purpose. Say so, rather than let the pips imply a spread that is not
        // there. Todd's own test run had eight tags across three pages.
        const pages = new Set(TURNIN_SLOTS.map(s => T[s[0]]).filter(Boolean)).size;
        return pages && pages < done
          ? `<p class="runline tw">${done} tags across <strong>${pages} page${pages>1?'s':''}</strong>. That is allowed — one page can do more than one job — but check it is what you meant.</p>` : '';
      })()}
    </details>`;
  }
  // Clicking a checklist row lands you on that entry in the Tags grid, highlighted, so
  // the next thing you do — change it — is one click away rather than a hunt.
  let tagFocus = null;
  // Every lens ends the same way — the turn-in panel and the button that prints the
  // report. The Tags lens returns early from renderNote with its own markup, so this
  // wiring has to be callable from either branch rather than living in one of them.
  // ⚠ In the My Progress lens the project panel already carries the rows, the points, the
  //   pickers and the links, so the older checklist would be the SAME nine checks a
  //   second time, in a second collapsible, on one screen. It is rendered everywhere
  //   else, where it is the summary and the way in.
  const noteFoot = () => `${noteMode === 'tags' ? '' : turnInPanel()}
    <div class="composer-foot" style="margin-top:14px"><button class="btn" id="bundleBtn">Bundle notebook → PDF</button></div>`;
  function wireNoteFoot(){
    const goT = document.getElementById('goTags');
    if(goT) goT.onclick = () => { noteMode = 'tags'; renderNote(); };
    // Caught at the moment it matters. A student who never found My Progress would
    // otherwise print a report with empty parts and no idea anything was missing —
    // silent and wrong, which is the failure mode this app is built to avoid.
    const bBtn = document.getElementById('bundleBtn');
    if(bBtn) bBtn.onclick = () => {
      const missing = readiness().checks.filter(c => !c.ok);
      if(missing.length && (DB.journal||[]).length){
        const ok = confirm(
          `${missing.length} of ${readiness().all} things are still undone:\n\n` +
          missing.map(c => '  · ' + c.label).join('\n') +
          `\n\nThose parts of your report will be blank or missing.\n\n` +
          `OK — let me finish first\nCancel — print it anyway`);
        if(ok){ noteMode = missing.every(c => c.k === 'analysis') ? 'threads' : 'tags'; renderNote(); return; }
      }
      bundleNotebookPDF();
    };
  }
  function wireThreadBars(){
    frame.querySelectorAll('.thradd').forEach(sel => sel.onchange = () => {
      const v = sel.value; if(!v) return;
      let tid = v;
      if(v === '__new'){
        const name = prompt('Name the thread — anything that keeps coming back.\n\ne.g. my grandmother · fear of the blank page · Mrs. Dunn');
        tid = addThread(name);
        if(!tid){ sel.value = ''; return; }
      }
      toggleThread(sel.dataset.entry, tid);
      toast('Added to “' + threadName(tid) + '”');
      renderNote();
    });
    frame.querySelectorAll('[data-unthread]').forEach(b => b.onclick = () => {
      toggleThread(b.dataset.e, b.dataset.unthread); renderNote();
    });
  }
  function wireTurninLinks(){
    wireThreadBars();
    frame.querySelectorAll('[data-gothreads]').forEach(b => b.onclick = () => { noteMode = 'threads'; renderNote(); });
    // Untag from an entry chip or from the checklist row. Shared, because the checklist
    // now renders in every lens and a per-branch copy would drift.
    frame.querySelectorAll('.tagx, .tclear').forEach(b => b.onclick = () => {
      delete turnin()[b.dataset.untag]; saveDB(); renderNote();
    });
    frame.querySelectorAll('[data-goto]').forEach(b => { if(!b.dataset.goto) return;
      b.onclick = () => { tagFocus = b.dataset.goto; noteMode = 'tags'; renderNote(); };
    });
  }
  function shortDate(k){ const [y,m,d]=String(k).split('-').map(Number);
    return new Date(y,(m||1)-1,d||1).toLocaleDateString(undefined,{month:'short',day:'numeric'}); }

  // Under this, recurringTerms drops to a 2-entry threshold and every word looks
  // like a thread. Same number the Threads pane already used to pick cbMin.
  const THREADS_MIN = 8;
  function renderNote(){
    body.classList.add('bleed');
    // The Tags lens advertises itself. Todd: "Folks won't know to click on Tags." A lens
    // name sitting third in a row of three says nothing about being required before you
    // submit, so it carries its own count and goes red until every column is filled.
    const _R = readiness(); const tagDone = _R.done, tagAll = _R.all;
    const tagBadge = (DB.journal||[]).length
      ? `<span class="nbcount ${tagDone<tagAll?'todo':'ready'}">${tagDone}/${tagAll}</span>` : '';
    const nEntries = numberedEntries().length;
    const threadsReady = nEntries >= THREADS_MIN;
    const onPages = noteMode === 'day' || noteMode === 'piece';
    const toggle = `<div class="nbviews">`
      + `<button class="nbview ${noteMode==='tags'?'on':''}" data-mode="tags" title="Where you stand on the 50 points: how much you have kept, which readings are still waiting for you to write about them, and which pages you have marked to be read closely. Start here.">My Progress ${tagBadge}</button>`
      + `<button class="nbview ${onPages?'on':''}" data-mode="day" title="Your term as a calendar. A filled dot is a day you wrote; a hollow one is a day you marked passages but have not written about them yet. Spread is part of the grade — entries dated across the whole term read as a practice, a pile of them in November does not.">By day</button>`
      + `<button class="nbview ${noteMode==='threads'?'on':''}" data-mode="threads"`
      + ` title="${threadsReady
            ? 'A thread is anything that keeps coming back across your entries. Name one, tag every entry it turns up in, then write your reading of it.'
            : 'A thread is anything that keeps coming back across your entries. With ' + nEntries + ' so far there is not much to look across yet — it gets sharper as you keep writing. You name threads yourself; the list of repeated words is only a hint.'}">`
      + `Threads${threadsReady ? '' : ` <span class="nblock">${nEntries}</span>`}</button>`
      + `</div>`;
    // No sub-switch. A piece opens from an entry and offers its own way back.
    const pagesSort = '';
    // ── The Tags lens: every entry against every tag, on one screen.
    //
    // Tagging lived only on the individual entry, so finding which page held which tag
    // meant clicking through days, and changing your mind meant finding the old page
    // first. A grid answers both at once. It also makes the coupling visible, which
    // nothing did before: a tagged entry is REPRINTED IN FULL in the report and an
    // untagged one appears only as a line in the Contents. That is what keeps the report
    // to under ten pages, and a student who does not know it cannot use it.
    if(noteMode === 'threads'){
      const ts = threads();
      const ordered = numberedEntries();
      const numOf = new Map(ordered.map((e,i) => [e.id, i+1]));
      // Candidates, offered in the LEFT pane where the eye already is — this is what you
      // reach for having noticed nothing, so it cannot sit below a full-height thread.
      const cbMin = ordered.length < 8 ? 2 : 3;
      const cand = recurringTerms(cbMin);
      const thin = ordered.length < THREADS_MIN ? `<p class="runline thin-note"><strong>Early days.</strong>
        With ${ordered.length} ${ordered.length === 1 ? 'entry' : 'entries'} there is not much to look
        across yet, and the repeated words below will be noisy. Nothing is wrong — this is what it looks
        like before a term accumulates. You can name a thread by hand at any time, and threading properly
        begins in Week 6.</p>` : '';
      const comeback = `<div class="comeback">
        <h4>What keeps coming back</h4>${thin}
        <p class="runline">Words you have used in <strong>${cbMin} or more different entries</strong>.
          A count, not a reading: it says what recurs, not what matters. Some will be noise.
          You decide which are threads.</p>
        ${cand.length ? `<div class="cbterms">${cand.map(c =>
            `<button class="cbterm ${cbSel===c.term?'on':''}" data-term="${escHtml(c.term)}">${escHtml(c.term)}<span class="cbn">${c.n}</span></button>`).join('')}</div>`
          : `<p class="empty">Nothing recurs yet. Come back once you have more entries — this needs words that turn up on different days.</p>`}
        ${(() => {
          const hit = cand.find(c => c.term === cbSel); if(!hit) return '';
          return `<div class="cbhits">
            <p class="runline"><strong>“${escHtml(hit.term)}”</strong> — ${hit.n} entries,
              ${escHtml(shortDate(hit.from))} to ${escHtml(shortDate(hit.to))}</p>
            <button class="btn sm" id="cbMake">Make it a thread</button>
            <p class="note">Puts it on all ${hit.n}. Rename it after — the word is a starting point, not the name.</p></div>`;
        })()}
      </div>`;
      const list = ts.length ? ts.map(t => {
        const es = threadEntries(t.id);
        const quiet = es.length ? daysBetween(es[es.length-1].date, ordered.length ? ordered[ordered.length-1].date : es[es.length-1].date) : 0;
        return `<button class="moment has ${threadSel===t.id?'on':''}" data-thread="${t.id}">
          <span class="mname"><span class="dot"></span>${escHtml(t.name)}</span>
          <span class="mkind">${es.length} ${es.length===1?'entry':'entries'}${quiet>21?` · quiet ${quiet} days`:''}</span></button>`;
      }).join('') : `<p class="empty" style="font-family:var(--sans)">No threads yet. Name one below, or open any entry and use <strong>＋ Add to a thread</strong>.</p>`;
      const leftT = `<div class="piecelist"><p class="lead">Your threads</p>${list}
        <div class="newthread"><input id="ntName" placeholder="Name a new thread…" maxlength="48">
          <button class="btn ghost sm" id="ntAdd">Start it</button></div>
        ${comeback}</div>`;


      let rightT;
      if(!threadSel || !ts.find(t => t.id === threadSel)){
        rightT = `<div class="notedetail"><h3>Pick a thread</h3><p class="empty">Choose a thread to see every entry on it, earliest first — and what changed between the first and the last.</p></div>`;
      } else {
        const es = threadEntries(threadSel), name = threadName(threadSel);
        if(!es.length){
          rightT = `<div class="notedetail"><h3>${escHtml(name)}</h3><p class="empty">Nothing on this thread yet. Open an entry and add it.</p></div>`;
        } else {
          const rows = es.map((e,i) => {
            const gap = i ? daysBetween(es[i-1].date, e.date) : 0;
            return `${i && gap > 0 ? `<p class="thgap">${gap} day${gap===1?'':'s'} later</p>` : ''}
              <div class="entryrow"><div class="k">entry ${numOf.get(e.id)} · ${escHtml(shortDate(e.date))} · ${wordsIn(e)}w</div>
                <div class="x">${escHtml(e.text).replace(/\n/g,'<br>')}</div></div>`;
          }).join('');
          // First against last. The single most useful thing this view can do, and it only
          // works with three or more — two entries ARE the first and the last.
          const a = es[0], b = es[es.length-1];
          const pair = es.length >= 3 ? `
            <div class="firstlast"><h4>First and last, side by side</h4>
              <div class="flcols">
                <div><p class="fllbl">Earliest · ${escHtml(shortDate(a.date))} · entry ${numOf.get(a.id)}</p><div class="x">${escHtml(entrySnippet(a, 460)).replace(/\n/g,'<br>')}</div></div>
                <div><p class="fllbl">Latest · ${escHtml(shortDate(b.date))} · entry ${numOf.get(b.id)}</p><div class="x">${escHtml(entrySnippet(b, 460)).replace(/\n/g,'<br>')}</div></div>
              </div>
              <p class="runline">${daysBetween(a.date, b.date)} days apart.</p></div>` : '';
          const draft = (DB.threadNotes || {})[threadSel] || '';
          rightT = `<div class="notedetail">
            <h3>${escHtml(name)}</h3>
            <p class="runline">${es.length} entries · ${escHtml(shortDate(a.date))} to ${escHtml(shortDate(b.date))}</p>
            ${pair}
            <div class="thask"><h4>Your reading of it</h4>
              <p class="runline">What runs through these? And what is in the last one that is not
                in the first? Nobody but you can answer that — I only put them side by side.</p>
              <textarea id="thNote" placeholder="Write what you see…">${escHtml(draft)}</textarea>
              <div class="composer-foot"><button class="btn sm" id="thKeep">＋ Add to notebook</button>
                <span class="note">Saved as a dated entry on this thread, so writing about the thread joins it.</span></div></div>
            <h4 class="thall">Every entry on this thread, earliest first</h4>
            ${rows}</div>`;
        }
      }
      frame.innerHTML = `<div class="head"><h1>Notebook</h1><p>Something that keeps coming back across your entries. Name it, tag every entry it turns up in, then write your reading of one — what runs through these, and what is in the last that is not in the first.</p>${toggle}</div>
        ${threadsAbout()}
        <div class="notewrap">${leftT}${rightT}</div>`;
      frame.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { if(!b.dataset.mode) return; noteMode = b.dataset.mode; nbEditingId = null; renderNote(); });
      wireProjectLinks();
      frame.querySelectorAll('[data-thread]').forEach(b => b.onclick = () => { threadSel = b.dataset.thread; renderNote(); });
      frame.querySelectorAll('.cbterm').forEach(b => b.onclick = () => {
        cbSel = (cbSel === b.dataset.term) ? null : b.dataset.term; renderNote();
      });
      const cbM = document.getElementById('cbMake');
      if(cbM) cbM.onclick = () => {
        const hit = recurringTerms(3).find(c => c.term === cbSel); if(!hit) return;
        const id = addThread(hit.term); if(!id) return;
        hit.ids.forEach(eid => { const e = (DB.journal||[]).find(x => x.id === eid);
          if(e){ e.threads = e.threads || []; if(!e.threads.includes(id)) e.threads.push(id); } });
        saveDB(); threadSel = id; cbSel = null;
        toast(`Thread “${hit.term}” started with ${hit.n} entries`);
        renderNote();
      };
      const ntA = document.getElementById('ntAdd'), ntN = document.getElementById('ntName');
      if(ntA) ntA.onclick = () => { const id = addThread(ntN.value); if(id){ threadSel = id; renderNote(); } };
      if(ntN) ntN.onkeydown = ev => { if(ev.key === 'Enter') ntA.click(); };
      const thN = document.getElementById('thNote');
      if(thN) thN.oninput = () => { (DB.threadNotes = DB.threadNotes || {})[threadSel] = thN.value; saveDB(); };
      const thK = document.getElementById('thKeep');
      if(thK) thK.onclick = () => {
        const txt = (thN.value || '').trim();
        if(!txt){ toast('Write something first.'); return; }
        const ent = elevate('thread-' + threadSel, 'reflection', 'On the thread: ' + threadName(threadSel), txt);
        // The reflection joins the thread it is about, so next term's first/last pairing
        // includes the writer's own reading of the thread.
        if(ent){ ent.threads = [threadSel]; saveDB(); }
        toast('Kept in your notebook ✎');
        renderNote();
      };
      return;
    }
    if(noteMode === 'tags'){
      const ordered = numberedEntries();
      const T = turnin();
      const head = TURNIN_SLOTS.map(([k,label]) =>
        `<th class="tg-c" title="${escHtml(label)}">${escHtml(TAG_ABBR[k] || label)}</th>`).join('');
      const rows = ordered.map((e,i) => {
        const tagged = tagsOn(e.id).length;
        return `<tr class="${tagged?'tg-in':''} ${tagFocus===e.id?'tg-focus':''}" data-row="${e.id}">
          <td class="tg-n">${i+1}</td>
          <td class="tg-d">${escHtml(shortDate(e.date))}</td>
          <td class="tg-w">${wordsIn(e)}w</td>
          <td class="tg-t">${escHtml(entryLabel(e, 64))}</td>
          ${TURNIN_SLOTS.map(([k]) => `<td class="tg-c"><button class="tgbox ${T[k]===e.id?'on':''}" data-tg="${k}" data-tge="${e.id}" title="${escHtml(slotLabel(k))}" aria-pressed="${T[k]===e.id}"></button></td>`).join('')}
        </tr>`;
      }).join('');
      frame.innerHTML = `<div class="head"><h1>Notebook</h1><p>What you are handing in, and where you stand on it. Below, every entry against every slot — click a box to mark a page; clicking one another page holds moves it here.</p>${toggle}</div>
        <div class="tagsgrid">
          ${draftTray()}
          ${projectPanel()}
          <p class="runline"><strong>Every column needs at least one filled box.</strong>
            A tagged page is printed in full in your report; everything else appears in the
            Contents as one line, which is what keeps the report short.</p>
          ${ordered.length ? `<table class="tgtable"><thead><tr><th></th><th>Date</th><th></th><th>Entry</th>${head}</tr></thead><tbody>${rows}</tbody></table>`
            : `<p class="empty">Nothing kept yet, so there is nothing to mark. Once you keep entries they appear here as rows, and you tick the box that says which required entry each one answers — or which three you want read closely.</p>`}
          ${noteFoot()}
        </div>`;
      frame.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { if(!b.dataset.mode) return; noteMode = b.dataset.mode; nbEditingId = null; renderNote(); });
      wireTray(); wireProjectLinks();
      wireTurninLinks(); wireNoteFoot();
      if(tagFocus){
        const row = frame.querySelector(`tr[data-row="${tagFocus}"]`);
        if(row && row.scrollIntoView) row.scrollIntoView({ block: 'center' });
        // One-shot: the highlight marks where you just arrived, not a persistent selection.
        setTimeout(() => { tagFocus = null; }, 2500);
      }
      frame.querySelectorAll('.tgbox').forEach(b => b.onclick = () => {
        const slot = b.dataset.tg, id = b.dataset.tge, TT = turnin();
        if(TT[slot] === id){ delete TT[slot]; saveDB(); renderNote(); return; }
        if(/^flag/.test(slot)){
          const clash = ['flag1','flag2','flag3'].find(f => f !== slot && TT[f] === id);
          if(clash){ toast(`This page is already ${slotLabel(clash)}. Flag three different pages, one from each act.`); return; }
        }
        const prev = TT[slot];
        TT[slot] = id; saveDB();
        if(prev && prev !== id){
          const n = numberedEntries().findIndex(x => x.id === prev) + 1;
          toast(`${slotLabel(slot)} moved here from entry ${n}`);
        }
        renderNote();
      });
      return;
    }
    let leftPane, rightPane;
    if(noteMode === 'day'){
      const y = noteView.getFullYear(), m = noteView.getMonth();
      const monthName = noteView.toLocaleDateString(undefined, {month:'long', year:'numeric'});
      const markedDays = new Set();
      for(const g of capturesByPiece()) for(const h of g.items) markedDays.add(hlDayKey(h));
      const first = new Date(y, m, 1).getDay(), days = new Date(y, m+1, 0).getDate();
      const dow = ['S','M','T','W','T','F','S'].map(x=>`<div class="dow">${x}</div>`).join('');
      let cells = '';
      for(let i=0;i<first;i++) cells += '<div class="cell" style="visibility:hidden;border:none"></div>';
      for(let dd=1; dd<=days; dd++){
        const key = `${y}-${String(m+1).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
        const list = journalByDate(key);
        const wrote = list.some(e => !isCapture(e));
        const markedHere = markedDays.has(key);
        // Legacy only: One-Pagers are submitted as their own PDF and no longer
        // elevate into the notebook, so nothing new carries this kind. Entries saved
        // before that change still render with their marker.
        const isOp = list.some(e=>e.pieceKind === 'one-pager');
        cells += `<div class="cell ${wrote?'entry':''} ${!wrote&&markedHere?'marked':''} ${isOp?'op':''} ${noteSel===key?'sel':''}" data-key="${key}">${dd}</div>`;
      }
      leftPane = `<div class="cal">${pagesSort}
        <div class="calhead"><button class="calnav" id="prevM" aria-label="Previous month" ${(y*12+m)<=NOTE_MIN?'disabled':''}>‹</button><span class="mname">${monthName}</span><button class="calnav" id="nextM" aria-label="Next month" ${(y*12+m)>=NOTE_MAX?'disabled':''}>›</button></div>
        <div class="grid">${dow}${cells}</div>
        <p class="runline" style="margin-top:12px">● green = a day you wrote. ○ hollow = passages marked, not yet reflected on. Click a day to read it.</p>
        ${noteFoot()}</div>`;
      rightPane = noteDayDetail();
    } else {
      const pieces = journalPieces();
      const listHtml = pieces.length
        ? pieces.map(p=>`<button class="moment has ${notePieceSel===p.id?'on':''}" data-piece="${p.id}"><span class="mname"><span class="dot"></span>${escHtml(p.title)}</span><span class="mkind">${p.entries.length} kept pass${p.entries.length>1?'es':''}</span></button>`).join('')
        : `<p class="empty" style="font-family:var(--sans)">Nothing kept yet. This fills with everything you decide to keep — free-writes, currere gushes, reading notes, the four required entries — each one dated, numbered, and counted toward <strong>Kept practice</strong>, the largest row on the rubric. Write in any tab, then press <strong>＋ Add to notebook</strong>.</p>`;
      leftPane = `<div class="piecelist"><button class="pj-link" data-mode="day" style="margin-bottom:10px">‹ All days</button><p class="lead">Your pieces</p>${listHtml}
        ${noteFoot()}</div>`;
      rightPane = notePieceDetail();
    }
    frame.innerHTML = `<div class="head"><h1>Notebook</h1><p>Your kept pages, by the day you kept them. Anything you have written about more than once carries a link on its name — follow it to see every pass at that one thing, earliest first.</p>${toggle}</div>
      ${draftTray()}
      <div class="notewrap">${leftPane}${rightPane}</div>`;

    frame.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { if(!b.dataset.mode) return; noteMode = b.dataset.mode; nbEditingId = null; renderNote(); });
    wireTray(); wireProjectLinks();
    // Only one lens renders at a time, so only one bundle button exists.
    // Tag / untag from the entry itself. Saved on the spot: there is no submit step here,
    // and a student who tags a page then navigates away should not lose it.
    frame.querySelectorAll('.tagadd').forEach(sel => sel.onchange = () => {
      const slot = sel.value; if(!slot) return;
      const T = turnin(), prev = T[slot];
      // One page may hold several tags — a currere gush is a plausible thing to also want
      // read closely. But not two FLAGS: the Thinking row is scored across three entries,
      // one per act, so three flags on one page is one entry wearing three hats and the
      // row cannot do its job. This is the only combination worth refusing outright.
      if(/^flag/.test(slot)){
        const clash = ['flag1','flag2','flag3'].find(f => f !== slot && T[f] === sel.dataset.entry);
        if(clash){
          toast(`This page is already ${slotLabel(clash)}. Flag three different pages, one from each act.`);
          sel.value = ''; return;
        }
      }
      T[slot] = sel.dataset.entry;
      saveDB();
      const ord = numberedEntries(), n = ord.findIndex(x => x.id === prev) + 1;
      toast(prev && prev !== sel.dataset.entry
        ? `${slotLabel(slot)} moved here from entry ${n}`
        : `Tagged: ${slotLabel(slot)}`);
      renderNote();
    });
    wireTurninLinks();
    wireNoteFoot();
    if(noteMode === 'day'){
      const y = noteView.getFullYear(), m = noteView.getMonth();
      const pm = document.getElementById('prevM'), nm = document.getElementById('nextM');
      if(pm) pm.onclick = () => { if((y*12+m)<=NOTE_MIN) return; noteView = new Date(y, m-1, 1); renderNote(); };
      if(nm) nm.onclick = () => { if((y*12+m)>=NOTE_MAX) return; noteView = new Date(y, m+1, 1); renderNote(); };
      frame.querySelectorAll('.cell[data-key]').forEach(c => c.onclick = () => { noteSel = c.dataset.key; nbEditingId = null; renderNote(); });
    } else {
      frame.querySelectorAll('[data-piece]').forEach(b => b.onclick = () => { notePieceSel = b.dataset.piece; nbEditingId = null; renderNote(); });
    }
    // Entry actions — shared across both lenses.
    frame.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => { nbEditingId = b.dataset.edit; renderNote(); });
    // Grow the editor to its content and keep growing as you type, so a long kept
    // conversation plus your response is never squeezed into a fixed box.
    frame.querySelectorAll('textarea[data-autogrow]').forEach(ta => {
      const fit = () => { ta.style.height = 'auto'; ta.style.height = Math.max(ta.scrollHeight + 4, window.innerHeight * 0.4) + 'px'; };
      ta.addEventListener('input', fit); fit();
      // Land the cursor at the end so you start writing after what you kept, not before it.
      ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
      ta.scrollTop = ta.scrollHeight;
    });
    frame.querySelectorAll('[data-cancel]').forEach(b => b.onclick = () => { nbEditingId = null; renderNote(); });
    frame.querySelectorAll('[data-save]').forEach(b => b.onclick = () => { const id = b.dataset.save; const ta = document.getElementById('edit_'+id); if(ta) updateEntry(id, ta.value); nbEditingId = null; renderNote(); });
    frame.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
      const gone = (DB.journal || []).find(e => e.id === b.dataset.del);
      deleteEntry(b.dataset.del); nbEditingId = null; renderNote();
      undoably('Page deleted', () => { if(gone){ DB.journal.push(gone); saveDB(); } renderNote(); });
    });
    frame.querySelectorAll('[data-open]').forEach(b => b.onclick = () => goToPiece(b.dataset.open));
  }

  // ── TIPS ─────────────────────────────────────────────────────────────────────
  //
  // The app used to open on the by-day calendar, which on 24 August is a grid of
  // thirty empty boxes -- a true picture of the notebook and a cold way to be met
  // by it. It opened on a poem for a while after that, until Todd pointed out the
  // obvious: "We already have poems of the day in the daily outlines." A poem in
  // the app was a second copy of something that already had a home.
  //
  // What has no home is the argument the course is making about writing. So the
  // page opens on a passage from Bad Ideas About Writing -- one short, verbatim,
  // attributed passage per class meeting, from a book of forty-three chapters that
  // each take apart one bad idea. Todd's pick, and a good one: it says the things
  // this app has been trying to say in its own copy all along.
  //
  // ⚠ CC BY-NC-ND 4.0. Three things follow and none of them is optional.
  //   · Every passage names its author and chapter and links the book. BY.
  //   · Nothing is reworded, shortened mid-sentence or stitched together. ND.
  //   · The text comes from tips.js, GENERATED by tools/build-tips.py from the
  //     book itself. Do not type a quotation in here -- see that script's header.
  //
  // ⚠ NOT a splash. A page you have to dismiss every launch is read once and
  // clicked through after that, and it puts a door in front of the writing.

  // null = today's. Not persisted: opening the app tomorrow should land on
  // tomorrow's tip, not on the one you were reading last week.
  let tipSel = null;

  function allTips(){
    return (window.DAILY_TIPS || []).slice().sort((a,b) => a.date.localeCompare(b.date));
  }
  const TIP_ACTS = [
    { n: 'I',   from: 1,  to: 5,  title: 'Become a Writer',             when: 'Aug 24 – Sep 23' },
    { n: 'II',  from: 6,  to: 10, title: 'The Currere',                 when: 'Sep 28 – Oct 30' },
    { n: 'III', from: 11, to: 15, title: 'Multimodal Research Project', when: 'Nov 2 – Dec 2' },
  ];
  function actOf(t){
    const w = +t.week || 1;
    return TIP_ACTS.find(a => w >= a.from && w <= a.to) || TIP_ACTS[TIP_ACTS.length - 1];
  }
  // Which act is open. Follows the tip on screen rather than defaulting to I blindly:
  // opening on Act I in November would fold away the very tip being read.
  let tipActOpen = null;
  function todaysTip(){
    const all = allTips();
    if(!all.length) return null;
    const today = _todayKey();
    // The tip of the last meeting that has happened. Between meetings the most
    // recent one stands; before the term starts, the first.
    let t = all[0];
    for(const q of all) if(q.date <= today) t = q;
    return t;
  }

  function renderTip(){
    body.classList.remove('wide', 'bleed');
    const fmt = k => { const [y,m,d] = String(k).split('-').map(Number);
      return new Date(y, (m||1)-1, d||1).toLocaleDateString(undefined,
        { weekday:'long', month:'long', day:'numeric' }); };
    const all = allTips();
    const today = todaysTip();
    const t = (tipSel && all.find(q => q.date === tipSel)) || today;
    if(!t){ frame.innerHTML = `<div class="poempage"><p class="empty">No tips yet — run
      <code>tools/build-tips.py</code>.</p></div>`; return; }

    const openAct = tipActOpen || actOf(t).n;   // 'none' folds them all
    const rail = `<nav class="poemrail">
      <p class="lead">Every tip this term</p>
      ${TIP_ACTS.map(a => {
        const mine = all.filter(q => actOf(q).n === a.n);
        if(!mine.length) return '';
        const open = a.n === openAct;
        return `<div class="tipact${open ? ' open' : ''}">
          <button class="tipact-h" data-act="${a.n}" aria-expanded="${open}">
            <span class="tipact-caret">${open ? '▾' : '▸'}</span>
            <span class="tipact-name">Act ${a.n} — ${escHtml(a.title)}</span>
            <span class="tipact-when">${escHtml(a.when)}</span>
          </button>
          <div class="tipact-body">${mine.map(q => `<button class="pmlink ${q.date === t.date ? 'on' : ''}"
            data-tip="${q.date}" title="${escHtml(q.chapter + ' — ' + q.author)}"
            ><span class="pmwhen">${escHtml(shortDate(q.date))}</span
            ><span class="pmwhat">${escHtml(q.chapter)}</span></button>`).join('')}</div>
        </div>`;
      }).join('')}
    </nav>`;

    // The chapter title IS a bad idea, stated flat for the chapter to take apart.
    // Printing it as a claim with no mark on it would be the app asserting it, so
    // it is labelled as the myth and the passage below is the answer to it.
    const page = `<div class="poempage">
      <p class="pmkick">A tip for ${escHtml(fmt(t.date))}</p>
      <p class="tipmyth">Bad idea: <b>“${escHtml(t.chapter)}”</b></p>
      <blockquote class="tiptext">${escHtml(t.text)}</blockquote>
      <p class="tipby">${escHtml(t.author)}</p>
      <div class="tipsrc">
        <p>From <a href="${escHtml(t.url)}" target="_blank" rel="noopener"><cite>Bad Ideas
          About Writing</cite></a>, edited by Cheryl E. Ball and Drew M. Loewe
          (West Virginia University Libraries, 2017). Free to read, and licensed
          CC&nbsp;BY-NC-ND&nbsp;4.0.</p>
      </div>
      <div class="pmacts">
        <button class="btn" id="pmKeep">＋ Share with notebook</button>
        <button class="btn ghost" id="pmAsk">Discuss with ${AI_NAME}</button>
      </div>
      <div id="pmPanel"></div>
    </div>`;

    frame.innerHTML = `<div class="layout poemlayout">${rail}<main class="stage plain">${page}</main></div>`;
    frame.querySelectorAll('[data-tip]').forEach(b => b.onclick = () => {
      // Picking a tip pins its act open, so choosing one from Act III does not fold
      // itself away on the re-render.
      tipSel = b.dataset.tip;
      const q = all.find(x => x.date === tipSel);
      if(q) tipActOpen = actOf(q).n;
      renderTip();
    });
    frame.querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
      // One open at a time -- two acts expanded is the scrolling list again.
      tipActOpen = (b.dataset.act === openAct) ? null : b.dataset.act;
      if(tipActOpen === null) tipActOpen = 'none';
      renderTip();
    });
    const here = frame.querySelector('[data-tip].on');
    if(here && here.scrollIntoView) here.scrollIntoView({ block: 'nearest' });
    wireTipActions(t);
  }

  // Neither button files anything on its own. "＋ Add to notebook" is the only thing
  // in this app that creates an entry, and a button that quietly logged "read the
  // tip" would be the first exception, on the one page that asks nothing of anybody.
  function wireTipActions(t){
    const panel = document.getElementById('pmPanel');
    const ref = `“${t.text}”\n— ${t.author}, “${t.chapter}”\n${t.book}`;

    document.getElementById('pmKeep').onclick = () => {
      panel.innerHTML = `<div class="pmwrite">
        <h4>What do you make of it?</h4>
        <textarea id="pmText" placeholder="Write about it…"></textarea>
        <div class="composer-foot"><button class="btn sm" id="pmSave">＋ Add to notebook</button>
          <span class="note">Kept as a dated entry, with the passage quoted at the top.</span></div>
      </div>`;
      const ta = document.getElementById('pmText'); ta.focus();
      document.getElementById('pmSave').onclick = () => {
        const txt = (ta.value || '').trim();
        if(!txt){ toast('Write something first.'); return; }
        elevate('tip:' + t.date, 'reflection', `On “${t.chapter}”`, `${ref}\n\n${txt}`);
        panel.innerHTML = '';
      };
    };

    document.getElementById('pmAsk').onclick = () => {
      if(getProvider() === 'none'){
        panel.innerHTML = `<div class="pmwrite"><p class="note">Connect an AI in Settings (the gear)
          and ${escHtml(AI_NAME)} will answer. Everything else on this page works without it.</p></div>`;
        return;
      }
      panel.innerHTML = `<div class="pmwrite">
        <h4>Ask ${escHtml(AI_NAME)} about it</h4>
        <input id="pmQ" placeholder="What do you want to ask?" maxlength="300">
        <div class="composer-foot"><button class="btn sm" id="pmGo">Ask</button></div>
        <div id="pmReply"></div></div>`;
      const q = document.getElementById('pmQ'), out = document.getElementById('pmReply');
      q.focus();
      const send = async () => {
        const question = (q.value || '').trim();
        if(!question){ toast('Ask something first.'); return; }
        out.innerHTML = `<p class="note">${escHtml(AI_NAME)} is reading…</p>`;
        const passage = `From “${t.chapter}” by ${t.author}, in ${t.book}:\n\n“${t.text}”`;
        try {
          const reply = await romanoReply(passage, question, [], '');
          out.innerHTML = `<div class="pmreply"><p>${escHtml(reply)}</p>
            <div class="composer-foot"><button class="btn sm ghost" id="pmKeepQA">＋ Add to notebook</button></div></div>`;
          document.getElementById('pmKeepQA').onclick = () => {
            elevate('tip:' + t.date, 'conversation', `On “${t.chapter}”`,
              `${ref}\n\nI asked: ${question}\n\n${AI_NAME} said: “${reply}”`,
              null, { author: AI_TAG, authorKind: 'ai' });
          };
        } catch(e){
          out.innerHTML = `<p class="note">${escHtml(AI_NAME)} is unavailable right now.</p>`;
        }
      };
      document.getElementById('pmGo').onclick = send;
      q.onkeydown = e => { if(e.key === 'Enter') send(); };
    };
  }

  // ---------- tabs + focus ----------
  const R = { tips:renderTip, free:renderFree, cur:renderCur, read:renderRead, note:renderNote };
  // body.reading lets CSS tell the reader apart from the writing views. Focus mode
  // clamps .frame to 720px, which is right for a gush and wrong for a PDF.
  // paintInsMarker last: the insertion marker is a fixed overlay on <body>, so leaving
  // Freewrite has to take it down or it hangs over whatever view replaced the pane.
  // ⚠ relocateReaderTools LAST, and on every tab: leaving Readings with the reader's
  // controls lodged in the top bar strands them there — they live outside #frame by
  // then, so the wipe that replaces the reading cannot take them along, and they sit on
  // Tips offering to hide a notes pane that is not on screen. Measured: 23 nodes.
  function show(t){ tab=t; document.querySelectorAll('#tabbar button').forEach(b=>b.classList.toggle('on',b.dataset.t===t)); body.classList.toggle('reading', t==='read'); R[t](); paintInsMarker(); _vbReach = null; relocateReaderTools(body.classList.contains('focus')); }
  document.querySelectorAll('#tabbar button').forEach(b=>b.addEventListener('click',()=>{ if(G.running)return; show(b.dataset.t); }));
  // ⚠ FOCUS MUST ASK FOR THE RE-RENDER (Todd, 2026-08-26): "when I click focus button
  // on this page, the pages disappear." Toggling the class changes the reader's width
  // AND its height in one step, and the only thing watching was the ResizeObserver --
  // which fires just at fit/page zoom, only past a 24px delta, and then after its own
  // debounce. So the recipe was fit + focus: the page sat at a size measured for the
  // other layout while several width changes raced each other through the observer.
  // Ask directly, two frames later, once the new layout has actually been laid out.
  // Focus hides the app's own chrome. The browser's -- URL bar, bookmarks, tabs -- is
  // not ours to hide except through the Fullscreen API, which needs the click that
  // called this and so cannot be done anywhere else.
  // ⚠ iOS and iPadOS Safari do not implement Fullscreen for page elements at ALL (only
  // for <video>), so this is a no-op there by design, not a bug to chase later. The
  // answer on an iPad is Add to Home Screen, which has no chrome to begin with.
  // Every call is guarded: a refusal must leave focus mode working, just with the
  // browser still showing.
  function requestChromeless(){
    try {
      const el = document.documentElement;
      if(document.fullscreenElement) return;
      const go = el.requestFullscreen || el.webkitRequestFullscreen;
      if(go) Promise.resolve(go.call(el, { navigationUI: 'hide' })).catch(()=>{});
    } catch(e){}
  }
  function releaseChromeless(){
    try {
      if(!document.fullscreenElement) return;
      const out = document.exitFullscreen || document.webkitExitFullscreen;
      if(out) Promise.resolve(out.call(document)).catch(()=>{});
    } catch(e){}
  }
  function setFocus(on){
    body.classList.toggle('focus', on);
    if(on) requestChromeless(); else releaseChromeless();
    if(tab !== 'read') return;
    syncNotesToggles();       // focus hides the top bar, so the doors swap over
    scheduleMarginLayout();   // the column's top moved even when nothing re-renders
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const r = readings[activeReading];
      if(r && (r.type === 'pdf' || r.type === 'docx')) renderActiveDoc(r);
    }));
  }
  document.getElementById('focusToggle').addEventListener('click',()=>setFocus(!body.classList.contains('focus')));
  document.getElementById('exitFocus').addEventListener('click',()=>setFocus(false));
  document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&!G.running) setFocus(false); });
  document.addEventListener('fullscreenchange', () => {
    if(!document.fullscreenElement && body.classList.contains('focus')) setFocus(false);
  });

  // Save / open the whole notebook of typed work as one file.
  const _rmSend = document.getElementById('rmSend');
  if(_rmSend) _rmSend.onclick = sendRomano;
  const _rmIn = document.getElementById('rmInput');
  if(_rmIn) _rmIn.onkeydown = e => {
    if(e.key === 'Enter' && (e.metaKey || e.ctrlKey)){ e.preventDefault(); sendRomano(); }
    e.stopPropagation();          // Escape closes the window, not the reader's focus mode
  };
  const _rmEx = document.getElementById('rmExport');
  if(_rmEx) _rmEx.onclick = () => exportTranscript(_rmEx);
  document.addEventListener('keydown', e => {
    if(e.key !== 'Escape') return;
    const o = document.getElementById('romanoOverlay');
    if(o && o.classList.contains('open')){ closeRomanoChat(); e.stopPropagation(); }
  });

  // Permanent, so Settings can open them from any tab. Wired once; the per-render
  // wiring left with the shelf bar.
  const _readIn = document.getElementById('readInput');
  if(_readIn) _readIn.onchange = async () => { await addReadingFiles(_readIn.files); _readIn.value = ''; };
  const _readDirIn = document.getElementById('readFolderInput');
  if(_readDirIn) _readDirIn.onchange = async () => { await addReadingFiles(_readDirIn.files); _readDirIn.value = ''; };
  const _saveBtn = document.getElementById('saveWorkBtn');
  if(_saveBtn) _saveBtn.addEventListener('click', saveWork);
  const _chatBtn = document.getElementById('exportChatBtn');
  if(_chatBtn) _chatBtn.addEventListener('click', () => exportTranscript(_chatBtn));
  const _wfi = document.getElementById('workFileInput');
  const _openBtn = document.getElementById('openWorkBtn');
  if(_openBtn && _wfi){ _openBtn.addEventListener('click', ()=>_wfi.click()); _wfi.addEventListener('change', ()=>{ if(_wfi.files[0]) openWork(_wfi.files[0]); _wfi.value=''; }); }

  // The three of them live behind one opener now. Closing on outside-click, on Escape
  // My Progress was a lens inside Notebook and nothing outside Notebook pointed at it.
  // From the topbar it is reachable from wherever the student happens to be writing.
  const _mpBtn = document.getElementById('myProgressBtn');
  if(_mpBtn) _mpBtn.addEventListener('click', () => { if(G.running) return; noteMode = 'tags'; show('note'); });
  // Same door, different lens. Guarded on G.running like every other tab move: the
  // One-Pager timer is the one place navigation must not be possible.
  const _calBtn = document.getElementById('calendarBtn');
  if(_calBtn) _calBtn.addEventListener('click', () => { if(G.running) return; noteMode = 'day'; show('note'); });

  wireNameField();

  // Theme. The class lives on <html>, set pre-paint by the inline script in index.html;
  // this only has to keep the button and DB in step with it.
  const _setThemeBtn = document.getElementById('setThemeBtn');
  function paintTheme(){
    const modern = document.documentElement.classList.contains('theme-modern');
    const label = modern ? '◐ Parchment' : '◑ Modern';
    if(_setThemeBtn) _setThemeBtn.textContent = label;
    const v = document.getElementById('viewThemeBtn');
    if(v) v.textContent = label;
  }
  if(DB.theme === 'modern') document.documentElement.classList.add('theme-modern');
  paintTheme();
  function toggleTheme(){
    const modern = document.documentElement.classList.toggle('theme-modern');
    DB.theme = modern ? 'modern' : 'parchment';
    saveDB();
    paintTheme();
    logEvent('ui', 'theme → ' + (modern ? 'modern' : 'parchment'));
  }
  if(_setThemeBtn) _setThemeBtn.addEventListener('click', toggleTheme);

  // ── Settings modal. Tabs, and the folder control rendered into the Readings tab
  //    so the shelf itself stays uncluttered.
  // ── AI tab, after Allegory's. The point is that a student should not have to
  //    know what an endpoint is: probe the ports a local model actually listens on,
  //    ask each one what models it has, and show them as one-click tiles.
  //
  //    Both 127.0.0.1 AND the host that served this page are probed. The second is
  //    what lets a laptop reach a model running on the machine that served it —
  //    the browser cannot see its own LAN address, but it always knows the one it
  //    loaded from.
  const LOCAL_PORTS = [{ port: 8765, hint: 'OpenAI-compatible shim' },
                       { port: 11434, hint: 'Ollama' },
                       { port: 1234, hint: 'LM Studio' }];
  const EXTRA_ENDPOINTS_KEY = 'cr_local_endpoints';
  let _aiSub = 'local', _probe = null;
  function localHosts(){
    const hosts = ['127.0.0.1'];
    try { const h = location.hostname; if(h && !['127.0.0.1','localhost','::1',''].includes(h)) hosts.push(h); } catch(e){}
    return hosts;
  }
  function extraEndpoints(){ try { return JSON.parse(localStorage.getItem(EXTRA_ENDPOINTS_KEY)) || []; } catch(e){ return []; } }
  function addExtraEndpoint(u){ const a = extraEndpoints(); if(!a.includes(u)){ a.push(u); localStorage.setItem(EXTRA_ENDPOINTS_KEY, JSON.stringify(a)); } }
  // Embedding models cannot chat; listing them only invites a confusing failure.
  const isEmbedding = id => /embed|bge-|nomic|gte-|minilm/i.test(id);
  async function listLocalModels(endpoint, ms){
    const clean = String(endpoint).replace(/\/$/, '');
    try {
      // Same key as the chat call. Without it a proxied endpoint 401s here, lists
      // no models, and the server simply never appears in the panel -- which looks
      // exactly like "nothing is running" and sends you debugging the wrong thing.
      const res = await fetch(clean + '/v1/models', { headers: localHeaders(), signal: AbortSignal.timeout(ms || 2000) });
      if(!res.ok) return null;
      const data = await res.json();
      if(!data || !data.data) return null;
      const out = data.data.filter(m => m && m.id && !isEmbedding(m.id)).map(m => ({ id: m.id, endpoint: clean }));
      return out.length ? out : null;
    } catch(e){ return null; }
  }
  async function probeLocal(){
    const urls = [];
    localHosts().forEach(h => LOCAL_PORTS.forEach(p => urls.push('http://' + h + ':' + p.port)));
    extraEndpoints().forEach(u => { if(!urls.includes(u)) urls.push(u); });
    const found = await Promise.all(urls.map(async u => { const m = await listLocalModels(u, 1500); return m ? { url:u, models:m } : null; }));
    return found.filter(Boolean);
  }
  // keyUrl, when given, adds a "Get a key ↗" link inside the card. Keys here are
  // collected with prompt(), which cannot carry a link, so without this a student
  // who has no key is told to paste one with no way to find out where from.
  function aiCard(title, sub, badge, on, onclick, keyUrl){
    const b = document.createElement('button');
    b.className = 'ai-card' + (on ? ' on' : '');
    b.innerHTML = `<span class="ai-card-main"><b>${escHtml(title)}</b><small>${escHtml(sub)}</small>` +
                  (keyUrl ? `<a class="ai-getkey" href="${escHtml(keyUrl)}" target="_blank" rel="noopener">Get a key ↗</a>` : '') +
                  `</span>` +
                  (badge ? `<span class="ai-badge">${escHtml(badge)}</span>` : '');
    b.onclick = onclick;
    // The link is inside a button; without this, following it also fires the
    // card's prompt() behind the newly-opened tab.
    const a = b.querySelector('.ai-getkey');
    if(a) a.addEventListener('click', e => e.stopPropagation());
    return b;
  }
  function renderAiTab(){
    const list = document.getElementById('aiList'); if(!list) return;
    const sel = document.getElementById('aiSelected');
    // Always "Selected: …", the same phrasing as the other apps' panels — the
    // label answers one question and should answer it the same way everywhere.
    if(sel){
      sel.innerHTML = 'Selected: <b></b>';
      sel.querySelector('b').textContent = getProvider() === 'none' ? 'none' : aiLabel();
    }
    const foot = document.getElementById('aiFoot');
    list.innerHTML = '';

    if(_aiSub === 'local'){
      if(foot) foot.textContent = 'Auto-checked ports ' + LOCAL_PORTS.map(p=>p.port).join(', ') + ' on this device and on the computer that served this page.';
      list.innerHTML = '<p class="ai-scan">Looking for a model on this computer…</p>';
      probeLocal().then(found => {
        if(document.getElementById('aiList') !== list) return;
        list.innerHTML = '';
        const cur = getProvider() === 'local' ? (getLocalEndpoint() + '|' + getLocalModel()) : '';
        const pick = preferLocal(found);
        const all = flattenLocal(found);
        const shown = _showAllLocal ? all : pick.list;
        if(pick.hidden && !_showAllLocal) logEvent('ai', 'local models hidden', {
          shown: pick.list.map(x => x.id), hidden: pick.hidden });
        shown.forEach(m => {
          list.appendChild(aiCard(m.id, m.url, 'Local', cur === (m.url + '|' + m.id), () => {
            localStorage.setItem(PROVIDER_KEY, 'local');
            localStorage.setItem(LOCAL_ENDPOINT_KEY, m.url);
            localStorage.setItem(LOCAL_MODEL_KEY, m.id);
            addExtraEndpoint(m.url);
            logEvent('ai', 'provider → local', { endpoint: m.url, model: m.id });
            updateAIBtn(); renderAiTab();
          }));
        });
        // The way past the default, for the person who set it.
        if(pick.hidden){
          const more = document.createElement('button');
          more.className = 'ai-more';
          more.textContent = _showAllLocal
            ? 'Show only the model for this course'
            : `Show all ${all.length} models on this server`;
          more.onclick = () => { _showAllLocal = !_showAllLocal; renderAiTab(); };
          list.appendChild(more);
        }
        if(!found.length) list.innerHTML =
          '<p class="ai-scan">No local model answered. Start Ollama (or LM Studio) and reopen this tab. ' +
          'If the page is served over https, the model must allow this origin — see OLLAMA_ORIGINS.</p>';
        const add = document.createElement('div');
        add.className = 'ai-add';
        add.innerHTML = '<b>+ Add local server</b><small>Custom URL — anything speaking OpenAI-compatible /v1/chat/completions</small>' +
                        '<input type="text" id="aiAddUrl" placeholder="http://127.0.0.1:11434" autocomplete="off" spellcheck="false">';
        list.appendChild(add);

        // Class key. Blank for a model on your own machine, which is the normal
        // case and wants no credentials. Filled in only when the server is one
        // Todd is running for the class behind a proxy that asks who you are --
        // the same key for everyone, handed out in class, not a personal secret.
        const keyBox = document.createElement('div');
        keyBox.className = 'ai-add';
        keyBox.innerHTML = '<b>Class key <span style="font-weight:400;color:#6b7280">(optional)</span></b>'
          + '<small>Leave empty for a model on this computer. Needed only for a shared server that asks for one.</small>'
          + '<input type="password" id="aiLocalKey" placeholder="none" autocomplete="off" spellcheck="false">';
        list.appendChild(keyBox);
        const kinp = keyBox.querySelector('#aiLocalKey');
        kinp.value = getLocalKey();
        // Saved on the way out rather than per keystroke: this is pasted, and a
        // half-pasted key written to storage would break the next probe.
        const saveKey = () => {
          const v = kinp.value.trim();
          if(v === getLocalKey()) return;
          if(v) localStorage.setItem(LOCAL_KEY, v); else localStorage.removeItem(LOCAL_KEY);
          logEvent('ai', 'local key ' + (v ? 'set' : 'cleared'));
          toast(v ? 'Class key saved. Rechecking…' : 'Class key cleared.');
          renderAiTab();
        };
        kinp.addEventListener('blur', saveKey);
        kinp.addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); saveKey(); } });
        const inp = add.querySelector('#aiAddUrl');
        inp.addEventListener('keydown', async e => {
          if(e.key !== 'Enter') return;
          const u = inp.value.trim().replace(/\/$/, ''); if(!u) return;
          inp.disabled = true;
          const models = await listLocalModels(u, 3000);
          inp.disabled = false;
          if(!models){ toast('Nothing answered at ' + u); return; }
          addExtraEndpoint(u); toast('Found ' + models.length + ' model(s)'); renderAiTab();
        });
      });
      return;
    }

    if(_aiSub === 'free'){
      if(foot) foot.textContent = 'Free tiers. The key is stored in this browser and sent only to that provider.';
      [['gemini','Gemini 2.5 Flash','Free tier via Google — use a personal Gmail account.', GEMINI_KEY, 'https://aistudio.google.com/app/apikey'],
       ['groq','Groq · ' + getGroqModel(),'Free tier. Any email — no Google account needed.', GROQ_KEY, 'https://console.groq.com/keys']]
        .forEach(([id,title,sub,keyName,keyUrl]) => {
          list.appendChild(aiCard(title, sub, 'Free', getProvider() === id, () => {
            const k = prompt('Paste your ' + title + ' API key:', localStorage.getItem(keyName) || '');
            if(k === null) return;
            localStorage.setItem(keyName, k.trim());
            localStorage.setItem(PROVIDER_KEY, id);
            logEvent('ai', 'provider → ' + id);
            updateAIBtn(); renderAiTab();
          }, keyUrl));
        });
      return;
    }

    if(foot) foot.textContent = 'Paid providers, billed to your own account. Keys stay in this browser.';
    list.appendChild(aiCard('Anthropic Claude', 'Your own key. Claude Sonnet — powerful and precise.', 'Own key',
      getProvider() === 'anthropic', () => {
        const k = prompt('Paste your Anthropic API key:', localStorage.getItem(ANTHROPIC_KEY) || '');
        if(k === null) return;
        localStorage.setItem(ANTHROPIC_KEY, k.trim());
        localStorage.setItem(PROVIDER_KEY, 'anthropic');
        logEvent('ai', 'provider → anthropic'); updateAIBtn(); renderAiTab();
      }, 'https://console.anthropic.com/settings/keys'));
    list.appendChild(aiCard('OpenAI-compatible', localStorage.getItem(CUSTOM_ENDPOINT_KEY) || 'Any /v1/chat/completions endpoint', 'Own key',
      getProvider() === 'custom', () => { window.closeSettings(); openAIModal(); }));
  }

  function openSettings(){
    document.getElementById('settingsOverlay').classList.add('open');
    renderAiTab();
    const f = document.getElementById('setFolder');
    if(f){
      f.innerHTML = FS_OK ? (folderChip() || '') : '';
      const pick = document.getElementById('pickDir'); if(pick) pick.onclick = pickReadingsFolder;
      const re = document.getElementById('reconnectDir'); if(re) re.onclick = reconnectReadingsFolder;
      const fg = document.getElementById('forgetDir'); if(fg) fg.onclick = forgetReadingsFolder;
    }
    const lf = document.getElementById('setLoadFiles');
    if(lf) lf.onclick = () => document.getElementById('readInput').click();
    const ld = document.getElementById('setLoadFolder');
    if(ld) ld.onclick = () => document.getElementById('readFolderInput').click();
    const zp = document.getElementById('setZipReadings');
    if(zp) zp.onclick = () => zipReadings(zp);
    renderDiagnostics(); renderDiagSnapshot();
  }
  window.openSettings = openSettings;
  // The single entry point to the AI chooser: the toolbar AI button and every
  // "you have not set this up yet" path in callModel() call this.
  window.openSettingsAI = function openSettingsAI() {
    openSettings();
    document.querySelectorAll('#setTabs .set-tab').forEach(x => x.classList.toggle('on', x.dataset.set === 'ai'));
    document.querySelectorAll('.set-pane').forEach(x => x.classList.toggle('on', x.id === 'set-ai'));
    renderAiTab();
  };
  // saveAISettings() lives outside this block and has to refresh the panel
  // behind the custom-endpoint modal once a save lands.
  window.renderAiTab = renderAiTab;
  window.closeSettings = () => document.getElementById('settingsOverlay').classList.remove('open');
  const _setBtn = document.getElementById('settingsBtn');
  if(_setBtn) _setBtn.addEventListener('click', openSettings);
  document.querySelectorAll('#setTabs .set-tab').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('#setTabs .set-tab').forEach(x => x.classList.toggle('on', x === b));
    document.querySelectorAll('.set-pane').forEach(x => x.classList.toggle('on', x.id === 'set-' + b.dataset.set));
    if(b.dataset.set === 'diag'){ renderDiagnostics(); renderDiagSnapshot(); renderDiagToggleMeta();
                                  renderUpdateBox(); checkForUpdate(false); }
    if(b.dataset.set === 'ai') renderAiTab();
  }));
  document.querySelectorAll('#aiSubTabs .ai-subtab').forEach(b => b.addEventListener('click', () => {
    _aiSub = b.dataset.ai;
    document.querySelectorAll('#aiSubTabs .ai-subtab').forEach(x => x.classList.toggle('on', x === b));
    renderAiTab();
  }));
  const _aiOff = document.getElementById('aiDisable');
  if(_aiOff) _aiOff.addEventListener('click', () => {
    localStorage.setItem(PROVIDER_KEY, 'none');
    logEvent('ai', 'provider → none'); updateAIBtn(); renderAiTab(); toast('AI disabled');
  });
  const _dCopy = document.getElementById('diagCopy');
  if(_dCopy) _dCopy.addEventListener('click', copyDetailsAndEmail);
  const _dPdf = document.getElementById('diagPdf');
  if(_dPdf) _dPdf.addEventListener('click', printReport);
  const _dTog = document.getElementById('diagToggle');
  if(_dTog) _dTog.addEventListener('click', toggleDiagFold);
  const _dDown = document.getElementById('diagDownload');
  if(_dDown) _dDown.addEventListener('click', async () => {
    const blob = new Blob([await diagnosticsText()], { type:'text/plain' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'journaler-diagnostics-' + new Date().toISOString().slice(0,19).replace(/[:T]/g,'-') + '.txt';
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
  });
  const _dClear = document.getElementById('diagClear');
  if(_dClear) _dClear.addEventListener('click', () => {
    const kept = _log.slice();
    clearLog();
    undoably('Event log cleared', () => { _log = kept; try { localStorage.setItem(LOG_KEY, JSON.stringify(_log)); } catch(e){} renderDiagnostics(); });
  });
  document.addEventListener('keydown', e => {
    if(e.key === 'Escape'){
      const o = document.getElementById('settingsOverlay');
      if(o && o.classList.contains('open')){ window.closeSettings(); e.stopPropagation(); }
    }
  });
  logEvent('boot', 'app ready · build ' + BUILD);

  // Restore the readings folder on load. queryPermission needs no user gesture, so
  // a folder that is still granted refills the shelf silently; anything else waits
  // behind the Reconnect button, since requestPermission DOES need a gesture.
  if(FS_OK) (async () => {
    let h = null;
    try { h = await idbGet('handles','readingsDir'); } catch(e){ return; }
    if(!h) return;
    readingsDir = h;
    try {
      const p = await h.queryPermission({ mode:'read' });
      if(p === 'granted') await syncFolderReadings();
      else { readingsDirState = 'prompt'; rerenderReadIfVisible(); }
    } catch(e){ readingsDirState = 'missing'; rerenderReadIfVisible(); }
  })();

  show('tips');
})();

// ===== init =====
updateAIBtn();
