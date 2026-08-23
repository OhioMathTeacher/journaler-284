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
import re, sys, json, subprocess, datetime, pathlib, html, urllib.parse, urllib.request

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


# ── Public-domain stand-ins ──────────────────────────────────────────────────
#
# Most of the class poems cannot be reproduced here, so those days show a poem that
# can be, named in poem-substitutes.txt and fetched from PoetryDB — a fixed corpus of
# 129 out-of-copyright poets.
#
# ⚠ Fetched at BUILD time and cached under poem-texts/_pd/, never called from the
# app. The landing page is the first thing a student sees, it has to work on a
# campus VPN or with no network at all, and a poem that arrives over the wire is a
# poem that can fail to arrive. It is also why the texts land in git, where they can
# be read in a diff rather than trusted.
PDB = 'https://poetrydb.org/author,title/%s;%s'
PDB_TITLE = 'https://poetrydb.org/title/%s/title,author,linecount'
PDB_LINES = 'https://poetrydb.org/lines/%s/title,author,linecount'
PDB_FETCH = 'https://poetrydb.org/author,title/%s;%s'

# A stand-in should be worth reading on its own, so: long enough not to be a scrap,
# short enough to sit on a landing page without scrolling. Todd: "preferably short?"
MIN_LINES, MAX_LINES = 8, 40

# Words that match everything and therefore mean nothing.
STOP = set('''a an the and or but if of to in on at by for with from as is are was were
be been being it its this that these those you your yours we our us they them their he
she his her him do does did not no nor so then than there here what which who whom whose
since while until upon unto whether though although because
how when where why all any both each few more most other some such only own same too very
can will just don should now into over under about after before again against between
during through above below up down out off only read aloud it's what's poem line lines
first last one two three today day says say said make makes made does doing go goes going
notice noticing whole never always ever also would could should might must have has had'''.split())


def session_name(page):
    """"Week 7 · Monday — Currere Topic Conferences" -> "Currere Topic Conferences".

    ⚠ Not named `html`: that shadows the stdlib module this function needs."""
    m = re.search(r'<h1>([^<]*)</h1>', page)
    if not m:
        return ''
    return html.unescape(re.sub(r'^.*?—\s*', '', m.group(1))).strip()


def keywords(p):
    """What this poem is about — from its TITLE, and nothing else.

    ⚠ Todd's framing questions were in here too, and they are why the first working
    version paired "We Wear the Mask" with a poem sharing the word "student", and
    "The Gift" with one sharing "pulling". The framing is prose ABOUT a poem, so its
    rare words are incidental -- "couldn't", "sideways", "knelling" -- and a rare
    word is exactly what the ranking below reaches for. A title is different: a poem
    called "We Wear the Mask" IS about masks, every time.

    When a title carries nothing to search on -- "Ethics", "Where I'm From" -- the
    answer is the curated list in poem-substitutes.txt, not a worse guess.

    Eleven of the twenty-seven class meetings have no Daily Poem at all. Those fall
    back to the session's own name -- "Revise for the Particular", "Launching the
    Research Project" -- which is a weaker signal than a poem title and misses more
    often, and missing is fine: the list is there."""
    seen, out = set(), []
    for w in re.findall(r"[a-z']{4,}", (p['title'] or p.get('session') or '').lower()):
        w = w.strip("'")
        if w and w not in STOP and w not in seen:
            seen.add(w)
            out.append(w)
    return out


def search(url, kw):
    r = urllib.request.Request(url % urllib.parse.quote(kw),
                               headers={'User-Agent': 'journaler-284 poem builder'})
    try:
        d = json.load(urllib.request.urlopen(r, timeout=25))
    except Exception:
        return []
    if not isinstance(d, list):
        return []
    return [p for p in d if MIN_LINES <= int(p.get('linecount') or 0) <= MAX_LINES]


_freq = {}


