// Telefone is one full-width column, and it fits on one screen.
//
// The pane went through three shapes in one night. It was 920px of a 1485px frame with
// 461px of overflow below the fold; then two columns, a reading column and a rail
// holding the figures, the saved runs and the reflection; and now one column again,
// because the reflection and the runs list are gone (Telefone submits nothing — it is an
// in-class conversation) and nothing was left to stand beside the page.
//
// What has to keep holding: the pane uses the width it has, it needs no vertical
// scrolling at a desktop size, the passage scrolls inside its own sheet rather than
// growing the document, and nothing is drawn shorter than its own text.
(function(){
  var OUT = [], ERRS = [];
  window.addEventListener('error', function(e){ ERRS.push('ERROR ' + (e.message||e) + ' @@ ' + ((e.error&&e.error.stack)||'').split('\n').slice(0,4).join(' <- ')); });
  function ok(n,p,d){ OUT.push({n:n,p:!!p,d:d===undefined?'':String(d)}); }
  function sleep(ms){ return new Promise(function(r){ setTimeout(r,ms); }); }
  function box(sel){ var e=document.querySelector(sel); if(!e) return null; var r=e.getBoundingClientRect();
    return {w:Math.round(r.width),h:Math.round(r.height),t:Math.round(r.top),l:Math.round(r.left),r:Math.round(r.right),b:Math.round(r.bottom)}; }

  function seedAndReload(){
    // A real OP5 page and eleven rounds — the fullest the pane ever gets, which is the
    // state that has to fit.
    var line = 'The fence was broke and nobody fixed it. Rain got in the kitchen and everything. ';
    var p = [new Array(36).join(line)];
    for(var i=1;i<=10;i++) p.push('The fence was broken and nobody fixed it. Rain came in. Revision ' + i + '. ' + new Array(20).join('word '));
    localStorage.setItem('cr284_state', JSON.stringify({v:6, tele:{passes:p, asked:[null]}}));
    localStorage.setItem('cr_provider','groq'); localStorage.setItem('cr_groq_key','k');
    sessionStorage.setItem('layoutProbe','1'); location.reload();
  }

  async function run(){
    document.querySelector('#tabbar button[data-t="tele"]').click();
    await sleep(600);

    var doc = document.documentElement.scrollHeight;
    ok('G1 the desktop pane needs no vertical scrolling', doc <= innerHeight + 2,
       'document ' + doc + ' vs viewport ' + innerHeight + ' (overflow ' + (doc - innerHeight) + 'px)');

    var tele = box('.tele'), frame = box('.frame'), sheet = box('.tele-sheet');
    ok('G2 the pane runs the width of the frame', !!(tele && frame) && tele.w > frame.w * 0.9,
       tele && frame ? (tele.w + ' of ' + frame.w + 'px frame') : 'missing');
    ok('G3 the sheet runs with it', !!(sheet && tele) && sheet.w > tele.w * 0.9,
       sheet && tele ? (sheet.w + ' of ' + tele.w) : 'missing');

    ok('G4 the status line sits under the sheet', !!document.querySelector('.tele-sheet .tele-status'));
    // The figures are behind a button so the passage gets the height. They must be out of
    // the flow until asked for, and must actually open when asked.
    var sBtn = document.getElementById('teleStatBtn'), sPop = document.getElementById('teleStats');
    ok('G4a the figures are hidden behind a button', !!sBtn && !!sPop && sPop.hidden,
       sPop ? ('hidden=' + sPop.hidden) : 'no popover');
    var beforeH = document.querySelector('.tele-page').clientHeight;
    if(sBtn) sBtn.click();
    await sleep(200);
    ok('G4b clicking it shows the figures', !!sPop && !sPop.hidden && /words/.test(sPop.textContent),
       sPop ? sPop.textContent.replace(/\s+/g,' ').trim().slice(0,70) : '-');
    ok('G4c and opening them does not shrink the passage',
       document.querySelector('.tele-page').clientHeight === beforeH,
       beforeH + ' -> ' + document.querySelector('.tele-page').clientHeight);
    document.body.click();
    await sleep(200);
    ok('G4d a click outside closes them again', !!sPop && sPop.hidden);
    ok('G5 nothing is left of the rail, the runs list or the reflection',
       !document.querySelector('.tele-rail') && !document.querySelector('.tele-rounds')
       && !document.querySelector('.tele-reflect') && !document.getElementById('teleReflection'),
       'all absent');

    var page = document.querySelector('.tele-page');
    ok('G6 a long passage scrolls inside its own sheet',
       !!page && (page.scrollHeight > page.clientHeight + 2 ? getComputedStyle(page).overflowY === 'auto' : true),
       page ? ('content ' + page.scrollHeight + ' in ' + page.clientHeight + ', overflow-y=' + getComputedStyle(page).overflowY) : 'no page');
    ok('G7 the passage got the room the rail used to take',
       !!page && page.clientHeight > 300, page ? (page.clientHeight + 'px tall') : '-');

    ok('G8 the run controls are on screen', (function(){ var a=box('.tele-actions'); return !!a && a.b <= innerHeight && a.w > 0; })(),
       JSON.stringify(box('.tele-actions')));

    // A finished run puts one long sentence in the status line. Flex children shrink by
    // default, and text squeezed below its own height paints over what follows -- which
    // is how the ending message once printed through the heading under it.
    var status = document.getElementById('teleStatus');
    status.textContent = 'The run stops at round 5: 73%, unchanged for 3 rounds — the machine has stopped changing it. Round 0 and round 5 are both still in the tabs — compare them.';
    await sleep(250);
    var kids = [].slice.call(document.querySelector('.tele-sheet').children);
    var cropped = kids.filter(function(k){ return k.scrollHeight > k.clientHeight + 2 && getComputedStyle(k).overflowY === 'visible'; })
                      .map(function(k){ return (k.className||k.id) + ' ' + k.scrollHeight + ' in ' + k.clientHeight; });
    ok('G9 nothing under the sheet is drawn shorter than its own text', cropped.length === 0, cropped.join(' | ') || 'none squeezed');
    ok('G10 and the page still does not scroll with that message on it',
       document.documentElement.scrollHeight <= innerHeight + 2,
       'document ' + document.documentElement.scrollHeight + ' vs ' + innerHeight);

    ok('Z1 no uncaught errors', ERRS.length === 0, ERRS.join(' | '));
    try { fetch('/',{method:'POST',body:JSON.stringify(OUT)}); } catch(e){}
  }
  window.addEventListener('load', function(){
    if(sessionStorage.getItem('layoutProbe')) setTimeout(run, 600); else setTimeout(seedAndReload, 300);
  });
})();
