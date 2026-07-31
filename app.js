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
const GROQ_MODEL_DEFAULT = 'llama-3.3-70b-versatile';
// Tried in this order when we have to go looking. Anything not listed is still eligible
// via the score below, so a model that does not exist yet can still be chosen.
const GROQ_PREFERRED = ['llama-3.3-70b-versatile', 'llama-3.1-70b-versatile',
                        'llama-3.1-8b-instant', 'llama3-70b-8192'];
function getGroqModel() { return localStorage.getItem(GROQ_MODEL_KEY) || GROQ_MODEL_DEFAULT; }

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

function updateAIBtn() {
  const btn   = document.getElementById('aiBtn');
  const label = document.getElementById('aiBtnLabel');
  const p = getProvider();
  if (p === 'anthropic') {
    btn.classList.add('ai-active');
    label.textContent = getStoredKey('anthropic') ? 'AI: Claude ✓' : 'AI: Claude (no key)';
  } else if (p === 'gemini') {
    btn.classList.add('ai-active');
    label.textContent = getStoredKey('gemini') ? 'AI: Gemini ✓' : 'AI: Gemini (no key)';
  } else if (p === 'groq') {
    btn.classList.add('ai-active');
    label.textContent = getStoredKey('groq') ? 'AI: Groq ✓' : 'AI: Groq (no key)';
  } else if (p === 'local') {
    btn.classList.add('ai-active');
    const m = getLocalModel();
    label.textContent = m ? `AI: ${m}` : 'AI: Local (no model)';
  } else if (p === 'custom') {
    btn.classList.add('ai-active');
    const m = localStorage.getItem(CUSTOM_MODEL_KEY) || '';
    label.textContent = (getStoredKey('custom') && m) ? `AI: ${m}` : 'AI: Custom (setup)';
  } else {
    btn.classList.remove('ai-active');
    label.textContent = 'AI · off';
  }
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

function openAIModal() {
  _modalProvider = getProvider();
  _refreshModalCards();
  _refreshKeySection();
  document.getElementById('aiModalOverlay').classList.add('open');
  if (_modalProvider !== 'none' && _modalProvider !== 'local') {
    setTimeout(() => document.getElementById('aiKeyInput').focus(), 50);
  }
}

function closeAIModal() {
  document.getElementById('aiModalOverlay').classList.remove('open');
}

function selectProvider(p) {
  _modalProvider = p;
  _refreshModalCards();
  _refreshKeySection();
  if (p !== 'none' && p !== 'local') setTimeout(() => document.getElementById('aiKeyInput').focus(), 30);
}

function _refreshModalCards() {
  ['local','anthropic','gemini','groq','custom','none'].forEach(p => {
    document.getElementById('card-' + p).classList.toggle('selected', p === _modalProvider);
  });
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

// Fill the local-model dropdown by probing for a running model. No typing.
async function _populateLocalModels() {
  const sel  = document.getElementById('aiLocalModel');
  const hint = document.getElementById('aiLocalHint');
  sel.innerHTML = '';
  hint.textContent = 'Looking for a local model…';
  const found = await detectLocalModels();
  // Dedupe by model id — localhost and 127.0.0.1 reach the same Ollama.
  const seen = new Set();
  const models = found.filter(m => (seen.has(m.id) ? false : seen.add(m.id)));
  if (!models.length) {
    const opt = document.createElement('option');
    opt.value = ''; opt.textContent = '— none detected —';
    sel.appendChild(opt);
    hint.textContent = 'No local model detected. ' + localFailureHint(getLocalEndpoint());
    return;
  }
  const current = getLocalModel();
  models.forEach(m => {
    const opt = document.createElement('option');
    opt.value = JSON.stringify(m);
    opt.textContent = prettyModelLabel(m.id);
    if (m.id === current) opt.selected = true;
    sel.appendChild(opt);
  });
  hint.textContent = 'Private · on this computer · no key, no internet.';
}

function _refreshKeySection() {
  const section = document.getElementById('aiKeySection');
  const localSection = document.getElementById('aiLocalSection');
  const input   = document.getElementById('aiKeyInput');
  const hint    = document.getElementById('aiKeyHint');
  // Local model: a picker, not a key.
  if (_modalProvider === 'local') {
    section.style.display = 'none';
    localSection.style.display = 'block';
    _populateLocalModels();
    return;
  }
  localSection.style.display = 'none';
  const customSection = document.getElementById('aiCustomSection');
  if (customSection) customSection.style.display = 'none';
  if (_modalProvider === 'none') {
    section.style.display = 'none';
    return;
  }
  if (_modalProvider === 'custom') {
    section.style.display = 'none';
    if (customSection) {
      customSection.style.display = 'block';
      document.getElementById('aiCustomEndpoint').value = localStorage.getItem(CUSTOM_ENDPOINT_KEY) || '';
      document.getElementById('aiCustomModel').value = localStorage.getItem(CUSTOM_MODEL_KEY) || '';
      document.getElementById('aiCustomKey').value = getStoredKey('custom') ? '••••••••••••••••' : '';
    }
    return;
  }
  section.style.display = 'block';
  const stored = getStoredKey(_modalProvider);
  input.value = stored ? '••••••••••••••••' : '';
  if (_modalProvider === 'anthropic') {
    input.placeholder = 'sk-ant-…';
    hint.innerHTML = 'Stored only in your browser · Never in source code · Get a key at <a href="https://console.anthropic.com" target="_blank" rel="noopener">console.anthropic.com</a>';
  } else if (_modalProvider === 'gemini') {
    input.placeholder = 'AIza…';
    hint.innerHTML = 'Visit <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener">aistudio.google.com</a> to get your free key — <strong style="color:#D4A843">use a personal Gmail, not a school account.</strong> Stored only in your browser. Never shared.';
  } else {
    input.placeholder = 'gsk_…';
    hint.innerHTML = 'Visit <a href="https://console.groq.com/keys" target="_blank" rel="noopener">console.groq.com</a> to get your free key — any email works, no Google account needed. Stored only in your browser. Never shared.';
  }
}

function saveAISettings() {
  // Local model: save the picked endpoint + model (no key).
  if (_modalProvider === 'local') {
    const sel = document.getElementById('aiLocalModel');
    if (sel && sel.value) {
      const m = JSON.parse(sel.value);
      localStorage.setItem(PROVIDER_KEY, 'local');
      localStorage.setItem(LOCAL_ENDPOINT_KEY, m.endpoint);
      localStorage.setItem(LOCAL_MODEL_KEY, m.id);
    }
    closeAIModal();
    updateAIBtn();
    return;
  }
  if (_modalProvider === 'custom') {
    const ep = document.getElementById('aiCustomEndpoint').value.trim().replace(/\/+$/, '');
    const model = document.getElementById('aiCustomModel').value.trim();
    const key = document.getElementById('aiCustomKey').value.trim();
    localStorage.setItem(PROVIDER_KEY, 'custom');
    if (ep) localStorage.setItem(CUSTOM_ENDPOINT_KEY, ep);
    if (model) localStorage.setItem(CUSTOM_MODEL_KEY, model);
    if (key && !key.startsWith('•')) localStorage.setItem(CUSTOM_KEY, key);
    closeAIModal(); updateAIBtn(); return;
  }
  const val = document.getElementById('aiKeyInput').value.trim();
  localStorage.setItem(PROVIDER_KEY, _modalProvider);
  if (_modalProvider !== 'none' && val && !val.startsWith('•')) {
    const storageKey = _modalProvider === 'anthropic' ? ANTHROPIC_KEY
                     : _modalProvider === 'gemini'    ? GEMINI_KEY
                     :                                  GROQ_KEY;
    localStorage.setItem(storageKey, val);
  }
  closeAIModal();
  updateAIBtn();
}

function applyCustomPreset(name) {
  const P = {
    openai:     { ep: 'https://api.openai.com/v1',      model: 'gpt-4o-mini' },
    deepseek:   { ep: 'https://api.deepseek.com/v1',    model: 'deepseek-chat' },
    openrouter: { ep: 'https://openrouter.ai/api/v1',   model: 'meta-llama/llama-3.3-70b-instruct' },
    groq:       { ep: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' }
  }[name];
  if (!P) return;
  document.getElementById('aiCustomEndpoint').value = P.ep;
  document.getElementById('aiCustomModel').value = P.model;
  document.getElementById('aiCustomKey').focus();
}

async function callModel(prompt) {
  const provider = getProvider();
  const apiKey   = getStoredKey(provider);

  if (provider === 'none') {
    openAIModal();
    return 'No AI provider selected. Choose one using the AI button in the header.';
  }
  if (provider !== 'local' && !apiKey) {
    openAIModal();
    return 'No API key found. Enter your key in the AI settings.';
  }

  if (provider === 'local') {
    const endpoint = getLocalEndpoint();
    const model    = getLocalModel();
    if (!model) {
      openAIModal();
      return 'No local model selected. Pick one in the AI settings.';
    }
    try {
      const res = await fetch(`${endpoint}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          max_tokens: 200,
          messages: [{ role: 'user', content: prompt }]
        })
      });
      if (!res.ok) {
        return `Local model error ${res.status}. ${localFailureHint(endpoint)}`;
      }
      const data = await res.json();
      return data.choices?.[0]?.message?.content || 'No response received.';
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
          'anthropic-dangerous-allow-browser': 'true'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 200,
          messages: [{ role: 'user', content: prompt }]
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (res.status === 401) return 'Invalid Anthropic key. Update it via the AI button in the header.';
        return `Anthropic API error ${res.status}: ${err?.error?.message || 'Unknown error'}`;
      }
      const data = await res.json();
      return data.content?.map(b => b.text || '').join('') || 'No response received.';
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
          generationConfig: { maxOutputTokens: 200, temperature: 0.7 }
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (res.status === 400 || res.status === 403) return 'Invalid Gemini key. Update it via the AI button in the header.';
        return `Gemini API error ${res.status}: ${err?.error?.message || 'Unknown error'}`;
      }
      const data = await res.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response received.';
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
        max_tokens: 200,
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
      return data.choices?.[0]?.message?.content || 'No response received.';
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
        body: JSON.stringify({ model, max_tokens: 200, messages: [{ role: 'user', content: prompt }] })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (res.status === 401) return 'Invalid API key. Update it via the AI button in the header.';
        return `API error ${res.status}: ${err?.error?.message || 'Unknown error'}`;
      }
      const data = await res.json();
      return data.choices?.[0]?.message?.content || 'No response received.';
    } catch (err) {
      return 'Could not reach that endpoint. Check the URL and your connection.';
    }
  }

  return 'Unknown provider.';
}

// ===== Act I — post-buzzer reflection partner =====
// Touches the EXPERIENCE of the timed write, never the words. See next-steps /
// [[human-first-creedo]]: the gush is the student's; AI reflects on pacing only.
const REFLECTION_PARTNER = [
  'You are a writing reflection partner in a college writing course.',
  'A student just finished a timed "gush" — a fast freewrite with editing locked off.',
  'They share the text ONLY so you can sense energy and pacing.',
  'Do NOT judge the writing, its quality, grammar, or ideas. Do NOT quote it or rewrite it.',
  'Ask 2 to 3 short, plain questions about the EXPERIENCE of writing it:',
  'where they sped up or stalled, what surprised them, what showed up that they did not plan.',
  'One sentence each. No preamble, no praise. Just the questions.'
].join(' ');

// Paint the exchange: the partner's question, then a box to answer it in. The OP1
// handout tells students to "answer the app's questions about how the writing went,"
// so the question on its own is half a conversation. The answer is saved and prints
// on the session record. Callers that pass no hooks get the question only.
function paintReflection(rf, question, hooks) {
  rf.innerHTML = '<span class="lbl">After the buzzer — reflection partner</span>'
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

async function runReflection(rf, text, hooks) {
  rf.innerHTML = '<span class="lbl">After the buzzer — reflection partner</span>'
    + '<span id="reflectBody"><em>Reading your pace…</em></span>';
  const bodyEl = rf.querySelector('#reflectBody');
  // Nothing was typed, so there is no session to reflect on. Without this the model
  // cheerfully asks where your pace slowed down on a gush of zero words, and that
  // invented question gets printed on a submitted artifact. Say the true thing instead.
  if ((String(text || '').trim().match(/\S+/g) || []).length < 10) {
    bodyEl.innerHTML = '<em>Nothing came down on the page this time. Reset the clock and '
      + 'gush again — there is nothing to reflect on yet.</em>';
    return;
  }
  if (getProvider() === 'none') {
    bodyEl.innerHTML = '<em>Connect an AI (top right) and a reflection partner will ask you '
      + 'a couple of questions about how the gush went. Optional — the gush is what matters.</em>';
    return;
  }
  try {
    const reply = await callModel(REFLECTION_PARTNER
      + '\n\n(For pacing context only — never quote or critique this:)\n"""\n'
      + String(text || '').slice(0, 4000) + '\n"""');
    if (hooks) hooks.onQuestion(reply);
    paintReflection(rf, reply, hooks);
  } catch (e) {
    bodyEl.innerHTML = '<em>Reflection partner is unavailable right now.</em>';
  }
}

// ===== Shell: tabs, gush engine, focus (from the 2026-07-27 prototype) =====
(function () {
  const frame = document.getElementById('frame');
  const body = document.body;
  let tab = 'free';

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
        if(lm) lm.textContent='Time. Your gush is fixed now — select the lines you want and copy them across.';
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
  const PIECE_ORDER = ['op1','op2','op3','op4','op5','cur-reg','cur-pro','cur-syn','free','reading'];
  // Reading pieces are one-per-chapter, so they share a rank and cluster together
  // after the writing pieces instead of scattering into the unknown bucket.
  function pieceRank(id){
    if(String(id).indexOf('reading') === 0) return PIECE_ORDER.length;
    const i = PIECE_ORDER.indexOf(id); return i<0 ? 99 : i;
  }
  let _toastT;
  function toast(msg){
    let el = document.getElementById('cr284Toast');
    if(!el){ el = document.createElement('div'); el.id = 'cr284Toast'; el.style.cssText = 'position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:var(--ink);color:var(--parchment);font-family:var(--sans);font-size:13px;padding:9px 16px;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.25);z-index:60;opacity:0;transition:opacity .2s;pointer-events:none'; document.body.appendChild(el); }
    el.textContent = msg; el.style.opacity = '1'; clearTimeout(_toastT); _toastT = setTimeout(()=>{ el.style.opacity = '0'; }, 1700);
  }
  function elevate(pieceId, pieceKind, pieceTitle, text, dateKey){
    text = (text||'').trim();
    if(!text){ toast('Nothing to keep yet — write something first.'); return null; }
    const now = new Date();
    const entry = { id:'j'+now.getTime()+Math.round(Math.random()*1e5), pieceId, pieceKind, pieceTitle, ts:now.toISOString(), date: dateKey || now.toISOString().slice(0,10), edited: now.toISOString(), text };
    DB.journal.push(entry); saveDB(); toast('Kept in your notebook ✎'); return entry;
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
    if(/^op[1-5]$/.test(pieceId)){ fwCur = pieceId; show('free'); }
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

  function renderFree(){
    body.classList.remove('wide');
    const spine = `
      <p class="lead">The Five One-Pagers</p>
      ${Object.entries(OPS).map(([k,o])=>`<button class="moment ${k===fwCur?'on':''} ${fwDone[k]?'has':''}" data-op="${k}"><span class="mname"><span class="dot"></span>${o.n} · ${o.t}</span><span class="mkind">gush → one page</span></button>`).join('')}
      <div class="divider"></div><p class="lead">Keep the practice</p>
      <button class="moment ${fwCur==='open'?'on':''}" data-op="open"><span class="mname"><span class="dot"></span>Open page</span><span class="mkind">free-write · stems</span></button>
      <p class="runline">Each One-Pager is a tiny currere.</p>`;
    frame.innerHTML = `<div class="head"><h1>Freewrite</h1><p>Start a timer, trust the gush, then shape it.</p></div>
      <div class="layout"><nav class="spine">${spine}</nav><main class="stage" id="stage"></main></div>`;
    frame.querySelectorAll('[data-op]').forEach(b=>b.addEventListener('click',()=>{ if(G.running) return; fwCur=b.dataset.op; renderFree(); }));
    fwCur==='open' ? renderOpen() : renderOPStage(OPS[fwCur]);
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
    const kept = s.lifted ? `Kept ${s.lifted} of ${total} words.` : '';
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
        <div class="reflect" id="reflect" style="display:none"><span class="lbl">After the buzzer — reflection partner</span><span>How did it go? <em>(About the experience, never your words — stubbed.)</em></span></div>
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
    body.classList.remove('wide');
    const spine = Object.entries(MO).map(([k,m])=>`<button class="moment ${k===curCur?'on':''} ${curBursts[k]?'has':''}" data-mo="${k}"><span class="mname"><span class="dot"></span>${m.t}</span><span class="mkind">${m.kind==='gush'?'timed gush':m.kind==='ana'?'compare':'open draft'}</span></button>`).join('');
    frame.innerHTML = `<div class="head"><h1>Your Currere</h1><p>Four movements, run in order the way a current runs. Structure loosens as you go.</p></div>
      <div class="layout"><nav class="spine"><p class="lead">The four moments</p>${spine}<p class="runline">Gushes → comparison → open page.</p></nav><main class="stage" id="stage"></main></div>`;
    frame.querySelectorAll('[data-mo]').forEach(b=>b.addEventListener('click',()=>{if(G.running)return;curCur=b.dataset.mo;renderCur();}));
    const m=MO[curCur],st=document.getElementById('stage');
    if(m.kind==='gush'){
      st.innerHTML=`<p class="kicker">${m.k}</p><h2>${m.t}</h2><p class="framing">${m.f}</p>
        <div class="gushbar"><div class="timerset" id="timerset"><button class="tadj" id="tminus">−</button><span class="timer editable" id="timer">8:00</span><button class="tadj" id="tplus">+</button></div><button class="btn go" id="startBtn">Start the gush</button><span class="locknote" id="lockmsg">Set your minutes, then start → locks + Focus.</span></div>
        <textarea class="gush" id="gush" placeholder="Don’t stop, don’t fix." disabled></textarea>
        <div class="reflect" id="reflect" style="display:none"><span class="lbl">Reflection partner</span><span>How did remembering go? <em>(stubbed)</em></span></div>
        <div style="margin-top:12px"><button class="btn ghost sm" id="curAddNb">＋ Add to notebook</button></div>`;
      wireTimer();
      if(curBursts[curCur]){ document.getElementById('gush').value = curBursts[curCur]; }
      document.getElementById('startBtn').addEventListener('click',()=>startGush(gushSecs,{focus:true,onEnd:()=>{curBursts[curCur]=document.getElementById('gush').value||'(gush)';DB.currere[curCur]=curBursts[curCur];saveDB();}}));
      const curAdd = document.getElementById('curAddNb'); if(curAdd) curAdd.onclick = ()=>elevate('cur-'+curCur, 'currere', m.k+' · '+m.t, document.getElementById('gush').value);
    } else if(m.kind==='ana'){
      const pane=k=>curBursts[k]?`<div class="pane">${curBursts[k]}</div>`:`<div class="pane" style="color:var(--muted);font-style:italic">Run this gush first.</div>`;
      st.innerHTML=`<p class="kicker">${m.k}</p><h2>${m.t}</h2><p class="framing">${m.f}</p>
        <div class="sbs"><div><h4>Regressive · past</h4>${pane('reg')}</div><div><h4>Progressive · future</h4>${pane('pro')}</div></div>
        <button class="btn ghost" id="themesBtn">Ask: what themes recur?</button>
        <div class="aiout" id="tout" style="display:none"><span class="stub">[Stubbed] Reads your own bursts and names threads in both — as questions, never new content.</span></div>`;
      document.getElementById('themesBtn').addEventListener('click',()=>document.getElementById('tout').style.display='block');
    } else {
      st.innerHTML=`<p class="kicker">${m.k}</p><h2>${m.t}</h2><p class="framing">${m.f}</p>
        <textarea class="gush" id="gush" placeholder="Write the currere — open parts, or braid it into one. Pull scenes from what you gathered."></textarea>
        <div class="composer-foot" style="margin-top:14px"><button class="btn ghost" id="synAddNb">＋ Add to notebook</button><button class="btn ghost">Craft consultant</button><button class="btn ghost">Todd-in-a-Can</button><button class="btn">Assemble Conference Packet (PDF)</button></div>`;
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
      <input type="text" id="captureInput" placeholder="Ask Romano a question — or just add a note…" autocomplete="off">
      <div class="popup-hint">Enter asks Romano · leave blank to highlight only</div>
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

  // Romano — the reading partner (Tom Romano, author of the book). Warm, first
  // person, ≤2 sentences, turns a question back. Uses the shared callModel client.
  const READING_PARTNER = `You are Tom Romano — writer, teacher, and author of "Write What Matters" — a warm reading-and-writing partner for a college student reading your book. You help them think about the passage and their own writing life; you never lecture or summarize for them.

Voice: warm, first person, plainspoken, a little wry — a writer talking to a writer, not a critic. Draw the reader out; one real question put back to them beats a clever answer.

Hard rule on length: no more than TWO short sentences. Often make the second a single question back to them. No lists, no preamble, no flattery. Stop early rather than late.`;
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
    parts.push(`They now say: ${q}\n\nReply as Romano in ONE or TWO short sentences — illuminate it, then perhaps turn one question back to them.`);
    return callModel(parts.join('\n\n'));
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
      return `<div class="notecard qa" data-qa="${r.id}">${ctx}${you}${him}<div class="hl-row"><button class="hl-del" data-qa="${r.id}">Remove</button></div></div>`;
    }).join('');
    box.querySelectorAll('.qa-quote').forEach(q => q.onclick = () => q.closest('.notecard').classList.toggle('open'));
    box.querySelectorAll('.hl-del[data-qa]').forEach(b => b.onclick = () => removeQA(b.dataset.qa));
  }
  async function askRomanoInto(passage, question, page){
    const rid = currentReadingId(); if(!rid) return;
    if(getProvider()==='none'){
      // No-AI is a supported path — don't bank a question nothing will answer.
      const box = document.getElementById('newnote');
      if(box) box.insertAdjacentHTML('beforeend', '<div class="notecard"><em>Connect an AI (top right) and Romano will answer — optional; your reading and notes work without it.</em></div>');
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
    body.classList.add('wide');
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
    document.getElementById('askbtn').addEventListener('click',()=>{const el=document.getElementById('askin');const v=el.value.trim();if(!v)return;el.value='';askRomanoInto('', v, readPageNum);});
  }

  // ---------- Notebook — kept pages, seen two ways (by day · by piece) ----------
  const NOTE_MIN = 2026*12 + 6;  // July 2026 (open now for testing; term is Aug–Dec)
  const NOTE_MAX = 2026*12 + 11; // December 2026
  let noteView = new Date(2026, 6, 1); // July 2026
  let noteSel = null;          // selected calendar day (by-day lens)
  let noteMode = 'day';        // 'day' | 'piece'
  let notePieceSel = null;     // selected piece (by-piece lens)
  let nbEditingId = null;      // entry being inline-edited

  // One dated page. Read-only, or inline-editable when nbEditingId matches.
  function entryCard(e, opts){
    opts = opts || {};
    const when = new Date(e.ts).toLocaleString(undefined, {month:'short', day:'numeric', hour:'numeric', minute:'2-digit'});
    if(nbEditingId === e.id){
      return `<div class="entryrow"><div class="k">${escHtml(e.pieceTitle)} · ${when}</div>
        <textarea id="edit_${e.id}" style="width:100%;min-height:92px;box-sizing:border-box;font-family:var(--serif);font-size:15px;line-height:1.6;padding:10px 12px;border:1px solid var(--accent-light);border-radius:6px;resize:vertical">${escHtml(e.text)}</textarea>
        <div style="margin-top:6px;display:flex;gap:6px"><button class="btn sm" data-save="${e.id}">Save</button><button class="btn ghost sm" data-cancel="1">Cancel</button><button class="btn ghost sm" data-del="${e.id}">Delete</button></div></div>`;
    }
    const head = (opts.showPiece === false) ? when : `${escHtml(e.pieceTitle)} · ${when}`;
    const openLink = (opts.pieceLink !== false && e.pieceId !== 'free') ? `<button class="entlink" data-open="${e.pieceId}">Open the live piece →</button>` : '';
    return `<div class="entryrow"><div class="k">${head}</div><div class="x">${escHtml(e.text).replace(/\n/g,'<br>')}</div>
      <div class="entacts"><button class="entlink" data-edit="${e.id}">Edit</button>${openLink}</div></div>`;
  }

  function noteDayDetail(){
    if(!noteSel) return `<div class="notedetail"><h3>Pick a day</h3><p class="empty">Click a day to see the pages you kept that day. A green dot marks a day with a kept page.</p></div>`;
    const d = new Date(noteSel + 'T00:00:00');
    const label = d.toLocaleDateString(undefined, {weekday:'long', month:'long', day:'numeric'});
    const list = journalByDate(noteSel).sort((a,b)=>a.ts.localeCompare(b.ts));
    const entries = list.length ? list.map(e=>entryCard(e, {})).join('') : `<p class="empty">Nothing kept this day yet.</p>`;
    return `<div class="notedetail"><h3>${label}</h3>${entries}
      <div class="entryrow"><div class="k">Quick-write for this day</div><textarea id="noteCompose" placeholder="Jot a note or free-write, then keep it…" style="width:100%;min-height:88px;box-sizing:border-box;font-family:var(--serif);font-size:15px;line-height:1.6;padding:10px 12px;border:1px solid var(--comment-border);border-radius:6px;resize:vertical"></textarea>
      <button class="btn sm" id="noteSaveBtn" style="margin-top:8px">Keep this page</button></div></div>`;
  }

  function notePieceDetail(){
    if(!notePieceSel) return `<div class="notedetail"><h3>Pick a piece</h3><p class="empty">Choose a piece on the left to watch it grow across the term — every pass you kept, earliest first.</p></div>`;
    const list = journalByPiece(notePieceSel);
    if(!list.length) return `<div class="notedetail"><h3>—</h3><p class="empty">No passes kept for this piece.</p></div>`;
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
  // Entries in one chronological order, numbered once. Entry 17 is entry 17 in the
  // Contents, in every part of the bundle, and in what the student writes on the cover.
  function numberedEntries(){
    return (DB.journal || []).slice().sort((a,b) =>
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
        <h3><span class="pb-n">${nOf(e)}</span>${escHtml(e.pieceTitle || '—')} <span class="pb-when">${escHtml(fmtDate(e.date))}</span></h3>
        ${label ? `<p class="pb-role">${escHtml(label)}</p>` : ''}
        ${para(e.text)}
      </article>` : '';
    const notChosen = label => `
      <article class="pb-full pb-missing"><h3>${escHtml(label)}</h3>
        <p class="pb-role">Not identified. Write the entry number here: ____</p></article>`;

    const contents = `
      <section class="pb-contents">
        <ol class="pb-toc">
          ${ordered.map(e => `<li><span class="pb-n">${nOf(e)}</span><span class="pb-d">${escHtml(fmtDate(e.date))}</span><span class="pb-t">${escHtml(e.pieceTitle || '—')}</span></li>`).join('')}
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
                  <span class="pb-kinds">Printed in full in Part 4. Only these are read closely.</span></td>
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

    const html = `
      ${cover}
      <section class="pb-part"><h2>Part 1 · Contents</h2>
        <p class="pb-sub">Every entry, numbered in date order.</p>
        ${contents}
      </section>
      ${part2}
      ${part3}
      ${part4}
      <section class="pb-part"><h2>Part 5 · The complete notebook</h2>
        <p class="pb-sub">Everything, ${noteMode === 'day' ? 'by day' : 'by piece'}.</p>
        ${sections}
      </section>`;
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
  // it." This is that page — what the gush was, the gush itself, the reflection
  // exchange, and what the machine was allowed to do. It is evidence, so when there
  // is no recorded session it says so plainly rather than implying one happened.
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

    const exchange = s.question ? `
      <h3>The reflection partner asked</h3>
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
        <p>${s.question
          ? 'The reflection partner asked how the writing went, about the experience and not the content. It supplied none of the words in the One-Pager.'
          : 'No AI was used on this One-Pager.'}</p>
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
  function turnInPanel(){
    const ordered = numberedEntries();
    if(!ordered.length) return '';
    const T = turnin();
    const opts = (sel) => ['<option value="">— not chosen —</option>'].concat(
      ordered.map((e,i) => `<option value="${e.id}" ${T[sel]===e.id?'selected':''}>${i+1} · ${escHtml(shortDate(e.date))} · ${escHtml((e.pieceTitle||'—').slice(0,34))}</option>`)
    ).join('');
    const done = TURNIN_SLOTS.filter(s => T[s[0]]).length;
    return `<details class="turnin" ${done < TURNIN_SLOTS.length ? '' : 'open'}>
      <summary>Before you turn it in — ${done} of ${TURNIN_SLOTS.length} identified</summary>
      <p class="runline">Your notebook is graded in four parts. Point me at the entries for
        three of them. Everything else stays unread.</p>
      ${TURNIN_SLOTS.map(([k,label,hint]) => `
        <label class="turnin-row"><span class="tl">${label}<em>${hint}</em></span>
          <select data-slot="${k}">${opts(k)}</select></label>`).join('')}
    </details>`;
  }
  function shortDate(k){ const [y,m,d]=String(k).split('-').map(Number);
    return new Date(y,(m||1)-1,d||1).toLocaleDateString(undefined,{month:'short',day:'numeric'}); }

  function renderNote(){
    body.classList.add('wide');
    const toggle = `<div class="nbviews"><button class="nbview ${noteMode==='day'?'on':''}" data-mode="day">By day</button><button class="nbview ${noteMode==='piece'?'on':''}" data-mode="piece">By piece</button></div>`;
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
        ${turnInPanel()}
        <div class="composer-foot" style="margin-top:14px"><button class="btn" id="bundleBtn">Bundle notebook → PDF</button></div></div>`;
      rightPane = noteDayDetail();
    } else {
      const pieces = journalPieces();
      const listHtml = pieces.length
        ? pieces.map(p=>`<button class="moment has ${notePieceSel===p.id?'on':''}" data-piece="${p.id}"><span class="mname"><span class="dot"></span>${escHtml(p.title)}</span><span class="mkind">${p.entries.length} kept pass${p.entries.length>1?'es':''}</span></button>`).join('')
        : `<p class="empty" style="font-family:var(--sans)">No kept pages yet. In any tab, write, then hit <strong>＋ Add to notebook</strong>.</p>`;
      leftPane = `<div class="piecelist"><p class="lead">Your pieces</p>${listHtml}
        ${turnInPanel()}
        <div class="composer-foot" style="margin-top:14px"><button class="btn" id="bundleBtn">Bundle notebook → PDF</button></div></div>`;
      rightPane = notePieceDetail();
    }
    frame.innerHTML = `<div class="head"><h1>Notebook</h1><p>Your kept pages — the writing you elevated with <strong>＋ Add to notebook</strong>. See them <strong>by day</strong>, or watch one piece grow <strong>by piece</strong>. This is the 50-pt Writer’s Notebook.</p>${toggle}</div>
      <div class="notewrap">${leftPane}${rightPane}</div>`;

    frame.querySelectorAll('.nbview').forEach(b => b.onclick = () => { noteMode = b.dataset.mode; nbEditingId = null; renderNote(); });
    // Only one lens renders at a time, so only one bundle button exists.
    // Saved on change, not on a Save button: there is no submit step here, and a student
    // who picked their entries and then navigated away should not lose them.
    frame.querySelectorAll('.turnin select').forEach(sel => sel.onchange = () => {
      turnin()[sel.dataset.slot] = sel.value || undefined;
      saveDB();
      const d = sel.closest('.turnin'), s = d && d.querySelector('summary');
      if(s) s.textContent = `Before you turn it in — ${TURNIN_SLOTS.filter(x => turnin()[x[0]]).length} of ${TURNIN_SLOTS.length} identified`;
    });
    const bBtn = document.getElementById('bundleBtn');
    if(bBtn) bBtn.onclick = bundleNotebookPDF;
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
    frame.querySelectorAll('[data-cancel]').forEach(b => b.onclick = () => { nbEditingId = null; renderNote(); });
    frame.querySelectorAll('[data-save]').forEach(b => b.onclick = () => { const id = b.dataset.save; const ta = document.getElementById('edit_'+id); if(ta) updateEntry(id, ta.value); nbEditingId = null; renderNote(); });
    frame.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { if(confirm('Delete this page? This cannot be undone.')){ deleteEntry(b.dataset.del); nbEditingId = null; renderNote(); } });
    frame.querySelectorAll('[data-open]').forEach(b => b.onclick = () => goToPiece(b.dataset.open));
  }

  // ---------- tabs + focus ----------
  const R = { free:renderFree, cur:renderCur, read:renderRead, note:renderNote };
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
  const _wfi = document.getElementById('workFileInput');
  const _openBtn = document.getElementById('openWorkBtn');
  if(_openBtn && _wfi){ _openBtn.addEventListener('click', ()=>_wfi.click()); _wfi.addEventListener('change', ()=>{ if(_wfi.files[0]) openWork(_wfi.files[0]); _wfi.value=''; }); }

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
      const res = await fetch(clean + '/v1/models', { signal: AbortSignal.timeout(ms || 2000) });
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
  function aiCard(title, sub, badge, on, onclick){
    const b = document.createElement('button');
    b.className = 'ai-card' + (on ? ' on' : '');
    b.innerHTML = `<span class="ai-card-main"><b>${escHtml(title)}</b><small>${escHtml(sub)}</small></span>` +
                  (badge ? `<span class="ai-badge">${escHtml(badge)}</span>` : '');
    b.onclick = onclick;
    return b;
  }
  function renderAiTab(){
    const list = document.getElementById('aiList'); if(!list) return;
    const sel = document.getElementById('aiSelected');
    if(sel) sel.textContent = getProvider() === 'none' ? 'No AI connected' : 'Selected: ' + aiLabel();
    const foot = document.getElementById('aiFoot');
    list.innerHTML = '';

    if(_aiSub === 'local'){
      if(foot) foot.textContent = 'Auto-checked ports ' + LOCAL_PORTS.map(p=>p.port).join(', ') + ' on this device and on the computer that served this page.';
      list.innerHTML = '<p class="ai-scan">Looking for a model on this computer…</p>';
      probeLocal().then(found => {
        if(document.getElementById('aiList') !== list) return;
        list.innerHTML = '';
        const cur = getProvider() === 'local' ? (getLocalEndpoint() + '|' + getLocalModel()) : '';
        found.forEach(f => f.models.forEach(m => {
          list.appendChild(aiCard(m.id, f.url, 'Local', cur === (f.url + '|' + m.id), () => {
            localStorage.setItem(PROVIDER_KEY, 'local');
            localStorage.setItem(LOCAL_ENDPOINT_KEY, f.url);
            localStorage.setItem(LOCAL_MODEL_KEY, m.id);
            addExtraEndpoint(f.url);
            logEvent('ai', 'provider → local', { endpoint: f.url, model: m.id });
            updateAIBtn(); renderAiTab();
          }));
        }));
        if(!found.length) list.innerHTML =
          '<p class="ai-scan">No local model answered. Start Ollama (or LM Studio) and reopen this tab. ' +
          'If the page is served over https, the model must allow this origin — see OLLAMA_ORIGINS.</p>';
        const add = document.createElement('div');
        add.className = 'ai-add';
        add.innerHTML = '<b>+ Add local server</b><small>Custom URL — anything speaking OpenAI-compatible /v1/chat/completions</small>' +
                        '<input type="text" id="aiAddUrl" placeholder="http://127.0.0.1:11434" autocomplete="off" spellcheck="false">';
        list.appendChild(add);
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
      [['gemini','Gemini 2.5 Flash','Free tier via Google — use a personal Gmail account.', GEMINI_KEY],
       ['groq','Groq · ' + getGroqModel(),'Free tier. Any email — no Google account needed.', GROQ_KEY]]
        .forEach(([id,title,sub,keyName]) => {
          list.appendChild(aiCard(title, sub, 'Free', getProvider() === id, () => {
            const k = prompt('Paste your ' + title + ' API key:', localStorage.getItem(keyName) || '');
            if(k === null) return;
            localStorage.setItem(keyName, k.trim());
            localStorage.setItem(PROVIDER_KEY, id);
            logEvent('ai', 'provider → ' + id);
            updateAIBtn(); renderAiTab();
          }));
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
      }));
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

  show('free');
})();

// ===== init =====
updateAIBtn();
