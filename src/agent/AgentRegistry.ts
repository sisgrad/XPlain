/**
 * Reads/writes agent settings (VS Code configuration + SecretStorage), builds
 * the configured provider and runs connection tests.
 */
import * as vscode from 'vscode';
import {
  AGENT_PROVIDER_IDS,
  SUBSCRIPTION_HARNESS,
  type SubscriptionProviderId,
  type AgentModelsResult,
  type AgentProviderId,
  type AgentSettings,
  type AgentSettingsView,
  type AgentTestResult,
  type SettingsTarget,
} from '../shared/types';
import { AgentError, type AgentProvider } from './AgentProvider';
import { AnthropicProvider, listAnthropicModels } from './AnthropicProvider';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ClaudexorProvider,
  claudexorWorkDir,
  harnessStatus,
  HARNESS_LABELS,
  listHarnessModels,
  privateProjectDir,
  type ClaudexorConfig,
} from './ClaudexorProvider';
import { CursorSdkProvider, cursorSdkStoreDir, listCursorModels } from './CursorSdkProvider';
import { describeDashboardMistake, originOf, probeDashboard } from './hermesHints';
import { HttpAgentProvider } from './HttpAgentProvider';
import { MockAgentProvider } from './MockAgentProvider';
import { listOpenAIModels, OpenAIChatProvider } from './OpenAIChatProvider';

const SECTION = 'xplain.agent';
const LEGACY_SECRET = 'xplain.agent.apiKey';

/** Sentinel "base URL" for AgentModelsResult matching (Cursor has no HTTP base). */
export const CURSOR_MODELS_BASE = 'cursor://sdk';
/** Sentinel "base URL" for subscription providers (Claudexor CLI, no HTTP base). */
export const CLAUDEXOR_MODELS_BASE = 'claudexor://';

export const PROVIDER_LABELS: Record<AgentProviderId, string> = {
  xplain: 'XPlain HTTP agent',
  hermes: 'Hermes Agent',
  openai: 'OpenAI / Codex (API)',
  anthropic: 'Anthropic / Claude (API)',
  openaiSubscription: 'OpenAI / Codex (Subscription)',
  anthropicSubscription: 'Anthropic / Claude (Subscription)',
  cursor: 'Cursor SDK',
  mock: 'Mock (offline)',
};

export function isSubscriptionProvider(id: AgentProviderId): id is SubscriptionProviderId {
  return id === 'openaiSubscription' || id === 'anthropicSubscription';
}

