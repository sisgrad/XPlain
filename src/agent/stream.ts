/** Helpers shared by the HTTP providers: line-based reading of NDJSON / SSE bodies. */
import { AgentError } from './AgentProvider';

/** Calls `onLine` for every complete line of the response body (without the newline). */
export async function readLines(res: Response, onLine: (line: string) => void): Promise<void> {
  if (!res.body) throw new AgentError('Agent returned an empty stream.');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      onLine(buffer.slice(0, nl).replace(/\r$/, ''));
      buffer = buffer.slice(nl + 1);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) onLine(buffer);
}

/**
 * Reads a Server-Sent Events body and calls `onData` with each `data:` payload
 * (multi-line data fields are joined with '\n'). Comment lines (`: keepalive`)
 * and `event:`/`id:` fields are ignored except that the event name is passed along.
 */
export async function readSse(res: Response, onData: (data: string, event: string | undefined) => void): Promise<void> {
  let dataLines: string[] = [];
  let event: string | undefined;
  const flush = () => {
    if (dataLines.length) onData(dataLines.join('\n'), event);
    dataLines = [];
    event = undefined;
  };
  await readLines(res, (line) => {
    if (line === '') {
      flush();
      return;
    }
    if (line.startsWith(':')) return;
    const colon = line.indexOf(':');
    const field = colon >= 0 ? line.slice(0, colon) : line;
    let value = colon >= 0 ? line.slice(colon + 1) : '';
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') dataLines.push(value);
    else if (field === 'event') event = value;
  });
  flush();
}

export interface FetchOptions {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  timeoutMs: number;
  signal: AbortSignal;
  method?: 'POST' | 'GET';
}

export interface TimedResponse {
  res: Response;
  /** Run the body-reading work; cancellation and the overall timeout stay active until it settles. */
  run<T>(work: (res: Response) => Promise<T>): Promise<T>;
}

/**
 * fetch with an overall timeout + external cancellation, mapping failures to
 * AgentError. The timeout covers headers *and* body (use `run`).
 */
export async function fetchWithTimeout(opts: FetchOptions): Promise<TimedResponse> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  opts.signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  const release = () => {
    clearTimeout(timer);
    opts.signal.removeEventListener('abort', onAbort);
  };
  const mapError = (err: unknown): AgentError => {
    if (err instanceof AgentError) return err;
    if (opts.signal.aborted) return new AgentError('Cancelled.');
    if (controller.signal.aborted) return new AgentError(`Agent did not respond within ${opts.timeoutMs} ms.`);
    return new AgentError(`Cannot reach agent at ${opts.url}: ${(err as Error).message}`);
  };
  let res: Response;
  try {
    res = await fetch(opts.url, {
      method: opts.method ?? 'POST',
      headers: opts.headers,
      body: opts.method === 'GET' ? undefined : JSON.stringify(opts.body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new AgentError(`Agent returned HTTP ${res.status}${text ? `: ${text.slice(0, 500)}` : ''}`, res.status);
    }
  } catch (err) {
    release();
    throw mapError(err);
  }
  return {
    res,
    async run(work) {
      try {
        return await work(res);
      } catch (err) {
        throw mapError(err);
      } finally {
        release();
      }
    },
  };
}

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}
