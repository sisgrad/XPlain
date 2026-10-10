import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { AgentProviderId, AgentSettings, AgentSettingsView, AgentTestResult, SettingsTarget } from '@shared/types';
import { post } from '../vscode';

interface Props {
  settings: AgentSettingsView | null;
  test: AgentTestResult | null;
  testing: boolean;
  onTestStart: () => void;
}

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

const ORDER: AgentProviderId[] = ['hermes', 'anthropic', 'openai', 'xplain', 'mock'];

export function AgentTab({ settings, test, testing, onTestStart }: Props) {
  const [form, setForm] = useState<AgentSettings | null>(null);
  const [target, setTarget] = useState<SettingsTarget>('global');
  const [dirty, setDirty] = useState(false);
  const [key, setKey] = useState('');
  const [headersText, setHeadersText] = useState('');
  const [headersError, setHeadersError] = useState<string | null>(null);

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
  const models = useMemo(() => (test && test.provider === provider && test.ok ? test.models ?? [] : []), [test, provider]);

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
  };

  const saveKey = () => {
    post({ type: 'setAgentKey', provider, key });
    setKey('');
  };

  const currentModel = provider === 'hermes' || provider === 'openai' || provider === 'anthropic' ? form[provider].model : '';

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

      {(provider === 'hermes' || provider === 'openai' || provider === 'anthropic') && (
        <section class="section">
          <Field label="Base URL">
            <input
              class="input"
              type="url"
              value={form[provider].baseUrl}
              placeholder={provider === 'anthropic' ? 'https://api.anthropic.com' : provider === 'hermes' ? 'http://127.0.0.1:8642/v1' : 'https://api.openai.com/v1'}
              onInput={(e) => updateChat(provider, { baseUrl: val(e) })}
            />
          </Field>
          <Field label="Model">
            <input
              class="input"
              type="text"
              list="xplain-models"
              value={form[provider].model}
              placeholder={provider === 'hermes' ? 'hermes-agent' : provider === 'anthropic' ? 'claude-sonnet-5' : 'chat-latest'}
              onInput={(e) => updateChat(provider, { model: val(e) })}
            />
            {models.length > 0 && (
              <datalist id="xplain-models">
                {models.map((m) => (
                  <option value={m} key={m} />
                ))}
              </datalist>
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
          <Field label="Timeout, ms">
            <input class="input" type="number" min={1000} step={1000} value={form.timeoutMs} onInput={(e) => update({ timeoutMs: Number(val(e)) || 180000 })} />
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
          {models.length > 0 && (
            <div class="models">
              {models.slice(0, 60).map((m) => (
                <button
                  key={m}
                  class={`chip clickable ${m === currentModel ? 'current' : ''}`}
                  title="Use this model"
                  onClick={() => provider !== 'xplain' && provider !== 'mock' && updateChat(provider, { model: m })}
                >
                  {m}
                </button>
              ))}
              {models.length > 60 && <span class="small muted">… and {models.length - 60} more</span>}
            </div>
          )}
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
    timeoutMs: v.timeoutMs,
    streaming: v.streaming,
    headers: { ...v.headers },
    systemPrompt: v.systemPrompt,
    hermes: { ...v.hermes },
    openai: { ...v.openai },
    anthropic: { ...v.anthropic },
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
