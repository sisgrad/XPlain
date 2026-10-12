import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { AgentModelsResult, AgentProviderId, AgentSettings, AgentSettingsView, AgentTestResult, SettingsTarget } from '@shared/types';
import { EFFORT_LEVELS, SUBSCRIPTION_HARNESS, type EffortProviderId, type SubscriptionProviderId } from '@shared/types';
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
const isSub = (p: AgentProviderId): p is SubscriptionProviderId => p === 'openaiSubscription' || p === 'anthropicSubscription';
const hasModelList = (p: AgentProviderId): boolean => isChat(p) || p === 'cursor' || isSub(p);
const hasEffort = (p: AgentProviderId): p is EffortProviderId => p in EFFORT_LEVELS;
/** Matches AgentRegistry.CURSOR_MODELS_BASE for listModels result matching. */
const CURSOR_MODELS_BASE = 'cursor://sdk';
/** Matches AgentRegistry.CLAUDEXOR_MODELS_BASE. */
const CLAUDEXOR_MODELS_BASE = 'claudexor://';

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
    label: 'Anthropic / Claude (API)',
    summary: 'Anthropic Messages API, billed per token. Pick any Claude model id.',
    keyHelp: 'Anthropic API key (sk-ant-…). Sent as "x-api-key".',
    keyRequired: true,
  },
  openai: {
    label: 'OpenAI / Codex (API)',
    summary: 'OpenAI Chat Completions (billed per token), or any compatible server (Ollama, vLLM, LiteLLM, OpenRouter…).',
    keyHelp: 'OpenAI API key (sk-…). Sent as "Authorization: Bearer <key>". Optional for local servers.',
    keyRequired: false,
  },
  anthropicSubscription: {
    label: 'Anthropic / Claude (Subscription)',
    summary: 'Uses your Claude Pro/Max subscription through the Claude Code CLI, driven by Claudexor (bundled with XPlain). No API key.',
    keyHelp: '',
    keyRequired: false,
  },
  openaiSubscription: {
    label: 'OpenAI / Codex (Subscription)',
    summary: 'Uses your ChatGPT Plus/Pro subscription through the Codex CLI, driven by Claudexor (bundled with XPlain). No API key.',
    keyHelp: '',
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

/** Providers shown in the Agent tab picker. `xplain` / `mock` stay in the backend for settings.json. */
const UI_PROVIDERS: AgentProviderId[] = ['hermes', 'anthropicSubscription', 'anthropic', 'openaiSubscription', 'openai', 'cursor'];

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

  const provider = form?.provider ?? 'hermes';
  const info = PROVIDERS[provider];
  // If settings still point at a hidden provider, keep it selectable so the user can switch away.
  const providerOptions = UI_PROVIDERS.includes(provider) ? UI_PROVIDERS : [provider, ...UI_PROVIDERS];
  const hasKey = settings?.hasKey[provider] ?? false;
  const chatBaseUrl = form && isChat(provider) ? form[provider].baseUrl.trim() : '';
  const modelsBaseUrl = provider === 'cursor' ? CURSOR_MODELS_BASE : isSub(provider) ? CLAUDEXOR_MODELS_BASE : chatBaseUrl;
  const hasKeyForProvider = settings?.hasKey[provider] ?? false;
  const currentModel = form
    ? provider === 'cursor'
      ? form.cursor.model
      : isSub(provider)
        ? form[provider].model
        : isChat(provider)
          ? form[provider].model
          : ''
    : '';
  const harness = isSub(provider) ? SUBSCRIPTION_HARNESS[provider] : undefined;
  const currentEffort = form && hasEffort(provider) ? form[provider].effort : '';
  const [manualEffort, setManualEffort] = useState(false);

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
  const updateCursor = (patch: { model?: string; effort?: string }) => {
    setForm((f) => (f ? { ...f, cursor: { ...f.cursor, ...patch } } : f));
    setDirty(true);
  };
  const updateSub = (id: SubscriptionProviderId, patch: { model?: string; effort?: string }) => {
    setForm((f) => (f ? { ...f, [id]: { ...f[id], ...patch } } : f));
    setDirty(true);
  };
  const updateClaudexor = (patch: Partial<AgentSettings['claudexor']>) => {
    setForm((f) => (f ? { ...f, claudexor: { ...f.claudexor, ...patch } } : f));
    setDirty(true);
  };
  const setModel = (model: string) => {
    if (provider === 'cursor') updateCursor({ model });
    else if (isSub(provider)) updateSub(provider, { model });
    else if (isChat(provider)) updateChat(provider, { model });
  };
  const setEffort = (effort: string) => {
    if (provider === 'cursor') updateCursor({ effort });
    else if (isSub(provider)) updateSub(provider, { effort });
    else if (provider === 'openai' || provider === 'anthropic') updateChat(provider, { effort });
  };
  // Cursor advertises effort levels per model; other vendors use a known (open) vocabulary.
  const serverEfforts = listCurrent && currentModel ? modelsResult!.efforts?.[currentModel] : undefined;
  const effortLevels = hasEffort(provider) ? (serverEfforts ?? EFFORT_LEVELS[provider]) : [];
  const cursorNoEffort = provider === 'cursor' && listCurrent && Boolean(currentModel) && models.includes(currentModel) && !serverEfforts;

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
    if (hasModelList(provider) && (provider === 'cursor' || isSub(provider) || chatBaseUrl)) requestModels({ ...form, headers });
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
          {providerOptions.map((id) => (
            <option value={id} key={id}>
              {PROVIDERS[id].label}
              {!UI_PROVIDERS.includes(id) ? ' (settings only)' : ''}
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

      {isSub(provider) && harness && (
        <section class="section">
          <h2>
            <span class="codicon codicon-account" /> Subscription login ({harness === 'claude' ? 'Claude Code' : 'Codex CLI'})
          </h2>
          <p class="small muted">
            XPlain ships the <code>claudexor</code> CLI; it drives the vendor CLI that is logged in with your subscription. Install the CLI once, log in
            (opens the vendor's browser/device flow in a terminal), then <em>Test connection</em>. Node.js ≥ 24.15 is downloaded automatically into the extension's storage if the machine has none. With the
            Excalidraw checkbox on, requests run as a write-capable <code>claudexor agent</code> so the skill can render PNGs (see Advanced).
          </p>
          <div class="row">
            <button class="button small secondary" title={`claudexor harness install ${harness} --target local --yes`} onClick={() => post({ type: 'claudexorSetup', harness, action: 'install' })}>
              <span class="codicon codicon-cloud-download" /> Install {harness} CLI
            </button>
            <button class="button small primary" title={`claudexor auth login ${harness}`} onClick={() => post({ type: 'claudexorSetup', harness, action: 'login' })}>
              <span class="codicon codicon-sign-in" /> Log in
            </button>
            <button class="button small secondary" title={`claudexor doctor --harness ${harness}`} onClick={() => post({ type: 'claudexorSetup', harness, action: 'doctor' })}>
              <span class="codicon codicon-pulse" /> Run doctor
            </button>
            <button class="button small secondary" title="claudexor quota --refresh" onClick={() => post({ type: 'claudexorSetup', harness, action: 'quota' })}>
              <span class="codicon codicon-graph" /> Quota
            </button>
            <button class="button small secondary" title="Download / check the managed Node.js ≥ 24.15 runtime (no sudo, lives in the extension's global storage)" onClick={() => post({ type: 'claudexorSetup', harness, action: 'node' })}>
              <span class="codicon codicon-package" /> Node.js runtime
            </button>
          </div>
        </section>
      )}

      {(isChat(provider) || provider === 'cursor' || isSub(provider)) && (
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
              provider === 'hermes'
                ? 'Model / profile (from the harness)'
                : provider === 'cursor'
                  ? 'Model (from Cursor account)'
                  : isSub(provider)
                    ? 'Model (empty = harness default)'
                    : 'Model (from the server)'
            }
          >
            <div class="row">
              {manualModel || (models.length === 0 && !loadingModels) ? (
                <input
                  class="input"
                  type="text"
                  value={currentModel}
                  placeholder={
                    provider === 'hermes'
                      ? 'hermes-agent'
                      : provider === 'anthropic' || provider === 'anthropicSubscription'
                        ? 'claude-sonnet-5'
                        : provider === 'cursor'
                          ? 'composer-2.5'
                          : provider === 'openaiSubscription'
                            ? 'harness default'
                            : 'chat-latest'
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
                  {!currentModel && <option value="">{isSub(provider) ? '— harness default —' : '— select a model —'}</option>}
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
              <p class="small muted">
                {provider === 'cursor' ? 'Loading models from Cursor…' : isSub(provider) ? `Asking Claudexor for ${harness} models…` : `Loading models from ${chatBaseUrl}…`}
              </p>
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
                {models.length} model(s) available{provider === 'cursor' || isSub(provider) ? '' : ` at ${chatBaseUrl}`}.
              </p>
            )}
          </Field>
          {hasEffort(provider) && (
            <Field label="Reasoning effort (empty = model default)">
              <div class="row">
                {manualEffort ? (
                  <input class="input" type="text" value={currentEffort} placeholder="e.g. high" list="xplain-effort-levels" onInput={(e) => setEffort(val(e))} />
                ) : (
                  <select class="input" value={currentEffort} onChange={(e) => setEffort((e.target as HTMLSelectElement).value)}>
                    <option value="">— default —</option>
                    {currentEffort && !effortLevels.includes(currentEffort) && <option value={currentEffort}>{currentEffort} (custom)</option>}
                    {effortLevels.map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                )}
                <datalist id="xplain-effort-levels">
                  {effortLevels.map((l) => (
                    <option key={l} value={l} />
                  ))}
                </datalist>
                <button class="icon-button" title={manualEffort ? 'Choose from the list' : 'Type a custom level'} onClick={() => setManualEffort((v) => !v)}>
                  <span class={`codicon ${manualEffort ? 'codicon-list-flat' : 'codicon-edit'}`} />
                </button>
              </div>
              <p class="small muted">
                {provider === 'openai'
                  ? 'Sent as reasoning_effort; supported levels depend on the model.'
                  : provider === 'anthropic'
                    ? 'Sent as output_config.effort; most Claude models default to high.'
                    : isSub(provider)
                      ? `Passed to Claudexor as --effort; clamped to what the ${harness} model advertises.`
                      : cursorNoEffort
                        ? `"${currentModel}" exposes no effort/thinking parameter — this setting is ignored for it.`
                        : serverEfforts
                          ? `Levels advertised by Cursor for "${currentModel}".`
                          : 'Mapped onto the model’s effort/thinking parameter from your Cursor account.'}
              </p>
            </Field>
          )}
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

      {provider !== 'mock' && !isSub(provider) && (
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
          {isSub(provider) && (
            <>
              <Field label="claudexor CLI path (empty = bundled with XPlain)">
                <input class="input" type="text" value={form.claudexor.cliPath} placeholder="/path/to/node_modules/claudexor/bin/claudexor.js" onInput={(e) => updateClaudexor({ cliPath: val(e) })} />
              </Field>
              <Field label="Node.js ≥ 24.15 binary (empty = auto-detect / managed download)">
                <input class="input" type="text" value={form.claudexor.nodePath} placeholder="/usr/local/bin/node" onInput={(e) => updateClaudexor({ nodePath: val(e) })} />
              </Field>
              <label class="check">
                <input type="checkbox" checked={form.claudexor.autoInstallNode} onChange={(e) => updateClaudexor({ autoInstallNode: (e.target as HTMLInputElement).checked })} /> Download Node.js
                automatically when none ≥ 24.15 is found
              </label>
              <Field label="Node.js version to download (empty = extension default)">
                <input class="input" type="text" value={form.claudexor.nodeVersion} placeholder="24.21.0" onInput={(e) => updateClaudexor({ nodeVersion: val(e) })} />
              </Field>
              <Field label="Claudexor route">
                <select class="select" value={form.claudexor.mode} onChange={(e) => updateClaudexor({ mode: (e.target as HTMLSelectElement).value as AgentSettings['claudexor']['mode'] })}>
                  <option value="auto">auto — read-only ask; agent run when Excalidraw is on</option>
                  <option value="ask">ask — always read-only (no PNG diagrams)</option>
                  <option value="agent">agent — always write-capable in-place run</option>
                </select>
              </Field>
              <Field label="Agent project dir">
                <select class="select" value={form.claudexor.project} onChange={(e) => updateClaudexor({ project: (e.target as HTMLSelectElement).value as AgentSettings['claudexor']['project'] })}>
                  <option value="auto">auto — workspace if it is a git repo, else private dir</option>
                  <option value="workspace">workspace — always (Claudexor git-inits non-git folders!)</option>
                  <option value="private">private — never touch the project tree; diagrams mirrored back</option>
                </select>
              </Field>
            </>
          )}
          {provider !== 'cursor' && !isSub(provider) && (
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
    openaiSubscription: { ...v.openaiSubscription },
    anthropicSubscription: { ...v.anthropicSubscription },
    cursor: { ...v.cursor },
    claudexor: { ...v.claudexor },
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
