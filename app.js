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
  }
  async function renderDiagSnapshot(){
    const el = document.getElementById('diagSnap');
    if(!el) return;
    const snap = await diagnosticsSnapshot();
    el.innerHTML = Object.keys(snap).map(k =>
      `<div class="diag-kv"><span>${escHtml(k)}</span><b>${escHtml(String(snap[k]))}</b></div>`).join('');
  }
  async function diagnosticsText(){
    const snap = await diagnosticsSnapshot();
    const head = Object.keys(snap).map(k => `${k}: ${snap[k]}`).join('\n');
    const log = _log.map(e => `${e.t.slice(11,19)}  ${e.kind.padEnd(8)} ${e.msg}${e.data===undefined?'':'  '+(typeof e.data==='string'?e.data:JSON.stringify(e.data))}`).join('\n');
    return `Journaler-284 diagnostics\n${'='.repeat(48)}\n${head}\n\nEVENTS (oldest first)\n${'-'.repeat(48)}\n${log}\n`;
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
  function confirmReplace(incoming){
    const now  = (DB.journal || []).length;
    const next = Array.isArray(incoming && incoming.journal) ? incoming.journal.length : 0;
    if(!now) return true;                       // nothing here to lose
    const ent = n => n + ' notebook ' + (n === 1 ? 'entry' : 'entries');
    const lines = ['This REPLACES everything in this browser. It cannot be undone.', '',
                   'In this browser now:   ' + ent(now),
                   'In the file you chose: ' + ent(next), ''];
    if(next < now) lines.push('\u26a0 The file has FEWER entries than this browser.',
                              '   You would lose ' + (now - next) + '.', '');
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
  function toast(msg, action){
    let el = document.getElementById('cr284Toast');
    if(!el){ el = document.createElement('div'); el.id = 'cr284Toast'; el.style.cssText = 'position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:var(--ink);color:var(--parchment);font-family:var(--sans);font-size:15px;padding:9px 16px;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.25);z-index:60;opacity:0;transition:opacity .2s;pointer-events:none;display:flex;align-items:center;gap:14px'; document.body.appendChild(el); }
    const hide = () => { el.style.opacity = '0'; el.style.pointerEvents = 'none'; };
    el.textContent = '';
    el.appendChild(document.createTextNode(msg));
    el.style.pointerEvents = action ? 'auto' : 'none';
    if(action){
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'toastact'; b.textContent = action.label;
      b.onclick = () => { clearTimeout(_toastT); hide(); action.onClick(); };
      el.appendChild(b);
    }
    el.style.opacity = '1'; clearTimeout(_toastT);
    _toastT = setTimeout(hide, action ? 4200 : 1700);
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
    toast('Kept in your notebook ✎', { label: 'View →', onClick: () => revealEntry(entry) });
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
    const w = pop.offsetWidth || 292, h = pop.offsetHeight || 190;
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
      if(idx >= 0){ activeReading = idx; readPageNum = 1; _curPdf = { id:null, doc:null }; persistReadings(); }
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
      f:'On Monday you gushed about why you write. Romano\'s license plate reads <em>Write 2</em> — <em>write to express, write to communicate, write to clarify, write to learn.</em> Any of those reasons you did not have? What do you make of that? <span class="hint">In Week 15 you come back to this, and to your Week 1 answers.</span>',
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
    frame.querySelectorAll('[data-jump]').forEach(b => b.onclick = () => {
      const to = b.dataset.jump;
      if(to === 'threads'){ noteMode = 'threads'; renderNote(); return; }
      if(to === 'open'){ fwCur = 'open'; show('free'); return; }
      goToPiece(to);
    });
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
    frame.innerHTML = `<div class="head"><h1>Freewrite</h1><p>Start a timer, trust the gush, then shape it.</p></div>
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
    // Pasted images bypass the picker entirely, so shrink them once they have landed.
    page.addEventListener('paste',()=>{ setTimeout(()=>shrinkImagesIn(page,save),0); });
    // Sweep restored content once as well: anything inserted before this build is still
    // full-resolution in localStorage and in every PDF it exports. data-shrunk makes it
    // a one-time cost per image, not work repeated on every render.
    shrinkImagesIn(page, save);
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
  let readPageMode = DB.readPageMode || 'single';   // 'single' | 'continuous'
  let readPageNum = 1;                               // current page in single mode
  let _curPdf = { id:null, doc:null };               // cache the parsed doc so paging doesn't reparse

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
    _curPdf = { id:null, doc:null };
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
  function rerenderReadIfVisible(){ if(document.getElementById('readingSelect')) renderRead(); }

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
          if(token !== _readToken) return;
          _curPdf = { id:r.id, doc };
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
  let pdfCaptureMode = (typeof DB === 'object' && DB && DB.pdfCaptureMode) || 'select';
  let captureText = '', captureImage = '', captureRects = null;

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
  function setCaptureMode(m){
    pdfCaptureMode = m;
    document.querySelectorAll('.marquee-overlay').forEach(o=>{ o.style.pointerEvents = (m==='box')?'auto':'none'; });
    const btn = document.getElementById('captureModeBtn');
    if(btn){ btn.textContent = (m==='box') ? '▭ Box' : '✎ Select'; btn.classList.toggle('on', m==='box'); }
    document.body.classList.toggle('marquee-on', m==='box');
    if(typeof DB === 'object' && DB){ DB.pdfCaptureMode = m; saveDB(); }
  }
  function toggleCaptureMode(){ setCaptureMode(pdfCaptureMode==='box'?'select':'box'); }

  // Only one marquee can be dragged at a time, so the window listeners belong to
  // the module, not to a page. attachMarquee() runs per page per render, and it
  // used to add a mousemove/mouseup pair each time without ever removing them —
  // a continuous-mode repaint of a 14-page chapter leaked 28 listeners.
  let _mq = null;            // live drag: { overlay, canvas, textLayerDiv, startX, startY, boxEl }
  let _mqWired = false;
  function wireMarqueeWindowListeners(){
    if(_mqWired) return;
    _mqWired = true;
    window.addEventListener('mousemove', e => {
      if(!_mq) return;
      const r = _mq.overlay.getBoundingClientRect();
      const cx = e.clientX - r.left, cy = e.clientY - r.top;
      _mq.boxEl.style.left   = Math.min(_mq.startX, cx)+'px';
      _mq.boxEl.style.top    = Math.min(_mq.startY, cy)+'px';
      _mq.boxEl.style.width  = Math.abs(cx - _mq.startX)+'px';
      _mq.boxEl.style.height = Math.abs(cy - _mq.startY)+'px';
    });
    window.addEventListener('mouseup', () => {
      if(!_mq) return;
      const m = _mq; _mq = null;
      const r = m.boxEl.getBoundingClientRect();
      if(r.width < 6 || r.height < 6){ m.boxEl.remove(); return; }
      handleMarqueeCapture(r, m.canvas, m.textLayerDiv);
    });
  }
  function attachMarquee(overlay, canvas, textLayerDiv){
    wireMarqueeWindowListeners();
    overlay.addEventListener('mousedown', e => {
      if(pdfCaptureMode!=='box' || e.button!==0) return;
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
    // spans whose box mostly falls inside the marquee (>=35% area) …
    const hits = [];
    textLayerDiv.querySelectorAll('span').forEach(sp => {
      if(!sp.textContent || !sp.textContent.trim() || sp.classList.contains('markedContent')) return;
      const r = sp.getBoundingClientRect();
      if(!r.width || !r.height) return;
      const ix = Math.max(0, Math.min(r.right,boxRect.right)-Math.max(r.left,boxRect.left));
      const iy = Math.max(0, Math.min(r.bottom,boxRect.bottom)-Math.max(r.top,boxRect.top));
      if(ix*iy >= 0.35*(r.width*r.height)) hits.push(sp);
    });
    // … then expand to complete lines between the first and last hit word.
    const pr = passageLineRects(hits);
    const text = spansToText(pr.spans);
    const rects = normalizeRectsToPages(pr.rects);
    if(pr.rects.length) console.log('[hl] box capture →', pr.rects.length, 'line(s), build', BUILD);
    // cropped image of the region (for figures / to keep with a note)
    let imgData = '';
    try {
      const cRect = canvas.getBoundingClientRect();
      const sx = (boxRect.left-cRect.left)/cRect.width*canvas.width;
      const sy = (boxRect.top-cRect.top)/cRect.height*canvas.height;
      const sw = boxRect.width/cRect.width*canvas.width;
      const sh = boxRect.height/cRect.height*canvas.height;
      const tmp = document.createElement('canvas');
      tmp.width = Math.max(1,Math.round(sw)); tmp.height = Math.max(1,Math.round(sh));
      tmp.getContext('2d').drawImage(canvas, sx,sy,sw,sh, 0,0, tmp.width,tmp.height);
      imgData = tmp.toDataURL('image/png');
    } catch(e){ console.warn('crop', e); }
    openCapturePopup(text, imgData, boxRect, rects);
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
  function passageLineRects(anchors, selRects){
    if(!anchors || !anchors.length) return { rects:[], spans:[] };
    const set = new Set(anchors);
    const lines = docLines();
    let firstLine = -1, lastLine = -1, firstLeft = Infinity, lastRight = -Infinity;
    lines.forEach((ln, li) => {
      ln.items.forEach(it => {
        if(!set.has(it.sp)) return;
        if(firstLine === -1 || li < firstLine){ firstLine = li; firstLeft = it.left; }
        else if(li === firstLine){ firstLeft = Math.min(firstLeft, it.left); }
        if(li > lastLine){ lastLine = li; lastRight = it.right; }
        else if(li === lastLine){ lastRight = Math.max(lastRight, it.right); }
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
  // Native text selection (Select mode). Take only the start & end words the user
  // touched, then passageLineRects fills complete lines between them — so coverage
  // never follows the browser's rectangular selection geometry.
  function handleSelectionCapture(){
    if(pdfCaptureMode !== 'select') return;
    const sel = window.getSelection();
    if(!sel || sel.isCollapsed || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const node = range.commonAncestorContainer;
    const host = node.nodeType === 1 ? node : node.parentElement;
    if(!host || !host.closest || !host.closest('#docPane')) return;   // not in the reader
    // Take EVERY span the selection touches, the way box capture already does,
    // instead of only the two boundary spans. spanOf() returned null whenever a
    // boundary landed between spans — on a gap, a line end, the endOfContent div —
    // and the capture was then abandoned with no popup and no explanation. That is
    // why box "worked" and select was hit or miss.
    // The real selection rectangles, so a band can never cover less than the glyphs
    // the reader dragged over.
    const selRects = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 1);
    const cands = [...document.querySelectorAll('#docPane .textLayer span')]
      .filter(sp => sp.textContent && sp.textContent.trim() && !sp.classList.contains('markedContent'));
    // Hit-test GEOMETRICALLY, the way box capture does. range.intersectsNode walks
    // the DOM, but text-layer spans are absolutely positioned and their DOM order
    // does not track reading order — orderByReadingColumns re-sorts them — so the
    // range missed most of the spans it visibly covered: 9 anchors for an 8-line
    // selection. Overlap against the selection's own rectangles cannot lie.
    const anchors = cands.filter(sp => {
      if(range.intersectsNode(sp)) return true;
      const r = sp.getBoundingClientRect();
      const area = r.width * r.height;
      if(area <= 0) return false;
      return selRects.some(s => {
        const ix = Math.min(r.right, s.right) - Math.max(r.left, s.left);
        const iy = Math.min(r.bottom, s.bottom) - Math.max(r.top, s.top);
        return ix > 0 && iy > 0 && (ix * iy) >= area * 0.3;
      });
    });
    // Geometry first — see bandsFromSelection. passageLineRects (anchor-driven) is
    // kept only as a fallback for box capture, which supplies real hit-tested spans.
    // Pointer path first; the selection-rect path is the fallback for a selection
    // made without a drag (double-click, shift-click, keyboard).
    let pr = bandsFromPoints(_dragFrom, _dragTo);
    if(!pr.rects.length) pr = bandsFromSelection(selRects);
    if(!pr.rects.length && anchors.length) pr = passageLineRects(anchors, selRects);
    // Last resort: a selection the reader can SEE must always produce a popup.
    // But the browser's rects are PER WORD, so using them raw drew a striped band
    // with a gap at every space — the very artifact this all started with. Union
    // them into one rect per line first.
    let via = 'geometry';
    if(!pr.rects.length && selRects.length){ pr = { rects: unionRectsByLine(selRects), spans: anchors }; via = 'fallback'; }
    const text = pr.spans.length ? spansToText(pr.spans) : cleanOcrText(String(sel));
    if(text.length < 2) return;
    const rects = normalizeRectsToPages(pr.rects);
    if(!rects.length) return;
    logEvent('read', `selection → ${pr.rects.length} band(s)`, { via, anchors: anchors.length, cands: cands.length });
    console.log('[hl] select capture →', pr.rects.length, 'band(s) via', via,
                '· anchors', anchors.length, '/ cands', cands.length,
                '· selRects', selRects.length, '· docLines', docLines().length, '· build', BUILD);
    openCapturePopup(text, '', range.getBoundingClientRect(), rects);
  }

  function ensureCapturePopup(){
    let pop = document.getElementById('capturePopup');
    if(pop) return pop;
    pop = document.createElement('div'); pop.className='selection-popup'; pop.id='capturePopup'; pop.style.display='none';
    pop.innerHTML = `<img id="captureThumb" alt="captured region" style="display:none;max-width:100%;max-height:130px;border-radius:4px;margin-bottom:.5rem;border:1px solid rgba(0,0,0,.15)">
      <div class="popup-passage" id="capturePassage"></div>
      <input type="text" id="captureInput" placeholder="A question, or just a note…" autocomplete="off">
      <div class="popup-hint">Enter asks · blank just highlights</div>
      <div class="popup-quick"><button class="popup-chip" id="captureCopyBtn" title="Copy this passage (⌘C / Ctrl+C)">⧉ Copy</button><button class="popup-chip" id="captureNbBtn">📓 Keep in notebook</button><button class="popup-chip" id="captureFigBtn" style="display:none">↓ Save figure</button></div>
      <div class="popup-actions">
        <button class="popup-btn secondary" id="captureCancelBtn">Cancel</button>
        <button class="popup-btn secondary" id="captureSaveBtn">✎ Highlight</button>
        <button class="popup-btn primary" id="captureAskBtn">Ask Romano</button>
      </div>`;
    document.body.appendChild(pop);
    pop.querySelector('#captureCancelBtn').onclick = closeCapture;
    pop.querySelector('#captureSaveBtn').onclick = () => saveHighlight(false);
    pop.querySelector('#captureAskBtn').onclick  = () => saveHighlight(true);
    pop.querySelector('#captureNbBtn').onclick   = () => saveHighlight(false, true);
    pop.querySelector('#captureFigBtn').onclick = downloadCapture;
    pop.querySelector('#captureCopyBtn').onclick = copyCaptureText;
    pop.querySelector('#captureInput').addEventListener('keydown', e => {
      if(e.key==='Enter'){ e.preventDefault(); saveHighlight(true); }
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
  function openCapturePopup(text, imgData, boxRect, rects){
    captureText = text || ''; captureImage = imgData || ''; captureRects = rects || null;
    const pop = ensureCapturePopup();
    const thumb = pop.querySelector('#captureThumb');
    const figBtn = pop.querySelector('#captureFigBtn');
    if(captureImage){ thumb.src = captureImage; thumb.style.display='block'; figBtn.style.display=''; }
    else { thumb.removeAttribute('src'); thumb.style.display='none'; figBtn.style.display='none'; }
    pop.querySelector('#capturePassage').textContent = captureText
      ? (captureText.length>150 ? captureText.slice(0,150)+'…' : captureText)
      : '(figure — no text in this box)';
    const input = pop.querySelector('#captureInput'); input.value='';
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
    captureText = ''; captureImage = ''; captureRects = null;
  }
  function saveHighlight(ask, toNotebook){
    const pop = document.getElementById('capturePopup');
    const note = pop ? pop.querySelector('#captureInput').value.trim() : '';
    if(!captureText && !captureImage){ closeCapture(); return; }
    const passage = captureText;
    const rects = captureRects || [];
    const rec = {
      id: 'h' + Date.now() + '-' + Math.round(Math.random()*1e6),
      text: passage || '', image: captureImage || '', note,
      rects, page: (rects[0] && rects[0].page) || readPageNum, ts: Date.now()
    };
    addHighlight(rec);
    logEvent('save', 'highlight kept', { page: rec.page, chars: (rec.text||'').length });
    repaintHighlights();
    renderHighlightList();
    closeCapture();
    if(toNotebook) elevateHighlight(rec);
    if(ask && passage) askRomanoInto(passage, note, rec.page);
  }
  // Reading work counts toward the 50-pt Writer's Notebook, so a highlight can be
  // kept as a dated pass like any other piece. Carries its own citation, since the
  // notebook entry has to stand on its own away from the PDF.
  function elevateHighlight(rec){
    if(!rec) return;
    const r = readings[activeReading];
    const label = r ? readingLabel(r) : '';
    const where = label + (rec.page ? ', p. ' + rec.page : '');
    const body = [
      rec.text ? '“' + rec.text + '”' : '(figure)',
      where.trim() ? '— ' + where : '',
      rec.note ? '\n' + rec.note : ''
    ].filter(Boolean).join('\n');
    // One piece PER READING rather than a single "Reading notes" bucket, so the
    // notebook shows which chapter each pass came from and a chapter's notes
    // stack together the way a One-Pager's passes do.
    const pieceId = r ? 'reading:' + r.id : 'reading';
    elevate(pieceId, 'reading', label ? 'Reading · ' + label : 'Reading notes', body);
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
    const where = label + (rec.page ? ', p. ' + rec.page : '');
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
  function downloadCapture(){
    if(!captureImage) return;
    const a = document.createElement('a');
    a.href = captureImage; a.download = 'figure.png';
    document.body.appendChild(a); a.click(); a.remove();
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
    box.querySelectorAll('.hl-del[data-qa]').forEach(b => b.onclick = () => removeQA(b.dataset.qa));
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
  async function askRomanoInto(passage, question, page){
    const rid = currentReadingId(); if(!rid) return;
    if(getProvider()==='none'){
      // No-AI is a supported path — don't bank a question nothing will answer.
      const box = document.getElementById('newnote');
      if(box) box.insertAdjacentHTML('beforeend', '<div class="notecard"><em>Connect an AI (top right) and Romano will answer — optional; your reading and notes work without it.</em><br><em class="whois">Romano is the app\u2019s reading partner, named for the book\u2019s author. It is software, and its answers are its own.</em></div>');
      return;
    }
    const rec = addQA(rid, {
      id: 'q' + Date.now() + '-' + Math.round(Math.random()*1e6),
      passage: passage || '', question: question || '', reply: '', error: '', ts: Date.now()
    });
    if(!rec) return;
    _qaPending.add(rec.id);
    renderQAList();
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
    if(currentReadingId() === rid) renderQAList();
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
  function removeHighlight(id){
    const rid = currentReadingId(); if(!rid) return;
    persistHighlights(rid, getHighlights(rid).filter(h => h.id !== id));
    document.querySelectorAll(`.hl-mark[data-hl="${id}"]`).forEach(el => el.remove());
    renderHighlightList();
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
  function scrollToHighlight(id){
    const el = document.querySelector(`.hl-mark[data-hl="${id}"]`);
    if(el){ el.scrollIntoView({ behavior:'smooth', block:'center' }); flashMark(id); return; }
    const rec = getHighlights(currentReadingId()).find(h => h.id === id);
    if(!rec) return;
    const pg = (rec.rects && rec.rects[0] && rec.rects[0].page) || rec.page || 1;
    if(readPageMode === 'single' && pg !== readPageNum){
      readPageNum = pg;
      renderActiveDoc(readings[activeReading]);
      setTimeout(()=>{ const e2 = document.querySelector(`.hl-mark[data-hl="${id}"]`); if(e2){ e2.scrollIntoView({ behavior:'smooth', block:'center' }); flashMark(id); } }, 450);
    }
  }
  function applyNotesPane(){
    const r = document.querySelector('.reader');
    if(r) r.classList.toggle('notes-hidden', !notesOpen);
  }
  function renderHighlightList(){
    const el = document.getElementById('hlList'); if(!el) return;
    const list = getHighlights(currentReadingId());
    // Badge on the toggle, so work captured while the pane is closed still announces
    // itself instead of vanishing into a panel nobody can see.
    const badge = document.getElementById('hlCount');
    if(badge) badge.textContent = (!notesOpen && list.length) ? ' · ' + list.length : '';
    if(!list.length){ el.innerHTML = '<p class="hl-empty">No highlights yet. Select a passage (or ▭ box one) and choose ✎ Highlight.</p>'; return; }
    el.innerHTML = list.map(h => {
      // Keep the WHOLE passage in the DOM — selectable, copyable, and ready for the
      // hand-off into the Notebook. .hl-quote clamps it visually; clicking opens it.
      const quote = escHtml(h.text || '(figure)');
      // A thumbnail of text just duplicates the quote above it, and rides along in
      // ⤓ Save my work as base64. Keep it only for real figures (boxed, no text).
      const thumb = (!h.text && h.image) ? `<img src="${h.image}" alt="figure" class="hl-thumb">` : '';
      const note = h.note ? `<div class="hl-note">${escHtml(h.note)}</div>` : '';
      return `<div class="hl-card" data-hl="${h.id}"><div class="hl-quote" title="Click to show the whole passage">${quote}</div>${thumb}${note}<div class="hl-row"><button class="hl-goto" data-hl="${h.id}">Go to</button><button class="hl-nb" data-hl="${h.id}" title="Keep this in your Writer's Notebook">📓 Notebook</button><button class="hl-del" data-hl="${h.id}">Remove</button></div></div>`;
    }).join('');
    // Click the quote to expand/collapse — "Go to" already covers navigation.
    el.querySelectorAll('.hl-quote').forEach(q => q.onclick = () => q.closest('.hl-card').classList.toggle('open'));
    el.querySelectorAll('.hl-goto').forEach(b => b.onclick = () => scrollToHighlight(b.dataset.hl));
    // Clear-all. A highlight stores the rects it was SAVED with, so any band made by
    // an older build keeps its geometry for ever and no fix can repaint it — the
    // only remedy is to drop it and highlight again. Removing them one card at a
    // time is unreasonable when a reading has a dozen.
    el.insertAdjacentHTML('beforeend',
      `<button class="hl-clear" id="hlClearAll">Clear all ${list.length} on this reading</button>`);
    const clr = document.getElementById('hlClearAll');
    if(clr) clr.onclick = () => {
      if(!confirm(`Remove all ${list.length} highlights on this reading? This cannot be undone.`)) return;
      persistHighlights(currentReadingId(), []);
      document.querySelectorAll('.hl-mark').forEach(m => m.remove());
      renderHighlightList();
    };
    el.querySelectorAll('.hl-nb').forEach(b => b.onclick = () => elevateHighlight(list.find(h => h.id === b.dataset.hl)));
    el.querySelectorAll('.hl-del').forEach(b => b.onclick = () => removeHighlight(b.dataset.hl));
  }

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
  let readZoom = DB.readZoom || 'fit';
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
      _paneT = setTimeout(() => {
        const r = readings[activeReading];
        if(r && (r.type === 'pdf' || r.type === 'docx')) renderActiveDoc(r);
      }, 120);
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
    const navHost = document.getElementById('pageNav');
    if(navHost) navHost.innerHTML = single
      ? `<button class="pdfnav-btn" id="pgPrev" ${readPageNum<=1?'disabled':''}>‹ Prev</button><span class="pdfnav-lbl">Page ${readPageNum} of ${doc.numPages}</span><button class="pdfnav-btn" id="pgNext" ${readPageNum>=doc.numPages?'disabled':''}>Next ›</button>`
      : `<span class="pdfnav-lbl">${doc.numPages} pages · scroll to read</span>`;
    pane.innerHTML = '';
    const wrap = document.createElement('div'); wrap.className = 'pdf-doc'; pane.appendChild(wrap);
    if(single){
      const pv = document.getElementById('pgPrev'), nx = document.getElementById('pgNext');
      if(pv) pv.onclick = ()=>{ if(readPageNum>1){ readPageNum--; renderActiveDoc(r); } };
      if(nx) nx.onclick = ()=>{ if(readPageNum<doc.numPages){ readPageNum++; renderActiveDoc(r); } };
    }
    const avail = Math.max(320, pane.clientWidth - 64);
    // Fit-page needs the height the pane can actually show, less the nav strip.
    const availH = Math.max(280, pane.clientHeight - 96);
    const ratio = window.devicePixelRatio || 1;
    const pages = single ? [readPageNum] : Array.from({length:doc.numPages}, (_,i)=>i+1);
    for(const n of pages){
      if(token !== _readToken) return;
      const page = await doc.getPage(n);
      const unit = page.getViewport({ scale: 1 });
      const scale = zoomScale(unit, avail, availH);
      const viewport = page.getViewport({ scale });
      const pageDiv = document.createElement('div'); pageDiv.className = 'pdf-page'; pageDiv.dataset.page = n;
      pageDiv.style.width = viewport.width + 'px'; pageDiv.style.height = viewport.height + 'px';
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width * ratio); canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = viewport.width + 'px'; canvas.style.height = viewport.height + 'px';
      pageDiv.appendChild(canvas); wrap.appendChild(pageDiv);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport, transform: ratio !== 1 ? [ratio,0,0,ratio,0,0] : null }).promise;
      if(token !== _readToken) return;
      // Selectable text layer + marquee capture overlay (passages → Romano / Notebook).
      try {
        const tc = await page.getTextContent();
        if(token !== _readToken) return;
        // Clean OCR items before building the layer: drop duplicate-embedded text and
        // put them in reading order — helps both native selection and marquee capture.
        try { tc.items = orderByReadingColumns(dedupeTextItems(tc.items), unit.width); } catch(e2){ console.warn('column order', e2); }
        const tlDiv = document.createElement('div'); tlDiv.className = 'textLayer';
        tlDiv.style.setProperty('--scale-factor', scale);
        tlDiv.style.setProperty('--total-scale-factor', scale);
        pageDiv.appendChild(tlDiv);
        const TL = window.pdfjsLib && window.pdfjsLib.TextLayer;
        if(TL){ await new TL({ textContentSource: tc, container: tlDiv, viewport }).render(); }
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
        overlay.style.pointerEvents = (pdfCaptureMode === 'box') ? 'auto' : 'none';
        pageDiv.appendChild(overlay);
        attachMarquee(overlay, canvas, tlDiv);
        paintHighlightsForPage(pageDiv, n, r.id);
      } catch(e){ console.warn('text layer', e); }
    }
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
    readPageNum = 1; _curPdf = { id:null, doc:null };
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
  function renderRead(){
    body.classList.add('bleed');
    sortReadings();
    const options = readings.length
      ? readings.map((r,i)=>`<option value="${i}" ${i===activeReading?'selected':''} title="${escHtml(r.name)}">${escHtml(readingLabel(r))}</option>`).join('')
      : `<option value="-1">No readings loaded yet</option>`;
    const active = readings[activeReading];
    frame.innerHTML = `<div class="head"><h1>Readings</h1><p>Open a chapter, read closely, think in the margin. Full width — the reading fills the page, your notes sit off to the side.</p></div>
      <div class="shelf">
        <span class="shelf-lbl">Reading</span>
        <select id="readingSelect" class="reading-select" ${readings.length?'':'disabled'}>${options}</select>
        <button class="rchip-x" id="removeReading" title="Remove this reading from your shelf" ${readings.length<=1?'disabled':''}>✕ Remove</button>
        <span class="shelf-spacer"></span>
        ${folderChip()}
        <button class="openbtn" id="openReading">＋ Load readings</button>
        <button class="openbtn" id="openFolder">＋ Load a folder</button>
        <input type="file" id="readInput" accept=".pdf,.docx,.txt" multiple hidden>
        <input type="file" id="readFolderInput" webkitdirectory hidden>
      </div>
      <div class="reader">
        <div class="viewbar">
          <span class="vb-group" id="pageNav"></span>
          <span class="vb-spacer"></span>
          ${active && active.type === 'pdf' ? `<span class="viewseg"><button class="vbtn ${readPageMode==='single'?'on':''}" data-vm="single">Single page</button><button class="vbtn ${readPageMode==='continuous'?'on':''}" data-vm="continuous">Continuous</button></span>
          <button class="vbtn capmode" id="captureModeBtn" title="Box: drag a box on the page to capture a passage or figure. Toggle to select text normally.">▭ Box</button>
          <label class="zoomwrap">Zoom <select id="zoomSel" class="zoomsel">${ZOOMS.map(z=>`<option value="${z.v}" ${String(readZoom)===String(z.v)?'selected':''}>${z.t}</option>`).join('')}</select></label>` : ''}
          <button class="vbtn" id="notesToggle" title="Show or hide the notes pane. Highlighting keeps working either way.">${notesOpen ? '◧ Hide notes' : '◨ Show notes'}<span class="hl-count" id="hlCount"></span></button>
        </div>
        <div class="doc" id="docPane">${docBody(active)}</div>
        <aside class="notes">
          <h4>Your highlights</h4>
          <div id="hlList"></div>
          <div id="newnote"></div>
          <div class="askbar"><input placeholder="Ask Romano about the reading…" id="askin"><button class="btn sm" id="askbtn">Ask</button></div>
          <p class="whois">Romano is the app's reading partner, named for the book's author. It is software, and its answers are its own.</p>
          <p class="locknote" style="margin-top:10px">Highlights save automatically · export to your Notebook →</p>
        </aside>
      </div>`;
    if(active && (active.type === 'pdf' || active.type === 'docx')) renderActiveDoc(active);
    const sel = document.getElementById('readingSelect');
    sel.onchange = () => { const i = +sel.value; if(i>=0){ activeReading = i; readPageNum = 1; _curPdf = { id:null, doc:null }; persistReadings(); renderRead(); } };
    document.getElementById('removeReading').onclick = () => {
      if(readings.length<=1) return;
      readings.splice(activeReading, 1);
      if(activeReading >= readings.length) activeReading = readings.length - 1;
      readPageNum = 1; _curPdf = { id:null, doc:null };
      persistReadings(); renderRead();
    };
    frame.querySelectorAll('.vbtn[data-vm]').forEach(b => b.onclick = () => { readPageMode = b.dataset.vm; DB.readPageMode = readPageMode; saveDB(); renderRead(); });
    const zs = document.getElementById('zoomSel');
    if(zs) zs.onchange = () => { readZoom = zs.value; DB.readZoom = readZoom; saveDB(); const rr = readings[activeReading]; if(rr) renderActiveDoc(rr); };
    const cmBtn = document.getElementById('captureModeBtn');
    if(cmBtn){ cmBtn.onclick = toggleCaptureMode; setCaptureMode(pdfCaptureMode); }
    applyNotesPane();
    const nt = document.getElementById('notesToggle');
    if(nt) nt.onclick = () => {
      notesOpen = !notesOpen; DB.notesOpen = notesOpen; saveDB();
      nt.innerHTML = (notesOpen ? '◧ Hide notes' : '◨ Show notes') + '<span class="hl-count" id="hlCount"></span>';
      applyNotesPane(); renderHighlightList();
    };
    renderHighlightList();
    renderQAList();
    const dp = document.getElementById('docPane');
    if(dp){ dp.addEventListener('mouseup', handleSelectionCapture); trackDrag(dp); }
    watchPaneWidth(dp);
    const input = document.getElementById('readInput');
    const folderInput = document.getElementById('readFolderInput');
    document.getElementById('openReading').onclick = () => input.click();
    document.getElementById('openFolder').onclick = () => folderInput.click();
    const pickBtn = document.getElementById('pickDir');
    if(pickBtn) pickBtn.onclick = pickReadingsFolder;
    const reBtn = document.getElementById('reconnectDir');
    if(reBtn) reBtn.onclick = reconnectReadingsFolder;
    const fgBtn = document.getElementById('forgetDir');
    if(fgBtn) fgBtn.onclick = forgetReadingsFolder;
    input.onchange = async () => { await addReadingFiles(input.files); input.value = ''; };
    folderInput.onchange = async () => { await addReadingFiles(folderInput.files); folderInput.value = ''; };
    // The ask bar is for the reading at large — no passage. It used to pass the
    // lingering captureText, which is what filed stray questions under old quotes.
    // Enter submits as well as the button: this is a chat box, and every other
    // chat box in the world sends on Enter. Without it the typed question just
    // sits there and the reader assumes the AI is broken.
    const askEl = document.getElementById('askin');
    const sendAsk = () => {
      const v = askEl.value.trim();
      if(!v) return;
      askEl.value = '';
      askRomanoInto('', v, readPageNum);
    };
    document.getElementById('askbtn').addEventListener('click', sendAsk);
    askEl.addEventListener('keydown', e => {
      // Shift+Enter stays free for anyone who expects it to mean "not yet".
      if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); sendAsk(); }
    });
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
  let noteMode = 'day';        // 'day' | 'piece' | 'tags' | 'threads'
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
    const head = (opts.showPiece === false) ? when : `${escHtml(e.pieceTitle)} · ${when}`;
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
    return `<div class="notedetail"><h3>${label}</h3>${entries}
      <div class="entryrow"><div class="k">Quick-write for this day</div><textarea id="noteCompose" placeholder="Jot a note or free-write, then keep it…" style="width:100%;min-height:88px;box-sizing:border-box;font-family:var(--serif);font-size:17px;line-height:1.65;padding:10px 12px;border:1px solid var(--comment-border);border-radius:6px;resize:vertical"></textarea>
      <button class="btn sm" id="noteSaveBtn" style="margin-top:8px">Keep this page</button></div></div>`;
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
  //   23 Aug 2026, because Todd asked whether the figure had moved back to 20. It had
  //   not, and never was: the document says "Expect 25 to 40 entries by December", and
  //   the Kept practice row scores 25+ full, 15-24 partial, under 15 none. The nearest
  //   thing to 20 is the middle of the partial band.
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
      <p>Anything you write is fair game to bring in here and rethink, expand or rewrite. What
        does <em>not</em> belong is a finished draft that already lives somewhere else — your
        timed One-Pager gushes go in on sheet two of their own PDF, and nothing gets counted
        twice.</p>
      <p><strong>Most of these mark themselves.</strong> The four required entries have their own
        pages under <em>Freewrite → For the notebook</em>: write one, keep it, and it is marked in
        the same action. Your Look-Back Letter too. The only thing left for December is flagging
        the three entries you want read closely.</p>
      <table class="ap-rows">
        <tr><td>1 · Kept practice</td><td>20</td><td>Every entry you keep. Nothing to mark.</td></tr>
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
      <table class="pjtable">
        ${row(1, 'Kept practice', 20, `Every entry you keep, from anywhere. Nothing to tag. ${jump('Open page →','open')}`,
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
  function numberedEntries(){
    // 'conversation' entries are kept AI exchanges. They are welcome in the notebook
    // -- the Guidelines invite "anything else you want to keep" -- but they are NOT
    // the student's practice, and this list is what the grade is counted from:
    // "Expect 25 to 40 entries by December", Contents carries "every entry, numbered,
    // dated, with its word count", and "Nothing gets counted twice". So they are
    // excluded from numbering, from Contents, and from the word count, and are
    // printed separately under their own heading instead.
    return (DB.journal || []).filter(e => e.pieceKind !== 'conversation').slice().sort((a,b) =>
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

  function renderNote(){
    body.classList.add('bleed');
    // The Tags lens advertises itself. Todd: "Folks won't know to click on Tags." A lens
    // name sitting third in a row of three says nothing about being required before you
    // submit, so it carries its own count and goes red until every column is filled.
    const _R = readiness(); const tagDone = _R.done, tagAll = _R.all;
    const tagBadge = (DB.journal||[]).length
      ? `<span class="nbcount ${tagDone<tagAll?'todo':'ready'}">${tagDone}/${tagAll}</span>` : '';
    const toggle = `<div class="nbviews"><button class="nbview ${noteMode==='day'?'on':''}" data-mode="day">By day</button><button class="nbview ${noteMode==='piece'?'on':''}" data-mode="piece">By piece</button><button class="nbview ${noteMode==='tags'?'on':''}" data-mode="tags">My Progress ${tagBadge}</button><button class="nbview ${noteMode==='threads'?'on':''}" data-mode="threads">Threads</button></div>`;
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
      const comeback = `<div class="comeback">
        <h4>What keeps coming back</h4>
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
      frame.innerHTML = `<div class="head"><h1>Notebook</h1><p>Hold one preoccupation still and watch it change across the term.</p>${toggle}</div>
        ${threadsAbout()}
        <div class="notewrap">${leftT}${rightT}</div>`;
      frame.querySelectorAll('.nbview').forEach(b => b.onclick = () => { noteMode = b.dataset.mode; nbEditingId = null; renderNote(); });
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
      frame.querySelectorAll('.nbview').forEach(b => b.onclick = () => { noteMode = b.dataset.mode; nbEditingId = null; renderNote(); });
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
      const first = new Date(y, m, 1).getDay(), days = new Date(y, m+1, 0).getDate();
      const dow = ['S','M','T','W','T','F','S'].map(x=>`<div class="dow">${x}</div>`).join('');
      let cells = '';
      for(let i=0;i<first;i++) cells += '<div class="cell" style="visibility:hidden;border:none"></div>';
      for(let dd=1; dd<=days; dd++){
        const key = `${y}-${String(m+1).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
        const list = journalByDate(key);
        // Legacy only: One-Pagers are submitted as their own PDF and no longer
        // elevate into the notebook, so nothing new carries this kind. Entries saved
        // before that change still render with their marker.
        const isOp = list.some(e=>e.pieceKind === 'one-pager');
        cells += `<div class="cell ${list.length?'entry':''} ${isOp?'op':''} ${noteSel===key?'sel':''}" data-key="${key}">${dd}</div>`;
      }
      leftPane = `<div class="cal">
        <div class="calhead"><button class="calnav" id="prevM" aria-label="Previous month" ${(y*12+m)<=NOTE_MIN?'disabled':''}>‹</button><span class="mname">${monthName}</span><button class="calnav" id="nextM" aria-label="Next month" ${(y*12+m)>=NOTE_MAX?'disabled':''}>›</button></div>
        <div class="grid">${dow}${cells}</div>
        <p class="runline" style="margin-top:12px">● green = a kept page. Click a day to read it.</p>
        ${noteFoot()}</div>`;
      rightPane = noteDayDetail();
    } else {
      const pieces = journalPieces();
      const listHtml = pieces.length
        ? pieces.map(p=>`<button class="moment has ${notePieceSel===p.id?'on':''}" data-piece="${p.id}"><span class="mname"><span class="dot"></span>${escHtml(p.title)}</span><span class="mkind">${p.entries.length} kept pass${p.entries.length>1?'es':''}</span></button>`).join('')
        : `<p class="empty" style="font-family:var(--sans)">Nothing kept yet. This fills with everything you decide to keep — free-writes, currere gushes, reading notes, the four required entries — each one dated, numbered, and counted toward <strong>Kept practice</strong>, the largest row on the rubric. Write in any tab, then press <strong>＋ Add to notebook</strong>.</p>`;
      leftPane = `<div class="piecelist"><p class="lead">Your pieces</p>${listHtml}
        ${noteFoot()}</div>`;
      rightPane = notePieceDetail();
    }
    frame.innerHTML = `<div class="head"><h1>Notebook</h1><p>Your kept pages — the writing you elevated with <strong>＋ Add to notebook</strong>. See them <strong>by day</strong>, or watch one piece grow <strong>by piece</strong>. This is the 50-pt Writer’s Notebook.</p>${toggle}</div>
      ${draftTray()}
      <div class="notewrap">${leftPane}${rightPane}</div>`;

    frame.querySelectorAll('.nbview').forEach(b => b.onclick = () => { noteMode = b.dataset.mode; nbEditingId = null; renderNote(); });
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
      const nsb = document.getElementById('noteSaveBtn');
      if(nsb) nsb.onclick = () => { const box = document.getElementById('noteCompose'); const txt = (box.value||'').trim(); if(!txt) return; elevate('free', 'freewrite', 'Free-writes & quick-writes', txt, noteSel); renderNote(); };
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
    frame.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { if(confirm('Delete this page? This cannot be undone.')){ deleteEntry(b.dataset.del); nbEditingId = null; renderNote(); } });
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

    const rail = `<nav class="poemrail">
      <p class="lead">Every tip this term</p>
      ${all.map(q => `<button class="pmlink ${q.date === t.date ? 'on' : ''}"
        data-tip="${q.date}" title="${escHtml(q.chapter + ' — ' + q.author)}"
        ><span class="pmwhen">${escHtml(shortDate(q.date))}</span
        ><span class="pmwhat">${escHtml(q.chapter)}</span></button>`).join('')}
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
      tipSel = b.dataset.tip; renderTip();
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
  function show(t){ tab=t; document.querySelectorAll('#tabbar button').forEach(b=>b.classList.toggle('on',b.dataset.t===t)); body.classList.toggle('reading', t==='read'); R[t](); paintInsMarker(); }
  document.querySelectorAll('#tabbar button').forEach(b=>b.addEventListener('click',()=>{ if(G.running)return; show(b.dataset.t); }));
  function setFocus(on){ body.classList.toggle('focus',on); }
  document.getElementById('focusToggle').addEventListener('click',()=>setFocus(!body.classList.contains('focus')));
  document.getElementById('exitFocus').addEventListener('click',()=>setFocus(false));
  document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&!G.running) setFocus(false); });

  // Save / open the whole notebook of typed work as one file.
  const _saveBtn = document.getElementById('saveWorkBtn');
  if(_saveBtn) _saveBtn.addEventListener('click', saveWork);
  const _chatBtn = document.getElementById('exportChatBtn');
  if(_chatBtn) _chatBtn.addEventListener('click', () => exportTranscript(_chatBtn));
  const _wfi = document.getElementById('workFileInput');
  const _openBtn = document.getElementById('openWorkBtn');
  if(_openBtn && _wfi){ _openBtn.addEventListener('click', ()=>_wfi.click()); _wfi.addEventListener('change', ()=>{ if(_wfi.files[0]) openWork(_wfi.files[0]); _wfi.value=''; }); }

  // The three of them live behind one opener now. Closing on outside-click, on Escape
  // and on choosing an item: a menu that stays open over the writing surface is worse
  // than the three buttons it replaced.
  const _mwBtn = document.getElementById('myWorkBtn'), _mwMenu = document.getElementById('myWorkMenu');
  if(_mwBtn && _mwMenu){
    const setMenu = open => { _mwMenu.hidden = !open; _mwBtn.setAttribute('aria-expanded', String(open)); };
    _mwBtn.addEventListener('click', e => { e.stopPropagation(); setMenu(_mwMenu.hidden); });
    _mwMenu.addEventListener('click', () => setMenu(false));
    document.addEventListener('click', e => { if(!document.getElementById('myWorkWrap').contains(e.target)) setMenu(false); });
    document.addEventListener('keydown', e => { if(e.key === 'Escape') setMenu(false); });
  }

  // My Progress was a lens inside Notebook and nothing outside Notebook pointed at it.
  // From the topbar it is reachable from wherever the student happens to be writing.
  const _mpBtn = document.getElementById('myProgressBtn');
  if(_mpBtn) _mpBtn.addEventListener('click', () => { if(G.running) return; noteMode = 'tags'; show('note'); });

  wireNameField();

  // Theme. The class lives on <html>, set pre-paint by the inline script in index.html;
  // this only has to keep the button and DB in step with it.
  const _themeBtn = document.getElementById('themeBtn');
  const _setThemeBtn = document.getElementById('setThemeBtn');
  function paintTheme(){
    const modern = document.documentElement.classList.contains('theme-modern');
    const label = modern ? '◐ Parchment' : '◑ Modern';
    if(_themeBtn) _themeBtn.textContent = label;
    if(_setThemeBtn) _setThemeBtn.textContent = label;
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
  if(_themeBtn) _themeBtn.addEventListener('click', toggleTheme);
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
      f.innerHTML = FS_OK ? (folderChip() || '') :
        '<p>This browser cannot remember a folder between visits. Use <b>＋ Load a folder</b> on the Readings page instead — that works everywhere.</p>';
      const pick = document.getElementById('pickDir'); if(pick) pick.onclick = pickReadingsFolder;
      const re = document.getElementById('reconnectDir'); if(re) re.onclick = reconnectReadingsFolder;
      const fg = document.getElementById('forgetDir'); if(fg) fg.onclick = forgetReadingsFolder;
    }
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
    if(b.dataset.set === 'diag'){ renderDiagnostics(); renderDiagSnapshot(); }
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
  if(_dCopy) _dCopy.addEventListener('click', async () => {
    const t = await diagnosticsText();
    try { await navigator.clipboard.writeText(t); toast('Diagnostics copied'); }
    catch(e){ const ta = document.createElement('textarea'); ta.value = t;
      ta.style.cssText='position:fixed;left:-9999px'; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('Diagnostics copied'); } catch(e2){ toast('Could not copy'); }
      ta.remove(); }
  });
  const _dDown = document.getElementById('diagDownload');
  if(_dDown) _dDown.addEventListener('click', async () => {
    const blob = new Blob([await diagnosticsText()], { type:'text/plain' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'journaler-diagnostics-' + new Date().toISOString().slice(0,19).replace(/[:T]/g,'-') + '.txt';
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
  });
  const _dClear = document.getElementById('diagClear');
  if(_dClear) _dClear.addEventListener('click', () => { if(confirm('Clear the event log?')) clearLog(); });
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
