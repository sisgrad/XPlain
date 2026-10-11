import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { AgentModelsResult, AgentProviderId, AgentSettings, AgentSettingsView, AgentTestResult, SettingsTarget } from '@shared/types';
import { post } from '../vscode';

interface Props {
  settings: AgentSettingsView | null;
  test: AgentTestResult | null;
  testing: boolean;
  onTestStart: () => void;
  models: AgentModelsResult | null;
}

type ChatProviderId = 'hermes' | 'openai' | 'anthropic';
const isChat = (p: AgentProviderId): p is ChatProviderId => p === 'hermes' || p === 'openai' || p === 'anthropic';
const hasModelList = (p: AgentProviderId): boolean => isChat(p) || p === 'cursor';
/** Matches AgentRegistry.CURSOR_MODELS_BASE for listModels result matching. */
const CURSOR_MODELS_BASE = 'cursor://sdk';

let modelsRequestSeq = 0;

interface ProviderInfo {
  label: string;
  summary: string;
  keyHelp: string;
  keyRequired: boolean;
  docs?: string;
}

const PROVIDERS: Record<AgentProviderId, ProviderInfo> = {
  hermes: {
    label: 'Hermes Agent',
    summary: 'Your local Hermes harness via its OpenAI-compatible API server (hermes api-server / API_SERVER_ENABLED=true).',
    keyHelp: 'API_SERVER_KEY from your Hermes config (~/.hermes/.env). Sent as "Authorization: Bearer <key>".',
    keyRequired: false,
  },
  anthropic: {
    label: 'Anthropic (Claude)',
    summary: 'Anthropic Messages API. Pick any Claude model id.',
    keyHelp: 'Anthropic API key (sk-ant-…). Sent as "x-api-key".',
    keyRequired: true,
  },
  openai: {
    label: 'OpenAI / Codex',
    summary: 'OpenAI Chat Completions, or any compatible server (Ollama, vLLM, LiteLLM, OpenRouter…).',
    keyHelp: 'OpenAI API key (sk-…). Sent as "Authorization: Bearer <key>". Optional for local servers.',
    keyRequired: false,
  },
  cursor: {
    label: 'Cursor SDK',
    summary: 'Runs a Cursor agent locally against this workspace via @cursor/sdk (Composer / account models). Needs a Cursor API key.',
    keyHelp: 'Cursor user API key from cursor.com/dashboard/integrations (or a team service-account key).',
    keyRequired: true,
  },
  xplain: {
    label: 'XPlain HTTP agent',
    summary: 'Your own agent service speaking the XPlain contract (POST JSON, reply JSON or NDJSON stream). See docs/04-agent-api.md.',
    keyHelp: 'Optional. Sent as "Authorization: Bearer <key>".',
    keyRequired: false,
  },
  mock: {
    label: 'Mock (offline)',
    summary: 'Built-in canned answer. Useful to try the UI without any backend.',
    keyHelp: '',
    keyRequired: false,
  },
};

const ORDER: AgentProviderId[] = ['hermes', 'anthropic', 'openai', 'cursor', 'xplain', 'mock'];

