// Telefone's three-way read: what's left, what this pass changed, what's lost.
//
// The switch replaced a checkbox, and a render that throws here fails the way the
// My Progress button did -- the pane just stops responding, with nothing in the UI to
// say why. It also carries a claim that is easy to break silently: the "what's lost"
// view and the % on each tab must describe the same loss. They use different
// comparators (teleDiffOf on tokens, teleSurvival on normalized words), so the tab can
// drift from the page without either one looking wrong on its own.
(function(){
  var OUT = [], ERRS = [];
  window.addEventListener('error', function(e){ ERRS.push('error: ' + (e.message || e) + ' @@ ' + ((e.error && e.error.stack) || '').split('\n').slice(0,4).join(' <- ')); });
  window.addEventListener('unhandledrejection', function(e){ ERRS.push('reject: ' + (e.reason && e.reason.message || e.reason)); });
  function ok(n, p, d){ OUT.push({ n: n, p: !!p, d: d === undefined ? '' : String(d) }); }
  function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }
  function pick(v){ return document.querySelector('input[name="teleMode"][value="' + v + '"]'); }
  function DB_LEN(){ try { return (JSON.parse(localStorage.getItem('cr284_state')) || {}).tele.passes.length; } catch(e){ return -1; } }

  // Pass zero breaks rules on purpose, the way OP5 asks. Each pass tidies it further,
  // so there is real loss to strike -- including a word that appears twice in pass zero
  // and once later, which is where a naive count goes wrong.
  function seedAndReload(){
    var st = { v: 6, tele: { passes: [
      "The fence was broke and nobody fixed it. Nobody. Rain got in the kitchen, got in everything.",
      "The fence was broken and nobody fixed it. Rain came into the kitchen and got into everything.",
      "The fence was broken, and no one repaired it. Rain entered the kitchen and soaked everything."
    ], asked: [null, 'clean it up & correct it', 'rewrite in clear, standard English'], rounds: [], reflection: '' } };
    localStorage.setItem('cr284_state', JSON.stringify(st));
    // A provider, so AI Revise is live for the error-path checks at the end.
    localStorage.setItem('cr_provider', 'groq');
    localStorage.setItem('cr_groq_key', 'probe-key');
    localStorage.setItem('cr_groq_model', 'openai/gpt-oss-120b');
    sessionStorage.setItem('teleProbe', '1');
    location.reload();
  }

  async function run(){
    var tab = document.querySelector('#tabbar button[data-t="tele"]');
    ok('T1 the Telefone tab exists', !!tab);
    if(!tab){ return done(); }
    tab.click();
    await sleep(400);

    ok('T2 the pane rendered its passes', document.querySelectorAll('.tele-tab').length === 3,
       document.querySelectorAll('.tele-tab').length + ' tabs');
    var modes = document.querySelector('.tele-modes');
    ok('T3 the three-way switch is present', !!modes && modes.querySelectorAll('input[name="teleMode"]').length === 3,
       modes ? modes.querySelectorAll('input').length + ' options' : 'no switch');
    ok('T4 pass 0 hides the switch, having nothing to compare',
       !!modes && getComputedStyle(modes).display === 'none', modes ? getComputedStyle(modes).display : '-');

    var tabs = document.querySelectorAll('.tele-tab');
    tabs[2].click();
    await sleep(250);
    ok('T5 moving off pass 0 shows the switch', getComputedStyle(document.querySelector('.tele-modes')).display !== 'none');
    ok('T6 it opens on "what\'s left" — the plain text, no marks',
       !!document.querySelector('.tele-page') && !document.querySelector('.tele-page.tele-diff'));

    pick('changed').click();
    await sleep(250);
    var ch = document.querySelector('.tele-page.tele-diff');
    ok('T7 "what this pass changed" marks both cuts and additions',
       !!ch && ch.querySelectorAll('del').length > 0 && ch.querySelectorAll('ins').length > 0,
       ch ? ch.querySelectorAll('del').length + ' del / ' + ch.querySelectorAll('ins').length + ' ins' : 'no view');

    pick('lost').click();
    await sleep(250);
    var lost = document.querySelector('.tele-page.tele-lost');
    ok('T8 "what\'s lost" renders', !!lost);
    ok('T9 it shows losses only — nothing the machine added',
       !!lost && lost.querySelectorAll('del').length > 0 && lost.querySelectorAll('ins').length === 0,
       lost ? lost.querySelectorAll('del').length + ' del / ' + lost.querySelectorAll('ins').length + ' ins' : 'no view');

    // The claim worth protecting: strikethroughs and the tab % are one measurement.
    if(lost){
      var struck = lost.querySelectorAll('del').length;
      var kept = lost.textContent.trim().split(/\s+/).filter(Boolean).length;
      var viewPct = Math.round((1 - struck / kept) * 100);
      var tabPct = parseInt((tabs[2].querySelector('.pct') || {}).textContent || '0', 10);
      ok('T10 the strikethroughs and the tab % describe the same loss',
         viewPct === tabPct, 'view ' + viewPct + '% vs tab ' + tabPct + '%');
      ok('T11 a word kept in the text is not struck as lost',
         !/\bfence\b/.test([].slice.call(lost.querySelectorAll('del')).map(function(d){ return d.textContent; }).join(' ')),
         [].slice.call(lost.querySelectorAll('del')).map(function(d){ return d.textContent; }).join(' '));
    }

    pick('left').click();
    await sleep(250);
    ok('T12 switching back leaves the plain text, unmarked',
       !!document.querySelector('.tele-page') && !document.querySelector('.tele-page.tele-diff'));

    tabs[0].click();
    await sleep(250);
    ok('T13 returning to pass 0 hides the switch again',
       getComputedStyle(document.querySelector('.tele-modes')).display === 'none');

    // A failing model call must say WHY. callModel's fail() throws from inside the try
    // that catches network faults, so every specific reason -- bad key, retired model --
    // was being rewritten as "check your connection", which sends the student to fix
    // something that is not broken. From the outside that reads as "nothing happens".
    var realFetch = window.fetch.bind(window);
    window.fetch = function(u, o){
      if(String(u).indexOf('groq.com') >= 0){
        return Promise.resolve({ ok: false, status: 404,
          json: function(){ return Promise.resolve({ error: { message: 'The model `openai/gpt-oss-120b` does not exist or you do not have access to it.' } }); },
          text: function(){ return Promise.resolve('model not found'); } });
      }
      return realFetch(u, o);
    };
    var run1 = document.getElementById('teleRun');
    ok('T14 AI Revise is live once a provider is set', !!run1 && !run1.disabled, run1 ? 'disabled=' + run1.disabled : 'missing');
    var passesBefore = DB_LEN();
    if(run1) run1.click();
    await sleep(1500);
    var st2 = document.getElementById('teleStatus');
    var msg = st2 ? st2.textContent.trim() : '';
    ok('T15 a failed pass adds nothing', DB_LEN() === passesBefore, passesBefore + ' -> ' + DB_LEN());
    ok('T16 the failure names its real reason, not the connection',
       /404|does not exist|do not have access/.test(msg) && !/check your connection/i.test(msg), JSON.stringify(msg));
    ok('T17 the button recovers for another try', !!document.getElementById('teleRun') && !document.getElementById('teleRun').disabled);

    // With no provider chosen, AI Revise must carry the student to Settings -> AI
    // rather than fail quietly -- the pane no longer has a Change model button of its own.
    localStorage.removeItem('cr_provider');
    document.getElementById('teleRun').click();
    await sleep(600);
    var aiPane = document.getElementById('set-ai');
    ok('T18 with no model set, AI Revise opens Settings -> AI',
       !!aiPane && aiPane.classList.contains('on'),
       aiPane ? ('set-ai.on=' + aiPane.classList.contains('on')) : 'no AI pane');
    ok('T19 and says where to go', /Settings/i.test(document.getElementById('teleStatus').textContent),
       JSON.stringify(document.getElementById('teleStatus').textContent.trim()));
    ok('T20 the pane no longer carries its own model control',
       !document.getElementById('teleModel') && !document.querySelector('.tele-model'), 'none present');

    ok('Z1 no uncaught errors', ERRS.length === 0, ERRS.join(' | '));
    done();
  }
  function done(){
    try { fetch('/', { method: 'POST', body: JSON.stringify(OUT) }); } catch(e){}
  }
  window.addEventListener('load', function(){
    if(sessionStorage.getItem('teleProbe')) setTimeout(run, 500);
    else setTimeout(seedAndReload, 300);
  });
})();
