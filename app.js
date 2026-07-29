/* Journaler-284 — app.js  (classic script; inline on* handlers need globals)
 * Assembled from the prototype shell + the 318P AI subsystem. Edit here, then
 * `node --check app.js` before shipping (port lesson: a stray smart-quote once
 * blanked the whole app). */

// Build stamp — bump on every shipped change so we can confirm the browser has the
// latest code (shown bottom-right + logged to console). Old highlights keep the
// rects they were SAVED with, so re-test the fix with a FRESH highlight.
const BUILD = '2026-07-28 · highlight-coverage-4';
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

function getProvider() { return localStorage.getItem(PROVIDER_KEY) || 'none'; }
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
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          max_tokens: 200,
          messages: [{ role: 'user', content: prompt }]
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
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

async function runReflection(rf, text) {
  rf.innerHTML = '<span class="lbl">After the buzzer — reflection partner</span>'
    + '<span id="reflectBody"><em>Reading your pace…</em></span>';
  const bodyEl = rf.querySelector('#reflectBody');
  if (getProvider() === 'none') {
    bodyEl.innerHTML = '<em>Connect an AI (top right) and a reflection partner will ask you '
      + 'a couple of questions about how the gush went. Optional — the gush is what matters.</em>';
    return;
  }
  try {
    const reply = await callModel(REFLECTION_PARTNER
      + '\n\n(For pacing context only — never quote or critique this:)\n"""\n'
      + String(text || '').slice(0, 4000) + '\n"""');
    bodyEl.textContent = reply;
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
    const ta = document.getElementById('gush');
    if(ta){ ta.removeEventListener('keydown', guard); ta.classList.remove('locked'); ta.disabled = false; }
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
    ta.disabled = false; ta.classList.add('locked'); ta.value=''; ta.focus();
    ta.addEventListener('keydown', guard);
    const lm = document.getElementById('lockmsg'); if(lm) lm.innerHTML = '<span class="lockflag">● Locked — gush mode. Keep going.</span>';
    if(opts.focus) setFocus(true);
    G.running = true; G.remain = mins;
    const timer = document.getElementById('timer');
    G.tId = setInterval(() => {
      G.remain--; timer.textContent = fmt(G.remain); timer.classList.toggle('low', G.remain<=30);
      if(G.remain<=0){ clearInterval(G.tId); G.running=false;
        ta.removeEventListener('keydown',guard); ta.classList.remove('locked'); ta.disabled=true;
        if(lm) lm.textContent='Time. The page is yours again.';
        if(opts.focus) setFocus(false);
        const rf = document.getElementById('reflect'); if(rf){ rf.style.display='block'; runReflection(rf, ta.value); }
        if(opts.onEnd) opts.onEnd();
      }
    }, 1000);
  }

  // ═══ Persistence — everything the student types is saved locally, and
  //     "Save my work" exports it ALL as ONE portable file (Drive/Dropbox/USB).
  //     Typed text lives in localStorage; the big reading files live in IndexedDB.
  const LS_KEY = 'cr284_state';
  function loadDB(){ try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch(e){ return {}; } }
  const DB = Object.assign({ v:1, freewrite:{}, currere:{}, notebook:{}, readings:null, activeReading:0 }, loadDB());
  if(!DB.freewrite) DB.freewrite = {};
  if(!DB.currere)   DB.currere   = {};
  if(!DB.notebook)  DB.notebook  = {};
  let _saveT;
  function saveDB(){ clearTimeout(_saveT); _saveT = setTimeout(()=>{ try { localStorage.setItem(LS_KEY, JSON.stringify(DB)); } catch(e){ console.warn('saveDB', e); } }, 250); }
  function escHtml(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // Big reading files (PDF/.docx bytes) are too large for localStorage → IndexedDB.
  const READ_DB_NAME = 'cr284_readings';
  function _readingDB(){ return new Promise((resolve,reject)=>{ let req; try{ req = indexedDB.open(READ_DB_NAME,1); }catch(e){ reject(e); return; } req.onupgradeneeded = ()=>{ req.result.createObjectStore('files'); }; req.onsuccess = ()=>resolve(req.result); req.onerror = ()=>reject(req.error); }); }
  async function saveReadingBytes(id, buf){ try{ const db = await _readingDB(); await new Promise((res,rej)=>{ const tx = db.transaction('files','readwrite'); tx.objectStore('files').put(buf,id); tx.oncomplete = res; tx.onerror = ()=>rej(tx.error); tx.onabort = ()=>rej(tx.error); }); }catch(e){ console.warn('saveReadingBytes',e); } }
  async function loadReadingBytes(id){ try{ const db = await _readingDB(); return await new Promise((res,rej)=>{ const tx = db.transaction('files','readonly'); const r = tx.objectStore('files').get(id); r.onsuccess = ()=>res(r.result||null); r.onerror = ()=>rej(r.error); }); }catch(e){ console.warn('loadReadingBytes',e); return null; } }

  // Export EVERYTHING typed as one file; import restores it, then reloads to re-init.
  function saveWork(){
    const payload = { app:'journaler-284', v:1, exported:new Date().toISOString(), state:DB };
    const blob = new Blob([JSON.stringify(payload,null,2)], { type:'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'journaler-284-' + new Date().toISOString().slice(0,10) + '.json';
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }
  function openWork(file){
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
  const PIECE_ORDER = ['op1','op2','op3','op4','op5','cur-reg','cur-pro','cur-syn','free'];
  function pieceRank(id){ const i = PIECE_ORDER.indexOf(id); return i<0 ? 99 : i; }
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
  function journalPieces(){ const m = {}; for(const e of DB.journal){ (m[e.pieceId] = m[e.pieceId] || { id:e.pieceId, kind:e.pieceKind, title:e.pieceTitle, entries:[] }).entries.push(e); } return Object.values(m).sort((a,b)=>pieceRank(a.id)-pieceRank(b.id) || a.title.localeCompare(b.title)); }
  function deleteEntry(id){ DB.journal = DB.journal.filter(e=>e.id!==id); saveDB(); }
  function updateEntry(id, text){ const e = DB.journal.find(x=>x.id===id); if(e){ e.text = text; e.edited = new Date().toISOString(); saveDB(); } }
  // Jump from a notebook entry to the live writing surface it came from.
  function goToPiece(pieceId){
    if(/^op[1-5]$/.test(pieceId)){ fwCur = pieceId; show('free'); }
    else if(pieceId.indexOf('cur-') === 0){ curCur = pieceId.slice(4); show('cur'); }
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
          <span class="locknote" id="lockmsg">Set your minutes, then start — the page locks and Focus opens.</span></div>
        <textarea class="gush" id="gush" placeholder="Don’t stop, don’t fix. Stalled? Write that you stalled — and keep going." disabled></textarea>
        <div class="reflect" id="reflect" style="display:none"><span class="lbl">After the buzzer — reflection partner</span><span>How did it go? <em>(About the experience, never your words — stubbed.)</em></span></div>
       </div>
       <div class="op-col shape" id="shapeCol">
        <div class="stagelabel"><span class="n">2</span> Shape — the One-Pager ${M.photos?'(image + text)':''}</div>
        <p class="stagenote">Build your One-Pager from the gush — this is what you submit.</p>
        <div class="toolbar">
          <button data-cmd="bold"><b>B</b></button><button data-cmd="italic"><i>I</i></button>
          <button data-cmd="formatBlock" data-val="h3">H</button><button data-cmd="insertUnorderedList">&bull;</button>
          <span class="sep"></span><button id="imgBtn">&#128247;</button><span class="wc" id="wc">0 words</span></div>
        <div class="page" id="page" contenteditable="${fwGushed[fwCur]?'true':'false'}" data-ph="${M.ph}"></div>
        <input type="file" id="imgInput" accept="image/*" hidden ${M.photos?'multiple':''}>
        <div class="composer-foot"><button class="btn ghost" id="opAddNb">＋ Add to notebook</button><button class="btn">Export One-Pager (1-page PDF)</button><span class="note">Keeping it dates a page in your notebook — do it again later and both passes stay.</span></div>
       </div>
      </div>`;
    wireTimer();
    // Restore a saved gush + shaped one-pager for this OP.
    const saved = DB.freewrite[fwCur] || {};
    const taEl = document.getElementById('gush'); if(saved.gush){ taEl.value = saved.gush; if(fwGushed[fwCur]) taEl.disabled = true; }
    const pgEl = document.getElementById('page'); if(saved.shape){ pgEl.innerHTML = saved.shape; }
    // Save the shaped one-pager as it is typed.
    pgEl.addEventListener('input', ()=>{ DB.freewrite[fwCur] = Object.assign({}, DB.freewrite[fwCur], { shape: pgEl.innerHTML }); saveDB(); });
    document.getElementById('startBtn').addEventListener('click',()=>startGush(gushSecs,{focus:true,onEnd:()=>{fwDone[fwCur]=true;fwGushed[fwCur]=true;DB.freewrite[fwCur]=Object.assign({},DB.freewrite[fwCur],{gush:document.getElementById('gush').value,gushed:true,done:true});saveDB();document.body.classList.add('wide');const oc=document.querySelector('.op-cols');if(oc)oc.classList.add('two');const pg=document.getElementById('page');if(pg)pg.setAttribute('contenteditable','true');}}));
    const opAdd = document.getElementById('opAddNb');
    if(opAdd) opAdd.onclick = ()=>{ const pg = document.getElementById('page'); const txt = (pg && pg.innerText.trim()) || document.getElementById('gush').value; elevate('op'+M.n, 'one-pager', 'One-Pager '+M.n+' · '+M.t, txt); };
    wireComposer();
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
    document.getElementById('notimer').addEventListener('click',()=>{const ta=document.getElementById('gush');ta.disabled=false;ta.focus();setFocus(true);});
  }
  function wireComposer(){
    const page=document.getElementById('page'),wc=document.getElementById('wc');
    const upd=()=>{const n=(page.innerText.trim().match(/\S+/g)||[]).length;wc.textContent=n+' words';wc.classList.toggle('good',n>=500&&n<=650);};
    page.addEventListener('input',upd);
    document.querySelectorAll('.toolbar button[data-cmd]').forEach(btn=>btn.addEventListener('mousedown',e=>{e.preventDefault();page.focus();document.execCommand(btn.dataset.cmd,false,btn.dataset.val||null);}));
    const imgInput=document.getElementById('imgInput');
    document.getElementById('imgBtn').addEventListener('mousedown',e=>{e.preventDefault();imgInput.click();});
    imgInput.addEventListener('change',()=>{[...imgInput.files].forEach(f=>{const r=new FileReader();r.onload=()=>{page.focus();document.execCommand('insertHTML',false,`<img src="${r.result}" alt="">`);upd();};r.readAsDataURL(f);});});
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
  function persistReadings(){ DB.readings = readings.map(r=>({ id:r.id, name:r.name, type:r.type, html: r.type==='txt' ? r.html : undefined, builtin: r.builtin||undefined, url: r.url||undefined })); DB.activeReading = activeReading; saveDB(); }

  // Order the shelf sensibly: built-in manual first, then an intro, then chapters
  // in NUMERIC order (ch1 < ch2 < ch10), then everything else alphabetically.
  function readingRank(r){
    if(r.builtin) return [0, 0, ''];
    const low = r.name.toLowerCase();
    if(/intro/.test(low)) return [1, 0, low];
    const m = /^(?:wwm[\s._-]*)?ch(?:apter)?[\s._-]*(\d+)/i.exec(r.name);
    if(m) return [2, parseInt(m[1], 10), low];
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
    let n = r.name.replace(/\.(pdf|docx|txt)$/i, '');
    if(/intro/i.test(n)) return 'Introduction';
    const m = /^(?:wwm[\s._-]*)?ch(?:apter)?[\s._-]*(\d+)[\s._-]*(.*)$/i.exec(n);
    if(m){ const rest = (m[2]||'').replace(/[-_]+/g,' ').trim(); return 'Ch ' + m[1] + (rest ? ' · ' + rest.charAt(0).toUpperCase() + rest.slice(1) : ''); }
    const s = n.replace(/[-_]+/g,' ').trim(); return s ? s.charAt(0).toUpperCase() + s.slice(1) : r.name;
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
  // Bytes for a reading: a built-in (shipped) reading fetches from its URL; a
  // student-loaded one comes from IndexedDB.
  async function readingBytesFor(r){
    if(r.builtin && r.url){ try { const res = await fetch(r.url); return res.ok ? await res.arrayBuffer() : null; } catch(e){ return null; } }
    return await loadReadingBytes(r.id);
  }

  // Render the active reading into #docPane. PDFs → canvas pages (pdf.js);
  // .docx → HTML (mammoth). A token guards against fast reading switches.
  let _readToken = 0;
  async function renderActiveDoc(r){
    const pane = document.getElementById('docPane');
    if(!pane || !r) return;
    const token = ++_readToken;
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
          if(!bytes){ pane.innerHTML = `<div class="docstub"><strong>${escHtml(r.name)}</strong><br>This file isn’t stored in this browser. Load it again with ＋ Load readings.</div>`; return; }
          doc = await lib.getDocument({ data: (bytes.slice ? bytes.slice(0) : bytes), ...(window.PDF_DOC_OPTS||{}) }).promise;
          if(token !== _readToken) return;
          _curPdf = { id:r.id, doc };
        }
        await renderPdfPages(pane, doc, r, token);
      } catch(e){ console.warn('pdf render', e); if(token===_readToken) pane.innerHTML = `<div class="docstub"><strong>Could not render this PDF.</strong><br>${escHtml(String((e&&e.message)||e))}</div>`; }
    } else if(r.type === 'docx'){
      const bytes = await readingBytesFor(r);
      if(token !== _readToken) return;
      if(!bytes){ pane.innerHTML = `<div class="docstub"><strong>${escHtml(r.name)}</strong><br>This file isn’t stored in this browser. Load it again.</div>`; return; }
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

  function attachMarquee(overlay, canvas, textLayerDiv){
    let startX=0, startY=0, boxEl=null, dragging=false;
    overlay.addEventListener('mousedown', e => {
      if(pdfCaptureMode!=='box' || e.button!==0) return;
      document.querySelectorAll('.marquee-box').forEach(b=>b.remove());
      dragging = true;
      const r = overlay.getBoundingClientRect();
      startX = e.clientX - r.left; startY = e.clientY - r.top;
      boxEl = document.createElement('div'); boxEl.className='marquee-box';
      boxEl.style.left = startX+'px'; boxEl.style.top = startY+'px';
      overlay.appendChild(boxEl); e.preventDefault();
    });
    window.addEventListener('mousemove', e => {
      if(!dragging || !boxEl) return;
      const r = overlay.getBoundingClientRect();
      const cx = e.clientX - r.left, cy = e.clientY - r.top;
      boxEl.style.left = Math.min(startX,cx)+'px'; boxEl.style.top = Math.min(startY,cy)+'px';
      boxEl.style.width = Math.abs(cx-startX)+'px'; boxEl.style.height = Math.abs(cy-startY)+'px';
    });
    window.addEventListener('mouseup', () => {
      if(!dragging) return; dragging=false;
      if(!boxEl) return;
      const r = boxEl.getBoundingClientRect();
      if(r.width<6 || r.height<6){ boxEl.remove(); boxEl=null; return; }
      handleMarqueeCapture(r, canvas, textLayerDiv);
      boxEl = null;
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
  // Collapse per-word rects into one rect per text line (continuous highlight,
  // spaces included). Buckets by line-center with a height-scaled tolerance so OCR
  // baseline jitter never splits a line. Single-column prose (the WWM chapters).
  function mergeRectsByLine(rects){
    const lines = [];
    rects.forEach(r => {
      const mid = (r.top + r.bottom)/2, h = r.bottom - r.top;
      const g = lines.find(l => Math.abs(l.mid - mid) <= Math.max(6, Math.min(l.h, h) * 0.6));
      if(g){ g.top=Math.min(g.top,r.top); g.bottom=Math.max(g.bottom,r.bottom); g.left=Math.min(g.left,r.left); g.right=Math.max(g.right,r.right); g.mid=(g.top+g.bottom)/2; g.h=g.bottom-g.top; }
      else lines.push({ top:r.top, bottom:r.bottom, left:r.left, right:r.right, mid, h });
    });
    return lines.map(g => ({ left:g.left, top:g.top, right:g.right, bottom:g.bottom, width:g.right-g.left, height:g.bottom-g.top }));
  }
  // Group every visible text-layer span into reading-order LINES, tolerant of the
  // per-word baseline jitter OCR produces — so a line never scrambles left↔right.
  function docLines(){
    const items = [...document.querySelectorAll('#docPane .textLayer span')]
      .filter(sp => sp.textContent && sp.textContent.trim() && !sp.classList.contains('markedContent'))
      .map(sp => { const r = sp.getBoundingClientRect(); return { sp, top:r.top, bottom:r.bottom, left:r.left, right:r.right, mid:(r.top+r.bottom)/2, h:r.height }; })
      .sort((a,b) => a.top - b.top || a.left - b.left);
    const lines = [];
    items.forEach(it => {
      const ln = lines[lines.length-1];
      if(ln && Math.abs(it.mid - ln.mid) <= Math.max(6, ln.h * 0.6)){ ln.items.push(it); ln.mid = (ln.mid*ln.n + it.mid)/(ln.n+1); ln.n++; ln.h = Math.max(ln.h, it.h); }
      else lines.push({ mid:it.mid, h:it.h, n:1, items:[it] });
    });
    lines.forEach(l => l.items.sort((a,b) => a.left - b.left));
    return lines;
  }
  // From anchor spans (marquee hits, or the two selection-boundary words) build the
  // full passage: first→last word with every intermediate LINE complete. The first
  // line runs from the start word to its end; the last line up to the end word.
  function expandToPassage(anchors){
    if(!anchors || !anchors.length) return [];
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
    if(firstLine === -1) return anchors.slice();
    const out = [];
    for(let li = firstLine; li <= lastLine; li++){
      lines[li].items.forEach(it => {
        const okL = (li > firstLine) || (it.left >= firstLeft - 2);
        const okR = (li < lastLine) || (it.right <= lastRight + 2);
        if(okL && okR) out.push(it.sp);
      });
    }
    return out;
  }
  // Build one full-width rect per line straight from the document's line geometry
  // (NOT the selection): middle lines span the whole line, first/last run from/to the
  // boundary word. Cannot clip a middle line even with jittery OCR spans.
  function passageLineRects(anchors){
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
      const left = (li === firstLine) ? firstLeft : lineLeft;
      const right = (li === lastLine) ? lastRight : lineRight;
      const top = Math.min(...items.map(i => i.top));
      const bottom = Math.max(...items.map(i => i.bottom));
      rects.push({ left, top, right, bottom, width: right - left, height: bottom - top });
      items.forEach(it => { if(it.right > left - 2 && it.left < right + 2) spans.push(it.sp); });
    }
    return { rects, spans };
  }
  // Passage spans → clean text (line-break de-hyphenation + collapsed whitespace).
  function spansToText(spans){
    return spans.map(s => s.textContent || '').join(' ')
      .replace(/([A-Za-z])[-­]\s+([a-z])/g, '$1$2')
      .replace(/\s+/g, ' ').trim();
  }
  // Native text selection (Select mode). Take only the start & end words the user
  // touched, then expandToPassage fills complete lines between them — so coverage
  // never follows the browser's rectangular selection geometry.
  function handleSelectionCapture(){
    if(pdfCaptureMode !== 'select') return;
    const sel = window.getSelection();
    if(!sel || sel.isCollapsed || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const startSpan = spanOf(range.startContainer), endSpan = spanOf(range.endContainer);
    if(!startSpan || !endSpan) return;
    const pr = passageLineRects([startSpan, endSpan]);
    if(!pr.spans.length) return;
    const text = spansToText(pr.spans);
    if(text.length < 3) return;
    const rects = normalizeRectsToPages(pr.rects);
    if(!rects.length) return;
    console.log('[hl] select capture →', pr.rects.length, 'line(s), build', BUILD);
    openCapturePopup(text, '', range.getBoundingClientRect(), rects);
  }

  function ensureCapturePopup(){
    let pop = document.getElementById('capturePopup');
    if(pop) return pop;
    pop = document.createElement('div'); pop.className='selection-popup'; pop.id='capturePopup'; pop.style.display='none';
    pop.innerHTML = `<img id="captureThumb" alt="captured region" style="display:none;max-width:100%;max-height:130px;border-radius:4px;margin-bottom:.5rem;border:1px solid rgba(0,0,0,.15)">
      <div class="popup-passage" id="capturePassage"></div>
      <input type="text" id="captureInput" placeholder="Add a note (optional)…" autocomplete="off">
      <div class="popup-quick"><button class="popup-chip" id="captureFigBtn" style="display:none">↓ Save figure</button></div>
      <div class="popup-actions">
        <button class="popup-btn secondary" id="captureCancelBtn">Cancel</button>
        <button class="popup-btn secondary" id="captureSaveBtn">✎ Highlight</button>
        <button class="popup-btn primary" id="captureAskBtn">Ask Romano</button>
      </div>`;
    document.body.appendChild(pop);
    pop.querySelector('#captureCancelBtn').onclick = closeCapture;
    pop.querySelector('#captureSaveBtn').onclick = () => saveHighlight(false);
    pop.querySelector('#captureAskBtn').onclick  = () => saveHighlight(true);
    pop.querySelector('#captureFigBtn').onclick = downloadCapture;
    pop.querySelector('#captureInput').addEventListener('keydown', e => {
      if(e.key==='Enter'){ e.preventDefault(); saveHighlight(true); }
      if(e.key==='Escape') closeCapture();
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
    let left = boxRect.left, top = boxRect.bottom + 8;
    if(left+320 > window.innerWidth) left = window.innerWidth-330;
    if(left<8) left=8;
    if(top+240 > window.innerHeight) top = Math.max(8, boxRect.top-240);
    pop.style.left = left+'px'; pop.style.top = top+'px'; pop.style.display='block';
    setTimeout(()=>input.focus(), 50);
  }
  function closeCapture(){
    const pop = document.getElementById('capturePopup');
    if(pop) pop.style.display='none';
    document.querySelectorAll('.marquee-box').forEach(b=>b.remove());
  }
  function saveHighlight(ask){
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
    repaintHighlights();
    renderHighlightList();
    closeCapture();
    if(ask && passage) askRomanoInto(passage, note);
  }
  function downloadCapture(){
    if(!captureImage) return;
    const a = document.createElement('a');
    a.href = captureImage; a.download = 'figure.png';
    document.body.appendChild(a); a.click(); a.remove();
  }

  // Romano — the reading partner (Tom Romano, author of the book). Warm, first
  // person, ≤2 sentences, turns a question back. Uses the shared callModel client.
  const READING_PARTNER = `You are Tom Romano — writer, teacher, and author of "Write What Matters" — a warm reading-and-writing partner for a college student reading your book. You help them think about the passage and their own writing life; you never lecture or summarize for them.

Voice: warm, first person, plainspoken, a little wry — a writer talking to a writer, not a critic. Draw the reader out; one real question put back to them beats a clever answer.

Hard rule on length: no more than TWO short sentences. Often make the second a single question back to them. No lists, no preamble, no flattery. Stop early rather than late.`;
  async function romanoReply(passage, question){
    const q = question || 'Help me think about this passage.';
    const prompt = passage
      ? `${READING_PARTNER}\n\nThe reader highlighted this passage from the book:\n"${passage}"\n\nThey ask: ${q}\n\nReply as Romano in ONE or TWO short sentences — illuminate it, then perhaps turn one question back to them.`
      : `${READING_PARTNER}\n\nThe reader asks: ${q}\n\nReply as Romano in ONE or TWO short sentences.`;
    return callModel(prompt);
  }
  async function askRomanoInto(passage, question){
    const box = document.getElementById('newnote');
    if(!box) return;
    const head = passage
      ? `<div class="q">You highlighted → asked Romano</div>${escHtml(passage.length>150?passage.slice(0,150)+'…':passage)}<br>`
      : `<div class="q">You asked Romano</div>${escHtml(question||'')}<br>`;
    const card = document.createElement('div'); card.className='notecard';
    card.innerHTML = head + `<span class="rmreply"><em style="color:var(--muted)">Romano is thinking…</em></span>`;
    box.appendChild(card);
    const replyEl = card.querySelector('.rmreply');
    if(getProvider()==='none'){ replyEl.innerHTML = '<em>Connect an AI (top right) and Romano will answer — optional; your reading and notes work without it.</em>'; return; }
    try { replyEl.textContent = await romanoReply(passage, question); }
    catch(e){ replyEl.innerHTML = '<em>Romano is unavailable right now.</em>'; }
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
          out.push({ page:+(pg.dataset.page||1), x:(r.left-p.left)/p.width, y:(r.top-p.top)/p.height, w:r.width/p.width, h:r.height/p.height });
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
        const m = document.createElement('div'); m.className = 'hl-mark'; m.dataset.hl = h.id;
        m.style.left = (rc.x*100)+'%'; m.style.top = (rc.y*100)+'%';
        m.style.width = (rc.w*100)+'%'; m.style.height = (rc.h*100)+'%';
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
  function renderHighlightList(){
    const el = document.getElementById('hlList'); if(!el) return;
    const list = getHighlights(currentReadingId());
    if(!list.length){ el.innerHTML = '<p class="hl-empty">No highlights yet. Select a passage (or ▭ box one) and choose ✎ Highlight.</p>'; return; }
    el.innerHTML = list.map(h => {
      const snip = escHtml(h.text ? (h.text.length>140 ? h.text.slice(0,140)+'…' : h.text) : '(figure)');
      const thumb = h.image ? `<img src="${h.image}" alt="figure" class="hl-thumb">` : '';
      const note = h.note ? `<div class="hl-note">${escHtml(h.note)}</div>` : '';
      return `<div class="hl-card" data-hl="${h.id}"><div class="hl-quote">${snip}</div>${thumb}${note}<div class="hl-row"><button class="hl-goto" data-hl="${h.id}">Go to</button><button class="hl-del" data-hl="${h.id}">Remove</button></div></div>`;
    }).join('');
    el.querySelectorAll('.hl-quote').forEach(q => q.onclick = () => scrollToHighlight(q.closest('.hl-card').dataset.hl));
    el.querySelectorAll('.hl-goto').forEach(b => b.onclick = () => scrollToHighlight(b.dataset.hl));
    el.querySelectorAll('.hl-del').forEach(b => b.onclick = () => removeHighlight(b.dataset.hl));
  }

  // Paint pdf pages — one at a time (single, with ‹ ›) or all stacked (continuous).
  async function renderPdfPages(pane, doc, r, token){
    const single = readPageMode === 'single';
    if(readPageNum > doc.numPages) readPageNum = doc.numPages;
    if(readPageNum < 1) readPageNum = 1;
    const nav = single
      ? `<div class="pdfnav"><button class="pdfnav-btn" id="pgPrev" ${readPageNum<=1?'disabled':''}>‹ Prev</button><span class="pdfnav-lbl">Page ${readPageNum} of ${doc.numPages}</span><button class="pdfnav-btn" id="pgNext" ${readPageNum>=doc.numPages?'disabled':''}>Next ›</button></div>`
      : `<div class="pdfnav"><span class="pdfnav-lbl">${doc.numPages} pages · scroll to read</span></div>`;
    pane.innerHTML = nav;
    const wrap = document.createElement('div'); wrap.className = 'pdf-doc'; pane.appendChild(wrap);
    if(single){
      const pv = document.getElementById('pgPrev'), nx = document.getElementById('pgNext');
      if(pv) pv.onclick = ()=>{ if(readPageNum>1){ readPageNum--; renderActiveDoc(r); } };
      if(nx) nx.onclick = ()=>{ if(readPageNum<doc.numPages){ readPageNum++; renderActiveDoc(r); } };
    }
    const avail = Math.max(320, pane.clientWidth - 64);
    const ratio = window.devicePixelRatio || 1;
    const pages = single ? [readPageNum] : Array.from({length:doc.numPages}, (_,i)=>i+1);
    for(const n of pages){
      if(token !== _readToken) return;
      const page = await doc.getPage(n);
      const unit = page.getViewport({ scale: 1 });
      const scale = Math.max(0.4, Math.min(3, (avail / unit.width)));
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
  async function addReadingFiles(fileList){
    const files = [...fileList].filter(f => /\.(pdf|docx|txt)$/i.test(f.name));
    if(!files.length) return;
    for(const f of files){
      const ext = (f.name.split('.').pop()||'').toLowerCase();
      const id = 'r' + Date.now() + '-' + Math.round(Math.random()*1e6);
      if(ext === 'txt'){
        const txt = await f.text();
        readings.push({ id, name: f.name, type: ext, html: `<p>${escHtml(txt).replace(/\n{2,}/g,'</p><p>').replace(/\n/g,'<br>')}</p>` });
      } else {
        const buf = await f.arrayBuffer();
        await saveReadingBytes(id, buf);   // kept locally; pdf.js / mammoth rendering wired next slice
        readings.push({ id, name: f.name, type: ext });
      }
    }
    activeReading = readings.length - 1;
    readPageNum = 1; _curPdf = { id:null, doc:null };
    persistReadings();
    renderRead();
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
        ${active && active.type === 'pdf' ? `<span class="viewseg"><button class="vbtn ${readPageMode==='single'?'on':''}" data-vm="single">Single page</button><button class="vbtn ${readPageMode==='continuous'?'on':''}" data-vm="continuous">Continuous</button></span><button class="vbtn capmode" id="captureModeBtn" title="Box: drag a box on the page to capture a passage or figure. Toggle to select text normally.">▭ Box</button>` : ''}
        <span class="shelf-spacer"></span>
        <button class="openbtn" id="openReading">＋ Load readings</button>
        <button class="openbtn" id="openFolder">＋ Load a folder</button>
        <input type="file" id="readInput" accept=".pdf,.docx,.txt" multiple hidden>
        <input type="file" id="readFolderInput" webkitdirectory hidden>
      </div>
      <div class="reader">
        <div class="doc" id="docPane">${docBody(active)}</div>
        <aside class="notes">
          <h4>Your highlights</h4>
          <div id="hlList"></div>
          <div class="askbar"><input placeholder="Ask Romano about the reading…" id="askin"><button class="btn sm" id="askbtn">Ask</button></div>
          <div id="newnote"></div>
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
    const cmBtn = document.getElementById('captureModeBtn');
    if(cmBtn){ cmBtn.onclick = toggleCaptureMode; setCaptureMode(pdfCaptureMode); }
    renderHighlightList();
    const dp = document.getElementById('docPane');
    if(dp) dp.addEventListener('mouseup', handleSelectionCapture);
    const input = document.getElementById('readInput');
    const folderInput = document.getElementById('readFolderInput');
    document.getElementById('openReading').onclick = () => input.click();
    document.getElementById('openFolder').onclick = () => folderInput.click();
    input.onchange = async () => { await addReadingFiles(input.files); input.value = ''; };
    folderInput.onchange = async () => { await addReadingFiles(folderInput.files); folderInput.value = ''; };
    document.getElementById('askbtn').addEventListener('click',()=>{const el=document.getElementById('askin');const v=el.value.trim();if(!v)return;el.value='';askRomanoInto(captureText||'', v);});
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
        const isOp = list.some(e=>e.pieceKind === 'one-pager');
        cells += `<div class="cell ${list.length?'entry':''} ${isOp?'op':''} ${noteSel===key?'sel':''}" data-key="${key}">${dd}</div>`;
      }
      leftPane = `<div class="cal">
        <div class="calhead"><button class="calnav" id="prevM" aria-label="Previous month" ${(y*12+m)<=NOTE_MIN?'disabled':''}>‹</button><span class="mname">${monthName}</span><button class="calnav" id="nextM" aria-label="Next month" ${(y*12+m)>=NOTE_MAX?'disabled':''}>›</button></div>
        <div class="grid">${dow}${cells}</div>
        <p class="runline" style="margin-top:12px">● green = a kept page · red outline = a One-Pager. Click a day to read it.</p>
        <div class="composer-foot" style="margin-top:14px"><button class="btn">Bundle notebook → PDF</button></div></div>`;
      rightPane = noteDayDetail();
    } else {
      const pieces = journalPieces();
      const listHtml = pieces.length
        ? pieces.map(p=>`<button class="moment has ${notePieceSel===p.id?'on':''}" data-piece="${p.id}"><span class="mname"><span class="dot"></span>${escHtml(p.title)}</span><span class="mkind">${p.entries.length} kept pass${p.entries.length>1?'es':''}</span></button>`).join('')
        : `<p class="empty" style="font-family:var(--sans)">No kept pages yet. In any tab, write, then hit <strong>＋ Add to notebook</strong>.</p>`;
      leftPane = `<div class="piecelist"><p class="lead">Your pieces</p>${listHtml}
        <div class="composer-foot" style="margin-top:14px"><button class="btn">Bundle notebook → PDF</button></div></div>`;
      rightPane = notePieceDetail();
    }
    frame.innerHTML = `<div class="head"><h1>Notebook</h1><p>Your kept pages — the writing you elevated with <strong>＋ Add to notebook</strong>. See them <strong>by day</strong>, or watch one piece grow <strong>by piece</strong>. This is the 50-pt Writer’s Notebook.</p>${toggle}</div>
      <div class="notewrap">${leftPane}${rightPane}</div>`;

    frame.querySelectorAll('.nbview').forEach(b => b.onclick = () => { noteMode = b.dataset.mode; nbEditingId = null; renderNote(); });
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
  function show(t){ tab=t; document.querySelectorAll('#tabbar button').forEach(b=>b.classList.toggle('on',b.dataset.t===t)); R[t](); }
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

  show('free');
})();

// ===== init =====
updateAIBtn();
