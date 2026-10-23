#!/usr/bin/env python3
"""Serve a built site on an isolated ephemeral loopback port, then check it.
The server has no proxy and cannot forward requests to any live API.
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import platform
import subprocess
import sys
import threading


class StaticPreview(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        # Static exports use /route.html, whereas the site's URLs use /route.
        route = self.path.split("?", 1)[0]
        if route.startswith("/playground/"):
            self.send_error(503, "Static preview: no live API")
            return
        if route != "/" and not Path(route).suffix:
            self.path = route + ".html"
        super().do_GET()


def main():
    site, runner = sys.argv[1:]
    with ThreadingHTTPServer(("127.0.0.1", 0), partial(StaticPreview, directory=site)) as server:
        url = f"http://127.0.0.1:{server.server_port}"
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        print(f"Isolated static preview: {url}; owner PID {os.getpid()}; Python {platform.python_version()}; site {site}", flush=True)
        try:
            return subprocess.call([runner, url])
        finally:
            server.shutdown()
            thread.join()
            print("Preview stopped; loopback listener closed on exit.", flush=True)


if __name__ == "__main__":
    sys.exit(main())
