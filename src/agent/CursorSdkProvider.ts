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

    let agent: Awaited<ReturnType<typeof sdk.Agent.create>> | undefined;
    let run: Awaited<ReturnType<NonNullable<typeof agent>['send']>> | undefined;
    const startedAt = Date.now();
    try {
      const localBase = {
        cwd: cfg.cwd,
        // Without this the SDK ignores project skills (default settingSources: []).
        settingSources: (cfg.loadProjectSettings === false ? [] : ['project']) as Array<'project' | 'user' | 'team'>,
      };
      try {
        agent = await sdk.Agent.create({
          apiKey: cfg.apiKey,
          model: { id: cfg.model },
          local: {
            ...localBase,
            // Landlock + .cursorignore hide other sessions/diagrams (see cursorIsolation.ts).
            sandboxOptions: { enabled: true },
          },
        });
      } catch (err) {
        // Older hosts / missing sandbox helper: fall back to unsandboxed local agent.
        const msg = err instanceof Error ? err.message : String(err);
        if (!/sandbox|ConfigurationError|bubblewrap|landlock/i.test(msg)) throw err;
        agent = await sdk.Agent.create({
          apiKey: cfg.apiKey,
          model: { id: cfg.model },
          local: localBase,
        });
      }

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
          // Stream errors are non-fatal if wait() still returns text.
          if (!(err instanceof AgentError)) {
            /* fall through to wait() */
          } else {
            throw err;
          }
        }
      }

      const result = await run.wait();
      options.signal.removeEventListener('abort', onAbort);

      if (result.status === 'cancelled' || options.signal.aborted) throw new AgentError('Cancelled');
      if (result.status === 'error') {
        throw new AgentError(result.error?.message ? `Cursor agent failed: ${result.error.message}` : 'Cursor agent run failed.');
      }
      const content = (result.result ?? streamed).trim();
      if (!content) throw new AgentError('Cursor SDK: empty answer.');
      // Cursor agents often Write the real HTML to .xplain/*.html and return a stub.
      const recovered = await recoverHtmlAnswer(content, {
        workspaceRoots: [cfg.cwd],
        sinceMs: startedAt,
        excludeSessions: true,
      });
      const html = ensureSelfContainedHtml(recovered.html);
      return { title: extractHtmlTitle(html), format: 'html', content: html };
    } catch (err) {
      if (err instanceof AgentError) throw err;
      if (err instanceof sdk.CursorAgentError) {
        throw new AgentError(`Cursor SDK: ${err.message}${err.isRetryable ? ' (retryable)' : ''}`);
      }
      throw new AgentError(err instanceof Error ? err.message : String(err));
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

function assistantText(event: { message?: { content?: Array<{ type: string; text?: string }> } }): string {
  const blocks = event.message?.content;
  if (!Array.isArray(blocks)) return '';
  return blocks.filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text!).join('');
}

/** List model ids available to the API key (Agent tab dropdown). */
export async function listCursorModels(apiKey: string | undefined, signal?: AbortSignal): Promise<string[]> {
  if (!apiKey?.trim()) throw new AgentError('Cursor SDK: API key is required to list models.');
  const sdk = loadSdk();
  if (signal?.aborted) throw new AgentError('Cancelled');
  const models = await sdk.Cursor.models.list({ apiKey });
  if (signal?.aborted) throw new AgentError('Cancelled');
  return models.map((m) => m.id).filter(Boolean).sort((a, b) => a.localeCompare(b));
}

export function cursorSdkStoreDir(globalStoragePath: string): string {
  return path.join(globalStoragePath, 'cursor-sdk-agents');
}
