#!/usr/bin/env python3
"""Generate poems.js from the TCE 284 course repo.

The Daily Poem is not the app's idea -- it is the standing ritual that opens every
class session, and it already exists, written out session by session, in
tce284-fa26.  Retyping sixteen poems, poets, links and framing questions into
app.js would be sixteen chances to introduce a poem the class never read, and no
way to notice when a session moves.  So the app's copy is GENERATED, and this is
the only place it is allowed to come from.

    python3 tools/build-poems.py ../tce284-fa26

Poem TEXT is not scraped.  It comes from poem-texts/<slug>.txt, one file per poem,
added by hand and only where reproducing it is safe -- see poem-texts/README.md.
A poem with no file there shows its byline and a link out, which is what the course
pages themselves do.  Everything else -- poet, title, link, framing -- is read from
the course repo, so it cannot drift from what the class was actually given.

Session dates come from the schedule table in the course index.html ("Week 2 ·
Aug 31") plus which of Mon/Wed that week actually links a page.  Week 3 has no
Monday (Labor Day) and its row is dated to the Wednesday, which is why the day is
read from the links rather than assumed.
"""
import re, sys, json, subprocess, datetime, pathlib

MONTHS = {m: i + 1 for i, m in enumerate(
    'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split())}
YEAR = 2026


def sessions(course):
    """[(date, week, 'Mon'|'Wed', path)] for every session that links a page."""
    idx = (course / 'index.html').read_text()
    rows = re.findall(
        r'Week (\d+) · ([A-Z][a-z]{2}) (\d+)\*?</td>.*?<td class="nowrap">(.*?)</td>',
        idx)
    out = []
    for wk, mon, day, links in rows:
        start = datetime.date(YEAR, MONTHS[mon], int(day))
        days = re.findall(r'href="([^"]+)"[^>]*>(Mon|Wed)</a>', links)
        for href, which in days:
            # The row is dated to the week's FIRST class, so a Wednesday-only week
            # is already dated to Wednesday; a normal week's Wed is Monday + 2.
            d = start if (which == 'Mon' or len(days) == 1) else start + datetime.timedelta(days=2)
            if d.strftime('%a') != which:
                sys.exit(f'week {wk} {which}: derived {d} is a {d.strftime("%a")}')
            out.append((d, int(wk), which, course / href))
    return out


def slugify(title):
    """The filename a poem's text would live under in poem-texts/."""
    s = re.sub(r'[^a-z0-9]+', '-', title.lower()).strip('-')
    return s or 'untitled'


def body(slug, here):
    """poem-texts/<slug>.txt → (text, source-note), or ('', '') if there is none."""
    f = here / 'poem-texts' / f'{slug}.txt'
    if not f.exists():
        return '', ''
    lines, src = f.read_text().splitlines(), ''
    while lines and lines[0].startswith('#'):
        head = lines.pop(0)
        if head.lower().startswith('# source:'):
            src = head.split(':', 1)[1].strip()
    return '\n'.join(lines).strip('\n'), src


def poem(path):
    """The b-poem block of one session page, or None if it has no poem."""
    html = path.read_text()
    m = re.search(r'<div class="block b-poem">(.*?)</div>', html, re.S)
    if not m:
        return None
    block = m.group(1)
    if '<div' in block:
        sys.exit(f'{path}: nested div in the poem block — the parser would truncate it')

    # Week 12 Wed uses the same b-poem styling for a mini-lesson ON writing a poem.
    # It is not a Daily Poem and the app should not present it as one.
    title = re.search(r'Daily Poem — "([^"]+)"', block)
    if not title:
        return None

    lis = re.findall(r'<li>(.*?)</li>', block, re.S)
    first = lis[0]
    # Most are "Poet, <a href=…>"Title"</a>". Heaney is not linked at all -- his is a
    # PDF on Canvas -- so the title may be plain <strong> with a [Canvas] tag after it.
    a = re.search(r'(.*?),\s*(?:<a href="([^"]+)"[^>]*>|<strong>).*?(?:</a>|</strong>)(.*)',
                  first, re.S)
    if not a:
        sys.exit(f'{path}: first bullet is not "Poet, <a|strong>Title</…>…"')
    poet, url, rest = a.group(1).strip(), a.group(2) or '', a.group(3)

    # Where to find it, when there is no link to give: <span class="tag">[Canvas]</span>.
    where = ''
    tag = re.match(r'\s*<span class="tag">\[([^\]]+)\]</span>', rest)
    if tag:
        where, rest = tag.group(1), rest[tag.end():]

    # Then an optional parenthetical (Dunbar's "(Dayton, Ohio)"), then the sentence
    # that starts Todd's framing.
    note = ''
    pn = re.match(r'\s*\(([^)]*)\)', rest)
    if pn:
        note, rest = pn.group(1), rest[pn.end():]
    rest = re.sub(r'^\s*[.·]\s*', '', rest)

    def clean(t):
        t = re.sub(r'<a [^>]*>(.*?)</a>', r'\1', t, flags=re.S)   # links out, text stays
        t = re.sub(r'<(?!/?em\b)[^>]+>', '', t, flags=re.S)       # <em> survives, nothing else
        return re.sub(r'\s+', ' ', t).strip()

    framing = [clean(x) for x in [rest] + lis[1:]]
    if not url and not where:
        sys.exit(f'{path}: "{title.group(1)}" has neither a link nor a [where] tag')
    slug = slugify(title.group(1))
    here = pathlib.Path(__file__).resolve().parent.parent
    text, text_src = body(slug, here)
    # ⚠ framing is carried but NOT rendered. Todd: "I don't want questions embedded in
    # there. That's in our daily outline." Kept in the file because it is what the
    # session actually says about the poem, and losing it would mean re-deriving it
    # from the course repo if the page ever wants it back.
    return dict(slug=slug, title=title.group(1), poet=clean(poet), url=url, where=where,
                note=clean(note), text=text, textSource=text_src,
                framing=[f for f in framing if f])


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    course = pathlib.Path(sys.argv[1]).expanduser().resolve()
    try:
        rev = subprocess.run(['git', '-C', str(course), 'rev-parse', '--short', 'HEAD'],
                             capture_output=True, text=True, check=True).stdout.strip()
        dirty = subprocess.run(['git', '-C', str(course), 'status', '--porcelain'],
                               capture_output=True, text=True).stdout.strip()
        rev += ' (with uncommitted changes)' if dirty else ''
    except Exception:
        rev = 'not a git checkout'

    rows, skipped = [], []
    for date, wk, which, path in sessions(course):
        p = poem(path)
        if not p:
            skipped.append(f'week {wk} {which}')
            continue
        rows.append(dict(date=date.isoformat(), week=wk, day=which,
                         src=str(path.relative_to(course)), **p))

    body = ',\n'.join('  ' + json.dumps(r, ensure_ascii=False) for r in rows)
    out = pathlib.Path(__file__).resolve().parent.parent / 'poems.js'
    out.write_text(f'''// GENERATED FILE — do not edit by hand.
//
//   python3 tools/build-poems.py {course}
//
// Source: {course.name} @ {rev}
// Built:  {datetime.date.today().isoformat()}
// {len(rows)} poems across {len(rows) + len(skipped)} class sessions.
// {len([r for r in rows if r["text"]])} carry their text (see poem-texts/README.md);
// the rest link out, which is what the course pages do.
// Sessions with no Daily Poem: {', '.join(skipped) or 'none'}.
//
// Poem text, where present, is transcribed by hand into poem-texts/ and is there only
// when reproducing it is safe. This repo is public; adding a poem here republishes it.
window.DAILY_POEMS = [
{body}
];
''')
    withtext = [r for r in rows if r['text']]
    print(f'{out}: {len(rows)} poems, {len(withtext)} with text, '
          f'{len(skipped)} sessions without a poem')
    for r in rows:
        print(f"  {'text  ' if r['text'] else 'link  '}{r['date']}  {r['title']}")
    for s in skipped:
        print(f'  no poem: {s}')


main()
