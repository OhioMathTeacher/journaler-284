// The reflection box after the buzzer — and what happens when Romano cannot be reached.
//
// This fails SILENTLY in two different directions, which is why it is a probe and not
// something to eyeball. Both were live on OP5 (4 Oct 2026):
//
//  1. callModel's fail() only THROWS when asked. Without { throwErrors: true } it RETURNS
//     the error message as a plain string, and this caller treated whatever came back as
//     Romano's question. A rate limit therefore SAVED "Groq API error 429: Rate limit
//     reached" into session.question and printed it on the submitted PDF under the heading
//     "Romano - AI asked", as though a teacher had asked the student that. Twenty students
//     share one key, so 429 is the ordinary case, not the rare one.
//
//  2. The catch painted an apology and NOTHING ELSE -- no question, no textarea, no
//     onQuestion -- so nothing was saved and the export dropped the whole block, because it
//     renders the exchange only `if(s.question)`. The student had nowhere to write a note
//     the rubric required, and the grader could not tell that from not bothering.
//
// What is pinned down here is the promise actually made to a student: after the buzzer
// there is always a question and always somewhere to answer it, whatever the network did.
(function(){
  var OUT = [], ERRS = [];
  window.addEventListener('error', function(e){ ERRS.push('error: ' + (e.message || e)); });
  window.addEventListener('unhandledrejection', function(e){ ERRS.push('reject: ' + (e.reason && e.reason.message || e.reason)); });
  function ok(n, p, d){ OUT.push({ n: n, p: !!p, d: d === undefined ? '' : String(d) }); }
  function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }

  var SOLO = 'How did the writing go? What did you leave out, and what do you most want a reader to notice?';
  var GUSH = 'Sunday dinners and the whole house loud with it, my father shouting at the television '
           + 'while the dogs went under the table and nobody minded any of it at all.';

  function state(){ try { return JSON.parse(localStorage.getItem('cr284_state')) || {}; } catch(e){ return {}; } }
  function session(op){ return (((state().freewrite || {})[op]) || {}).session || {}; }

  // Drive one gush to the buzzer with the clock wound down to zero. The textarea is
  // disabled until the gush starts, so the text goes in immediately after.
  async function gushToBuzzer(){
    var minus = document.getElementById('tminus');
    for (var i = 0; i < 9 && minus; i++) minus.click();        // 8:00 -> 0:00
    var start = document.getElementById('startBtn');
    if(!start) return 'no #startBtn';
    start.click();
    var ta = document.getElementById('gush');
    if(!ta) return 'no #gush';
    ta.value = GUSH;                                            // >10 words, clears the floor
    await sleep(3000);                                          // buzzer + the model call
    return null;
  }

  async function run(){
    // ---- Romano unreachable: a genuine network fault on every call ----
    localStorage.setItem('cr_provider', 'groq');
    localStorage.setItem('cr_groq_key', 'gsk_probe_not_a_real_key');
    var realFetch = window.fetch;
    window.fetch = function(u){
      var url = String((u && u.url) || u || '');
      if (/groq|openai|anthropic|googleapis/i.test(url)) return Promise.reject(new TypeError('Failed to fetch'));
      return realFetch.apply(window, arguments);
    };

    document.querySelectorAll('#tabbar button').forEach(function(b){ if(b.dataset.t === 'free') b.click(); });
    await sleep(700);
    var why = await gushToBuzzer();
    if(why){ ok('the Freewrite tab offers a gush to start', false, why); return done(); }

    var band = document.getElementById('reflectband');
    var label = band && band.querySelector('.stagelabel');
    ok('unreachable · the reflection band is open', !!band && band.style.display !== 'none');
    ok('unreachable · it is still headed "Reflecting on Writing"',
       !!label && /Reflecting on Writing/.test(label.textContent), label && label.textContent);

    var ta = document.getElementById('reflectAnswer');
    ok('unreachable · there is somewhere to answer', !!ta, ta ? '' : 'no #reflectAnswer — the student is stuck');

    var body = document.getElementById('reflectBody');
    var q = body ? body.textContent : '';
    ok('unreachable · the question is the app\'s own prompt', q.indexOf(SOLO) === 0, q.slice(0, 90));
    // ⚠ Keep this pattern WIDE. It first read /API error|Failed to fetch|rate.?limit/ and
    // passed cheerfully on the real bug, because the string actually saved was "Error reaching
    // Groq. Please check your connection and try again." A probe that green-lights the defect
    // it exists for is worse than no probe.
    var LOOKS_LIKE_AN_ERROR = /API error|error reaching|failed to fetch|rate.?limit|unavailable|check your connection|unauthorized|\b4\d\d\b|\b5\d\d\b/i;
    ok('unreachable · no error text is shown as a question', !LOOKS_LIKE_AN_ERROR.test(q), q.slice(0, 90));

    // What is SAVED is what prints on the submitted PDF, so it matters more than the DOM.
    var s = session('op1');
    ok('unreachable · a question was saved at all', !!s.question, JSON.stringify(s.question || null));
    ok('unreachable · it is saved as the app\'s, not Romano\'s', s.questionFrom === 'app', String(s.questionFrom));
    ok('unreachable · no error text was saved onto the submitted record',
       !LOOKS_LIKE_AN_ERROR.test(String(s.question || '')), String(s.question || '').slice(0, 90));

    // The answer must persist, or the note is lost on reload whatever the heading said.
    if(ta){
      ta.value = 'It went faster than I expected and I left out the part about my brother.';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(300);
      ok('unreachable · the answer is saved as it is typed',
         /left out the part about my brother/.test(String(session('op1').answer || '')));
    }

    window.fetch = realFetch;
    done();
  }
  function done(){
    ERRS.forEach(function(e){ ok('no console errors', false, e); });
    fetch('/__result', { method: 'POST', body: JSON.stringify(OUT) });
  }
  if(document.readyState === 'complete') setTimeout(run, 900);
  else window.addEventListener('load', function(){ setTimeout(run, 900); });
})();
