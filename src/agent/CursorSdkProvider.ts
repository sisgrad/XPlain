/**
 * Cursor Agent SDK provider (`@cursor/sdk`). Runs a local agent against the
 * workspace folder and returns self-contained HTML like the chat providers.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AgentError, type AgentCallOptions, type AgentProvider, type AgentRequest, type AgentResponse } from './AgentProvider';
import { ensureSelfContainedHtml, extractHtmlTitle } from './htmlResult';
import { buildChatPrompt } from './prompt';
import { recoverHtmlAnswer } from './recoverHtml';

export interface CursorSdkConfig {
  model: string;
  /** Reasoning-effort level; mapped onto the model's effort/thinking parameter from `Cursor.models.list()`. Empty = default. */
  effort?: string;
  apiKey?: string;
  systemPrompt?: string;
  /** Absolute workspace path used as the local agent cwd. */
  cwd: string;
  /** Directory for the JSONL local agent store (avoids requiring node:sqlite). */
  storeDir: string;
  streaming: boolean;
  /**
   * Load project `.cursor/` / `.claude/` skills & rules into the local agent.
   * SDK default is [] (no ambient skills) — XPlain turns this on so Excalidraw works.
   */
  loadProjectSettings?: boolean;
  /**
   * Request Cursor local Landlock sandbox. Off by default — many Remote-SSH / restricted
   * hosts report "sandboxing is requested but no sandbox available". Isolation still uses
   * `.cursorignore` + prompt rules when sandbox is off.
   */
  useSandbox?: boolean;
  /** Optional logger for sandbox fallback notices. */
  onLog?: (message: string) => void;
}

type CursorSdk = typeof import('@cursor/sdk');

let configuredStoreDir: string | undefined;

function loadSdk(): CursorSdk {
  try {
    // Kept external so the prebuilt CJS package loads as-is (see esbuild.mjs).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@cursor/sdk') as CursorSdk;
  } catch (err) {
    throw new AgentError(
      `Cursor SDK is not available (${err instanceof Error ? err.message : String(err)}). Reinstall the XPlain extension or run npm install.`,
    );
  }
}

function ensureStore(sdk: CursorSdk, storeDir: string): void {
  fs.mkdirSync(storeDir, { recursive: true });
  if (configuredStoreDir === storeDir) return;
  sdk.Cursor.configure({
    local: {
      store: new sdk.JsonlLocalAgentStore(storeDir),
    },
  });
  configuredStoreDir = storeDir;
}

export class CursorSdkProvider implements AgentProvider {
  readonly id = 'cursor';
  readonly label = 'Cursor SDK';

  constructor(private readonly getConfig: () => Promise<CursorSdkConfig>) {}

  async explain(request: AgentRequest, options: AgentCallOptions): Promise<AgentResponse> {
    const cfg = await this.getConfig();
    if (!cfg.apiKey?.trim()) {
      throw new AgentError('Cursor SDK: API key is not set. Save a Cursor API key in the Agent tab (cursor.com/dashboard/integrations).');
    }
    if (!cfg.model.trim()) throw new AgentError('Cursor SDK: model is not configured.');
    if (!cfg.cwd) throw new AgentError('Cursor SDK: open a workspace folder first (local agent needs a cwd).');

    const sdk = loadSdk();
    ensureStore(sdk, cfg.storeDir);
    // Same system + user instructions as Hermes / OpenAI / Anthropic / XPlain HTTP.
    const prompt = buildChatPrompt(request, request.systemPrompt ?? cfg.systemPrompt);
    const message = [prompt.system, '', '---', '', prompt.user].join('\n');

    const startedAt = Date.now();
    // Default: no Landlock sandbox (fails on many Remote-SSH hosts). Optional retry path if enabled.
    const preferSandbox = cfg.useSandbox === true;
    try {
      return await this.runOnce(sdk, cfg, message, options, startedAt, preferSandbox);
    } catch (err) {
      if (preferSandbox && isSandboxUnavailableError(err)) {
        cfg.onLog?.(
          '[cursor] local sandbox unavailable — retrying without sandboxOptions (isolation via .cursorignore + prompt).',
        );
        return await this.runOnce(sdk, cfg, message, options, startedAt, false);
      }
      if (err instanceof AgentError) throw err;
      if (err instanceof sdk.CursorAgentError) {
        throw new AgentError(`Cursor SDK: ${err.message}${err.isRetryable ? ' (retryable)' : ''}`);
      }
      throw new AgentError(err instanceof Error ? err.message : String(err));
    }
  }

