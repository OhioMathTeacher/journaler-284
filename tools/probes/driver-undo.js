// Deletes, the undo offer, and the toast layer underneath them.
//
// Two passes: the first seeds the browser and reloads, because the app reads its DB
// once at boot. The second runs the checks and POSTs them back to run.py.
//
// What this pins down, all of it something Todd said in so many words:
//   · a deletion offers itself back, and the offer has NO timer on it
//   · Undo restores the page IN POSITION, with its text, tags and threads
//   · a second deletion does not silently commit the first
//   · an ordinary receipt ("Tagged: …") cannot take a standing offer away with it
//   · and receipts still fade on their own when nothing is pending
(function(){
  var OUT = [], ERRS = [];
  window.addEventListener('error', function(e){ ERRS.push('error: ' + (e.message || e)); });
  window.addEventListener('unhandledrejection', function(e){ ERRS.push('reject: ' + (e.reason && e.reason.message || e.reason)); });
  function ok(n, p, d){ OUT.push({ n: n, p: !!p, d: d === undefined ? '' : String(d) }); }
  function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }
  function pad(n){ return (n < 10 ? '0' : '') + n; }
  // The by-day lens opens on TODAY, so the seed has to be dated today or the pages are
  // on a screen nobody is looking at. (The calendar only spans the term — Jul–Dec 2026
  // — so outside that window A2 fails and says so rather than failing obscurely.)
  var D = new Date(), KEY = D.getFullYear() + '-' + pad(D.getMonth()+1) + '-' + pad(D.getDate());

  function rows(){ return [].slice.call(document.querySelectorAll('[data-entryrow]')).map(function(e){ return e.getAttribute('data-entryrow'); }); }
  function toastEl(){ return document.getElementById('cr284Toast'); }
  function toastUp(){ var t = toastEl(); return !!t && t.style.opacity === '1'; }
  function toastMsg(){ var t = toastEl(); return t && t.firstChild ? String(t.firstChild.nodeValue || '') : ''; }
  function toastBtns(){ var t = toastEl(); return t ? [].slice.call(t.querySelectorAll('button')).map(function(b){ return b.textContent; }) : []; }
  function toastBtn(l){ var t = toastEl(); if(!t) return null;
    return [].slice.call(t.querySelectorAll('button')).filter(function(b){ return b.textContent === l; })[0] || null; }
  function stored(){ try { return JSON.parse(localStorage.getItem('cr284_state')) || {}; } catch(e){ return {}; } }
  function storedIds(){ return (stored().journal || []).map(function(e){ return e.id; }); }
  function storedEntry(id){ return (stored().journal || []).filter(function(e){ return e.id === id; })[0] || null; }
  function delBtn(id, label){
    var all = [].slice.call(document.querySelectorAll('[data-del="' + id + '"]'));
    if(label) all = all.filter(function(b){ return b.textContent.trim() === label; });
    return all[0] || null;
  }

  function seedAndReload(){
    var entries = [], hours = ['09','11','13','15','17'];
    var texts = ['FIRST page of the day.', 'SECOND page — this is the one we delete.',
                 'THIRD page of the day.', 'FOURTH page of the day.', 'FIFTH page of the day.'];
    for(var i = 0; i < 5; i++){
      entries.push({ id: 'jprobe' + (i+1), pieceId: 'free', pieceKind: 'freewrite',
        pieceTitle: 'Free-writes & quick-writes',
        ts: KEY + 'T' + hours[i] + ':00:00.000Z', date: KEY,
        edited: KEY + 'T' + hours[i] + ':00:00.000Z', text: texts[i],
        tags: i === 1 ? ['probe'] : [], threads: i === 1 ? ['t-probe'] : [] });
    }
    localStorage.clear();
    localStorage.setItem('cr284_state', JSON.stringify({
      v: 2, name: 'Probe Reader', freewrite: {}, currere: {}, notebook: {},
      _journalMigrated: true, journal: entries, readings: null, activeReading: 0 }));
    sessionStorage.setItem('probePass', '2');
    location.reload();
  }

  async function run(){
    if(sessionStorage.getItem('probePass') !== '2'){ seedAndReload(); return; }
    await sleep(400);

    // ── A · reach the pages
    var nb = document.querySelector('#tabbar button[data-t="note"]');
    if(!nb){ ok('A0 Notebook tab exists', false); return finish(); }
    nb.click(); await sleep(120);
    var byDay = document.querySelector('.nbview[data-mode="day"]');
    ok('A1 By-day lens button present', !!byDay);
    if(byDay){ byDay.click(); await sleep(120); }
    var cell = document.querySelector('.cell[data-key="' + KEY + '"]');
    ok('A2 calendar cell for today (' + KEY + ') present', !!cell, cell ? '' : 'today may be outside the term calendar');
    if(cell){ cell.click(); await sleep(120); }
    ok('A3 five seeded pages render in ts order', JSON.stringify(rows()) === '["jprobe1","jprobe2","jprobe3","jprobe4","jprobe5"]', rows().join(','));

    // ── B · the trash icon on the row: delete, the offer waits, undo restores
    var b = delBtn('jprobe2');
    ok('B1 row trash button present on the middle page', !!b);
    if(!b) return finish();
    b.click(); await sleep(150);
    ok('B2 the page is gone from the list', JSON.stringify(rows()) === '["jprobe1","jprobe3","jprobe4","jprobe5"]', rows().join(','));
    ok('B3 an offer is showing', toastUp(), 'opacity=' + (toastEl() && toastEl().style.opacity));
    ok('B4 it says what was done', toastMsg().indexOf('Page deleted') === 0, JSON.stringify(toastMsg()));
    ok('B5 it offers Undo and Dismiss', JSON.stringify(toastBtns()) === '["Undo","Dismiss"]', toastBtns().join(','));
    ok('B6 the offer is clickable', toastEl() && toastEl().style.pointerEvents === 'auto', toastEl() && toastEl().style.pointerEvents);
    await sleep(450);
    ok('B7 the deletion reached storage', storedIds().indexOf('jprobe2') === -1, storedIds().join(','));
    // ⚠ the whole point of opts.decide — nothing expires under the reader
    await sleep(6500);
    ok('B8 the offer still stands after 6.5s', toastUp(), 'opacity=' + (toastEl() && toastEl().style.opacity));
    ok('B9 Undo is still there to click', !!toastBtn('Undo'));
    var u = toastBtn('Undo'); if(!u) return finish();
    u.click(); await sleep(200);
    ok('B10 the page came back in its original position', JSON.stringify(rows()) === '["jprobe1","jprobe2","jprobe3","jprobe4","jprobe5"]', rows().join(','));
    await sleep(450);
    var back = storedEntry('jprobe2');
    ok('B11 it came back in storage too', !!back, storedIds().join(','));
    ok('B12 its tags survived', !!back && JSON.stringify(back.tags) === '["probe"]', back && JSON.stringify(back.tags));
    ok('B13 its threads survived', !!back && JSON.stringify(back.threads) === '["t-probe"]', back && JSON.stringify(back.threads));
    ok('B14 its text survived', !!back && back.text.indexOf('SECOND page') === 0, back && back.text);
    ok('B15 the offer closed when it was taken', !toastUp(), 'opacity=' + (toastEl() && toastEl().style.opacity));

    // ── C · the Delete inside the entry editor, then Dismiss
    var ed = document.querySelector('button.entlink[data-edit="jprobe3"]') || document.querySelector('[data-edit="jprobe3"]');
    ok('C1 Edit affordance present', !!ed);
    if(ed){ ed.click(); await sleep(150); }
    ok('C2 the editor opened on that page', !!document.getElementById('edit_jprobe3'));
    var ed_del = delBtn('jprobe3', 'Delete');
    ok('C3 the editor carries a Delete', !!ed_del);
    if(!ed_del) return finish();
    ed_del.click(); await sleep(200);
    ok('C4 the page is gone from the list', JSON.stringify(rows()) === '["jprobe1","jprobe2","jprobe4","jprobe5"]', rows().join(','));
    ok('C5 the editor closed with it', !document.getElementById('edit_jprobe3'));
    ok('C6 the same offer appears from the editor path', toastUp() && JSON.stringify(toastBtns()) === '["Undo","Dismiss"]', toastBtns().join(','));
    var d = toastBtn('Dismiss'); if(d){ d.click(); await sleep(200); }
    ok('C7 Dismiss closes the offer', !toastUp(), 'opacity=' + (toastEl() && toastEl().style.opacity));
    ok('C8 the deletion stands after Dismiss', JSON.stringify(rows()) === '["jprobe1","jprobe2","jprobe4","jprobe5"]', rows().join(','));
    await sleep(450);
    ok('C9 and stands in storage', storedIds().indexOf('jprobe3') === -1, storedIds().join(','));

    // ── D · two deletions with no decision between them. Both stay recoverable.
    var b1 = delBtn('jprobe4'); if(b1){ b1.click(); await sleep(200); }
    var b2 = delBtn('jprobe5'); if(b2){ b2.click(); await sleep(200); }
    ok('D1 both pages are gone', JSON.stringify(rows()) === '["jprobe1","jprobe2"]', rows().join(','));
    ok('D2 only one offer element exists', document.querySelectorAll('#cr284Toast').length === 1, String(document.querySelectorAll('#cr284Toast').length));
    ok('D3 the offer says another is still waiting', /more you can still undo/.test(toastMsg()), JSON.stringify(toastMsg()));
    var u2 = toastBtn('Undo'); if(u2){ u2.click(); await sleep(250); }
    ok('D4 Undo took back the newest', rows().indexOf('jprobe5') !== -1, rows().join(','));
    ok('D5 the earlier offer came back up on its own', toastUp() && !!toastBtn('Undo'), JSON.stringify(toastMsg()));
    ok('D6 and it no longer claims others are waiting', !/more you can still undo/.test(toastMsg()), JSON.stringify(toastMsg()));
    var u3 = toastBtn('Undo'); if(u3){ u3.click(); await sleep(250); }
    await sleep(450);
    ok('D7 the FIRST of the two deletions is recoverable too', storedIds().indexOf('jprobe4') !== -1, storedIds().join(','));
    ok('D8 the list is whole again', JSON.stringify(rows()) === '["jprobe1","jprobe2","jprobe4","jprobe5"]', rows().join(','));
    ok('D9 the offer is gone once every decision is made', !toastUp(), 'opacity=' + (toastEl() && toastEl().style.opacity));

    // ── E · an ordinary, unrelated receipt while an offer is standing
    var b3 = delBtn('jprobe1'); if(b3){ b3.click(); await sleep(200); }
    ok('E1 the offer is standing before the interruption', toastUp() && !!toastBtn('Undo'), toastBtns().join(','));
    var sel = document.querySelector('select.tagadd[data-entry="jprobe2"]');
    ok('E2 a tag control is available to interrupt with', !!sel);
    if(sel){
      var opt = [].slice.call(sel.options).filter(function(o){ return o.value; })[0];
      if(opt){ sel.value = opt.value; sel.dispatchEvent(new Event('change')); }
      await sleep(200);
    }
    ok('E3 the receipt gets the element and shows plainly', /^Tagged:|moved here/.test(toastMsg()) && toastBtns().length === 0, JSON.stringify(toastMsg()) + ' buttons=' + JSON.stringify(toastBtns()));
    await sleep(2200);
    ok('E4 the offer comes back when the receipt has run its course', toastUp() && !!toastBtn('Undo'), JSON.stringify(toastMsg()) + ' buttons=' + JSON.stringify(toastBtns()));
    ok('E5 the deleted page is still absent while the offer stands', rows().indexOf('jprobe1') === -1, rows().join(','));
    var u4 = toastBtn('Undo'); if(u4){ u4.click(); await sleep(250); }
    await sleep(450);
    ok('E6 the way back still works after the interruption', storedIds().indexOf('jprobe1') !== -1, storedIds().join(','));

    // ── F · Dismiss answers for every pending offer at once
    var f1 = delBtn('jprobe4'); if(f1){ f1.click(); await sleep(200); }
    var f2 = delBtn('jprobe5'); if(f2){ f2.click(); await sleep(200); }
    ok('F1 two offers are pending', /more you can still undo/.test(toastMsg()), JSON.stringify(toastMsg()));
    var d2 = toastBtn('Dismiss'); if(d2){ d2.click(); await sleep(250); }
    ok('F2 Dismiss closes the offer outright', !toastUp(), 'opacity=' + (toastEl() && toastEl().style.opacity));
    await sleep(450);
    ok('F3 both deletions stand', storedIds().indexOf('jprobe4') === -1 && storedIds().indexOf('jprobe5') === -1, storedIds().join(','));

    // ── G · with nothing pending, a receipt behaves as it always did
    var sel2 = document.querySelector('select.tagadd[data-entry="jprobe1"]');
    ok('G1 a tag control is available', !!sel2);
    if(sel2){
      var o2 = [].slice.call(sel2.options).filter(function(o){ return o.value; })[0];
      if(o2){ sel2.value = o2.value; sel2.dispatchEvent(new Event('change')); }
      await sleep(200);
    }
    ok('G2 the receipt shows', toastUp(), JSON.stringify(toastMsg()));
    await sleep(2200);
    ok('G3 and it fades on its own, as receipts should', !toastUp(), 'opacity=' + (toastEl() && toastEl().style.opacity));
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
