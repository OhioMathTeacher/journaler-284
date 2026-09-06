#!/usr/bin/env python3
"""Cache Canvas file names, so the roster can show a reading's real title.

    python3 tools/fetch-canvas-names.py            # needs canvas-sync + a token

A roster row's `title` is the outline's anchor text, which for Romano is bare
chapter shorthand: "ch1", "ch7". The file on Canvas is called
"ch1-who-are-you-to-presume-to-write.pdf", and that is the name a student
already sees on their own shelf -- so the roster looked wrong beside it.

This writes tools/canvas-files.json, a {file id: display name} map that
build-readings.py folds in as a `file` field. The cache is COMMITTED: the
generator must run without Canvas credentials, and a name that has not changed
does not need fetching again. Re-run this only when files are added or renamed.
"""
import json, pathlib, sys
sys.path.insert(0, str(pathlib.Path.home() / 'Repos' / 'canvas-sync'))
from canvas_sync.client import Canvas                      # noqa: E402

COURSE = 258319
OUT = pathlib.Path(__file__).parent / 'canvas-files.json'

def main() -> int:
    c = Canvas()
    names = {str(f['id']): f['display_name']
             for f in c.paginate(f'courses/{COURSE}/files?per_page=100')}
    OUT.write_text(json.dumps(dict(sorted(names.items(), key=lambda kv: int(kv[0]))), indent=1) + '\n')
    print(f'{len(names)} file names -> {OUT.relative_to(pathlib.Path.cwd())}')
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
