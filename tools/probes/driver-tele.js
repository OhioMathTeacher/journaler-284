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
    ok('T4 round 0 keeps the switch in place, with the comparisons inert',
       !!modes && getComputedStyle(modes).display !== 'none'
       && !document.querySelector('input[name="teleMode"][value="left"]').disabled
       && document.querySelector('input[name="teleMode"][value="changed"]').disabled
       && document.querySelector('input[name="teleMode"][value="lost"]').disabled,
       modes ? ('display=' + getComputedStyle(modes).display + ' disabled=' +
         [].slice.call(modes.querySelectorAll('input')).map(function(i){ return i.value + ':' + i.disabled; }).join(',')) : '-');
    var zeroBox = modes.getBoundingClientRect();

    var tabs = document.querySelectorAll('.tele-tab');
    tabs[2].click();
    await sleep(250);
    var liveBox = document.querySelector('.tele-modes').getBoundingClientRect();
    ok('T5 the switch does not move between round 0 and a later round',
       Math.abs(liveBox.left - zeroBox.left) < 1 && Math.abs(liveBox.top - zeroBox.top) < 1,
       'round 0 at ' + Math.round(zeroBox.left) + ',' + Math.round(zeroBox.top)
       + ' / round 2 at ' + Math.round(liveBox.left) + ',' + Math.round(liveBox.top));
    ok('T5b and every option is live once there is something to compare',
       ![].slice.call(document.querySelectorAll('input[name="teleMode"]')).some(function(i){ return i.disabled; }));
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
    ok('T13 returning to round 0 leaves the switch where it was, comparisons inert again',
       getComputedStyle(document.querySelector('.tele-modes')).display !== 'none'
       && document.querySelector('input[name="teleMode"][value="lost"]').disabled
       && document.querySelector('input[name="teleMode"][value="left"]').checked,
       'left checked=' + document.querySelector('input[name="teleMode"][value="left"]').checked);

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

    ok('T21 the pane offers no PDF of its own — the One-Pager export is the deliverable',
       !document.getElementById('telePrint')
       && ![].slice.call(document.querySelectorAll('.tele button')).some(function(b){ return /pdf|print/i.test(b.textContent); }),
       [].slice.call(document.querySelectorAll('.tele button')).map(function(b){ return b.textContent.trim(); }).join(' | '));
    var claim = [].slice.call(document.querySelectorAll('.tele'))
      .map(function(n){ return n.textContent; }).join(' ')
      .replace(/Use my One-Pager 5/g, '');
    ok('T22 the pane claims no tie to One-Pager 5 — it submits nothing',
       !/One-Pager 5|prints with|submit/i.test(claim),
       (claim.match(/[^.]*(One-Pager 5|prints with|submit)[^.]*/i) || ['no claim'])[0].trim().slice(0,90));

    document.querySelectorAll('.tele-tab')[0].click();
    await sleep(300);
    var ed = document.getElementById('teleEditor');
    ok('T23 round 0 is editable even after rounds exist', !!ed, ed ? 'textarea present' : 'read-only');
    if(ed){
      var had = document.querySelectorAll('.tele-tab').length;
      ed.value = 'Something else entirely, typed over the old page.';
      ed.dispatchEvent(new Event('input', {bubbles:true}));
      await sleep(300);
      ok('T24 typing over it drops the rounds made from the old text',
         document.querySelectorAll('.tele-tab').length === 1, had + ' tabs -> ' + document.querySelectorAll('.tele-tab').length);
      var st = JSON.parse(localStorage.getItem('cr284_state'));
      ok('T25 and the new text is round 0', (st.tele.passes[0] || '').indexOf('Something else entirely') === 0
         && st.tele.passes.length === 1, st.tele.passes.length + ' passes');
    }

    // Start over means an empty box, not "round 0 kept and everything else thrown away".
    window.confirm = function(){ return true; };
    var rs = document.getElementById('teleReset');
    ok('T26 Start over is offered while there is anything to clear', !!rs && !rs.disabled,
       rs ? ('disabled=' + rs.disabled) : 'missing');
    if(rs){
      rs.click();
      await sleep(400);
      var st2 = JSON.parse(localStorage.getItem('cr284_state'));
      ok('T27 it wipes round 0 as well, leaving nothing behind',
         st2.tele.passes.length === 1 && String(st2.tele.passes[0]).trim() === '',
         st2.tele.passes.length + ' passes, round 0 = ' + JSON.stringify(String(st2.tele.passes[0]).slice(0,40)));
      var ed2 = document.getElementById('teleEditor');
      ok('T28 and leaves an empty box ready to type in', !!ed2 && ed2.value === '',
         ed2 ? JSON.stringify(ed2.value.slice(0,30)) : 'no editor');
    }

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
