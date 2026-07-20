#!/usr/bin/env python3
# Dev server for Journaler that disables browser caching, so a normal refresh
# always gets the latest index.html (no more stale-JS "phantom bugs").
#   python3 serve-nocache.py   ->   http://localhost:8000
import http.server, socketserver, os

os.chdir(os.path.dirname(os.path.abspath(__file__)))

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('127.0.0.1', 8000), NoCacheHandler) as httpd:
    print('Journaler (no-cache) on http://localhost:8000')
    httpd.serve_forever()
