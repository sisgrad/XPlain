/** Anthropic Messages API provider (Claude). POST {baseUrl}/v1/messages */
import { AgentError, type AgentCallOptions, type AgentProvider, type AgentRequest, type AgentResponse } from './AgentProvider';
import { ensureSelfContainedHtml, extractHtmlTitle } from './htmlResult';
import { buildChatPrompt } from './prompt';
import { fetchWithTimeout, joinUrl, readSse } from './stream';

export const ANTHROPIC_VERSION = '2023-06-01';

export interface AnthropicConfig {
  baseUrl: string;
  model: string;
  maxTokens: number;
  apiKey?: string;
  timeoutMs: number;
  streaming: boolean;
  headers: Record<string, string>;
  systemPrompt?: string;
}

export class AnthropicProvider implements AgentProvider {
  readonly id = 'anthropic';
  readonly label = 'Anthropic (Claude)';

  constructor(private readonly getConfig: () => Promise<AnthropicConfig>) {}

  async explain(request: AgentRequest, options: AgentCallOptions): Promise<AgentResponse> {
    const cfg = await this.getConfig();
    if (!cfg.baseUrl) throw new AgentError('Anthropic: base URL is not configured.');
    if (!cfg.model) throw new AgentError('Anthropic: model is not configured.');
    if (!cfg.apiKey) throw new AgentError('Anthropic: API key is not set (Agent tab → API key).');
    const prompt = buildChatPrompt(request, request.systemPrompt ?? cfg.systemPrompt);
    const body = {
      model: cfg.model,
      max_tokens: cfg.maxTokens,
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }],
      stream: cfg.streaming,
    };
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: cfg.streaming ? 'text/event-stream' : 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      ...cfg.headers,
    };

    const timed = await fetchWithTimeout({
      url: joinUrl(cfg.baseUrl, 'v1/messages'),
      headers,
      body,
      timeoutMs: cfg.timeoutMs,
      signal: options.signal,
    });

    const content = await timed.run(async (res) => {
      const type = res.headers.get('content-type') ?? '';
      if (type.includes('text/event-stream')) {
        let text = '';
        await readSse(res, (data) => {
          let ev: Record<string, unknown>;
          try {
            ev = JSON.parse(data);
          } catch {
            return;
          }
          if (ev.type === 'error') throw new AgentError(describeError(ev.error));
          if (ev.type === 'content_block_delta') {
            const delta = ev.delta as Record<string, unknown> | undefined;
            if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
              text += delta.text;
              options.onDelta?.(delta.text);
            }
          }
        });
        return text;
      }
      const json = (await res.json()) as Record<string, unknown>;
      if (json.type === 'error') throw new AgentError(describeError(json.error));
      const blocks = (json.content as Array<Record<string, unknown>> | undefined) ?? [];
      return blocks
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text as string)
        .join('');
    });

    if (!content.trim()) throw new AgentError('Anthropic: empty answer.');
    const html = ensureSelfContainedHtml(content);
    return { title: extractHtmlTitle(html), format: 'html', content: html };
  }
}

/** GET {baseUrl}/v1/models → model ids. */
export async function listAnthropicModels(cfg: Pick<AnthropicConfig, 'baseUrl' | 'apiKey' | 'headers' | 'timeoutMs'>, signal: AbortSignal): Promise<string[]> {
  if (!cfg.apiKey) throw new AgentError('Anthropic: API key is not set.');
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'x-api-key': cfg.apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
    ...cfg.headers,
  };
  const timed = await fetchWithTimeout({ url: joinUrl(cfg.baseUrl, 'v1/models?limit=100'), headers, body: undefined, timeoutMs: cfg.timeoutMs, signal, method: 'GET' });
  return timed.run(async (res) => {
    const json = (await res.json()) as { data?: Array<{ id?: string }> };
    return (json.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string').sort();
  });
}

function describeError(err: unknown): string {
  if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return 'Anthropic reported an error.';
}
