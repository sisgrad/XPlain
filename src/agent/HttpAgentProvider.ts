/**
 * Talks to the user's own agent system over HTTP using the XPlain contract.
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
import { ensureSelfContainedHtml, extractHtmlTitle } from './htmlResult';
import type { ResultFormat } from '../shared/types';
import { fetchWithTimeout, readLines, readSse } from './stream';

export interface HttpAgentConfig {
  endpoint: string;
  timeoutMs: number;
  streaming: boolean;
  headers: Record<string, string>;
  apiKey?: string;
}

export class HttpAgentProvider implements AgentProvider {
  readonly id = 'xplain';
  readonly label = 'XPlain HTTP agent';

  constructor(private readonly getConfig: () => Promise<HttpAgentConfig>) {}

  async explain(request: AgentRequest, options: AgentCallOptions): Promise<AgentResponse> {
    const cfg = await this.getConfig();
    if (!cfg.endpoint) throw new AgentError('Agent endpoint is not configured (Agent tab or setting xplain.agent.endpoint).');

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: cfg.streaming ? 'application/x-ndjson, application/json' : 'application/json',
      ...cfg.headers,
    };
    if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;

    const timed = await fetchWithTimeout({ url: cfg.endpoint, headers, body: request, timeoutMs: cfg.timeoutMs, signal: options.signal });
    return timed.run(async (res) => {
      const contentType = res.headers.get('content-type') ?? '';
      if (contentType.includes('ndjson') || contentType.includes('text/event-stream')) {
        return asHtmlResult(await this.readStream(res, options, contentType.includes('event-stream')));
      }
      return asHtmlResult(parseJsonResponse(await res.text()));
    });
  }

  private async readStream(res: Response, options: AgentCallOptions, sse: boolean): Promise<AgentResponse> {
    let content = '';
    let title: string | undefined;
    let format: ResultFormat = 'markdown';
    let finalContent: string | undefined;

    const handle = (payload: string) => {
      const line = payload.trim();
      if (!line || line === '[DONE]') return;
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(line);
      } catch {
        // Tolerate plain-text streams.
        content += payload + '\n';
        options.onDelta?.(payload + '\n');
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

    if (sse) await readSse(res, (data) => handle(data));
    else await readLines(res, handle);

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
    // Be lenient: treat a non-JSON body as markdown/HTML source.
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
  const format: ResultFormat = obj.format === 'html' || typeof obj.html === 'string' ? 'html' : 'markdown';
  return { title: typeof obj.title === 'string' ? obj.title : undefined, format, content };
}

/** XPlain always stores results as self-contained HTML (converts Markdown when needed). */
function asHtmlResult(res: AgentResponse): AgentResponse {
  const html = ensureSelfContainedHtml(res.content, res.title ?? 'XPlain explanation');
  return { title: res.title ?? extractHtmlTitle(html), format: 'html', content: html };
}
