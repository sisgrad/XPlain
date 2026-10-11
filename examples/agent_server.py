#!/usr/bin/env python3
"""Reference XPlain agent server (stdlib only).

Implements the HTTP contract from README.md so you can test the extension before
wiring your own agent system. Replace `explain()` with a call to your LLM/agent.

    python3 examples/agent_server.py --port 8765
    # then, in the XPlain panel's Agent tab, choose "XPlain HTTP agent" with
    # endpoint http://127.0.0.1:8765/explain (xplain.agent.provider = "xplain")
"""
import argparse
import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def explain(payload: dict):
    """Yield (event_type, data) tuples. Replace with your agent.

    Real agents should honour payload["systemPrompt"] and payload["instructions"] —
    the same shared text chat/Cursor providers receive from XPlain.
    """
    question = (payload.get("question") or "").strip()
    items = payload.get("items", [])
    code = [i for i in items if i.get("type") == "code"]
    results = [i for i in items if i.get("type") == "result"]
    templates = [i for i in items if i.get("type") == "template"]
    instructions = (payload.get("instructions") or "").strip()

    first = code[0] if code else None
    title = question or (f"{first['file'].split('/')[-1]} L{first['startLine']}-L{first['endLine']}" if first else "Explanation")
    yield "title", {"title": title[:72]}

    chunks = [f"# {title}\n\n"]
    if question:
        chunks.append(f"> {question}\n\n")
    if instructions:
        chunks.append(f"_Shared XPlain instructions received ({len(instructions)} chars)._\n\n")
    chunks.append(f"Received **{len(code)}** code block(s), {len(results)} previous result(s), {len(templates)} template(s).\n\n")
    for c in code:
        lines = c["text"].split("\n")
        chunks.append(f"## `{c['file']}` L{c['startLine']}-L{c['endLine']}\n\n")
        chunks.append(f"{len(lines)} lines of {c.get('language') or 'code'}. Opening line:\n\n")
        chunks.append(f"```{c.get('language') or ''}\n{lines[0]}\n```\n\n")
    for t in templates:
        chunks.append(f"## Template: {t['name']}\n\n{t.get('instruction', '')}\n\n")
        for f in t.get("files", []):
            chunks.append(f"- attached `{f['name']}` ({len(f.get('content', ''))} chars)\n")
    for chunk in chunks:
        yield "delta", {"text": chunk}
        time.sleep(0.03)
    yield "done", {"format": "markdown"}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # quieter logs
        print(f"[agent] {self.address_string()} {fmt % args}")

    def do_POST(self):
        if not self.path.startswith("/explain"):
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0"))
        payload = json.loads(self.rfile.read(length) or b"{}")
        accept = self.headers.get("Accept", "")
        streaming = "ndjson" in accept

        self.send_response(200)
        if streaming:
            self.send_header("Content-Type", "application/x-ndjson")
            self.end_headers()
            for ev_type, data in explain(payload):
                self.wfile.write((json.dumps({"type": ev_type, **data}) + "\n").encode())
                self.wfile.flush()
        else:
            title, content, fmt = None, [], "markdown"
            for ev_type, data in explain(payload):
                if ev_type == "title":
                    title = data["title"]
                elif ev_type == "delta":
                    content.append(data["text"])
                elif ev_type == "done":
                    fmt = data.get("format", fmt)
                    title = data.get("title", title)
            body = json.dumps({"title": title, "format": fmt, "content": "".join(content)}).encode()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    args = ap.parse_args()
    print(f"[agent] listening on http://{args.host}:{args.port}/explain")
    ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()
