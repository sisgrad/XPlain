import * as assert from 'node:assert/strict';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { HttpAgentProvider } from '../src/agent/HttpAgentProvider';
import type { AgentRequest } from '../src/agent/AgentProvider';

const request: AgentRequest = { sessionId: 's1', question: 'why?', items: [] };

describe('HttpAgentProvider', () => {
  let server: http.Server;
  let endpoint: string;
  let lastBody: unknown;
  let lastHeaders: http.IncomingHttpHeaders;
  let mode: 'json' | 'ndjson' | 'ndjson-content' | 'error' | 'slow' | 'text' | 'ndjson-slow-chunks' | 'headers-ok-then-idle';

  before(async () => {
    server = http.createServer((req, res) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        lastBody = JSON.parse(data);
        lastHeaders = req.headers;
        switch (mode) {
          case 'json':
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ title: 'From agent', format: 'markdown', content: '# Hello' }));
            break;
          case 'ndjson':
            res.setHeader('content-type', 'application/x-ndjson');
            res.write(JSON.stringify({ type: 'delta', text: 'Hel' }) + '\n');
            setTimeout(() => {
              res.write(JSON.stringify({ type: 'delta', text: 'lo' }) + '\n');
              res.end(JSON.stringify({ type: 'done', title: 'Streamed', format: 'markdown' }) + '\n');
            }, 20);
            break;
          case 'ndjson-content':
            res.setHeader('content-type', 'application/x-ndjson');
            res.end(JSON.stringify({ type: 'done', format: 'html', content: '<h1>x</h1>' }) + '\n');
            break;
          case 'error':
            res.statusCode = 500;
            res.end('boom');
            break;
          case 'text':
            res.setHeader('content-type', 'text/plain');
            res.end('plain markdown');
            break;
          case 'slow':
            setTimeout(() => res.end('{}'), 2000);
            break;
          case 'ndjson-slow-chunks': {
            // Total wall time ~250ms, but each gap is < idle timeout (150ms) so it must succeed.
            res.setHeader('content-type', 'application/x-ndjson');
            res.write(JSON.stringify({ type: 'delta', text: 'A' }) + '\n');
            setTimeout(() => res.write(JSON.stringify({ type: 'delta', text: 'B' }) + '\n'), 80);
            setTimeout(() => res.write(JSON.stringify({ type: 'delta', text: 'C' }) + '\n'), 160);
            setTimeout(() => res.end(JSON.stringify({ type: 'done', format: 'markdown' }) + '\n'), 240);
            break;
          }
          case 'headers-ok-then-idle':
            res.setHeader('content-type', 'application/x-ndjson');
            res.write(JSON.stringify({ type: 'delta', text: 'x' }) + '\n');
            // Never end — idle timeout should fire while reading the body.
            break;
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/explain`;
  });

  after(() => server.close());

  const provider = (overrides: Partial<{ timeoutMs: number; streaming: boolean; apiKey: string }> = {}) =>
    new HttpAgentProvider(async () => ({
      endpoint,
      timeoutMs: 1000,
      streaming: true,
      headers: { 'X-Test': '1' },
      ...overrides,
    }));

  it('posts the request and parses a JSON response', async () => {
    mode = 'json';
    const res = await provider({ apiKey: 'secret' }).explain(request, { signal: new AbortController().signal });
    assert.deepEqual(res, { title: 'From agent', format: 'markdown', content: '# Hello' });
    assert.deepEqual(lastBody, request);
    assert.equal(lastHeaders.authorization, 'Bearer secret');
    assert.equal(lastHeaders['x-test'], '1');
    assert.match(String(lastHeaders.accept), /ndjson/);
  });

  it('reads an NDJSON stream and forwards deltas', async () => {
    mode = 'ndjson';
    const deltas: string[] = [];
    const res = await provider().explain(request, { signal: new AbortController().signal, onDelta: (t) => deltas.push(t) });
    assert.deepEqual(deltas, ['Hel', 'lo']);
    assert.deepEqual(res, { title: 'Streamed', format: 'markdown', content: 'Hello' });
  });

  it('uses content from the done event when present', async () => {
    mode = 'ndjson-content';
    const res = await provider().explain(request, { signal: new AbortController().signal });
    assert.deepEqual(res, { title: undefined, format: 'html', content: '<h1>x</h1>' });
  });

  it('treats a non-JSON body as markdown', async () => {
    mode = 'text';
    const res = await provider().explain(request, { signal: new AbortController().signal });
    assert.equal(res.content, 'plain markdown');
  });

  it('reports HTTP errors', async () => {
    mode = 'error';
    await assert.rejects(provider().explain(request, { signal: new AbortController().signal }), /HTTP 500: boom/);
  });

  it('times out waiting for headers and can be cancelled', async () => {
    mode = 'slow';
    await assert.rejects(provider({ timeoutMs: 100 }).explain(request, { signal: new AbortController().signal }), /did not respond/);
    const ac = new AbortController();
    const p = provider().explain(request, { signal: ac.signal });
    setTimeout(() => ac.abort(), 30);
    await assert.rejects(p, /Cancelled/);
  });

  it('idle timeout resets on each streamed chunk (total wall time may exceed timeoutMs)', async () => {
    mode = 'ndjson-slow-chunks';
    const res = await provider({ timeoutMs: 150 }).explain(request, { signal: new AbortController().signal });
    assert.equal(res.content, 'ABC');
  });

  it('aborts when the body goes idle after headers', async () => {
    mode = 'headers-ok-then-idle';
    await assert.rejects(provider({ timeoutMs: 120 }).explain(request, { signal: new AbortController().signal }), /went idle/);
  });
});