  private async runOnce(
    sdk: CursorSdk,
    cfg: CursorSdkConfig,
    message: string,
    options: AgentCallOptions,
    startedAt: number,
    useSandbox: boolean,
  ): Promise<AgentResponse> {
    let agent: Awaited<ReturnType<typeof sdk.Agent.create>> | undefined;
    let run: Awaited<ReturnType<NonNullable<typeof agent>['send']>> | undefined;
    try {
      const local: Record<string, unknown> = {
        cwd: cfg.cwd,
        // Without this the SDK ignores project skills (default settingSources: []).
        settingSources: cfg.loadProjectSettings === false ? [] : ['project'],
      };
      if (useSandbox) local.sandboxOptions = { enabled: true };

      const params = await effortParams(sdk, cfg.apiKey!, cfg.model, cfg.effort, cfg.onLog);
      agent = await sdk.Agent.create({
        apiKey: cfg.apiKey,
        model: params ? { id: cfg.model, params } : { id: cfg.model },
        local,
      });

      const onAbort = () => {
        if (run?.supports('cancel')) void run.cancel();
      };
      if (options.signal.aborted) throw new AgentError('Cancelled');
      options.signal.addEventListener('abort', onAbort, { once: true });

      run = await agent.send(message);
      let streamed = '';
      if (cfg.streaming) {
        try {
          for await (const event of run.stream()) {
            if (options.signal.aborted) throw new AgentError('Cancelled');
            if (event.type !== 'assistant') continue;
            const text = assistantText(event);
            if (!text) continue;
            if (text.startsWith(streamed)) {
              const delta = text.slice(streamed.length);
              if (delta) {
                streamed = text;
                options.onDelta?.(delta);
              }
            } else {
              streamed = text;
              options.onDelta?.(text);
            }
          }
        } catch (err) {
          if (options.signal.aborted) throw new AgentError('Cancelled');
          if (err instanceof AgentError) throw err;
          /* stream errors are non-fatal if wait() still returns text */
        }
      }

      const result = await run.wait();
      options.signal.removeEventListener('abort', onAbort);

      if (result.status === 'cancelled' || options.signal.aborted) throw new AgentError('Cancelled');
      if (result.status === 'error') {
        const detail = result.error?.message ? `Cursor agent failed: ${result.error.message}` : 'Cursor agent run failed.';
        throw new AgentError(detail);
      }
      const content = (result.result ?? streamed).trim();
      if (!content) throw new AgentError('Cursor SDK: empty answer.');
      const recovered = await recoverHtmlAnswer(content, {
        workspaceRoots: [cfg.cwd],
        sinceMs: startedAt,
        excludeSessions: true,
      });
      const html = ensureSelfContainedHtml(recovered.html);
      return { title: extractHtmlTitle(html), format: 'html', content: html };
    } finally {
      if (agent && typeof agent[Symbol.asyncDispose] === 'function') {
        try {
          await agent[Symbol.asyncDispose]();
        } catch {
          /* ignore dispose errors */
        }
      }
    }
  }
}

function isSandboxUnavailableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /sandbox/i.test(msg) && /not available|unavailable|requested|ConfigurationError|bubblewrap|landlock|backend/i.test(msg);
}

function assistantText(event: { message?: { content?: Array<{ type: string; text?: string }> } }): string {
  const blocks = event.message?.content;
  if (!Array.isArray(blocks)) return '';
  return blocks.filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text!).join('');
}

