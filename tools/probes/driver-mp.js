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
    var opts = document.querySelectorAll('.pj-opt');
    ok('M5 the acts list their entries as options', opts.length >= 3, opts.length + ' options');
    var chosen = document.querySelectorAll('.pj-opt.on');
    ok('M6 the seeded Act I flag is checked', chosen.length === 1, chosen.length + ' checked');
    if(opts.length){
      var target = [].slice.call(opts).filter(function(b){ return !b.classList.contains('on'); })[0];
      if(target){
        var slot = target.getAttribute('data-flagpick'), ent = target.getAttribute('data-flagent');
        target.click();
        await sleep(300);
        var T = (JSON.parse(localStorage.getItem('cr284_state')) || {}).turnin || {};
        ok('M7 clicking an option sets that act\'s entry', T[slot] === ent, slot + '=' + T[slot]);
      }
    }
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