def rarity(kw):
    """How many poems in the corpus use this word at all. Cached; lower is better."""
    if kw not in _freq:
        r = urllib.request.Request(PDB_LINES % urllib.parse.quote(kw),
                                   headers={'User-Agent': 'journaler-284 poem builder'})
        try:
            d = json.load(urllib.request.urlopen(r, timeout=25))
            _freq[kw] = len(d) if isinstance(d, list) else 0
        except Exception:
            _freq[kw] = 0
    return _freq[kw]


def echo(p, used, cache):
    """A public-domain poem that answers this one, or None.

    ⚠ Ranked by how RARE the word is, and each word exhausted before the next.

    The obvious way round -- every title match first, then line matches -- is what
    this did first, and it paired "We Wear the Mask" with a sonnet that happens to
    contain the word "wear", and "[since feeling is first]" with Donne on the
    strength of the word "since". Both are real matches and neither is about
    anything. A word the corpus uses eighty times is telling you something; a word
    it uses four hundred times is telling you nothing, and "mask" only loses to
    "wear" if you rank them by where they sit in the title.

    So: order the words by corpus frequency, then for the rarest one try titles AND
    lines before giving up on it. A poem with "mask" somewhere in it beats a poem
    called something with "wear" in it."""
    kws = [k for k in keywords(p) if rarity(k)]
    for kw in sorted(kws, key=rarity):
        for url, how in ((PDB_TITLE, 'title'), (PDB_LINES, 'line')):
            hits = [h for h in search(url, kw)
                    if (h['author'], h['title']) not in used]
            if not hits:
                continue
            hit = min(hits, key=lambda h: int(h['linecount']))   # shortest wins
            text, note = poetrydb(hit['author'], hit['title'], cache)
            if not text:
                continue
            return dict(slug=slugify(hit['title']), poet=hit['author'], title=hit['title'],
                        text=text, textSource=note,
                        why=f'{how}: “{kw}” ({rarity(kw)} in corpus)')
    return None





def poetrydb(author, title, cache):
    """(lines, note) for one poem, from the cache if it is there."""
    f = cache / f'{slugify(author)}--{slugify(title)}.txt'
    if f.exists():
        return f.read_text().strip('\n'), 'PoetryDB (cached)'
    url = PDB % (urllib.parse.quote(author), urllib.parse.quote(title))
    req = urllib.request.Request(url, headers={'User-Agent': 'journaler-284 poem builder'})
    try:
        d = json.load(urllib.request.urlopen(req, timeout=25))
    except Exception as e:
        print(f'  ! {author} — {title}: {e}')
        return '', ''
    if isinstance(d, dict) or not d:          # PoetryDB says 404 with a JSON object
        print(f'  ! {author} — {title}: not in PoetryDB')
        return '', ''
    text = '\n'.join(d[0]['lines']).strip('\n')
    cache.mkdir(parents=True, exist_ok=True)
    f.write_text(text + '\n')
    return text, 'PoetryDB'


