"""
Serve the site locally with browser caching turned off, so edits to the
JavaScript and CSS always show up on reload.

Usage (from the repo root):
    python scripts/serve.py            # http://localhost:8623/
    python scripts/serve.py 8000       # another port
"""
import http.server
import sys
from functools import partial
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8623
    handler = partial(NoCacheHandler, directory=str(ROOT))
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"Serving {ROOT} at http://localhost:{port}/ (no caching)")
        httpd.serve_forever()