export const DEFAULT_SETTINGS: AgentSettings = {
  provider: 'xplain',
  endpoint: 'http://127.0.0.1:8765/explain',
  timeoutMinutes: 10,
  streaming: true,
  headers: {},
  systemPrompt: '',
  hermes: { baseUrl: 'http://127.0.0.1:8642/v1', model: 'hermes-agent' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'chat-latest', effort: '' },
  anthropic: { baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-5', maxTokens: 8192, effort: '' },
  openaiSubscription: { model: '', effort: '' },
  anthropicSubscription: { model: '', effort: '' },
  cursor: { model: 'composer-2.5', effort: '' },
  claudexor: { cliPath: '', nodePath: '', mode: 'auto', project: 'auto', autoInstallNode: true, nodeVersion: '' },
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
      timeoutMinutes: readTimeoutMinutes(cfg, d.timeoutMinutes),
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
        effort: cfg.get<string>('openai.effort', ''),
      },
      anthropic: {
        baseUrl: cfg.get<string>('anthropic.baseUrl', d.anthropic.baseUrl),
        model: cfg.get<string>('anthropic.model', d.anthropic.model),
        maxTokens: cfg.get<number>('anthropic.maxTokens', d.anthropic.maxTokens),
        effort: cfg.get<string>('anthropic.effort', ''),
      },
      openaiSubscription: { model: cfg.get<string>('openaiSubscription.model', ''), effort: cfg.get<string>('openaiSubscription.effort', '') },
      anthropicSubscription: { model: cfg.get<string>('anthropicSubscription.model', ''), effort: cfg.get<string>('anthropicSubscription.effort', '') },
      cursor: {
        model: cfg.get<string>('cursor.model', d.cursor.model),
        effort: cfg.get<string>('cursor.effort', ''),
      },
      claudexor: {
        cliPath: cfg.get<string>('claudexor.cliPath', ''),
        nodePath: cfg.get<string>('claudexor.nodePath', ''),
        mode: oneOf(cfg.get<string>('claudexor.mode'), ['auto', 'ask', 'agent'] as const, 'auto'),
        project: oneOf(cfg.get<string>('claudexor.project'), ['auto', 'workspace', 'private'] as const, 'auto'),
        autoInstallNode: cfg.get<boolean>('claudexor.autoInstallNode', true),
        nodeVersion: cfg.get<string>('claudexor.nodeVersion', ''),
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
      ['timeoutMinutes', clampInt(settings.timeoutMinutes, 1, 180, d.timeoutMinutes), d.timeoutMinutes],
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
      ['cursor.model', settings.cursor.model.trim(), d.cursor.model],
      ['openaiSubscription.model', settings.openaiSubscription.model.trim(), ''],
      ['anthropicSubscription.model', settings.anthropicSubscription.model.trim(), ''],
      ['openai.effort', settings.openai.effort.trim(), ''],
      ['anthropic.effort', settings.anthropic.effort.trim(), ''],
      ['openaiSubscription.effort', settings.openaiSubscription.effort.trim(), ''],
      ['anthropicSubscription.effort', settings.anthropicSubscription.effort.trim(), ''],
      ['cursor.effort', settings.cursor.effort.trim(), ''],
      ['claudexor.cliPath', settings.claudexor.cliPath.trim(), ''],
      ['claudexor.nodePath', settings.claudexor.nodePath.trim(), ''],
      ['claudexor.mode', settings.claudexor.mode, 'auto'],
      ['claudexor.project', settings.claudexor.project, 'auto'],
      ['claudexor.autoInstallNode', Boolean(settings.claudexor.autoInstallNode), true],
      ['claudexor.nodeVersion', settings.claudexor.nodeVersion.trim(), ''],
    ];
    for (const [key, value, def] of entries) {
      // Writing the default removes the explicit entry to keep settings.json tidy,
      // except for `provider`, which we always pin so the target is unambiguous.
      const same = JSON.stringify(value) === JSON.stringify(def) && key !== 'provider';
      await cfg.update(key, same ? undefined : value, t);
    }
    // Drop the pre-minutes setting wherever it was stored.
    await cfg.update('timeoutMs', undefined, t);
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
      if (cfg.inspect('timeoutMs')?.workspaceValue !== undefined) {
        await cfg.update('timeoutMs', undefined, vscode.ConfigurationTarget.Workspace);
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
          timeoutMs: minutesToMs(settings.timeoutMinutes),
          streaming: settings.streaming,
          headers: settings.headers,
          systemPrompt: settings.systemPrompt,
        }));
      case 'openai':
        return new OpenAIChatProvider('openai', PROVIDER_LABELS.openai, async () => ({
          ...settings.openai,
          apiKey: await this.getKey('openai'),
          timeoutMs: minutesToMs(settings.timeoutMinutes),
          streaming: settings.streaming,
          headers: settings.headers,
          systemPrompt: settings.systemPrompt,
        }));
      case 'anthropic':
        return new AnthropicProvider(async () => ({
          ...settings.anthropic,
          apiKey: await this.getKey('anthropic'),
          timeoutMs: minutesToMs(settings.timeoutMinutes),
          streaming: settings.streaming,
          headers: settings.headers,
          systemPrompt: settings.systemPrompt,
        }));
      case 'openaiSubscription':
      case 'anthropicSubscription': {
        const id = settings.provider;
        return new ClaudexorProvider(id, PROVIDER_LABELS[id], async () => this.claudexorConfig(settings, id));
      }
      case 'cursor':
        return new CursorSdkProvider(async () => {
          const cfg = vscode.workspace.getConfiguration('xplain.agent');
          return {
            model: settings.cursor.model,
            effort: settings.cursor.effort,
            apiKey: await this.getKey('cursor'),
            systemPrompt: settings.systemPrompt,
            cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '',
            storeDir: cursorSdkStoreDir(this.context.globalStorageUri.fsPath),
            streaming: settings.streaming,
            // Load project .cursor/ layer so runtime skill bridges under .cursor/skills are visible.
            loadProjectSettings: true,
            // Off by default: Remote-SSH often has no usable Landlock sandbox.
            useSandbox: cfg.get<boolean>('cursor.useSandbox', false),
            onLog: (message) => {
              /* best-effort; controller Output channel is not wired here */
              console.info(`[xplain] ${message}`);
            },
          };
        });
      case 'xplain':
      default:
        return new HttpAgentProvider(async () => ({
          endpoint: settings.endpoint,
          timeoutMs: minutesToMs(settings.timeoutMinutes),
          streaming: settings.streaming,
          headers: settings.headers,
          apiKey: await this.getKey('xplain'),
        }));
    }
  }

  /** Settings for a Claudexor-backed subscription provider. */
  claudexorConfig(settings: AgentSettings, id: SubscriptionProviderId): ClaudexorConfig {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const globalStorage = this.context.globalStorageUri.fsPath;
    const pref = settings.claudexor.project;
    // `auto`: run in the workspace only when it is already a git repo — Claudexor
    // git-inits (and baseline-commits) non-git project folders, which we never do to a user's tree.
    const isGit = Boolean(workspaceRoot && fs.existsSync(path.join(workspaceRoot, '.git')));
    const useWorkspace = Boolean(workspaceRoot) && (pref === 'workspace' || (pref === 'auto' && isGit));
    return {
      harness: SUBSCRIPTION_HARNESS[id],
      model: settings[id].model,
      effort: settings[id].effort,
      cliPath: settings.claudexor.cliPath,
      nodePath: settings.claudexor.nodePath,
      extensionPath: this.context.extensionPath,
      globalStoragePath: globalStorage,
      autoInstallNode: settings.claudexor.autoInstallNode,
      nodeVersion: settings.claudexor.nodeVersion.trim() || undefined,
      onProgress: (m) => {
        this.log(`[node] ${m}`);
        vscode.window.setStatusBarMessage(`$(cloud-download) XPlain: ${m}`, 8_000);
      },
      workDir: claudexorWorkDir(globalStorage),
      mode: settings.claudexor.mode,
      projectDir: useWorkspace ? workspaceRoot! : privateProjectDir(globalStorage, workspaceRoot),
      workspaceRoot,
      timeoutMs: minutesToMs(settings.timeoutMinutes),
      streaming: settings.streaming,
      systemPrompt: settings.systemPrompt,
      onLog: this.log,
    };
  }

  /** Optional sink for provider diagnostics (wired to the Output channel by the controller). */
  log: (message: string) => void = (m) => console.info(`[xplain] ${m}`);

  /** Short description for the panel footer, e.g. "Hermes Agent · hermes-agent". */
  label(settings: AgentSettings = this.read()): string {
    switch (settings.provider) {
      case 'hermes':
        return `${PROVIDER_LABELS.hermes} · ${settings.hermes.model || 'model not set'}`;
      case 'openai':
        return `${PROVIDER_LABELS.openai} · ${settings.openai.model || 'model not set'}`;
      case 'anthropic':
        return `${PROVIDER_LABELS.anthropic} · ${settings.anthropic.model || 'model not set'}`;
      case 'openaiSubscription':
      case 'anthropicSubscription':
        return `${PROVIDER_LABELS[settings.provider]} · ${settings[settings.provider].model || 'default model'}`;
      case 'cursor':
        return `${PROVIDER_LABELS.cursor} · ${settings.cursor.model || 'model not set'}`;
      case 'mock':
        return PROVIDER_LABELS.mock;
      default:
        return settings.endpoint ? `XPlain agent · ${settings.endpoint}` : 'XPlain agent · endpoint not set';
    }
  }

  /* --------------------------------------------------------------- models */

  /** Ask the provider which models it offers (hermes/openai/anthropic/cursor). */
  async listModels(settings: AgentSettings, requestId = 0): Promise<AgentModelsResult> {
    const provider = settings.provider;
    const timeoutMs = Math.min(minutesToMs(settings.timeoutMinutes), 15_000);
    const signal = AbortSignal.timeout(timeoutMs);
    const base = { requestId, provider, models: [] as string[] };
    if (provider === 'cursor') {
      try {
        const { models, efforts } = await listCursorModels(await this.getKey('cursor'), signal);
        return { ...base, baseUrl: CURSOR_MODELS_BASE, models, efforts };
      } catch (err) {
        return { ...base, baseUrl: CURSOR_MODELS_BASE, error: err instanceof Error ? err.message : String(err) };
      }
    }
    if (isSubscriptionProvider(provider)) {
      try {
        const models = await listHarnessModels(this.claudexorConfig(settings, provider), SUBSCRIPTION_HARNESS[provider], AbortSignal.timeout(60_000));
        return { ...base, baseUrl: CLAUDEXOR_MODELS_BASE, models };
      } catch (err) {
        return { ...base, baseUrl: CLAUDEXOR_MODELS_BASE, error: err instanceof Error ? err.message : String(err) };
      }
    }
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
    const timeoutMs = Math.min(minutesToMs(settings.timeoutMinutes), 20_000);
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
        case 'openaiSubscription':
        case 'anthropicSubscription': {
          const harness = SUBSCRIPTION_HARNESS[provider];
          const st = await harnessStatus(this.claudexorConfig(settings, provider), harness, AbortSignal.timeout(60_000));
          const label = HARNESS_LABELS[harness];
          if (!st.available) {
            const hint = !st.installed
              ? ` Install it: XPlain → Agent → "Install ${harness} CLI" (runs claudexor harness install ${harness}).`
              : st.loggedIn === false
                ? ` Log in: XPlain → Agent → "Log in" (runs claudexor auth login ${harness}).`
                : ' Use "Run doctor" in the Agent tab for details.';
            throw new AgentError(`${label} is ${st.status}: ${st.details.slice(0, 3).join('; ') || 'not ready'}.${hint}`);
          }
          let models: string[] | undefined;
          try {
            models = await listHarnessModels(this.claudexorConfig(settings, provider), harness, AbortSignal.timeout(60_000));
          } catch {
            /* model list is optional */
          }
          const model = settings[provider].model;
          const note = !model ? ' Using the harness default model.' : models && !models.includes(model) ? ` Note: "${model}" is not in the list (may still work).` : ` "${model}" is available.`;
          return { provider, ok: true, models, message: `${label} is ready via Claudexor${models ? ` (${models.length} model(s))` : ''}.${note}` };
        }
        case 'cursor': {
          const list = await this.listModels(settings);
          if (list.error) throw new AgentError(list.error);
          const models = list.models;
          const model = settings.cursor.model;
          const has = models.includes(model);
          const note = !model
            ? ' Pick a model from the list.'
            : has
              ? ` "${model}" is available.`
              : ` Note: "${model}" is not in the list (may still work).`;
          return { provider, ok: true, models, message: `Cursor SDK: ${models.length} model(s).${note}` };
        }
        case 'xplain':
        default: {
          if (!settings.endpoint) throw new AgentError('Endpoint is empty.');
          // The XPlain contract has no discovery endpoint; probe with an empty, harmless request.
          const p = this.provider({ ...settings, timeoutMinutes: 1 });
          const res = await p.explain({ sessionId: 'xplain-test', question: 'ping (connection test from XPlain; reply briefly)', items: [] }, { signal });
          return { provider, ok: true, message: `Agent answered (${res.format}, ${res.content.length} chars).` };
        }
      }
    } catch (err) {
      return { provider, ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }
}

export function minutesToMs(minutes: number): number {
  return Math.max(1, Math.round(minutes)) * 60_000;
}

/** Prefer `timeoutMinutes`; migrate legacy `timeoutMs` (rounded up to whole minutes). */
function readTimeoutMinutes(cfg: vscode.WorkspaceConfiguration, fallback: number): number {
  const inspected = cfg.inspect<number>('timeoutMinutes');
  if (inspected?.workspaceValue !== undefined) return clampInt(inspected.workspaceValue, 1, 180, fallback);
  if (inspected?.workspaceFolderValue !== undefined) return clampInt(inspected.workspaceFolderValue, 1, 180, fallback);
  if (inspected?.globalValue !== undefined) return clampInt(inspected.globalValue, 1, 180, fallback);
  const legacy = cfg.get<number>('timeoutMs');
  if (typeof legacy === 'number' && Number.isFinite(legacy) && legacy > 0) {
    return clampInt(Math.ceil(legacy / 60_000), 1, 180, fallback);
  }
  return fallback;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], def: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : def;
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
