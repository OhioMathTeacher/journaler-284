#!/usr/bin/env node
// ── Add-only import: the merge, exercised ────────────────────────────────────
// openWork/openZip is the ONLY path in the app that can destroy a student's work, so
// the merge behind it is tested rather than eyeballed. The functions are pulled out of
// app.js by name, not copied here -- a copy would drift and go on passing.
//
//   node tools/probes/merge-import.js                 # synthetic fixtures
//   node tools/probes/merge-import.js --archives DIR  # also two real journaler-284.json
//
// ⚠ This repo is public (see TESTING.md). The fixtures below are invented. Real
//   archives are read from a directory you pass in and are never committed.
const fs = require('fs'), path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'app.js'), 'utf8');
const a = src.indexOf('  function sameJSON(');
const z = src.indexOf('return { merged: m, added, conflicts };');
if (a < 0 || z < 0) { console.error('could not find the merge block in app.js'); process.exit(2); }
const readingIdForName = n => 'f:' + String(n || '').trim().toLowerCase();
const { mergeStates } = new Function('readingIdForName',
  src.slice(a, z) + 'return { merged: m, added, conflicts };\n  }\n' +
  '; return { mergeStates };')(readingIdForName);

let fails = 0;
const ok = (label, got, want) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (!pass) fails++;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}: ${JSON.stringify(got)}${pass ? '' : '  want ' + JSON.stringify(want)}`);
};
const marks = st => Object.values(st.highlights || {}).reduce((n, v) => n + v.length, 0);
const hl = (id, note) => ({ id, text: 't' + id, note: note || '', rects: [{ page: 1 }], ts: +id.slice(1) || 1 });
const shelf = names => names.map(n => ({ id: readingIdForName(n), name: n, type: 'pdf' }));

// Two devices, same term, no overlap -- the case this feature exists for.
const laptop = { name: 'A Student', readings: shelf(['ch1.pdf', 'ch2.pdf']),
  highlights: { 'f:ch1.pdf': [hl('h101'), hl('h102')] },
  journal: [{ id: 'e1' }], turnin: { baseline: '2026-01-01' } };
const tablet = { name: '', readings: shelf(['ch2.pdf', 'ch3.pdf']),
  highlights: { 'f:ch2.pdf': [hl('h201')], 'f:ch3.pdf': [hl('h301'), hl('h302')] },
  journal: [] };

console.log('two devices, no overlap');
let r = mergeStates(laptop, tablet);
ok('every mark survives', marks(r.merged), 5);
ok('nothing to ask about', r.conflicts.length, 0);
ok('counted what it added', r.added.marks, 3);
ok('the notebook is untouched', r.merged.journal.length, 1);
ok('turn-ins are untouched', Object.keys(r.merged.turnin), ['baseline']);
ok('the shelf is a union', r.merged.readings.length, 3);
ok('a name already set is kept', r.merged.name, 'A Student');

console.log('\nthe other direction fills the blanks instead');
let back = mergeStates(tablet, laptop);
ok('every mark survives', marks(back.merged), 5);
ok('a blank name takes the file’s', back.merged.name, 'A Student');
ok('turn-ins arrive', Object.keys(back.merged.turnin), ['baseline']);

console.log('\nimporting the same file twice adds nothing');
let twice = mergeStates(r.merged, tablet);
ok('no change', marks(twice.merged), 5);
ok('added nothing', twice.added.marks, 0);
ok('asked nothing', twice.conflicts.length, 0);

console.log('\ninto an empty browser');
let fresh = mergeStates({}, laptop);
ok('marks', marks(fresh.merged), 2);
ok('entries', fresh.merged.journal.length, 1);
ok('activeReading is in range', fresh.merged.activeReading, 0);

console.log('\nnothing is ever lost: every id in, every id out');
const ids = st => new Set(Object.values(st.highlights || {}).flat().map(h => h.id));
const before = new Set([...ids(laptop), ...ids(tablet)]);
ok('missing after merge', [...before].filter(x => !ids(r.merged).has(x)).length, 0);
ok('invented by the merge', [...ids(r.merged)].filter(x => !before.has(x)).length, 0);

console.log('\nsame id, different note -- the only thing worth asking about');
const mine  = { readings: shelf(['a.pdf']), highlights: { 'f:a.pdf': [hl('h1', 'MINE')] } };
const yours = { readings: shelf(['a.pdf']), highlights: { 'f:a.pdf': [hl('h1', 'THEIRS'), hl('h2')] } };
let c = mergeStates(mine, yours);
ok('one conflict', c.conflicts.length, 1);
ok('the clean one still arrived', marks(c.merged), 2);
ok('keeping mine is the default', c.merged.highlights['f:a.pdf'].find(h => h.id === 'h1').note, 'MINE');
c.conflicts.forEach(x => x.take());
ok('take() switches that one', c.merged.highlights['f:a.pdf'].find(h => h.id === 'h1').note, 'THEIRS');

// ⚠ THE BUG THAT MADE THIS FILE. Ids come from the filename, so renaming a PDF mints a
// new one. Canonicalising only the INCOMING side left the stale id on the shelf, the
// chapter forked in two, and a second import of the same file added its marks all over
// again -- silent duplication, in the one place that must never surprise anybody.
console.log('\na renamed file is still the same chapter');
const stale = { readings: [{ id: 'f:old.pdf', name: 'New Name.pdf', type: 'pdf' }],
                highlights: { 'f:old.pdf': [hl('h5')] } };
const current = { readings: shelf(['New Name.pdf']), highlights: { 'f:new name.pdf': [hl('h6')] } };
let rn = mergeStates(stale, current);
ok('one chapter, not two', rn.merged.readings.length, 1);
ok('keyed by the filename', Object.keys(rn.merged.highlights), ['f:new name.pdf']);
ok('both marks on it', marks(rn.merged), 2);
ok('and re-importing adds nothing', mergeStates(rn.merged, current).added.marks, 0);

const i = process.argv.indexOf('--archives');
if (i > 0 && process.argv[i + 1]) {
  const dir = process.argv[i + 1];
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
  if (files.length < 2) { console.error('\nneed two .json archives in ' + dir); process.exit(2); }
  const rd = f => { const d = JSON.parse(fs.readFileSync(path.join(dir, f))); return d.state || d; };
  const A = rd(files[0]), B = rd(files[1]);
  console.log(`\nreal archives: ${files[0]} (${marks(A)}) + ${files[1]} (${marks(B)})`);
  const both = mergeStates(A, B), rev = mergeStates(B, A);
  const union = new Set([...ids(A), ...ids(B)]);
  ok('merged holds the union of both', marks(both.merged), union.size);
  ok('the same either way round', marks(rev.merged), union.size);
  ok('re-importing adds nothing', mergeStates(both.merged, B).added.marks, 0);
  ok('no mark was dropped', [...union].filter(x => !ids(both.merged).has(x)).length, 0);
}

console.log(fails ? `\n${fails} FAILING` : '\nall passing');
process.exit(fails ? 1 : 0);
