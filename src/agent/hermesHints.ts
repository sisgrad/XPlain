/**
 * Turns a failed Hermes connection into an actionable message. The most common
 * mistake is pointing XPlain at the Hermes *dashboard / gateway* (the URL Hermes
 * Desktop uses, default port 9119) instead of the OpenAI-compatible *API server*
 * (default port 8642), or at an API server that is bound to loopback only.
 */

export interface DashboardStatus {
  version?: string;
  authRequired?: boolean;
  /** `listener_base` of the api_server platform, e.g. "http://127.0.0.1:8642". */
  apiServerBase?: string;
  apiServerState?: string;
}

/** Origin (scheme://host:port) of a URL, or undefined when it does not parse. */
export function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/** Parse the JSON of Hermes' public `GET /api/status`. Returns undefined if it is not a Hermes dashboard. */
export function parseDashboardStatus(json: unknown): DashboardStatus | undefined {
  if (!json || typeof json !== 'object') return undefined;
  const j = json as Record<string, unknown>;
  const platforms = j.gateway_platforms as Record<string, Record<string, unknown>> | undefined;
  const api = platforms?.api_server;
  const looksLikeHermes = 'gateway_state' in j || 'auth_providers' in j || Boolean(api);
  if (!looksLikeHermes) return undefined;
  return {
    version: typeof j.version === 'string' ? j.version : undefined,
    authRequired: typeof j.auth_required === 'boolean' ? j.auth_required : undefined,
    apiServerBase: typeof api?.listener_base === 'string' ? api.listener_base : undefined,
    apiServerState: typeof api?.state === 'string' ? api.state : undefined,
  };
}

/** Fetch `GET {origin}/api/status`; undefined when unreachable or not a Hermes dashboard. */
export async function probeDashboard(baseUrl: string, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<DashboardStatus | undefined> {
  const origin = originOf(baseUrl);
  if (!origin) return undefined;
  try {
    const res = await fetchImpl(`${origin}/api/status`, { headers: { Accept: 'application/json' }, signal, redirect: 'manual' });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return undefined;
    return parseDashboardStatus(await res.json());
  } catch {
    return undefined;
  }
}

/** Human-readable explanation when `baseUrl` turned out to be a Hermes dashboard rather than its API server. */
export function describeDashboardMistake(baseUrl: string, status: DashboardStatus): string {
  const origin = originOf(baseUrl) ?? baseUrl;
  const lines: string[] = [
    `${origin} is the Hermes dashboard/gateway (the address Hermes Desktop uses), not the OpenAI-compatible API server XPlain needs.`,
  ];
  const host = (() => {
    try {
      return new URL(origin).hostname;
    } catch {
      return 'the Hermes host';
    }
  })();
  if (status.apiServerBase) {
    let port = '8642';
    let loopback = false;
    try {
      const u = new URL(status.apiServerBase);
      port = u.port || port;
      loopback = u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '::1';
    } catch {
      /* keep defaults */
    }
    lines.push(`Hermes reports its API server at ${status.apiServerBase} (${status.apiServerState ?? 'state unknown'}).`);
    if (loopback) {
      lines.push(
        `It listens on loopback only, so it is not reachable from other machines. On ${host} set API_SERVER_HOST=0.0.0.0 (and API_SERVER_KEY) in ~/.hermes/.env, restart the gateway, then use http://${host}:${port}/v1 here;` +
          ` or forward the port (ssh -L ${port}:127.0.0.1:${port} ${host}) and use http://127.0.0.1:${port}/v1.`,
      );
    } else {
      lines.push(`Use ${status.apiServerBase.replace(/\/$/, '')}/v1 as the Base URL and API_SERVER_KEY as the key.`);
    }
  } else {
    lines.push(
      `Enable it on ${host}: API_SERVER_ENABLED=true, API_SERVER_HOST=0.0.0.0, API_SERVER_KEY=... in ~/.hermes/.env, restart the gateway, then use http://${host}:8642/v1 here.`,
    );
  }
  return lines.join(' ');
}
