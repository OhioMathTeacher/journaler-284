// Telefone reads across, not down.
//
// Todd: "make the page more horizontal and less vertical so that no vertical scrolling
// is required on a desktop." Before this, the pane was 920px of a 1485px frame and ran
// 461px past the fold: the figures, the status line, the saved rounds and the reflection
// were stacked UNDER a sheet with 565px of empty space beside it.
//
// What has to keep holding: at a desktop width the pane fits on one screen, the rail
// sits beside the reading column rather than under it, and a long passage scrolls inside
// its own sheet instead of growing the document. The narrow layout is not exercised here
// -- the harness fixes the window at 1500x1000 -- so instead this checks that the
// two-column rules are GATED behind a min-width query, which is what keeps a phone on
// one column.
(function(){
  var OUT = [], ERRS = [];
  window.addEventListener('error', function(e){ ERRS.push('ERROR ' + (e.message||e)); });
  function ok(n,p,d){ OUT.push({n:n,p:!!p,d:d===undefined?'':String(d)}); }
  function sleep(ms){ return new Promise(function(r){ setTimeout(r,ms); }); }
  function box(sel){ var e=document.querySelector(sel); if(!e) return null; var r=e.getBoundingClientRect();
    return {w:Math.round(r.width),h:Math.round(r.height),t:Math.round(r.top),l:Math.round(r.left),r:Math.round(r.right),b:Math.round(r.bottom)}; }

  function seedAndReload(){
    // A real OP5 page, plus ten passes and two saved rounds -- the fullest the pane
    // ever gets, which is the state that has to fit.
    var line = 'The fence was broke and nobody fixed it. Rain got in the kitchen and everything. ';
    var p = [new Array(36).join(line)];
    for(var i=1;i<=10;i++) p.push('The fence was broken and nobody fixed it. Rain came in. Revision ' + i + '. ' + new Array(20).join('word '));
    var rounds = [1,2].map(function(k){ return { id:'r'+k, when:new Date().toISOString(), model:'Groq', n:10,
      asked:'clean it up', survival:61, first:p[0], last:p[10] }; });
    localStorage.setItem('cr284_state', JSON.stringify({v:6, tele:{passes:p, asked:[null], games:rounds, reflection:'Some words about what went.'}}));
    localStorage.setItem('cr_provider','groq'); localStorage.setItem('cr_groq_key','k');
    sessionStorage.setItem('layoutProbe','1'); location.reload();
  }

  async function run(){
    document.querySelector('#tabbar button[data-t="tele"]').click();
    await sleep(600);

    var doc = document.documentElement.scrollHeight;
    ok('G1 the desktop pane needs no vertical scrolling', doc <= innerHeight + 2,
       'document ' + doc + ' vs viewport ' + innerHeight + ' (overflow ' + (doc - innerHeight) + 'px)');

    var sheet = box('.tele-sheet'), rail = box('.tele-rail'), main = box('.tele-main');
    ok('G2 the rail sits beside the reading column, not under it',
       !!(sheet && rail) && rail.l >= sheet.r - 1 && rail.t < sheet.b,
       rail && sheet ? ('sheet right=' + sheet.r + ', rail left=' + rail.l + ' top=' + rail.t) : 'missing');

    var tele = box('.tele'), frame = box('.frame');
    ok('G3 the pane uses the width it has', !!(tele && frame) && tele.w > frame.w * 0.9,
       tele && frame ? (tele.w + ' of ' + frame.w + 'px frame') : 'missing');

    // Everything that used to be stacked below the sheet is now in the rail.
    ['.tele-stats', '.tele-status', '.tele-rounds', '.tele-reflect'].forEach(function(sel){
      var e = document.querySelector('.tele-rail ' + sel);
      ok('G4 ' + sel + ' is in the rail', !!e);
    });

    // A passage longer than the screen must scroll inside the sheet, not stretch the page.
    var page = document.querySelector('.tele-main .tele-page');
    ok('G5 a long passage scrolls inside its own sheet',
       !!page && page.scrollHeight > page.clientHeight + 2 ? getComputedStyle(page).overflowY === 'auto' : true,
       page ? ('content ' + page.scrollHeight + ' in ' + page.clientHeight + ', overflow-y=' + getComputedStyle(page).overflowY) : 'no page');

    ok('G6 the run controls are still on screen', (function(){
      var a = box('.tele-actions');
      return !!a && a.b <= innerHeight && a.w > 0;
    })(), JSON.stringify(box('.tele-actions')));

    // The two-column rules must be gated, or a phone gets a 440px rail it cannot use.
    var gated = false, conds = [];
    for(var i=0;i<document.styleSheets.length;i++){
      var ss = document.styleSheets[i], rules;
      try { rules = ss.cssRules; } catch(e){ continue; }
      for(var j=0;j<rules.length;j++){
        var r = rules[j];
        if(r.type === CSSRule.MEDIA_RULE && /min-width/.test(r.conditionText) && /\.tele-rail/.test(r.cssText)){
          gated = true; conds.push(r.conditionText);
        }
      }
    }
    ok('G7 the two-column layout is gated behind a min-width query', gated, conds.join(' ; ') || 'NOT gated');
    ok('Z1 no uncaught errors', ERRS.length === 0, ERRS.join(' | '));
    try { fetch('/',{method:'POST',body:JSON.stringify(OUT)}); } catch(e){}
  }
  window.addEventListener('load', function(){
    if(sessionStorage.getItem('layoutProbe')) setTimeout(run, 600); else setTimeout(seedAndReload, 300);
  });
})();
