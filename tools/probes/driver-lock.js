// The edit-lock — the only graded integrity mechanism in the app.
//
// The syllabus requires the five timed One-Pager drafts to happen in Journaler
// BECAUSE the timer locks editing while it runs. A hole here is a hole in the
// guarantee, and it fails SILENTLY: the box still says "● Locked — gush mode" while
// the text changes underneath it.
//
// keydown was that hole for the whole of the app's life. Todd, on an iPad,
// 2026-09-08: "I am able to delete the gush when it's dictated." Dictation emits no
// key events at all -- and neither do autocorrect replacing a word, ⌘Z, cut, or
// dragging text out of the box. Every one of them edited a locked gush.
//
// So what is pinned down here is not "Backspace is deaf" but "the text cannot
// change", which is the promise actually made to a student:
//   · every deletion path is refused, however it was produced
//   · autocorrect cannot rewrite a word mid-gush ("you cannot fix anything, so keep
//     going" is the instruction, and a silent correction is the app breaking it)
//   · undo and redo cannot unwind the gush
//   · ordinary typing, line breaks, paste and IME composition still work
//   · and every one of those is released at the buzzer, so shaping is unimpeded
(function(){
  var OUT = [], ERRS = [];
  window.addEventListener('error', function(e){ ERRS.push('error: ' + (e.message || e)); });
  window.addEventListener('unhandledrejection', function(e){ ERRS.push('reject: ' + (e.reason && e.reason.message || e.reason)); });
  function ok(n, p, d){ OUT.push({ n: n, p: !!p, d: d === undefined ? '' : String(d) }); }
  function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }

  // Dispatching the event and reading defaultPrevented asks the guard directly. The
  // alternative -- typing and diffing the text -- cannot express "dictation", which
  // is the case that started this.
  function beforeinput(ta, type){
    var e = new InputEvent('beforeinput', { inputType: type, data: 'x', bubbles: true, cancelable: true });
    ta.dispatchEvent(e);
    return e.defaultPrevented;
  }
  function keydown(ta, k){
    var e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
    ta.dispatchEvent(e);
    return e.defaultPrevented;
  }

  // Everything a student could do on purpose to remove or rewrite what they wrote.
  var MUST_BLOCK = ['deleteContentBackward','deleteContentForward','deleteWordBackward',
    'deleteWordForward','deleteSoftLineBackward','deleteHardLineBackward','deleteByCut',
    'deleteByDrag','insertReplacementText','historyUndo','historyRedo'];
  // ⚠ Composition is NOT editing. deleteCompositionText and deleteByComposition are
  // how an IME assembles a character; blocking them wedges typing for anyone whose
  // language needs one, while stopping nothing anybody could do deliberately.
  var MUST_PASS = ['insertText','insertLineBreak','insertParagraph','insertFromPaste',
    'insertCompositionText','deleteCompositionText','deleteByComposition'];

  async function run(){
    document.querySelectorAll('#tabbar button').forEach(function(b){ if(b.dataset.t === 'free') b.click(); });
    await sleep(700);
    var start = document.getElementById('startBtn');
    if(!start){ ok('the Freewrite tab offers a gush to start', false, 'no #startBtn'); return done(); }
    start.click();
    await sleep(700);

    var ta = document.getElementById('gush');
    if(!ta){ ok('the gush box exists once the clock runs', false, 'no #gush'); return done(); }
    ok('the clock is running', document.body.classList.contains('gushing'));
    ok('the box is marked locked', ta.classList.contains('locked'));

    MUST_BLOCK.forEach(function(t){
      ok('locked · ' + t + ' is refused', beforeinput(ta, t) === true);
    });
    MUST_PASS.forEach(function(t){
      ok('locked · ' + t + ' still gets through', beforeinput(ta, t) === false);
    });
    ok('locked · Backspace is refused', keydown(ta, 'Backspace') === true);
    ok('locked · Delete is refused', keydown(ta, 'Delete') === true);
    ok('locked · an ordinary letter still gets through', keydown(ta, 'a') === false);

    // ⚠ The lock must also LET GO. A gush that stays locked after the buzzer is a
    // worse bug than one that never locked: the student cannot shape what they wrote.
    var reset = document.getElementById('resetBtn');
    if(!reset){ ok('the clock offers a reset', false, 'no #resetBtn'); return done(); }
    reset.click();
    await sleep(600);
    var ta2 = document.getElementById('gush');
    ok('the clock has stopped', !document.body.classList.contains('gushing'));
    ok('the box is no longer marked locked', !ta2.classList.contains('locked'));
    ['deleteContentBackward','insertReplacementText','historyUndo'].forEach(function(t){
      ok('released · ' + t + ' works again', beforeinput(ta2, t) === false);
    });
    ok('released · Backspace works again', keydown(ta2, 'Backspace') === false);
    done();
  }
  function done(){
    ERRS.forEach(function(e){ ok('no console errors', false, e); });
    fetch('/__result', { method: 'POST', body: JSON.stringify(OUT) });
  }
  if(document.readyState === 'complete') setTimeout(run, 900);
  else window.addEventListener('load', function(){ setTimeout(run, 900); });
})();
