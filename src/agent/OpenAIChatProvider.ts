/**
 * OpenAI-compatible Chat Completions provider. Used for:
 *   - Hermes Agent API server (http://127.0.0.1:8642/v1, model "hermes-agent")
 *   - OpenAI / Codex models (https://api.openai.com/v1)
 *   - any other server implementing POST {baseUrl}/chat/completions (Ollama, vLLM, LiteLLM, ...)
 */
import { AgentError, type AgentCallOptions, type AgentProvider, type AgentRequest, type AgentResponse } from './AgentProvider';
import { ensureSelfContainedHtml, extractHtmlTitle } from './htmlResult';
import { buildChatPrompt } from './prompt';
import { fetchWithTimeout, joinUrl, readSse } from './stream';

export interface OpenAIChatConfig {
  baseUrl: string;
  model: string;
  /** `reasoning_effort` (none/minimal/low/medium/high/xhigh); empty = omit. */
  effort?: string;
  apiKey?: string;
  timeoutMs: number;
  streaming: boolean;
  headers: Record<string, string>;
  systemPrompt?: string;
  /** Extra JSON fields merged into the request body (e.g. Hermes `provider`). */
  extraBody?: Record<string, unknown>;
}

export class OpenAIChatProvider implements AgentProvider {
  constructor(
    readonly id: string,
    readonly label: string,
    private readonly getConfig: () => Promise<OpenAIChatConfig>,
  ) {}

  async explain(request: AgentRequest, options: AgentCallOptions): Promise<AgentResponse> {
    const cfg = await this.getConfig();
    if (!cfg.baseUrl) throw new AgentError(`${this.label}: base URL is not configured.`);
    if (!cfg.model) throw new AgentError(`${this.label}: model is not configured.`);
    const prompt = buildChatPrompt(request, request.systemPrompt ?? cfg.systemPrompt);
    const body: Record<string, unknown> = {
      model: cfg.model,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      stream: cfg.streaming,
      ...(cfg.effort?.trim() ? { reasoning_effort: cfg.effort.trim() } : {}),
      ...(cfg.extraBody ?? {}),
    };
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: cfg.streaming ? 'text/event-stream' : 'application/json',
      ...cfg.headers,
    };
    if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;

    const timed = await fetchWithTimeout({
      url: joinUrl(cfg.baseUrl, 'chat/completions'),
      headers,
      body,
      timeoutMs: cfg.timeoutMs,
      signal: options.signal,
    });

    const content = await timed.run(async (res) => {
      const type = res.headers.get('content-type') ?? '';
      if (type.includes('text/event-stream')) {
        let text = '';
        await readSse(res, (data, event) => {
          if (data === '[DONE]') return;
          if (event && event !== 'message' && !event.startsWith('chat.')) return; // e.g. hermes.tool.progress
          let ev: Record<string, unknown>;
          try {
            ev = JSON.parse(data);
          } catch {
            return;
          }
          if (ev.error) throw new AgentError(describeError(ev.error));
          const choices = ev.choices as Array<Record<string, unknown>> | undefined;
          const delta = choices?.[0]?.delta as Record<string, unknown> | undefined;
          const piece = typeof delta?.content === 'string' ? delta.content : '';
          if (piece) {
            text += piece;
            options.onDelta?.(piece);
          }
        });
        return text;
      }
      const json = (await res.json()) as Record<string, unknown>;
      if (json.error) throw new AgentError(describeError(json.error));
      const choices = json.choices as Array<Record<string, unknown>> | undefined;
      const message = choices?.[0]?.message as Record<string, unknown> | undefined;
      const text = typeof message?.content === 'string' ? message.content : '';
      if (!text) throw new AgentError(`${this.label}: response has no message content.`);
      return text;
    });

    if (!content.trim()) throw new AgentError(`${this.label}: empty answer.`);
    const html = ensureSelfContainedHtml(content);
    return { title: extractHtmlTitle(html), format: 'html', content: html };
  }
}

/** GET {baseUrl}/models → model ids (used by "Test connection"). */
export async function listOpenAIModels(cfg: Pick<OpenAIChatConfig, 'baseUrl' | 'apiKey' | 'headers' | 'timeoutMs'>, signal: AbortSignal): Promise<string[]> {
  const headers: Record<string, string> = { Accept: 'application/json', ...cfg.headers };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  const timed = await fetchWithTimeout({ url: joinUrl(cfg.baseUrl, 'models'), headers, body: undefined, timeoutMs: cfg.timeoutMs, signal, method: 'GET' });
  return timed.run(async (res) => {
    const json = (await res.json()) as { data?: Array<{ id?: string }> };
    return (json.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string').sort();
  });
}

function describeError(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return 'Agent reported an error.';
}
