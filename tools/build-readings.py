#!/usr/bin/env python3
"""Build readings.js — the course reading roster — from the tagged outlines.

    python3 tools/build-readings.py /home/todd/Repos/tce284-fa26

Every reading anchor in an outline carries class="rdg" and
data-rdg="romano|currere|article". Nothing else in an outline is a reading:
booking calendars, slide decks, One-Pager handouts and the daily poems all
link the same way and are deliberately excluded.

A reading is recorded where it is DISCUSSED (its link in a class block), and
where it is ASSIGNED (its link in that day's wrap-up, which sends it home for
the next session). A reading with only a wrap-up appearance has not been
taught yet; a reading with neither has not been written into an outline.
"""
import re, sys, json, glob, html, os

SRC = sys.argv[1] if len(sys.argv) > 1 else '/home/todd/Repos/tce284-fa26'
A = re.compile(r'<a class="rdg" data-rdg="(romano|currere|article)" href="([^"]+)"[^>]*>(.*?)</a>', re.S)

def clean(s):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]*>', '', s))).strip().strip('.,')

def chapter(t):
    m = re.match(r'^ch(\d+)', t, re.I)
    return int(m.group(1)) if m else None

rows = {}
for f in sorted(glob.glob(os.path.join(SRC, 'week-*/week-*.html'))):
    base = os.path.basename(f)
    wk = int(re.search(r'week-(\d+)', base).group(1))
    day = 'Mon' if '-mon' in base else 'Wed'
    s = open(f, encoding='utf-8').read()
    # the wrap-up is the last block; anything after its marker is homework
    cut = s.find('Wrap-up')
    for m in A.finditer(s):
        kind, url, inner = m.group(1), m.group(2), m.group(3)
        title = clean(inner)
        key = url.split('?')[0]
        r = rows.setdefault(key, {'kind': kind, 'url': url, 'title': title,
                                  'ch': chapter(title), 'taught': [], 'assigned': []})
        # A conference-day outline has no wrap-up section, so its reading links
        # ARE homework even though nothing marks them as such: ch18 is set at the
        # topic conference for the Wednesday, ch19 at the draft conference for the
        # Monday. Without this they date to a day with no class meeting.
        where = 'assigned' if (cut == -1 or m.start() > cut) else 'taught'
        slot = [wk, day]
        if slot not in r[where]:
            r[where].append(slot)
        # prefer the longest title seen (wrap-ups often carry the full citation)
        if len(title) > len(r['title']):
            r['title'] = title

out = list(rows.values())
order = {'romano': 0, 'currere': 1, 'article': 2}
out.sort(key=lambda r: (order[r['kind']], r['ch'] if r['ch'] is not None else 99,
                        (r['taught'] or r['assigned'] or [[99, 'Z']])[0]))

# ── The session calendar, derived rather than typed. A session exists iff its
#    outline file does, which is why Week 3 has no Monday (Labor Day) and Week 14
#    none at all (Thanksgiving). Week 1 Monday is 24 Aug 2026; no break shifts a
#    Monday, so week N Monday is +7(N-1) and Wednesday is +2.
import datetime
W1 = datetime.date(2026, 8, 24)
sessions = []          # [(week, day, date, outline path relative to site root)]
for path in sorted(glob.glob(os.path.join(SRC, 'week-*/week-*.html'))):
    b = os.path.basename(path)
    m = re.match(r'week-(\d+)-(mon|wed)\.html$', b)
    if not m:
        continue
    w, d = int(m.group(1)), m.group(2)
    date = W1 + datetime.timedelta(days=7 * (w - 1) + (0 if d == 'mon' else 2))
    rel = os.path.relpath(path, SRC)
    sessions.append((w, 'Mon' if d == 'mon' else 'Wed', date, rel))
sessions.sort(key=lambda s: s[2])
def index_of(w, day):
    for i, s in enumerate(sessions):
        if s[0] == w and s[1] == day:
            return i
    return None

# ── Due date = the session AFTER the wrap-up that sends the reading home. A
#    reading linked only inside a class block is due that same day. Only the
#    FIRST occurrence counts: Week 10's skim-menu links "Who's Cheating Whom?"
#    and Daspit again as mentor texts, and a callback is not a second assignment.
for r in out:
    first = None
    for w, day in sorted(r['assigned'], key=lambda x: (x[0], x[1] != 'Mon')):
        i = index_of(w, day)
        if i is not None and i + 1 < len(sessions):
            first = sessions[i + 1]
            break
    if first is None:
        for w, day in sorted(r['taught'], key=lambda x: (x[0], x[1] != 'Mon')):
            i = index_of(w, day)
            if i is not None:
                first = sessions[i]
                break
    if first:
        r['week'], r['day'] = first[0], first[1]
        r['due'] = first[2].isoformat()
        r['dueLabel'] = first[1] + ', ' + first[2].strftime('%b ') + str(first[2].day)
        r['outline'] = first[3]
    else:
        r['week'] = r['day'] = r['due'] = r['dueLabel'] = r['outline'] = None
    r.pop('taught', None); r.pop('assigned', None)

out.sort(key=lambda r: (order[r['kind']], r['due'] or '9999',
                        r['ch'] if r['ch'] is not None else 99))

js = ('// GENERATED FILE — do not edit by hand.\n'
      '//   python3 tools/build-readings.py %s\n'
      '// %d readings: %d Romano, %d currere, %d articles.\n'
      'window.COURSE_READINGS = %s;\n' % (
          SRC, len(out),
          sum(1 for r in out if r['kind'] == 'romano'),
          sum(1 for r in out if r['kind'] == 'currere'),
          sum(1 for r in out if r['kind'] == 'article'),
          json.dumps(out, indent=1, ensure_ascii=False)))
open(os.path.join(os.path.dirname(__file__), '..', 'readings.js'), 'w', encoding='utf-8').write(js)

for r in out:
    print(f"{r['kind']:8s} {(r['title'][:42]):44s} due {str(r['dueLabel'] or '—'):12s} {r['outline'] or ''}")
print(f"\n{len(out)} readings → readings.js")
