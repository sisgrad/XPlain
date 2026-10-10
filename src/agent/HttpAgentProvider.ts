/**
 * Talks to the user's own agent system over HTTP.
 *
 * Request:  POST <endpoint>  { sessionId, question, items[], workspace }
 * Response: either a JSON document { title?, format, content }
 *           or an NDJSON stream (Content-Type: application/x-ndjson) of events:
 *             { "type": "delta", "text": "..." }
 *             { "type": "title", "title": "..." }
 *             { "type": "done",  "title"?: "...", "format"?: "markdown"|"html", "content"?: "..." }
 *             { "type": "error", "message": "..." }
 *           When `done` has no `content`, the concatenated deltas are the content.
 */
import { AgentError, type AgentCallOptions, type AgentProvider, type AgentRequest, type AgentResponse } from './AgentProvider';
import type { ResultFormat } from '../shared/types';

export interface HttpAgentConfig {
  endpoint: string;
  timeoutMs: number;
  streaming: boolean;
  headers: Record<string, string>;
  apiKey?: string;
}

export class HttpAgentProvider implements AgentProvider {
  readonly id = 'http';

  constructor(private readonly getConfig: () => Promise<HttpAgentConfig>) {}

  get label(): string {
    return 'HTTP agent';
  }

  async explain(request: AgentRequest, options: AgentCallOptions): Promise<AgentResponse> {
    const cfg = await this.getConfig();
    if (!cfg.endpoint) throw new AgentError('Agent endpoint is not configured (setting: xplain.agent.endpoint).');

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    options.signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: cfg.streaming ? 'application/x-ndjson, application/json' : 'application/json',
      ...cfg.headers,
    };
    if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;

    try {
      let res: Response;
      try {
        res = await fetch(cfg.endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(request),
          signal: controller.signal,
        });
      } catch (err) {
        if (options.signal.aborted) throw new AgentError('Cancelled.');
        if (controller.signal.aborted) throw new AgentError(`Agent did not respond within ${cfg.timeoutMs} ms.`);
        throw new AgentError(`Cannot reach agent at ${cfg.endpoint}: ${(err as Error).message}`);
      }
      if (!res.ok) {
        const body = await safeText(res);
        throw new AgentError(`Agent returned HTTP ${res.status}${body ? `: ${body.slice(0, 500)}` : ''}`, res.status);
      }
      const contentType = res.headers.get('content-type') ?? '';
      if (contentType.includes('ndjson') || contentType.includes('text/event-stream')) {
        return await this.readStream(res, options, contentType.includes('event-stream'));
      }
      const text = await res.text();
      return parseJsonResponse(text);
    } finally {
      clearTimeout(timer);
      options.signal.removeEventListener('abort', onAbort);
    }
  }

  private async readStream(res: Response, options: AgentCallOptions, sse: boolean): Promise<AgentResponse> {
    if (!res.body) throw new AgentError('Agent returned an empty stream.');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let title: string | undefined;
    let format: ResultFormat = 'markdown';
    let finalContent: string | undefined;

    const handleLine = (rawLine: string) => {
      let line = rawLine.trim();
      if (!line) return;
      if (sse) {
        if (!line.startsWith('data:')) return;
        line = line.slice(5).trim();
        if (line === '[DONE]') return;
      }
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(line);
      } catch {
        // Tolerate plain-text streams.
        content += rawLine + '\n';
        options.onDelta?.(rawLine + '\n');
        return;
      }
      switch (ev.type) {
        case 'delta': {
          const text = typeof ev.text === 'string' ? ev.text : '';
          content += text;
          options.onDelta?.(text);
          break;
        }
        case 'title':
          if (typeof ev.title === 'string') title = ev.title;
          break;
        case 'done':
          if (typeof ev.title === 'string') title = ev.title;
          if (ev.format === 'html' || ev.format === 'markdown') format = ev.format;
          if (typeof ev.content === 'string') finalContent = ev.content;
          break;
        case 'error':
          throw new AgentError(typeof ev.message === 'string' ? ev.message : 'Agent reported an error.');
        default:
          break;
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        handleLine(line);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) handleLine(buffer);

    const body = finalContent ?? content;
    if (!body.trim()) throw new AgentError('Agent stream finished without any content.');
    return { title, format, content: body };
  }
}

function parseJsonResponse(text: string): AgentResponse {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    // Be lenient: treat a non-JSON body as markdown.
    return { format: 'markdown', content: text };
  }
  if (typeof data !== 'object' || data === null) throw new AgentError('Agent returned an unexpected JSON payload.');
  const obj = data as Record<string, unknown>;
  const content =
    typeof obj.content === 'string'
      ? obj.content
      : typeof obj.answer === 'string'
        ? obj.answer
        : typeof obj.markdown === 'string'
          ? obj.markdown
          : typeof obj.html === 'string'
            ? obj.html
            : undefined;
  if (content === undefined) throw new AgentError('Agent response has no "content" field.');
  const format: ResultFormat =
    obj.format === 'html' || typeof obj.html === 'string' ? 'html' : 'markdown';
  return { title: typeof obj.title === 'string' ? obj.title : undefined, format, content };
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
