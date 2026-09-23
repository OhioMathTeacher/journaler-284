// Telefone against a $0 tier.
//
// OP5 is now "press AI Revise again, and again — one round at a time", so this no longer
// drives a x10 button (bc33843 removed it, deliberately: clicking ten at once skips the
// watching, which is the assignment). What still has to hold is the thing the burst
// button made obvious and single clicks only hide: a free tier meters tokens per minute,
// a 500-word page spends roughly 1,400 a round, and a student pressing Revise steadily
// WILL be metered. A rate limit has to be an interruption, not an ending -- the rounds
// already played stay, the wait is shown and counted down, and the same round goes again.
//
// Its own suite because the state must be seeded before load: writing localStorage under
// a running app is overwritten by the next saveDB, which is how an earlier draft of this
// test came to pass against an empty string.
(function(){
  var OUT = [], ERRS = [];
  window.addEventListener('error', function(e){ ERRS.push('ERROR ' + (e.message||e) + ' @@ ' + ((e.error&&e.error.stack)||'').split('\n').slice(0,4).join(' <- ')); });
  window.addEventListener('unhandledrejection', function(e){ ERRS.push('REJECT ' + ((e.reason&&e.reason.message)||e.reason)); });
  function ok(n,p,d){ OUT.push({n:n,p:!!p,d:d===undefined?'':String(d)}); }
  function sleep(ms){ return new Promise(function(r){ setTimeout(r,ms); }); }
  function passes(){ try { return (JSON.parse(localStorage.getItem('cr284_state'))||{}).tele.passes; } catch(e){ return []; } }

  var WORD = 'The fence was broke and nobody fixed it Rain got in the kitchen and everything '.split(' ').filter(Boolean);
  function words(n){ var a=[]; for(var i=0;i<n;i++) a.push(WORD[i % WORD.length]); return a.join(' '); }

  function seedAndReload(){
    localStorage.setItem('cr284_state', JSON.stringify({ v:6, tele:{
      passes:[words(520)], asked:[null] } }));
    localStorage.setItem('cr_provider','groq');
    localStorage.setItem('cr_groq_key','probe-key');
    localStorage.setItem('cr_groq_model','openai/gpt-oss-120b');
    sessionStorage.setItem('limitProbe','1');
    location.reload();
  }

  async function run(){
    var realFetch = window.fetch.bind(window);
    var calls = 0, metered = 0;
    // Each reply is a little shorter than the last, so the percentage keeps falling and
    // the game does not end itself mid-test. The third call is metered, once.
    window.fetch = function(u, o){
      if(String(u).indexOf('groq.com') >= 0){
        calls++;
        if(calls === 3 && metered === 0){
          metered++;
          return Promise.resolve({ ok:false, status:429,
            json: function(){ return Promise.resolve({ error:{ message:'Rate limit reached for `openai/gpt-oss-120b`. Try again in 2s.' } }); },
            text: function(){ return Promise.resolve('rate limited'); } });
        }
        return Promise.resolve({ ok:true, status:200, json: function(){ return Promise.resolve({
          choices:[{ message:{ content: words(460 - calls * 30) }, finish_reason:'stop' }] }); } });
      }
      return realFetch(u, o);
    };

    var w0 = passes()[0].split(/\s+/).filter(Boolean).length;
    ok('L1 round zero is a realistic OP5 page', w0 >= 400 && w0 <= 600, w0 + ' words');

    document.querySelector('#tabbar button[data-t="tele"]').click();
    await sleep(500);
    var btn = document.getElementById('teleRun');
    ok('L2 AI Revise is live', !!btn && !btn.disabled,
       btn ? ('disabled=' + btn.disabled) : 'MISSING');
    if(!btn || btn.disabled){ return done(realFetch); }

    // Round 1 and round 2 land normally.
    btn.click(); await sleep(1200);
    document.getElementById('teleRun').click(); await sleep(1200);
    ok('L3 two rounds land before the meter', passes().length === 3, passes().length + ' passes after ' + calls + ' calls');

    // Round 3 is metered. The wait is 2s; the run must survive it and finish the round.
    var t0 = Date.now();
    document.getElementById('teleRun').click();
    await sleep(1200);
    var during = document.getElementById('teleStatus').textContent;
    ok('L4 the wait is shown while it holds, with a countdown',
       /rate limit/i.test(during) && /going again in \d+s/i.test(during), JSON.stringify(during));
    await sleep(4500);
    var after = document.getElementById('teleStatus').textContent.trim();

    ok('L5 the metered round completed rather than failing', passes().length === 4,
       passes().length + ' passes after ' + calls + ' calls (' + metered + ' metered)');
    ok('L6 nothing already played was lost', passes().every(function(x){ return String(x).trim().length; }), 'no empty rounds');
    ok('L7 it waited rather than retrying instantly', Date.now() - t0 >= 2000,
       Math.round((Date.now() - t0)/1000) + 's for the metered round');
    ok('L8 it does not leave an error standing once it recovers', !/error|rate limit/i.test(after), JSON.stringify(after));
    ok('L9 the strip agrees with what was stored',
       document.querySelectorAll('.tele-tab').length === passes().length,
       document.querySelectorAll('.tele-tab').length + ' tabs / ' + passes().length + ' passes');
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
