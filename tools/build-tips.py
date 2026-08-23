#!/usr/bin/env python3
"""Assign passages to class meetings and write tips.js.

    python3 tools/passages.py  path/to/badideasaboutwriting-book.pdf   # the pool
    python3 tools/build-tips.py ../tce284-fa26                         # the assignment

tips-chosen.txt names the ones Todd has approved, in order, and vetoes the ones he
has not. Everything it does not cover is filled from the rest of the pool.

⚠ tips-chosen.txt holds POINTERS — a chapter and the first few words. The passage
text is only ever copied from tools/quotes.js, which is only ever copied from the
book. Nothing in this chain retypes a quotation, so no quotation can drift from
what the book actually says. That matters more than usual here: the licence is
CC BY-NC-ND, and a misquotation is both a bad tip and a licence breach.
"""
import re, sys, json, pathlib, importlib.util

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
ARGS = sys.argv[1:]

spec = importlib.util.spec_from_file_location('bp', HERE / 'build-poems.py')
bp = importlib.util.module_from_spec(spec)
sys.argv = ['build-poems.py']
try:
    spec.loader.exec_module(bp)
except SystemExit:
    pass


def pool():
    js = (HERE / 'quotes.js').read_text()
    return json.loads(js[js.index('['):js.rindex(';')])


def wanted():
    f = ROOT / 'tips-chosen.txt'
    keep, veto = [], []
    if not f.exists():
        return keep, veto
    for line in f.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '|' not in line:
            continue
        bits = [b.strip() for b in line.lstrip('-').split('|')]
        ch, pre = bits[0], bits[1] if len(bits) > 1 else ''
        # A third field lists elisions: text to drop, replaced by an ellipsis.
        cuts = [c.strip() for c in bits[2].split(';;')] if len(bits) > 2 and bits[2] else []
        (veto if line.startswith('-') else keep).append((ch, pre, cuts))
    return keep, veto


def elide(q, cuts):
    """Drop declared phrases from a passage, marking each with an ellipsis.

    ⚠ This is the ONLY thing in the pipeline that changes a quotation, and it is
    deliberately dumb: it removes exactly the characters named in tips-chosen.txt
    and puts "…" where they were. It cannot reword, reorder or paraphrase.

    On the licence: CC BY-NC-ND restricts derivatives, and an elision marked with
    an ellipsis is ordinary quotation practice rather than an adaptation — the
    reader is told text was removed and can follow the link to the whole chapter.
    That is the reasoning; it is not legal advice, and the safe move is always to
    quote whole.

    ⚠ A cut that no longer matches is a HARD ERROR, not a silent no-op. If the
    source ever changes under us, the build stops rather than shipping a passage
    that quietly says something else."""
    text = q['text']
    for c in cuts:
        if c not in text:
            sys.exit(f'\n  cut not found in “{q["chapter"]}”:\n    {c!r}\n'
                     f'  the passage reads:\n    {text}\n')
        text = text.replace(c, '…')
    # "literacy at the college level is" -> "literacy … is", never "literacy  … is".
    text = re.sub(r'\s*…\s*', ' … ', text)
    text = re.sub(r'\s+([,.;:])', r'\1', text).strip()
    return dict(q, text=text, elided=bool(cuts))


def killed(qs, veto):
    """⚠ A veto kills the whole CHAPTER, not one passage.

    It used to kill exactly the passage it named, and the pool holds two per
    chapter, so vetoing Carr's "The failed writer…" simply let the other Carr
    passage through on a later date — "Failure in writing betrays dullness of
    mind", which is worse than the one that was rejected. If a chapter is not
    wanted, none of it is wanted."""
    chapters = {norm(c) for c, _, _ in veto}
    return {id(q) for q in qs if norm(q['chapter']) in chapters}


def norm(t):
    """⚠ The book sets apostrophes curly — "Writer’s Block" — and anything typed
    into tips-chosen.txt by hand will have straight ones. Match without them."""
    return re.sub(r"[‘’']", "'", (t or '')).strip().lower()


# ── Tone ─────────────────────────────────────────────────────────────────────
# Todd: "They should all be encouraging. Not about failure (unless it's
# encouraging! lol)". These chapters argue FOR students, but plenty of individual
# passages do it by first describing at length what students are accused of —
# dullness of mind, smallness of imagination — and a passage like that, alone on a
# page with no chapter around it to answer it, is just the accusation.
#
# ⚠ A word list cannot read tone. This only drops the obvious ones; the rest is a
# job for eyes, which is what tools/curate.html is for.
GRIM = re.compile(r'\b(fail(ed|ure|ing)?|dull(ness)?|stupid|dumb|deficien\w*|remedial|'
                  r'illiterate|inadequa\w*|worthless|hopeless|punitive|punish\w*|'
                  r'condemn\w*|bankrupt\w*|ruin(s|ed|ing)?|crisis|damaged|weakness|'
                  r'discourag\w*|hurts?|harm(s|ful|ed)?|frustrat\w*|dangerous|'
                  r'needs to die|anxiet\w*)\b', re.I)