type CursorModelList = Awaited<ReturnType<CursorSdk['Cursor']['models']['list']>>;

const MODEL_LIST_TTL_MS = 10 * 60_000;
const modelListCache = new Map<string, { at: number; models: CursorModelList }>();

async function cachedModelList(sdk: CursorSdk, apiKey: string): Promise<CursorModelList> {
  const hit = modelListCache.get(apiKey);
  if (hit && Date.now() - hit.at < MODEL_LIST_TTL_MS) return hit.models;
  const models = await sdk.Cursor.models.list({ apiKey });
  modelListCache.set(apiKey, { at: Date.now(), models });
  return models;
}

const EFFORT_PARAM_RE = /effort|thinking|reasoning/i;

/** The model parameter that controls reasoning effort/thinking, if the model has one. */
export function effortParameter(model: CursorModelList[number] | undefined): { id: string; values: string[] } | undefined {
  const def = model?.parameters?.find((p) => EFFORT_PARAM_RE.test(p.id) || EFFORT_PARAM_RE.test(p.displayName ?? ''));
  if (!def || def.values.length === 0) return undefined;
  return { id: def.id, values: def.values.map((v) => v.value) };
}

/** Match a user effort slug against the model's advertised values (exact, then case-insensitive substring). */
export function pickEffortValue(values: string[], effort: string): string | undefined {
  const want = effort.trim().toLowerCase();
  if (!want) return undefined;
  return values.find((v) => v.toLowerCase() === want) ?? values.find((v) => v.toLowerCase().includes(want) || want.includes(v.toLowerCase()));
}

async function effortParams(sdk: CursorSdk, apiKey: string, modelId: string, effort: string | undefined, onLog?: (m: string) => void) {
  if (!effort?.trim()) return undefined;
  let models: CursorModelList;
  try {
    models = await cachedModelList(sdk, apiKey);
  } catch (err) {
    onLog?.(`Cursor SDK: could not load model parameters to apply effort "${effort}" (${err instanceof Error ? err.message : String(err)}); using the model default.`);
    return undefined;
  }
  const model = models.find((m) => m.id === modelId || m.aliases?.includes(modelId));
  const param = effortParameter(model);
  if (!param) {
    onLog?.(`Cursor SDK: model "${modelId}" has no effort/thinking parameter; ignoring effort "${effort}".`);
    return undefined;
  }
  const value = pickEffortValue(param.values, effort);
  if (!value) {
    onLog?.(`Cursor SDK: model "${modelId}" does not offer effort "${effort}" (has: ${param.values.join(', ')}); using the default.`);
    return undefined;
  }
  return [{ id: param.id, value }];
}

export interface CursorModelCatalog {
  models: string[];
  /** model id → advertised effort levels (only models with such a parameter). */
  efforts: Record<string, string[]>;
}

/** List model ids (and their effort levels) available to the API key (Agent tab dropdown). */
export async function listCursorModels(apiKey: string | undefined, signal?: AbortSignal): Promise<CursorModelCatalog> {
  if (!apiKey?.trim()) throw new AgentError('Cursor SDK: API key is required to list models.');
  const sdk = loadSdk();
  if (signal?.aborted) throw new AgentError('Cancelled');
  const list = await sdk.Cursor.models.list({ apiKey });
  modelListCache.set(apiKey, { at: Date.now(), models: list });
  if (signal?.aborted) throw new AgentError('Cancelled');
  const efforts: Record<string, string[]> = {};
  for (const m of list) {
    const p = effortParameter(m);
    if (p) efforts[m.id] = p.values;
  }
  return { models: list.map((m) => m.id).filter(Boolean).sort((a, b) => a.localeCompare(b)), efforts };
}

export function cursorSdkStoreDir(globalStoragePath: string): string {
  return path.join(globalStoragePath, 'cursor-sdk-agents');
}
