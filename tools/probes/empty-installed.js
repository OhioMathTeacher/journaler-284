#!/usr/bin/env node
// ── When does the empty-installed-app rescue fire? ───────────────────────────
// Both failure modes are silent, and both are bad in a different direction.
//
// Too shy: a reader opens the new Home Screen icon, sees an empty app, believes a term
// of writing is gone, and is told nothing. That is the exact moment this exists for, it
// happened to Todd on 2026-10-11, and nothing on screen would show the banner's absence.
//
// Too eager: we tell a genuine newcomer -- or an Android installed app, which SHARES
// storage with Chrome and so is empty for the ordinary reason -- that their writing "is
// not lost" when there never was any. That teaches readers the banner lies, and the one
// day it is true they will dismiss it like all the others.
//
// Pulled out of app.js by name, not copied -- a copy would drift and go on passing.
//
//   node tools/probes/empty-installed.js
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'app.js'), 'utf8');

const a = src.indexOf('  function nagIfEmptyInstalled(){');
const z = src.indexOf('\n  }', a);
if (a < 0 || z < 0) { console.error('could not find nagIfEmptyInstalled in app.js'); process.exit(2); }
const body = src.slice(a, z + 4);

// The rank table decides whether this banner can be displaced by another. Lifted from
// app.js too, for the same reason: a hard-coded 1 here would keep passing after a
// reorder in app.js put something above it.
const rankLine = src.match(/const NAG_RANK = \{[^}]*\};/);
if (!rankLine) { console.error('could not find NAG_RANK in app.js'); process.exit(2); }
const NAG_RANK = new Function('return ' + rankLine[0].replace('const NAG_RANK = ', '').replace(/;$/, ''))();

const countMarks = st => Object.values((st && st.highlights) || {}).reduce((n, v) => n + v.length, 0);

// One launch of the app. Returns the banner it put up, or null.
function launch({ ios = true, standalone = true, marks = 0, entries = 0, snoozed = false }) {
  const DB = { highlights: { r: Array.from({ length: marks }, (_, i) => ({ id: 'h' + i })) },
               journal: Array.from({ length: entries }, (_, i) => ({ id: 'e' + i })) };
  let banner = null;
  const nagBanner = (kind, html, label, onAction) => { banner = { kind, html, label, onAction }; return true; };
  const fn = new Function('IOS', 'isStandalone', 'DB', 'countMarks', 'nagSnoozed', 'nagBanner',
                          'logEvent', 'openWorkFile', `${body}\n return nagIfEmptyInstalled;`)(
    ios, () => standalone, DB, countMarks, () => snoozed, nagBanner, () => {}, () => {});
  fn();
  return banner;
}

let fails = 0;
const ok = (label, got, want) => {
  const pass = got === want;
  if (!pass) fails++;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}: ${got}${pass ? '' : '  want ' + want}`);
};
const fires = opts => launch(opts) !== null;

console.log('the case it was written for');
ok('iOS, installed, nothing here', fires({}), true);

console.log('\nnot this container\'s problem');
ok('iOS, Safari tab — the work is right there', fires({ standalone: false }), false);
ok('Android installed app — storage is shared with Chrome', fires({ ios: false }), false);
ok('desktop installed PWA — also shared', fires({ ios: false, standalone: true }), false);

console.log('\nany work at all proves this is no longer the empty container');
ok('one marked passage', fires({ marks: 1 }), false);
ok('one notebook entry', fires({ entries: 1 }), false);
ok('a whole term of work', fires({ marks: 123, entries: 9 }), false);

console.log('\ndismissed this session');
ok('snoozed — stays quiet', fires({ snoozed: true }), false);

console.log('\nit fires again on the NEXT launch, not once ever');
// The frightened reader force-quits and reopens. A once-only flag would have been spent
// on the launch they panicked through, which is the launch that helped them least.
ok('second launch, still empty', fires({}), true);
ok('third launch, still empty', fires({}), true);

console.log('\nwhat the banner actually says and offers');
const b = launch({});
ok('ranked so nothing displaces it', NAG_RANK[b.kind] === Math.min(...Object.values(NAG_RANK)), true);
ok('the way out is in the banner', /Open my file/.test(b.label), true);
// ⚠ The reader's first belief is "it is gone". The banner has to contradict that in
// words, not merely offer a button -- a button alone reads as one more thing to try.
ok('it says the writing is not lost', /not lost/i.test(b.html), true);
ok('it says where the writing still is', /Safari/.test(b.html) && /file/.test(b.html), true);
// Rank is a number in app.js; if someone renames the kind, this probe should fail loudly
// rather than quietly testing a kind that no longer exists.
ok('the kind is still in the rank table', b.kind in NAG_RANK, true);

console.log(fails ? `\n${fails} failed` : '\nall checks passed');
process.exit(fails);