# …unless the passage TURNS, which is the whole move of this book.
#
# ⚠ Kept narrow on purpose. This test used to include "can learn" and "all
# writers", and "The idea that we can all learn to 'write in general' … hurts
# students and frustrates teachers" sailed through on the strength of "can learn"
# — a phrase from the myth being demolished, not from the answer to it. A turn is
# a hinge word at the head of a clause, not a hopeful-sounding one anywhere.
TURN = re.compile(r'(^|[.;:—-]\s*)(But|Instead|In fact|Rather|However|The truth is)\b'
                  r'|\bis not a sign\b|\bgood company\b', re.I)

# Passages that are teaching a technical point rather than saying something to a
# writer. Todd on Cunningham's habitual "be": a paragraph of descriptive
# linguistics is exactly right inside its chapter and says nothing as a tip.
LESSON = re.compile(r'\b(construction|conjugat\w*|morphem\w*|syntax of|clause|'
                    r'known as|means,? in |is used in a sentence|refers to the|'
                    r'the term|defined as|for example, the word)\b', re.I)


def grim(q):
    return bool(GRIM.search(q['text'])) and not TURN.search(q['text'])


# ⚠ This book is written for writing teachers, who all know what FYC is. Todd:
# "no one is going to know that FYC is first year composition". A passage cannot
# gloss its own acronym once it is lifted out of the chapter that introduced it,
# and the elision mechanism can only REMOVE text, never expand it — so the answer
# is to not use that passage. There are 43 chapters and 27 meetings; we can afford
# to be picky.
KNOWN = {'SAT', 'ACT', 'GPA', 'AI', 'US', 'USA', 'UK', 'TV', 'PC', 'OK', 'A', 'I'}
ACRONYM = re.compile(r'\b[A-Z]{2,5}\b')

# Openers that point at a list the reader cannot see. "Second, writing is a
# curious and ancient technology" is a fine sentence with no first to follow.
ORPHAN = re.compile(r'^(First|Second|Third|Fourth|Fifth|Finally|Next|Lastly|'
                    r'One|Another|Again)\b[,:]?\s', re.I)


def opaque(q):
    if any(a not in KNOWN for a in ACRONYM.findall(q['text'])):
        return 'acronym'
    if ORPHAN.match(q['text']):
        return 'orphan opener'
    if LESSON.search(q['text']):
        return 'a lesson, not a tip'
    return '' 


def find(qs, ch, pre):
    for q in qs:
        if norm(q['chapter']) == norm(ch) and norm(q['text']).startswith(norm(pre)):
            return q
    return None


def main(course):
    qs = pool()
    keep, veto = wanted()
    dead = killed(qs, veto)
    ordered, used = [], set()
    for c, p, cuts in keep:
        q = find(qs, c, p)
        if q:
            used.add(id(q))
            ordered.append(elide(q, cuts) if cuts else q)
        else:
            print(f'  ! not in the pool: {c} | {p}')
    # ⚠ One passage per chapter before any chapter comes round twice. The pool holds
    # two per chapter and they sit next to each other, so a straight fill put Paul
    # Cook on the 2nd and the 9th and Elizabeth Wardle on the 14th and the 16th.
    live = [q for q in qs if id(q) not in used and id(q) not in dead]
    rest, why = [], {}
    for q in live:
        bad = 'discouraging' if grim(q) else opaque(q)
        if bad:
            why.setdefault(bad, []).append(q)
        else:
            rest.append(q)
    for label in sorted(why):
        print(f'  {len(why[label])} set aside — {label}')
    seen = {norm(q['chapter']) for q in ordered}
    firsts, seconds = [], []
    for q in rest:
        (seconds if norm(q['chapter']) in seen else firsts).append(q)
        seen.add(norm(q['chapter']))
    ordered += firsts + seconds

    rows = []
    for n, (date, wk, which, path) in enumerate(bp.sessions(pathlib.Path(course).expanduser())):
        if n >= len(ordered):
            break
        q = ordered[n]
        rows.append(dict(date=date.isoformat(), week=wk, day=which,
                         session=bp.session_name(path.read_text()), **q))
        print(f"{date}  {q['chapter'][:44]:46.46} {q['author']}")
    (ROOT / 'tips.js').write_text(
        '// GENERATED by tools/build-tips.py — do not edit by hand.\n'
        '//\n'
        '//   python3 tools/build-tips.py ../tce284-fa26\n'
        '//\n'
        '// Verbatim passages from Bad Ideas About Writing (Ball & Loewe, WVU Libraries,\n'
        '// 2017), CC BY-NC-ND 4.0. Attribution travels with every one and none may be\n'
        '// reworded. Order and vetoes come from tips-chosen.txt.\n'
        'window.DAILY_TIPS = ' + json.dumps(rows, ensure_ascii=False, indent=1) + ';\n')
    print(f'\ntips.js: {len(rows)} class meetings, {len(keep)} chosen by hand, '
          f'{len(veto)} vetoed')


if not ARGS:
    sys.exit(__doc__)
main(ARGS[0])
