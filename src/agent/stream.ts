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
  /**
   * Idle timeout in milliseconds: time allowed with no activity.
   * Applies to waiting for response headers (TTFB) and, once the body starts,
   * resets whenever any body bytes arrive (SSE keepalives, tool-progress events,
   * content deltas). Aborting cancels the HTTP request on the agent side too.
   */
  timeoutMs: number;
  signal: AbortSignal;
  method?: 'POST' | 'GET';
}

export interface TimedResponse {
  res: Response;
  /** Run the body-reading work; idle timeout stays armed and resets on body data. */
  run<T>(work: (res: Response) => Promise<T>): Promise<T>;
}

/**
 * fetch with an *idle* timeout + external cancellation, mapping failures to
 * AgentError. The timeout is the maximum silence (no headers yet, or no body
 * bytes); any received chunk restarts it. Use `run` so the body is wrapped.
 */
export async function fetchWithTimeout(opts: FetchOptions): Promise<TimedResponse> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  opts.signal.addEventListener('abort', onAbort, { once: true });

  let timer: ReturnType<typeof setTimeout> | undefined;
  let phase: 'headers' | 'body' = 'headers';
  const arm = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  };
  const release = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    opts.signal.removeEventListener('abort', onAbort);
  };
  const mapError = (err: unknown): AgentError => {
    if (err instanceof AgentError) return err;
    if (opts.signal.aborted) return new AgentError('Cancelled.');
    if (controller.signal.aborted) {
      return new AgentError(
        phase === 'headers'
          ? `Agent did not respond within ${opts.timeoutMs} ms.`
          : `Agent went idle for ${opts.timeoutMs} ms (no data). The request was aborted — if the agent was still working (e.g. Hermes tools / GPU), increase xplain.agent.timeoutMs. Idle timeout resets on every received chunk, including keepalives.`,
      );
    }
    return new AgentError(`Cannot reach agent at ${opts.url}: ${(err as Error).message}`);
  };

  arm();
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

  phase = 'body';
  arm();
  const tracked = withActivityBump(res, arm);

  return {
    res: tracked,
    async run(work) {
      try {
        return await work(tracked);
      } catch (err) {
        throw mapError(err);
      } finally {
        release();
      }
    },
  };
}

/** Re-wrap a Response so every body chunk notifies `onActivity` (idle-timeout bump). */
export function withActivityBump(res: Response, onActivity: () => void): Response {
  if (!res.body) return res;
  const reader = res.body.getReader();
  const stream = new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      const { value, done } = await reader.read();
      if (done) {
        ctrl.close();
        return;
      }
      onActivity();
      ctrl.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return new Response(stream, { status: res.status, statusText: res.statusText, headers: res.headers });
}

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}
