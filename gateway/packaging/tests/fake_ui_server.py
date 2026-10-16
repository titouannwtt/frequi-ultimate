#!/usr/bin/env python3
"""Stand-in for the part of a freqtrade bot that serves the UI (rpc/api_server/web_ui.py).

Same observable behaviour: GET /ui_version returns {"version": <content of .uiversion>},
any other path returns the file under the UI directory, or index.html (SPA fallback), and the
directory is read on every request. Used to rehearse deploy-ui.sh without touching a bot.

    fake_ui_server.py UI_DIR PORT_FILE     (binds 127.0.0.1 on a free port, writes it to PORT_FILE)
"""
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

RESERVED = {9399, 9400}  # gateway and live bot: never bind them


class Handler(BaseHTTPRequestHandler):
    base: Path

    def log_message(self, *args):  # keep the test output quiet
        pass

    def _send(self, code, body, ctype):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?", 1)[0].lstrip("/")
        base = self.base.resolve()
        if path == "ui_version":
            f = base / ".uiversion"
            version = f.read_text() if f.is_file() else "not_installed"
            return self._send(200, json.dumps({"version": version}).encode(), "application/json")
        if path.startswith("api") or path.startswith("."):
            return self._send(404, b'{"detail":"Not Found"}', "application/json")
        target = (base / path).resolve()
        if target.is_file() and target.is_relative_to(base):
            return self._send(200, target.read_bytes(), "application/octet-stream")
        index = base / "index.html"
        if not index.is_file():
            return self._send(200, b"fallback", "text/html")
        return self._send(200, index.read_bytes(), "text/html")


def main():
    ui_dir, port_file = Path(sys.argv[1]), Path(sys.argv[2])
    Handler.base = ui_dir
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    while server.server_address[1] in RESERVED:
        server.server_close()
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    port_file.write_text(str(server.server_address[1]))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