def substitutes(here):
    """(pool, pinned) from poem-substitutes.txt.

    A line may be "Author | Title", which joins the fallback pool, or
    "2026-09-16 | Author | Title", which pins that poem to that session and
    overrides the search entirely. Pinning is how a bad automatic match gets
    fixed: the search is a default, not a verdict."""
    f = here / 'poem-substitutes.txt'
    pool, pinned = [], {}
    if not f.exists():
        return pool, pinned
    for line in f.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '|' not in line:
            continue
        bits = [b.strip() for b in line.split('|')]
        if len(bits) >= 3 and re.fullmatch(r'\d{4}-\d{2}-\d{2}', bits[0]):
            pinned[bits[0]] = (bits[1], bits[2])
        else:
            pool.append((bits[0], bits[1]))
    return pool, pinned


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

    here = pathlib.Path(__file__).resolve().parent.parent
    rows, skipped = [], []
    for date, wk, which, path in sessions(course):
        # ⚠ EVERY class meeting gets a row, not only the ones with a Daily Poem.
        # Todd: "this doesn't cover all of our class meetings. Let's have a poem a
        # day." A session with no poem of its own still gets one that stands in; it
        # just has no class poem to name above it.
        p = poem(path) or dict(slug='', title='', poet='', url='', where='', note='',
                               text='', textSource='', framing=[])
        if not p['title']:
            skipped.append(f'week {wk} {which}')
        rows.append(dict(date=date.isoformat(), week=wk, day=which,
                         session=session_name(path.read_text()),
                         src=str(path.relative_to(course)), **p))

    # Every session whose own poem cannot be printed gets the next stand-in, in the
    # order poem-substitutes.txt lists them. Assigned here, in one pass over the term,
    # so the same date always lands on the same poem however often this is re-run.
    (pool, pinned), cache = substitutes(here), here / 'poem-texts' / '_pd'
    need = [r for r in rows if not r['text']]
    used = set()
    if need:
        print(f'{len(need)} sessions need a stand-in')
        for i, r in enumerate(need):
            got = None
            # 1. Whatever Todd pinned to this date, no argument.
            if r['date'] in pinned:
                author, title = pinned[r['date']]
                text, note = poetrydb(author, title, cache)
                if text:
                    got = dict(slug=slugify(title), poet=author, title=title,
                               text=text, textSource=note, why='pinned')
            # 2. A public-domain poem that is about what this one is about. Todd: "the
            #    dunbar poem is about masks. Can we find one from the DB with 'mask' in
            #    the title?" -- so the search runs on the class poem's own title.
            if not got:
                got = echo(r, used, cache)
            # 3. Otherwise the curated list — first entry not already spoken for.
            if not got:
                for k in range(len(pool)):
                    author, title = pool[(i + k) % len(pool)]
                    if (author, title) in used:
                        continue
                    text, note = poetrydb(author, title, cache)
                    if text:
                        got = dict(slug=slugify(title), poet=author, title=title,
                                   text=text, textSource=note, why='from the list')
                        break
            if got:
                used.add((got['poet'], got['title']))
                r['sub'] = got

    body = ',\n'.join('  ' + json.dumps(r, ensure_ascii=False) for r in rows)
    out = pathlib.Path(__file__).resolve().parent.parent / 'poems.js'
    out.write_text(f'''// GENERATED FILE — do not edit by hand.
//
//   python3 tools/build-poems.py {course}
//
// Source: {course.name} @ {rev}
// Built:  {datetime.date.today().isoformat()}
// {len(rows)} class meetings, every one with a poem.
// {len([r for r in rows if r["text"]])} carry their own text (see poem-texts/README.md);
// {len([r for r in rows if r.get("sub")])} show a public-domain stand-in instead, named in
// poem-substitutes.txt, with the class poem still linked above it.
// Sessions with no Daily Poem: {', '.join(skipped) or 'none'}.
//
// Poem text, where present, is transcribed by hand into poem-texts/ and is there only
// when reproducing it is safe. This repo is public; adding a poem here republishes it.
window.DAILY_POEMS = [
{body}
];
''')
    withtext = [r for r in rows if r['text']]
    withsub = [r for r in rows if r.get('sub')]
    print(f"{out}: {len(rows)} class meetings — {len(withtext)} showing the class poem, "
          f"{len(withsub)} a stand-in, {len(rows) - len(withtext) - len(withsub)} EMPTY; "
          f"{len(skipped)} of them have no Daily Poem of their own")
    for r in rows:
        how = 'class ' if r['text'] else ('sub   ' if r.get('sub') else 'NONE  ')
        tail = (f"  →  {r['sub']['poet']}, {r['sub']['title']}  [{r['sub'].get('why','')}]"
                if r.get('sub') else '')
        print(f"  {how}{r['date']}  {r['title'] or '(' + r['session'] + ')'}{tail}")


main()
