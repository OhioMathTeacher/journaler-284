// Telefone against a $0 tier: the OP5 assignment is "paste your page, press x10", and a
// free tier meters tokens per minute. A 500-word page costs roughly 1,400 a pass, so ten
// in a row WILL be rate limited on most free keys. What matters is that the limit is an
// interruption, not an ending: the passes already made stay, the wait is shown, and the
// run picks up where it stopped.
//
// Its own suite, not more checks bolted onto driver-tele: the state has to be seeded
// before load, because writing localStorage under a running app is overwritten by the
// next saveDB -- which is how an earlier version of this test came to pass against an
// empty string.
(function(){
  var OUT = [], ERRS = [];
  window.addEventListener('error', function(e){ ERRS.push('ERROR ' + (e.message||e) + ' @@ ' + ((e.error&&e.error.stack)||'').split('\n').slice(0,4).join(' <- ')); });
  window.addEventListener('unhandledrejection', function(e){ ERRS.push('REJECT ' + ((e.reason&&e.reason.message)||e.reason)); });
  function ok(n,p,d){ OUT.push({n:n,p:!!p,d:d===undefined?'':String(d)}); }
  function sleep(ms){ return new Promise(function(r){ setTimeout(r,ms); }); }
  function passes(){ try { return (JSON.parse(localStorage.getItem('cr284_state'))||{}).tele.passes; } catch(e){ return []; } }

  function seedAndReload(){
    // ~500 words, rules broken on purpose, the way OP5 asks for.
    var line = 'The fence was broke and nobody fixed it. Rain got in the kitchen and everything. ';
    var page = new Array(36).join(line);
    localStorage.setItem('cr284_state', JSON.stringify({ v:6, tele:{ passes:[page], asked:[null], rounds:[], reflection:'' } }));
    localStorage.setItem('cr_provider','groq');
    localStorage.setItem('cr_groq_key','probe-key');
    localStorage.setItem('cr_groq_model','openai/gpt-oss-120b');
    sessionStorage.setItem('limitProbe','1');
    location.reload();
  }

  async function run(){
    var realFetch = window.fetch.bind(window);
    var calls = 0, limited = 0;
    // Two passes land, the third is metered once, then it clears -- exactly the shape of
    // a free tier under a burst.
    window.fetch = function(u, o){
      if(String(u).indexOf('groq.com') >= 0){
        calls++;
        if(calls === 3 && limited === 0){
          limited++;
          return Promise.resolve({ ok:false, status:429,
            json: function(){ return Promise.resolve({ error:{ message:'Rate limit reached for `openai/gpt-oss-120b`. Try again in 2s.' } }); },
            text: function(){ return Promise.resolve('rate limited'); } });
        }
        return Promise.resolve({ ok:true, status:200, json: function(){ return Promise.resolve({
          choices:[{ message:{ content:'The fence was broken and nobody fixed it. Rain came in. Revision ' + calls + '.' },
                     finish_reason:'stop' }] }); } });
      }
      return realFetch(u, o);
    };

    var w0 = passes()[0].split(/\s+/).filter(Boolean).length;
    ok('L1 pass zero is a realistic OP5 page', w0 >= 400 && w0 <= 600, w0 + ' words');

    document.querySelector('#tabbar button[data-t="tele"]').click();
    await sleep(400);
    var all = document.getElementById('teleRunAll');
    ok('L2 the x10 button is live', !!all && !all.disabled);
    if(!all){ return done(realFetch); }

    var t0 = Date.now();
    all.click();
    // Long enough for three passes, the 2s wait, and the 1.2s gaps.
    await sleep(14000);
    var P = passes(), st = document.getElementById('teleStatus');
    var msg = st ? st.textContent.trim() : '';

    ok('L3 the rate limit did not end the run', P.length > 3, P.length + ' passes after ' + calls + ' calls (1 metered)');
    ok('L4 it kept going to the full ten', P.length === 11, P.length + ' passes (want 11 = pass 0 + 10)');
    ok('L5 nothing was lost to the limit', P.every(function(x){ return String(x).trim().length; }), 'no empty passes');
    ok('L6 the run ends quiet, not on an error', !/error|rate limit/i.test(msg), JSON.stringify(msg));
    ok('L7 the passes were paced, not fired as one burst', Date.now() - t0 > 10 * 1000,
       Math.round((Date.now() - t0)/1000) + 's for 10 passes incl. a 2s wait');
    ok('L8 the tab strip agrees with what was stored',
       document.querySelectorAll('.tele-tab').length === P.length,
       document.querySelectorAll('.tele-tab').length + ' tabs / ' + P.length + ' passes');
    ok('Z1 no uncaught errors', ERRS.length === 0, ERRS.join(' || '));
    done(realFetch);
  }
  function done(realFetch){
    try { (realFetch || fetch)('/', {method:'POST', body: JSON.stringify(OUT)}); } catch(e){}
  }
  window.addEventListener('load', function(){
    if(sessionStorage.getItem('limitProbe')) setTimeout(run, 600);
    else setTimeout(seedAndReload, 300);
  });
})();
