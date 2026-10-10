/**
 * Reads/writes agent settings (VS Code configuration + SecretStorage), builds
 * the configured provider and runs connection tests.
 */
import * as vscode from 'vscode';
import {
  AGENT_PROVIDER_IDS,
  type AgentModelsResult,
  type AgentProviderId,
  type AgentSettings,
  type AgentSettingsView,
  type AgentTestResult,
  type SettingsTarget,
} from '../shared/types';
import { AgentError, type AgentProvider } from './AgentProvider';
import { AnthropicProvider, listAnthropicModels } from './AnthropicProvider';
import { describeDashboardMistake, originOf, probeDashboard } from './hermesHints';
import { HttpAgentProvider } from './HttpAgentProvider';
import { MockAgentProvider } from './MockAgentProvider';
import { listOpenAIModels, OpenAIChatProvider } from './OpenAIChatProvider';

const SECTION = 'xplain.agent';
const LEGACY_SECRET = 'xplain.agent.apiKey';

export const PROVIDER_LABELS: Record<AgentProviderId, string> = {
  xplain: 'XPlain HTTP agent',
  hermes: 'Hermes Agent',
  openai: 'OpenAI / Codex',
  anthropic: 'Anthropic (Claude)',
  mock: 'Mock (offline)',
};

export const DEFAULT_SETTINGS: AgentSettings = {
  provider: 'xplain',
  endpoint: 'http://127.0.0.1:8765/explain',
  timeoutMs: 180000,
  streaming: true,
  headers: {},
  systemPrompt: '',
  hermes: { baseUrl: 'http://127.0.0.1:8642/v1', model: 'hermes-agent' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'chat-latest' },
  anthropic: { baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-5', maxTokens: 8192 },
};

export function normalizeProviderId(value: unknown): AgentProviderId {
  if (value === 'http') return 'xplain'; // pre-0.2 name
  return AGENT_PROVIDER_IDS.includes(value as AgentProviderId) ? (value as AgentProviderId) : 'xplain';
}

export class AgentRegistry {
  constructor(private readonly context: vscode.ExtensionContext) {}

  /* ------------------------------------------------------------- settings */

  read(): AgentSettings {
    const cfg = vscode.workspace.getConfiguration(SECTION);
    const d = DEFAULT_SETTINGS;
    return {
      provider: normalizeProviderId(cfg.get<string>('provider', d.provider)),
      endpoint: cfg.get<string>('endpoint', d.endpoint),
      timeoutMs: cfg.get<number>('timeoutMs', d.timeoutMs),
      streaming: cfg.get<boolean>('streaming', d.streaming),
      headers: cfg.get<Record<string, string>>('headers', {}) ?? {},
      systemPrompt: cfg.get<string>('systemPrompt', ''),
      hermes: {
        baseUrl: cfg.get<string>('hermes.baseUrl', d.hermes.baseUrl),
        model: cfg.get<string>('hermes.model', d.hermes.model),
      },
      openai: {
        baseUrl: cfg.get<string>('openai.baseUrl', d.openai.baseUrl),
        model: cfg.get<string>('openai.model', d.openai.model),
      },
      anthropic: {
        baseUrl: cfg.get<string>('anthropic.baseUrl', d.anthropic.baseUrl),
        model: cfg.get<string>('anthropic.model', d.anthropic.model),
        maxTokens: cfg.get<number>('anthropic.maxTokens', d.anthropic.maxTokens),
      },
    };
  }

  async view(): Promise<AgentSettingsView> {
    const settings = this.read();
    const hasKey = {} as Record<AgentProviderId, boolean>;
    for (const id of AGENT_PROVIDER_IDS) hasKey[id] = Boolean(await this.getKey(id));
    const inspected = vscode.workspace.getConfiguration(SECTION).inspect<string>('provider');
    const target: SettingsTarget = inspected?.workspaceValue !== undefined || inspected?.workspaceFolderValue !== undefined ? 'workspace' : 'global';
    return { ...settings, hasKey, target, hasWorkspace: Boolean(vscode.workspace.workspaceFolders?.length) };
  }

  async save(settings: AgentSettings, target: SettingsTarget): Promise<void> {
    const cfg = vscode.workspace.getConfiguration(SECTION);
    const t = target === 'workspace' && vscode.workspace.workspaceFolders?.length ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
    const d = DEFAULT_SETTINGS;
    const entries: Array<[string, unknown, unknown]> = [
      ['provider', settings.provider, d.provider],
      ['endpoint', settings.endpoint.trim(), d.endpoint],
      ['timeoutMs', clampInt(settings.timeoutMs, 1000, 3_600_000, d.timeoutMs), d.timeoutMs],
      ['streaming', Boolean(settings.streaming), d.streaming],
      ['headers', sanitizeHeaders(settings.headers), {}],
      ['systemPrompt', settings.systemPrompt ?? '', ''],
      ['hermes.baseUrl', settings.hermes.baseUrl.trim(), d.hermes.baseUrl],
      ['hermes.model', settings.hermes.model.trim(), d.hermes.model],
      ['openai.baseUrl', settings.openai.baseUrl.trim(), d.openai.baseUrl],
      ['openai.model', settings.openai.model.trim(), d.openai.model],
      ['anthropic.baseUrl', settings.anthropic.baseUrl.trim(), d.anthropic.baseUrl],
      ['anthropic.model', settings.anthropic.model.trim(), d.anthropic.model],
      ['anthropic.maxTokens', clampInt(settings.anthropic.maxTokens, 256, 200_000, d.anthropic.maxTokens), d.anthropic.maxTokens],
    ];
    for (const [key, value, def] of entries) {
      // Writing the default removes the explicit entry to keep settings.json tidy,
      // except for `provider`, which we always pin so the target is unambiguous.
      const same = JSON.stringify(value) === JSON.stringify(def) && key !== 'provider';
      await cfg.update(key, same ? undefined : value, t);
    }
    if (target === 'workspace') {
      // Make sure a stale global value does not shadow anything confusing.
      return;
    }
    // Saving globally: clear workspace overrides so the global values take effect.
    if (vscode.workspace.workspaceFolders?.length) {
      for (const [key] of entries) {
        const info = cfg.inspect(key);
        if (info?.workspaceValue !== undefined) await cfg.update(key, undefined, vscode.ConfigurationTarget.Workspace);
      }
    }
  }

  /* -------------------------------------------------------------- secrets */

  private secretName(provider: AgentProviderId): string {
    return `xplain.agent.apiKey.${provider}`;
  }

  async getKey(provider: AgentProviderId): Promise<string | undefined> {
    const key = await this.context.secrets.get(this.secretName(provider));
    if (key) return key;
    if (provider === 'xplain') return this.context.secrets.get(LEGACY_SECRET); // migrated name
    return undefined;
  }

  async setKey(provider: AgentProviderId, key: string): Promise<void> {
    const value = key.trim();
    if (value) await this.context.secrets.store(this.secretName(provider), value);
    else await this.clearKey(provider);
  }

  async clearKey(provider: AgentProviderId): Promise<void> {
    await this.context.secrets.delete(this.secretName(provider));
    if (provider === 'xplain') await this.context.secrets.delete(LEGACY_SECRET);
  }

  /* ------------------------------------------------------------ providers */

  provider(settings: AgentSettings = this.read()): AgentProvider {
    switch (settings.provider) {
      case 'mock':
        return new MockAgentProvider();
      case 'hermes':
        return new OpenAIChatProvider('hermes', PROVIDER_LABELS.hermes, async () => ({
          ...settings.hermes,
          apiKey: await this.getKey('hermes'),
          timeoutMs: settings.timeoutMs,
          streaming: settings.streaming,
          headers: settings.headers,
          systemPrompt: settings.systemPrompt,
        }));
      case 'openai':
        return new OpenAIChatProvider('openai', PROVIDER_LABELS.openai, async () => ({
          ...settings.openai,
          apiKey: await this.getKey('openai'),
          timeoutMs: settings.timeoutMs,
          streaming: settings.streaming,
          headers: settings.headers,
          systemPrompt: settings.systemPrompt,
        }));
      case 'anthropic':
        return new AnthropicProvider(async () => ({
          ...settings.anthropic,
          apiKey: await this.getKey('anthropic'),
          timeoutMs: settings.timeoutMs,
          streaming: settings.streaming,
          headers: settings.headers,
          systemPrompt: settings.systemPrompt,
        }));
      case 'xplain':
      default:
        return new HttpAgentProvider(async () => ({
          endpoint: settings.endpoint,
          timeoutMs: settings.timeoutMs,
          streaming: settings.streaming,
          headers: settings.headers,
          apiKey: await this.getKey('xplain'),
        }));
    }
  }

  /** Short description for the panel footer, e.g. "Hermes Agent · hermes-agent". */
  label(settings: AgentSettings = this.read()): string {
    switch (settings.provider) {
      case 'hermes':
        return `${PROVIDER_LABELS.hermes} · ${settings.hermes.model || 'model not set'}`;
      case 'openai':
        return `${PROVIDER_LABELS.openai} · ${settings.openai.model || 'model not set'}`;
      case 'anthropic':
        return `${PROVIDER_LABELS.anthropic} · ${settings.anthropic.model || 'model not set'}`;
      case 'mock':
        return PROVIDER_LABELS.mock;
      default:
        return settings.endpoint ? `XPlain agent · ${settings.endpoint}` : 'XPlain agent · endpoint not set';
    }
  }

  /* --------------------------------------------------------------- models */

  /** Ask the provider's server which models it offers (hermes/openai/anthropic only). */
  async listModels(settings: AgentSettings, requestId = 0): Promise<AgentModelsResult> {
    const provider = settings.provider;
    const timeoutMs = Math.min(settings.timeoutMs, 15_000);
    const signal = AbortSignal.timeout(timeoutMs);
    const base = { requestId, provider, models: [] as string[] };
    if (provider !== 'hermes' && provider !== 'openai' && provider !== 'anthropic') {
      return { ...base, baseUrl: '', error: 'This provider has no model list.' };
    }
    const baseUrl = settings[provider].baseUrl.trim();
    if (!baseUrl) return { ...base, baseUrl, error: 'Base URL is empty.' };
    try {
      const cfg = { baseUrl, apiKey: await this.getKey(provider), headers: settings.headers, timeoutMs };
      const models = provider === 'anthropic' ? await listAnthropicModels(cfg, signal) : await listOpenAIModels(cfg, signal);
      return { ...base, baseUrl, models };
    } catch (err) {
      let error = err instanceof Error ? err.message : String(err);
      if (provider === 'hermes') error = await this.explainHermesFailure(baseUrl, error);
      return { ...base, baseUrl, error };
    }
  }

  /**
   * When the Hermes API server does not answer, check whether the URL is actually
   * the Hermes dashboard (what Hermes Desktop connects to) and say so.
   */
  private async explainHermesFailure(baseUrl: string, error: string): Promise<string> {
    const status = await probeDashboard(baseUrl, AbortSignal.timeout(5_000));
    if (status) return describeDashboardMistake(baseUrl, status);
    // Not a dashboard. If the API server port refused the connection, the dashboard might still
    // tell us where the API server listens; try the default dashboard port on the same host.
    if (/Cannot reach|ECONNREFUSED|fetch failed/i.test(error)) {
      const origin = originOf(baseUrl);
      if (origin) {
        try {
          const host = new URL(origin).hostname;
          for (const port of [9119, 9120]) {
            const s = await probeDashboard(`http://${host}:${port}`, AbortSignal.timeout(3_000));
            if (s?.apiServerBase) {
              return `${error} Hermes on ${host} reports its API server at ${s.apiServerBase} (${s.apiServerState ?? 'state unknown'}); if that is a loopback address, set API_SERVER_HOST=0.0.0.0 in ~/.hermes/.env on ${host} and restart the gateway, or forward the port over SSH.`;
            }
          }
        } catch {
          /* ignore */
        }
      }
    }
    return error;
  }

  /* ----------------------------------------------------------------- test */

  async test(settings: AgentSettings): Promise<AgentTestResult> {
    const timeoutMs = Math.min(settings.timeoutMs, 20_000);
    const signal = AbortSignal.timeout(timeoutMs);
    const provider = settings.provider;
    try {
      switch (provider) {
        case 'mock':
          return { provider, ok: true, message: 'Mock provider is always available.' };
        case 'hermes':
        case 'openai':
        case 'anthropic': {
          const s = settings[provider];
          const list = await this.listModels(settings);
          if (list.error) throw new AgentError(list.error);
          const models = list.models;
          const has = models.includes(s.model);
          const note = !s.model
            ? ' Pick a model from the list.'
            : has
              ? ` "${s.model}" is available.`
              : ` Note: "${s.model}" is not in the list (may still work).`;
          return { provider, ok: true, models, message: `Connected to ${s.baseUrl}: ${models.length} model(s).${note}` };
        }
        case 'xplain':
        default: {
          if (!settings.endpoint) throw new AgentError('Endpoint is empty.');
          // The XPlain contract has no discovery endpoint; probe with an empty, harmless request.
          const p = this.provider({ ...settings, timeoutMs });
          const res = await p.explain({ sessionId: 'xplain-test', question: 'ping (connection test from XPlain; reply briefly)', items: [] }, { signal });
          return { provider, ok: true, message: `Agent answered (${res.format}, ${res.content.length} chars).` };
        }
      }
    } catch (err) {
      return { provider, ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }
}

function clampInt(v: unknown, lo: number, hi: number, def: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.round(Math.min(hi, Math.max(lo, n)));
}

function sanitizeHeaders(h: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (h && typeof h === 'object') {
    for (const [k, v] of Object.entries(h as Record<string, unknown>)) {
      const key = k.trim();
      if (key && typeof v === 'string') out[key] = v;
    }
  }
  return out;
}
