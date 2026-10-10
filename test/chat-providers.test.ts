import * as assert from 'node:assert/strict';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AgentRequest } from '../src/agent/AgentProvider';
import { AnthropicProvider, listAnthropicModels } from '../src/agent/AnthropicProvider';
import { listOpenAIModels, OpenAIChatProvider } from '../src/agent/OpenAIChatProvider';
import { buildChatPrompt, DEFAULT_SYSTEM_PROMPT, detectHtml } from '../src/agent/prompt';
import { joinUrl } from '../src/agent/stream';

const request: AgentRequest = {
  sessionId: 's1',
  question: 'What does this do?',
  items: [
    { type: 'code', file: 'src/a.ts', startLine: 3, endLine: 4, language: 'typescript', text: 'const a = 1;\nconst b = `x`;' },
    { type: 'result', title: 'Earlier answer', format: 'markdown', content: '# Earlier\nsome text' },
    { type: 'template', name: 'Review', instruction: 'Be strict.', files: [{ name: 'rules.md', content: '- no any' }] },
  ],
};

describe('buildChatPrompt', () => {
  it('uses the default system prompt and lays out templates, results, code and question', () => {
    const p = buildChatPrompt(request);
    assert.equal(p.system, DEFAULT_SYSTEM_PROMPT.trim());
    const t = p.user.indexOf('Be strict.');
    const r = p.user.indexOf('Earlier answer');
    const c = p.user.indexOf('src/a.ts');
    const q = p.user.indexOf('What does this do?');
    assert.ok(t >= 0 && r > t && c > r && q > c, p.user);
    assert.match(p.user, /L3-L4/);
    assert.match(p.user, /```typescript/);
    assert.match(p.user, /rules\.md/);
  });

  it('honours a custom system prompt and escapes fences inside code', () => {
    const p = buildChatPrompt({ sessionId: 'x', question: '', items: [{ type: 'code', file: 'f.md', startLine: 1, endLine: 1, language: 'markdown', text: '```js\n1\n```' }] }, '  custom  ');
    assert.equal(p.system, 'custom');
    assert.match(p.user, /````/); // a longer fence wraps code that itself contains ```
  });

  it('detects HTML documents', () => {
    assert.equal(detectHtml('<!DOCTYPE html><html></html>'), true);
    assert.equal(detectHtml('# Title\n<b>bold</b>'), false);
  });

  it('joins URLs without duplicate slashes', () => {
    assert.equal(joinUrl('http://h/v1/', '/chat/completions'), 'http://h/v1/chat/completions');
    assert.equal(joinUrl('http://h/v1', 'models'), 'http://h/v1/models');
  });
});

type Mode = 'sse' | 'json' | 'error' | 'models' | 'anthropic-sse' | 'anthropic-json' | 'anthropic-models';

describe('OpenAIChatProvider / AnthropicProvider', () => {
  let server: http.Server;
  let baseUrl: string;
  let lastBody: Record<string, unknown>;
  let lastHeaders: http.IncomingHttpHeaders;
  let lastPath = '';
  let mode: Mode;

  before(async () => {
    server = http.createServer((req, res) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        lastBody = data ? JSON.parse(data) : {};
        lastHeaders = req.headers;
        lastPath = req.url ?? '';
        switch (mode) {
          case 'sse': {
            res.setHeader('content-type', 'text/event-stream');
            const chunk = (content: string) => `data: ${JSON.stringify({ object: 'chat.completion.chunk', choices: [{ delta: { content } }] })}\n\n`;
            res.write(': keepalive\n\n');
            res.write(chunk('# Ti'));
            res.write('event: hermes.tool.progress\ndata: {"tool":"read_file","status":"running"}\n\n');
            setTimeout(() => {
              res.write(chunk('tle\n\nbody'));
              res.write('data: [DONE]\n\n');
              res.end();
            }, 20);
            break;
          }
          case 'json':
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'plain answer' } }] }));
            break;
          case 'error':
            res.statusCode = 401;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ error: { message: 'Invalid API key', type: 'invalid_request_error' } }));
            break;
          case 'models':
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ object: 'list', data: [{ id: 'zeta' }, { id: 'hermes-agent' }] }));
            break;
          case 'anthropic-sse':
            res.setHeader('content-type', 'text/event-stream');
            res.write('event: message_start\ndata: {"type":"message_start","message":{}}\n\n');
            res.write('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hel"}}\n\n');
            res.write('event: ping\ndata: {"type":"ping"}\n\n');
            res.write('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"lo"}}\n\n');
            res.write('event: message_stop\ndata: {"type":"message_stop"}\n\n');
            res.end();
            break;
          case 'anthropic-json':
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ content: [{ type: 'text', text: 'claude says hi' }] }));
            break;
          case 'anthropic-models':
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ data: [{ id: 'claude-b' }, { id: 'claude-a' }] }));
            break;
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  });

  after(() => server.close());

  const openai = (overrides: Partial<{ streaming: boolean; apiKey: string; systemPrompt: string; model: string }> = {}) =>
    new OpenAIChatProvider('hermes', 'Hermes Agent', async () => ({
      baseUrl,
      model: 'hermes-agent',
      timeoutMs: 1000,
      streaming: true,
      headers: { 'X-Test': '1' },
      ...overrides,
    }));

  const anthropic = (overrides: Partial<{ streaming: boolean; apiKey?: string }> = {}) =>
    new AnthropicProvider(async () => ({
      baseUrl: baseUrl.replace(/\/v1$/, ''),
      model: 'claude-sonnet-5',
      maxTokens: 1024,
      timeoutMs: 1000,
      streaming: true,
      headers: {},
      apiKey: 'sk-ant-test',
      ...overrides,
    }));

  it('streams chat.completion.chunk deltas and ignores keepalives, custom events and [DONE]', async () => {
    mode = 'sse';
    const deltas: string[] = [];
    const res = await openai({ apiKey: 'k' }).explain(request, { signal: new AbortController().signal, onDelta: (t) => deltas.push(t) });
    assert.deepEqual(deltas, ['# Ti', 'tle\n\nbody']);
    assert.deepEqual(res, { format: 'markdown', content: '# Title\n\nbody' });
    assert.equal(lastPath, '/v1/chat/completions');
    assert.equal(lastHeaders.authorization, 'Bearer k');
    assert.equal(lastHeaders['x-test'], '1');
    assert.equal(lastBody.model, 'hermes-agent');
    assert.equal(lastBody.stream, true);
    const messages = lastBody.messages as Array<{ role: string; content: string }>;
    assert.equal(messages[0].role, 'system');
    assert.equal(messages[1].role, 'user');
    assert.match(messages[1].content, /src\/a\.ts/);
  });

  it('parses a non-streaming JSON completion and sends no Authorization without a key', async () => {
    mode = 'json';
    const res = await openai({ streaming: false, systemPrompt: 'be brief' }).explain(request, { signal: new AbortController().signal });
    assert.equal(res.content, 'plain answer');
    assert.equal(lastHeaders.authorization, undefined);
    assert.equal(lastBody.stream, false);
    assert.equal((lastBody.messages as Array<{ content: string }>)[0].content, 'be brief');
  });

  it('surfaces API error messages', async () => {
    mode = 'error';
    await assert.rejects(openai().explain(request, { signal: new AbortController().signal }), /Invalid API key|HTTP 401/);
  });

  it('lists models sorted', async () => {
    mode = 'models';
    const models = await listOpenAIModels({ baseUrl, apiKey: 'k', headers: {}, timeoutMs: 1000 }, new AbortController().signal);
    assert.deepEqual(models, ['hermes-agent', 'zeta']);
    assert.equal(lastPath, '/v1/models');
  });

  it('Anthropic: streams text_delta events with the right headers and body', async () => {
    mode = 'anthropic-sse';
    const deltas: string[] = [];
    const res = await anthropic().explain(request, { signal: new AbortController().signal, onDelta: (t) => deltas.push(t) });
    assert.deepEqual(deltas, ['Hel', 'lo']);
    assert.equal(res.content, 'Hello');
    assert.equal(lastPath, '/v1/messages');
    assert.equal(lastHeaders['x-api-key'], 'sk-ant-test');
    assert.equal(lastHeaders['anthropic-version'], '2023-06-01');
    assert.equal(lastBody.max_tokens, 1024);
    assert.equal(typeof lastBody.system, 'string');
    const messages = lastBody.messages as Array<{ role: string }>;
    assert.equal(messages.length, 1);
    assert.equal(messages[0].role, 'user');
  });

  it('Anthropic: parses a JSON message and requires a key', async () => {
    mode = 'anthropic-json';
    const res = await anthropic({ streaming: false }).explain(request, { signal: new AbortController().signal });
    assert.equal(res.content, 'claude says hi');
    await assert.rejects(anthropic({ apiKey: undefined }).explain(request, { signal: new AbortController().signal }), /API key/);
  });

  it('Anthropic: lists models', async () => {
    mode = 'anthropic-models';
    const models = await listAnthropicModels({ baseUrl: baseUrl.replace(/\/v1$/, ''), apiKey: 'k', headers: {}, timeoutMs: 1000 }, new AbortController().signal);
    assert.deepEqual(models, ['claude-a', 'claude-b']);
    assert.match(lastPath, /^\/v1\/models/);
  });
});
