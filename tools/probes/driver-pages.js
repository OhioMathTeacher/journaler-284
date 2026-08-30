// Page eviction in Continuous mode: what gets drawn, what gets let go, and — the part
// that decides the design — whether the reader's notes stay beside their passages.
//
// Two passes: the first puts a probe chapter in IndexedDB and its highlights in the DB
// and reloads; the second scrolls the chapter end to end and measures.
//
// The two invariants under test, both Todd's, both in his words in NEXT-STEPS.md:
//   · "We can't have notes disappearing while students are reading a long document."
//     → no .pdf-page div may ever leave the DOM, and no card may lose its anchor.
//   · "We do need all of the user's comments saved in resident memory across all the
//     readings." → bands and cards come from the DB, and no render path touches them.
(function(){
  var OUT = [], ERRS = [];
  var RID = 'f:_p_probe.pdf', NPAGES = 30, NHL = 12;
  window.addEventListener('error', function(e){ ERRS.push('error: ' + (e.message || e)); });
  window.addEventListener('unhandledrejection', function(e){ ERRS.push('reject: ' + (e.reason && e.reason.message || e.reason)); });
  function ok(n, p, d){ OUT.push({ n: n, p: !!p, d: d === undefined ? '' : String(d) }); }
  function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }

  function idbSeed(buf){
    return new Promise(function(res, rej){
      var req = indexedDB.open('cr284_readings', 2);
      req.onupgradeneeded = function(){ var db = req.result;
        if(!db.objectStoreNames.contains('files')) db.createObjectStore('files');
        if(!db.objectStoreNames.contains('handles')) db.createObjectStore('handles'); };
      req.onsuccess = function(){ var tx = req.result.transaction('files', 'readwrite');
        tx.objectStore('files').put(buf, RID);
        tx.oncomplete = function(){ res(); }; tx.onerror = function(){ rej(tx.error); }; };
      req.onerror = function(){ rej(req.error); };
    });
  }

  async function seedAndReload(){
    await idbSeed(await (await fetch('./_p_probe.pdf')).arrayBuffer());
    // One highlight every other page, spread the length of the chapter and far enough
    // apart that the margin never has to push a card off its own band — so a drift
    // measurement means what it says.
    var hls = [];
    for(var i = 0; i < NHL; i++){
      var pg = 1 + i * 2;
      hls.push({ id: 'hp' + pg, page: pg, pageLabel: String(pg), image: '', note: '',
        text: 'A passage kept on page ' + pg + ', long enough to fill a card and be recognisable in the margin beside its band.',
        ts: 1756000000000 + i, rects: [{ page: pg, x: 0.10, y: 0.18, w: 0.72, h: 0.028 }] });
    }
    var db = { v: 2, name: 'Probe Reader', freewrite: {}, currere: {}, notebook: {},
      _journalMigrated: true, _readingIdsV2: true, journal: [], qa: {}, highlights: {},
      readPageMode: 'continuous', notesOpen: true, activeReading: 0,
      readings: [{ id: RID, name: '_p_probe.pdf', type: 'pdf' }] };
    db.highlights[RID] = hls;
    localStorage.setItem('cr284_state', JSON.stringify(db));
    sessionStorage.setItem('probePass', '2');
    location.reload();
  }

  function canvases(){ return [].slice.call(document.querySelectorAll('#docPane .pdf-page > canvas')); }
  function canvasMB(){ return canvases().reduce(function(a,c){ return a + c.width*c.height*4; }, 0) / 1048576; }
  function pageDivs(){ return document.querySelectorAll('#docPane .pdf-page').length; }
  function marks(){ return document.querySelectorAll('#docPane .hl-mark').length; }
  function layers(){ return document.querySelectorAll('#docPane .hl-layer').length; }
  function textLayers(){ return document.querySelectorAll('#docPane .textLayer').length; }

  // Every card measured against the band it points at. An orphan — the page div gone,
  // so the card has nothing to anchor to — is the failure the whole design exists to
  // prevent, and is counted separately from drift.
  function cardDrift(){
    var surf = document.querySelector('.reader .notes-scroll');
    if(!surf) return { worst: -1, orphans: -1, checked: 0 };
    var worst = 0, orphans = 0, checked = 0;
    [].slice.call(surf.querySelectorAll('.hl-card[data-hl]')).forEach(function(card){
      var mark = document.querySelector('#docPane .hl-mark[data-hl="' + card.getAttribute('data-hl') + '"]');
      var pg = mark && mark.closest('.pdf-page');
      if(!mark || !pg || !pg.getBoundingClientRect().height){ orphans++; return; }
      checked++;
      var d = Math.abs(card.getBoundingClientRect().top - mark.getBoundingClientRect().top);
      if(d > worst) worst = d;
    });
    return { worst: worst, orphans: orphans, checked: checked };
  }

  // ⚠ WHICH THING SCROLLS IS NOT FIXED — #docPane has overflow-y:auto, but at page zoom
  // the pane scrolls by 0px and the document scrolls instead. Ask, don't assume.
  function scroller(){
    var dp = document.getElementById('docPane');
    if(dp && dp.scrollHeight > dp.clientHeight + 4) return dp;
    return document.scrollingElement || document.documentElement;
  }

  async function run(){
    if(sessionStorage.getItem('probePass') !== '2'){ await seedAndReload(); return; }
    await sleep(600);
    var rt = document.querySelector('#tabbar button[data-t="read"]');
    ok('P1 Readings tab present', !!rt);
    if(rt) rt.click();
    for(var i = 0; i < 120 && pageDivs() < NPAGES; i++) await sleep(250);
    ok('P2 every page of the chapter has a div from the start', pageDivs() === NPAGES, pageDivs() + ' divs');
    ok('P3 the margin is anchored', !!document.querySelector('.reader .notes.anchored'));

    await sleep(900);
    var first = { c: canvases().length, mb: canvasMB(), t: textLayers() };
    ok('P4 only a few pages are drawn at rest', first.c > 0 && first.c <= 12, first.c + ' canvases, ' + first.mb.toFixed(1) + ' MB');
    ok('P5 text layers follow the canvases', first.t <= first.c, first.t + ' text layers');
    ok('P6 bands exist for every page div, drawn or not', layers() === NPAGES, layers() + ' hl-layers');
    ok('P7 every band is painted', marks() === NHL, marks() + ' marks');
    var d0 = cardDrift();
    ok('P8 no card is orphaned at the top', d0.orphans === 0, 'orphans=' + d0.orphans + ' checked=' + d0.checked);
    ok('P9 every card sits on its band (<=2px)', d0.worst >= 0 && d0.worst <= 2, 'worst drift ' + d0.worst.toFixed(2) + 'px over ' + d0.checked + ' cards');

    var sc = scroller(), total = sc.scrollHeight - sc.clientHeight;
    ok('P10 the document has its full height from the first paint', total > 8000, 'scrollable ' + Math.round(total) + 'px');
    var peakC = first.c, peakMB = first.mb, worstDrift = d0.worst, orphanEver = d0.orphans,
        divsMin = pageDivs(), marksMin = marks(), STEPS = 24;
    for(var s = 1; s <= STEPS; s++){
      sc.scrollTop = Math.round(total * s / STEPS);
      await sleep(320);
      if(canvases().length > peakC) peakC = canvases().length;
      if(canvasMB() > peakMB) peakMB = canvasMB();
      var d = cardDrift();
      if(d.worst > worstDrift) worstDrift = d.worst;
      if(d.orphans > orphanEver) orphanEver = d.orphans;
      if(pageDivs() < divsMin) divsMin = pageDivs();
      if(marks() < marksMin) marksMin = marks();
    }
    await sleep(500);
    ok('P11 page divs never leave the DOM while scrolling', divsMin === NPAGES, 'fewest seen ' + divsMin);
    ok('P12 bands never leave the page while scrolling', marksMin === NHL, 'fewest seen ' + marksMin);
    ok('P13 no card was ever orphaned', orphanEver === 0, 'worst ' + orphanEver);
    ok('P14 every card stayed on its band the whole way (<=2px)', worstDrift <= 2, 'worst drift ' + worstDrift.toFixed(2) + 'px');
    ok('P15 canvas memory plateaus rather than climbing', peakC <= 14, 'peak ' + peakC + ' canvases / ' + peakMB.toFixed(1) + ' MB');
    ok('P16 REPORT ONLY — at the bottom of the chapter', true, canvases().length + ' canvases, ' + canvasMB().toFixed(1) + ' MB');
    ok('P17 REPORT ONLY — what drawing all ' + NPAGES + ' would cost', true,
       (NPAGES * (peakMB / Math.max(1, peakC))).toFixed(1) + ' MB');
    ok('P18 text layers were released too', textLayers() <= peakC, textLayers() + ' resident');

    sc.scrollTop = 0; await sleep(1400);
    var back = cardDrift();
    ok('P19 pages redraw on the way back up', canvases().length > 0, canvases().length + ' canvases');
    ok('P20 and the cards are still on their bands', back.orphans === 0 && back.worst <= 2, 'orphans=' + back.orphans + ' worst=' + back.worst.toFixed(2) + 'px');
    ok('P21 the text layer rebuilt with them', textLayers() > 0, textLayers() + ' text layers');

    // ── H · single-page mode and back. fill() serves both paths.
    var vs = document.querySelector('.vbtn[data-vm="single"]');
    ok('H1 the single-page control is there', !!vs);
    if(vs) vs.click();
    for(var k = 0; k < 40 && canvases().length === 0; k++) await sleep(250);
    await sleep(700);
    ok('H2 single mode draws the page it is on', canvases().length >= 1 && canvases().length <= 2, canvases().length + ' canvases');
    ok('H3 and builds only the divs it needs', pageDivs() >= 1 && pageDivs() <= 2, pageDivs() + ' divs');
    ok('H4 its text layer is there for capture', textLayers() >= 1, textLayers() + ' text layers');
    var vc = document.querySelector('.vbtn[data-vm="continuous"]');
    if(vc) vc.click();
    for(var k2 = 0; k2 < 60 && pageDivs() < NPAGES; k2++) await sleep(250);
    await sleep(900);
    ok('H5 continuous restores every page div', pageDivs() === NPAGES, pageDivs() + ' divs');
    ok('H6 and still draws only a few', canvases().length > 0 && canvases().length <= 14, canvases().length + ' canvases');
    var hd = cardDrift();
    ok('H7 the cards found their bands again', hd.orphans === 0 && hd.worst <= 2, 'orphans=' + hd.orphans + ' worst=' + hd.worst.toFixed(2) + 'px');

    finish();
  }

  function finish(){
    ok('Z1 no uncaught errors', ERRS.length === 0, ERRS.slice(0,3).join(' | '));
    try { fetch('/_probe_result', { method:'POST', body: JSON.stringify(OUT) }); } catch(e){}
  }
  function go(){ run().catch(function(e){
    OUT.push({ n: 'DRIVER THREW', p: false, d: String(e && e.message || e) });
    try { fetch('/_probe_result', { method:'POST', body: JSON.stringify(OUT) }); } catch(x){}
  }); }
  if(document.readyState === 'complete') go(); else window.addEventListener('load', go);
})();
