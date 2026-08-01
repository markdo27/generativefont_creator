#!/usr/bin/env python3
"""Static file server for local testing that disables all caching.

Python's bare `http.server` sends no Cache-Control header, so browsers apply
heuristic freshness and can silently keep serving a stale copy of a JS file
across reloads even after it changes on disk. This wrapper adds explicit
no-store headers so every reload is guaranteed to reflect the file on disk.
"""
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8743
    HTTPServer(('', port), NoCacheHandler).serve_forever()
