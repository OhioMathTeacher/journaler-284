// The My Progress button, and the panel it opens.
//
// Todd: "My progress button doesn't work." The button is a top-bar control, not a lens
// tab, so nothing in the other suites ever presses it -- which is exactly why it could
// break unnoticed. Seeds entries across all three acts so row 4's columns have something
// to draw, then presses the button and reports what happened.
(function(){
  var OUT = [], ERRS = [];
  window.addEventListener('error', function(e){ ERRS.push('error: ' + (e.message || e) + ' @@ ' + ((e.error && e.error.stack) || '').split('\n').slice(0,4).join(' <- ')); });
  window.addEventListener('unhandledrejection', function(e){ ERRS.push('reject: ' + (e.reason && e.reason.message || e.reason)); });
  function ok(n, p, d){ OUT.push({ n: n, p: !!p, d: d === undefined ? '' : String(d) }); }
  function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }

  function seedAndReload(){
    var dates = ['2026-07-30', '2026-09-02', '2026-10-05', '2026-11-10'];
    var entries = dates.map(function(d, i){
      return { id: 'mp' + i, pieceId: 'free', pieceKind: 'freewrite', date: d,
               ts: d + 'T10:0' + i + ':00', text: 'Probe page ' + i + '. ' + new Array(60).join('word ') };
    });
    var st = { v: 6, journal: entries, turnin: { flag1: 'mp1' }, readings: [], highlights: {}, qa: {} };
    localStorage.setItem('cr284_state', JSON.stringify(st));
    sessionStorage.setItem('mpProbe', '1');
    location.reload();
  }

  async function run(){
    var btn = document.getElementById('myProgressBtn');
    ok('M1 the My Progress button exists', !!btn);
    if(!btn){ return done(); }
    btn.click();
    await sleep(400);
    var panel = document.querySelector('.pjtable');
    ok('M2 pressing it renders the panel', !!panel);
    ok('M3 the notebook view is showing', !!document.querySelector('.nbview[data-mode="tags"].on'));
    var acts = document.querySelectorAll('.pj-act');
    ok('M4 row 4 draws three act columns', acts.length === 3, acts.length + ' columns');
    var st0 = JSON.parse(localStorage.getItem('cr284_state')) || {};
    ok('M4b the seed survived the reload', (st0.journal||[]).length === 4, (st0.journal||[]).length + ' entries');
    ok('M4c what the columns say', true, [].slice.call(acts).map(function(a){ return a.textContent.replace(/\s+/g,' ').slice(0,70); }).join(' || '));
    var opts = document.querySelectorAll('.pj-mark');
    ok('M5 the acts list their entries as options', opts.length >= 3, opts.length + ' options');
    var chosen = document.querySelectorAll('.pj-mark.on');
    ok('M6 the seeded Act I flag is checked', chosen.length === 1, chosen.length + ' checked');
    if(opts.length){
      var target = [].slice.call(opts).filter(function(b){ return !b.classList.contains('on'); })[0];
      if(target){
        var slot = target.getAttribute('data-flagpick'), ent = target.getAttribute('data-flagent');
        target.click();
        await sleep(300);
        var T = (JSON.parse(localStorage.getItem('cr284_state')) || {}).turnin || {};
        ok('M7 the circle sets that act\'s entry', T[slot] === ent, slot + '=' + T[slot]);
      }
    }
    var sums = [].slice.call(document.querySelectorAll('.pj-act-sum')).map(function(n){ return n.textContent.replace(/\s+/g,' ').trim(); });
    ok('M9 each act reports its own words, and the chosen entry against the floor',
       sums.length === 3 && /chosen: \d+ words/.test(sums[0]) && /short of \d+|clears \d+|not from this act/.test(sums[0]), sums.join(' || '));
    // Todd's complaint made a check: a four-word page from before the term, flagged for an
    // act, must not wear the same green tick as work that counts.
    var green = document.querySelectorAll('.pj-mark.on:not(.warn)');
    var amber = document.querySelectorAll('.pj-mark.on.warn');
    ok('M10 a chosen entry that does not qualify is not ticked green',
       green.length === 0 && amber.length >= 1, green.length + ' green / ' + amber.length + ' amber');
    ok('M11 every option carries its word count', document.querySelectorAll('.pj-w').length === document.querySelectorAll('.pj-opt').length,
       document.querySelectorAll('.pj-w').length + ' counts');
    var link = document.querySelector('.pj-opt[data-goto]');
    var beforeT = JSON.stringify((JSON.parse(localStorage.getItem('cr284_state'))||{}).turnin||{});
    if(link){ link.click(); await sleep(400);
      ok('M8 clicking the entry text opens it, and changes no flag',
         !!document.querySelector('.nbview[data-mode="day"].on')
         && JSON.stringify((JSON.parse(localStorage.getItem('cr284_state'))||{}).turnin||{}) === beforeT); }
    ok('Z1 no uncaught errors', ERRS.length === 0, ERRS.join(' | '));
    done();
  }
  function done(){
    try { fetch('/', { method: 'POST', body: JSON.stringify(OUT) }); } catch(e){}
  }
  window.addEventListener('load', function(){
    if(sessionStorage.getItem('mpProbe')) setTimeout(run, 500);
    else setTimeout(seedAndReload, 300);
  });
})();
