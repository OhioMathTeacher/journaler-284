#!/usr/bin/env node
// ── When does the backup reminder fire? ──────────────────────────────────────
// Both failure modes here are SILENT. Too eager and students learn to dismiss it, so
// it is worthless on the day it matters; too shy and we believe we shipped a safety
// net that does not exist. Neither shows up in casual use, so it is checked here.
// Pulled out of app.js by name, not copied -- a copy would drift and go on passing.
//
//   node tools/probes/backup-nag.js
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'app.js'), 'utf8');
const a = src.indexOf('  function recordBackup(){');
const z = src.indexOf('  function isStandalone(){');
if (a < 0 || z < 0) { console.error('could not find the nag block in app.js'); process.exit(2); }

// workAtRisk and the threshold, lifted with their real bodies. DB and countMarks are
// the two things they reach for; everything else in the block is UI.
const body = src.slice(a, z);
const thresholdSrc = src.slice(src.indexOf('    const r = workAtRisk();', src.indexOf('  function maybeNagBackup(){')),
                               src.indexOf('    const bits = [];', src.indexOf('  function maybeNagBackup(){')));
const make = new Function('DB', 'countMarks', 'saveDB', 'document', `
  ${body}
  return function decide(){
    ${thresholdSrc.replace('return;', 'return false;').replace(/\n\s*if\(worth/, '\n    if(worth')}
    return true;
  };
`);

let fails = 0;
const ok = (label, got, want) => {
  const pass = got === want;
  if (!pass) fails++;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}: ${got}${pass ? '' : '  want ' + want}`);
};
const DAY = 86400000;
const countMarks = st => Object.values((st && st.highlights) || {}).reduce((n, v) => n + v.length, 0);
// A browser holding `marks` marks and `entries` entries, last backed up `daysAgo` ago
// at the counts it had then.
function browser({ marks = 0, entries = 0, daysAgo = null, backedUpAt = null }) {
  const DB = { highlights: { r: Array.from({ length: marks }, (_, i) => ({ id: 'h' + i })) },
               journal: Array.from({ length: entries }, (_, i) => ({ id: 'e' + i })) };
  if (daysAgo !== null) DB.lastBackup = { ts: Date.now() - daysAgo * DAY,
    marks: backedUpAt ? backedUpAt.marks : marks, entries: backedUpAt ? backedUpAt.entries : entries };
  return DB;
}
const fires = db => make(db, countMarks, () => {}, { getElementById: () => null })();

console.log('a fresh student who has done nothing');
ok('never backed up, empty', fires(browser({})), false);
ok('never backed up, 3 marks', fires(browser({ marks: 3 })), false);

console.log('\nnever backed up, real work accumulating');
ok('7 marks — still quiet', fires(browser({ marks: 7 })), false);
ok('8 marks — speaks up', fires(browser({ marks: 8 })), true);
ok('1 notebook entry alone — the graded artifact', fires(browser({ entries: 1 })), true);
ok('2 notebook entries', fires(browser({ entries: 2 })), true);
ok('1 entry + 3 marks', fires(browser({ entries: 1, marks: 3 })), true);

console.log('\njust backed up — nothing at risk, however much work exists');
ok('123 marks, all of them saved', fires(browser({ marks: 123, entries: 8, daysAgo: 0 })), false);
ok('backed up 30 days ago, nothing since',
   fires(browser({ marks: 50, entries: 4, daysAgo: 30, backedUpAt: { marks: 50, entries: 4 } })), false);

console.log('\nbacked up, then kept working');
ok('backed up, 7 marks since', fires(browser({ marks: 57, daysAgo: 1, backedUpAt: { marks: 50, entries: 0 } })), false);
ok('backed up, 8 marks since', fires(browser({ marks: 58, daysAgo: 1, backedUpAt: { marks: 50, entries: 0 } })), true);
ok('backed up, 1 entry since', fires(browser({ marks: 50, entries: 1, daysAgo: 2, backedUpAt: { marks: 50, entries: 0 } })), true);

console.log('\nthe stale-backup rule: a week old AND something since');
ok('8 days, 1 mark since',
   fires(browser({ marks: 51, daysAgo: 8, backedUpAt: { marks: 50, entries: 0 } })), true);
ok('8 days, nothing since',
   fires(browser({ marks: 50, daysAgo: 8, backedUpAt: { marks: 50, entries: 0 } })), false);
ok('6 days, 1 mark since — not yet',
   fires(browser({ marks: 51, daysAgo: 6, backedUpAt: { marks: 50, entries: 0 } })), false);

// ⚠ THE ONE THAT MATTERS MOST. A backup that never reached the reader must not count
// as one -- recordBackup() is called only after saveBlob returns true, and if that
// ever slips the reminder goes quiet exactly when it is wrong.
console.log('\na backup that did not happen leaves the work at risk');
ok('no lastBackup recorded, 20 marks', fires(browser({ marks: 20 })), true);

console.log(fails ? `\n${fails} FAILING` : '\nall passing');
process.exit(fails ? 1 : 0);
