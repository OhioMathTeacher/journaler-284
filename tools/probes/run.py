#!/usr/bin/env python3
"""Drive the real app in a headless browser and report what it actually did.

    python3 tools/probes/run.py            # both suites
    python3 tools/probes/run.py undo       # deletes, the undo offer, the toast layer
    python3 tools/probes/run.py pages      # page eviction, card anchoring, canvas memory

Exit code is the number of failed checks, so this is usable as a gate.

⚠ REAL TIME, NEVER --virtual-time-budget. See README.md — the short version is that
virtual time races the clock forward whenever the main thread looks idle, which is
exactly what it looks like while a pdf.js worker is parsing. The document then never
finishes loading and every assertion runs against "Loading...". The suite waits on real
work, so it needs a real clock; results come back over HTTP instead of --dump-dom.
"""
import http.server, json, os, shutil, socket, subprocess, sys, tempfile, threading, time

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.join(ROOT, 'tools', 'probes')
SUITES = ('undo', 'pages')
CHROME = ['chromium-browser', 'chromium', 'google-chrome', 'google-chrome-stable', 'chrome']


def chrome_binary():
    for c in CHROME:
        p = shutil.which(c)
        if p:
            return p
    sys.exit("no chromium/chrome on PATH (tried: %s)" % ', '.join(CHROME))


def free_port():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    p = s.getsockname()[1]
    s.close()
    return p


def make_page(suite):
    """The probe page IS index.html, with one script tag added. Nothing about the app
    is stubbed or reimplemented — a suite that tests a copy tests the copy."""
    src = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
    tag = '<script src="tools/probes/driver-%s.js"></script>\n' % suite
    assert '</body>' in src, 'index.html has no </body>'
    # ⚠ THE LAST </body>, NOT THE FIRST. 318P's own script writes a whole HTML document
    # into a print window from a template literal, so the first '</body>' in the file is
    # inside a JavaScript STRING — injecting there lands the driver tag mid-literal and
    # the app dies with "Unexpected end of input" a thousand lines from anything real.
    assert '</body>' in src, 'index.html has no </body>'
    head, tail = src.rsplit('</body>', 1)
    out = os.path.join(ROOT, '_p_%s.html' % suite)
    open(out, 'w', encoding='utf-8').write(head + tag + tail)
    return out


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True


def serve(port, result_path):
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=ROOT, **k)
        def log_message(self, *a):
            pass
        def end_headers(self):
            self.send_header('Cache-Control', 'no-store')
            super().end_headers()
        def do_POST(self):
            n = int(self.headers.get('Content-Length') or 0)
            open(result_path, 'wb').write(self.rfile.read(n))
            self.send_response(204)
            self.end_headers()
    httpd = Server(('127.0.0.1', port), H)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def run_suite(suite, timeout=240):
    made = [make_page(suite)]
    if suite == 'pages':
        pdf = os.path.join(ROOT, '_p_probe.pdf')
        subprocess.check_call([sys.executable, os.path.join(HERE, 'make-pdf.py'), '30', pdf],
                              stdout=subprocess.DEVNULL)
        made.append(pdf)

    port = free_port()
    tmp = tempfile.mkdtemp(prefix='probe-')
    result = os.path.join(tmp, 'result.json')
    httpd = serve(port, result)
    proc = subprocess.Popen(
        [chrome_binary(), '--headless', '--no-sandbox', '--disable-gpu',
         '--window-size=1500,1000', '--user-data-dir=' + os.path.join(tmp, 'profile'),
         'http://127.0.0.1:%d/_p_%s.html' % (port, suite)],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        deadline = time.time() + timeout
        while time.time() < deadline and not os.path.exists(result):
            time.sleep(1)
        if not os.path.exists(result):
            print('%s: TIMED OUT after %ds with no result' % (suite, timeout))
            return [{'n': '%s suite' % suite, 'p': False, 'd': 'timed out'}]
        return json.load(open(result, encoding='utf-8'))
    finally:
        proc.terminate()
        try:
            proc.wait(10)
        except Exception:
            proc.kill()
        httpd.shutdown()
        shutil.rmtree(tmp, ignore_errors=True)
        for f in made:
            if os.path.exists(f):
                os.remove(f)


def main():
    want = sys.argv[1:] or list(SUITES)
    bad = [s for s in want if s not in SUITES]
    if bad:
        sys.exit('unknown suite(s): %s (have: %s)' % (', '.join(bad), ', '.join(SUITES)))
    failed = 0
    for suite in want:
        print('\n== %s ==' % suite)
        for t in run_suite(suite):
            mark = 'PASS' if t['p'] else 'FAIL'
            print('%s %s%s' % (mark, t['n'], (' · ' + t['d']) if t.get('d') else ''))
            if not t['p']:
                failed += 1
    print('\n%d failed' % failed if failed else '\nall checks passed')
    return failed


if __name__ == '__main__':
    sys.exit(main())