export function AgentTab({ settings, test, testing, onTestStart, models: modelsResult }: Props) {
  const [form, setForm] = useState<AgentSettings | null>(null);
  const [target, setTarget] = useState<SettingsTarget>('global');
  const [dirty, setDirty] = useState(false);
  const [key, setKey] = useState('');
  const [headersText, setHeadersText] = useState('');
  const [headersError, setHeadersError] = useState<string | null>(null);
  const [pendingModels, setPendingModels] = useState<number | null>(null);
  const [manualModel, setManualModel] = useState(false);

  // Adopt host settings whenever they change and the form has no unsaved edits.
  useEffect(() => {
    if (!settings) return;
    if (!dirty || !form) {
      setForm(stripView(settings));
      setTarget(settings.target);
      setHeadersText(formatHeaders(settings.headers));
      setHeadersError(null);
    }
  }, [settings]);

  const provider = form?.provider ?? 'xplain';
  const info = PROVIDERS[provider];
  const hasKey = settings?.hasKey[provider] ?? false;
  const chatBaseUrl = form && isChat(provider) ? form[provider].baseUrl.trim() : '';
  const modelsBaseUrl = provider === 'cursor' ? CURSOR_MODELS_BASE : chatBaseUrl;
  const hasKeyForProvider = settings?.hasKey[provider] ?? false;
  const currentModel = form ? (provider === 'cursor' ? form.cursor.model : isChat(provider) ? form[provider].model : '') : '';

  // Load the model list whenever the provider, base URL or stored key changes.
  const requestModels = (settingsForRequest: AgentSettings) => {
    const requestId = ++modelsRequestSeq;
    setPendingModels(requestId);
    post({ type: 'listModels', settings: settingsForRequest, requestId });
  };
  useEffect(() => {
    if (!form || !hasModelList(provider)) return;
    if (isChat(provider) && !chatBaseUrl) return;
    if (provider === 'cursor' && !hasKeyForProvider) return;
    const t = window.setTimeout(() => requestModels(form), 400);
    return () => window.clearTimeout(t);
  }, [provider, chatBaseUrl, hasKeyForProvider, form !== null]);
  useEffect(() => {
    if (modelsResult && modelsResult.requestId === pendingModels) setPendingModels(null);
  }, [modelsResult]);
  useEffect(() => setManualModel(false), [provider]);

  // Only trust a list that matches what the form currently points at.
  const listCurrent = Boolean(modelsResult && modelsResult.provider === provider && modelsResult.baseUrl === modelsBaseUrl);
  const models = useMemo(() => (listCurrent ? modelsResult!.models : []), [listCurrent, modelsResult]);
  const modelsError = listCurrent ? modelsResult!.error : undefined;
  const loadingModels = pendingModels !== null;

  if (!form) {
    return (
      <div class="hint centered">
        <span class="codicon codicon-loading codicon-modifier-spin big" />
        <p>Loading agent settings…</p>
      </div>
    );
  }

  const update = (patch: Partial<AgentSettings>) => {
    setForm((f) => (f ? { ...f, ...patch } : f));
    setDirty(true);
  };
  const updateChat = (id: 'hermes' | 'openai' | 'anthropic', patch: Record<string, string | number>) => {
    setForm((f) => (f ? { ...f, [id]: { ...f[id], ...patch } } : f));
    setDirty(true);
  };
  const updateCursor = (patch: { model?: string }) => {
    setForm((f) => (f ? { ...f, cursor: { ...f.cursor, ...patch } } : f));
    setDirty(true);
  };
  const setModel = (model: string) => {
    if (provider === 'cursor') updateCursor({ model });
    else if (isChat(provider)) updateChat(provider, { model });
  };

  const parsedHeaders = () => {
    try {
      const h = parseHeaders(headersText);
      setHeadersError(null);
      return h;
    } catch (e) {
      setHeadersError(e instanceof Error ? e.message : String(e));
      return null;
    }
  };

  const save = () => {
    const headers = parsedHeaders();
    if (!headers) return;
    post({ type: 'saveAgentSettings', settings: { ...form, headers }, target });
    setDirty(false);
  };

  const revert = () => {
    if (!settings) return;
    setForm(stripView(settings));
    setTarget(settings.target);
    setHeadersText(formatHeaders(settings.headers));
    setHeadersError(null);
    setDirty(false);
  };

  const runTest = () => {
    const headers = parsedHeaders();
    if (!headers) return;
    onTestStart();
    post({ type: 'testAgent', settings: { ...form, headers } });
    if (hasModelList(provider) && (provider === 'cursor' || chatBaseUrl)) requestModels({ ...form, headers });
  };

  const saveKey = () => {
    post({ type: 'setAgentKey', provider, key });
    setKey('');
  };

  return (
    <div class="agent-tab">
      <section class="section">
        <h2>
          <span class="codicon codicon-server-process" /> Agent provider
        </h2>
        <select class="select" value={provider} onChange={(e) => update({ provider: (e.target as HTMLSelectElement).value as AgentProviderId })}>
          {ORDER.map((id) => (
            <option value={id} key={id}>
              {PROVIDERS[id].label}
            </option>
          ))}
        </select>
        <p class="small muted">{info.summary}</p>
      </section>

      {provider === 'xplain' && (
        <section class="section">
          <Field label="Endpoint (POST)">
            <input class="input" type="url" value={form.endpoint} placeholder="http://127.0.0.1:8765/explain" onInput={(e) => update({ endpoint: val(e) })} />
          </Field>
        </section>
      )}

      {(isChat(provider) || provider === 'cursor') && (
        <section class="section">
          {isChat(provider) && (
            <Field label="Base URL">
              <input
                class="input"
                type="url"
                value={form[provider].baseUrl}
                placeholder={provider === 'anthropic' ? 'https://api.anthropic.com' : provider === 'hermes' ? 'http://127.0.0.1:8642/v1' : 'https://api.openai.com/v1'}
                onInput={(e) => updateChat(provider, { baseUrl: val(e) })}
              />
            </Field>
          )}
          {provider === 'cursor' && (
            <p class="small muted">Runs locally against the open workspace folder via the Cursor Agent SDK. Model list comes from your Cursor account.</p>
          )}
          <Field
            label={
              provider === 'hermes' ? 'Model / profile (from the harness)' : provider === 'cursor' ? 'Model (from Cursor account)' : 'Model (from the server)'
            }
          >
            <div class="row">
              {manualModel || (models.length === 0 && !loadingModels) ? (
                <input
                  class="input"
                  type="text"
                  value={currentModel}
                  placeholder={
                    provider === 'hermes' ? 'hermes-agent' : provider === 'anthropic' ? 'claude-sonnet-5' : provider === 'cursor' ? 'composer-2.5' : 'chat-latest'
                  }
                  onInput={(e) => setModel(val(e))}
                />
              ) : (
                <select
                  class="select"
                  value={currentModel}
                  disabled={loadingModels && models.length === 0}
                  onChange={(e) => setModel((e.target as HTMLSelectElement).value)}
                >
                  {!currentModel && <option value="">— select a model —</option>}
                  {currentModel && !models.includes(currentModel) && (
                    <option value={currentModel}>{currentModel} (not in the server list)</option>
                  )}
                  {models.map((m) => (
                    <option value={m} key={m}>
                      {m}
                    </option>
                  ))}
                </select>
              )}
              <button
                class="icon-button"
                title="Reload the model list"
                disabled={loadingModels || (isChat(provider) && !chatBaseUrl) || (provider === 'cursor' && !hasKey)}
                onClick={() => requestModels(form)}
              >
                <span class={`codicon ${loadingModels ? 'codicon-loading codicon-modifier-spin' : 'codicon-refresh'}`} />
              </button>
              {models.length > 0 && (
                <button class="icon-button" title={manualModel ? 'Choose from the list' : 'Type a model id manually'} onClick={() => setManualModel((v) => !v)}>
                  <span class={`codicon ${manualModel ? 'codicon-list-flat' : 'codicon-edit'}`} />
                </button>
              )}
            </div>
            {loadingModels && models.length === 0 && (
              <p class="small muted">{provider === 'cursor' ? 'Loading models from Cursor…' : `Loading models from ${chatBaseUrl}…`}</p>
            )}
            {!loadingModels && modelsError && (
              <p class="small error">
                Could not load models: {modelsError}
                {(provider === 'anthropic' || provider === 'cursor') && !hasKey ? ' Save the API key first.' : ''} You can type the id manually.
              </p>
            )}
            {!loadingModels && !modelsError && listCurrent && models.length === 0 && <p class="small muted">No models returned.</p>}
            {!loadingModels && models.length > 0 && (
              <p class="small muted">
                {models.length} model(s) available{provider === 'cursor' ? '' : ` at ${chatBaseUrl}`}.
              </p>
            )}
          </Field>
          {provider === 'anthropic' && (
            <Field label="max_tokens">
              <input
                class="input"
                type="number"
                min={256}
                step={256}
                value={form.anthropic.maxTokens}
                onInput={(e) => updateChat('anthropic', { maxTokens: Number(val(e)) || 8192 })}
              />
            </Field>
          )}
        </section>
      )}

      {provider !== 'mock' && (
        <section class="section">
          <h2>
            <span class="codicon codicon-key" /> API key
            <span class={`chip ${hasKey ? 'ok' : ''}`} style={{ marginLeft: 8 }}>
              {hasKey ? 'saved' : info.keyRequired ? 'required' : 'not set'}
            </span>
          </h2>
          <div class="row">
            <input
              class="input"
              type="password"
              autocomplete="off"
              value={key}
              placeholder={hasKey ? '•••••••• (enter a new key to replace)' : 'paste the key'}
              onInput={(e) => setKey(val(e))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && key.trim()) saveKey();
              }}
            />
            <button class="button small primary" disabled={!key.trim()} onClick={saveKey} title="Store in the IDE's secret storage">
              Save key
            </button>
            {hasKey && (
              <button class="button small secondary" onClick={() => post({ type: 'clearAgentKey', provider })} title="Delete the stored key">
                Clear
              </button>
            )}
          </div>
          <p class="small muted">{info.keyHelp} Keys never go to settings.json or .xplain/; they live in the IDE secret storage and are saved immediately.</p>
        </section>
      )}

      {provider !== 'mock' && (
        <details class="section advanced" open={provider === 'xplain' ? false : undefined}>
          <summary>
            <span class="codicon codicon-settings" /> Advanced
          </summary>
          <Field label="Idle timeout, minutes (resets on every chunk / keepalive)">
            <input
              class="input"
              type="number"
              min={1}
              max={180}
              step={1}
              value={form.timeoutMinutes}
              onInput={(e) => update({ timeoutMinutes: Math.max(1, Math.min(180, Number(val(e)) || 10)) })}
            />
          </Field>
          <label class="check">
            <input type="checkbox" checked={form.streaming} onChange={(e) => update({ streaming: (e.target as HTMLInputElement).checked })} /> Stream partial output
          </label>
          {provider !== 'xplain' && (
            <Field label="System prompt (empty = built-in XPlain prompt)">
              <textarea
                rows={4}
                value={form.systemPrompt}
                placeholder="You are a senior engineer explaining code…"
                onInput={(e) => update({ systemPrompt: (e.target as HTMLTextAreaElement).value })}
              />
            </Field>
          )}
          {provider !== 'cursor' && (
            <Field label="Extra HTTP headers (one per line: Name: value)">
              <textarea
                rows={2}
                value={headersText}
                placeholder={'X-Org: my-team'}
                onInput={(e) => {
                  setHeadersText((e.target as HTMLTextAreaElement).value);
                  setDirty(true);
                }}
              />
              {headersError && <p class="small error">{headersError}</p>}
            </Field>
          )}
        </details>
      )}

      <section class="section">
        <div class="row">
          <span class="small muted">Save to:</span>
          <label class="check">
            <input type="radio" name="target" checked={target === 'global'} onChange={() => { setTarget('global'); setDirty(true); }} /> User settings
          </label>
          <label class="check" title={settings?.hasWorkspace ? 'Stored in .vscode/settings.json of this workspace' : 'Open a folder to use workspace settings'}>
            <input type="radio" name="target" disabled={!settings?.hasWorkspace} checked={target === 'workspace'} onChange={() => { setTarget('workspace'); setDirty(true); }} /> This workspace
          </label>
        </div>
        <div class="row agent-actions">
          <button class="button primary" disabled={!dirty} onClick={save}>
            <span class="codicon codicon-save" /> Save
          </button>
          <button class="button secondary" disabled={!dirty} onClick={revert}>
            Revert
          </button>
          <span class="grow-spacer" />
          <button class="button secondary" disabled={testing} onClick={runTest} title="Check that the provider is reachable with the values above (uses the saved API key)">
            <span class={`codicon ${testing ? 'codicon-loading codicon-modifier-spin' : 'codicon-debug-disconnect'}`} /> Test connection
          </button>
        </div>
        {dirty && <p class="small muted">Unsaved changes. Test uses the values in the form; Send uses the saved ones.</p>}
      </section>

      {test && test.provider === provider && (
        <section class={`section test-result ${test.ok ? 'ok' : 'fail'}`}>
          <p>
            <span class={`codicon ${test.ok ? 'codicon-pass' : 'codicon-error'}`} /> {test.message}
          </p>
        </section>
      )}
    </div>
  );
}

function Field(props: { label: string; children: ComponentChildren }) {
  return (
    <label class="field">
      <span class="field-label">{props.label}</span>
      {props.children}
    </label>
  );
}

function val(e: Event): string {
  return (e.target as HTMLInputElement).value;
}

function stripView(v: AgentSettingsView): AgentSettings {
  return {
    provider: v.provider,
    endpoint: v.endpoint,
    timeoutMinutes: v.timeoutMinutes,
    streaming: v.streaming,
    headers: { ...v.headers },
    systemPrompt: v.systemPrompt,
    hermes: { ...v.hermes },
    openai: { ...v.openai },
    anthropic: { ...v.anthropic },
    cursor: { ...v.cursor },
  };
}

function formatHeaders(h: Record<string, string>): string {
  return Object.entries(h)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
}

export function parseHeaders(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const i = line.indexOf(':');
    if (i <= 0) throw new Error(`Header line "${line}" must look like "Name: value".`);
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}
