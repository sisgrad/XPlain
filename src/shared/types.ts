/**
 * Domain model shared by the extension host and the webview.
 * Everything here must be plain JSON-serialisable data.
 */

export type ResultFormat = 'markdown' | 'html';

/** A code block in a workspace file that has (or is about to have) explanations. */
export interface Anchor {
  id: string;
  /** Workspace-relative, POSIX-style path. */
  file: string;
  /** 1-based, inclusive. */
  startLine: number;
  /** 1-based, inclusive. */
  endLine: number;
  /** Hash of the normalised block text; used to re-find the block after edits. */
  textHash: string;
  /** The block text at the time it was anchored (used for re-anchoring). */
  snippet: string;
  language: string;
}

export type SessionStatus = 'pending' | 'done' | 'error';

/** Lightweight session record kept in index.json. */
export interface SessionMeta {
  id: string;
  /** Human-readable title (chat-like), never "v1"/"v2". */
  title: string;
  createdAt: string;
  anchorIds: string[];
  question: string;
  resultFormat: ResultFormat;
  status: SessionStatus;
  error?: string;
}

export type ContextItem =
  | {
      kind: 'code';
      anchorId: string;
      file: string;
      startLine: number;
      endLine: number;
      language: string;
      text: string;
    }
  | {
      kind: 'result';
      sessionId: string;
      title: string;
    }
  | {
      kind: 'template';
      templateId: string;
      name: string;
    };

/** Full context of a session, stored as sessions/<id>/context.json. */
export interface SessionContext {
  id: string;
  title: string;
  createdAt: string;
  question: string;
  items: ContextItem[];
  agent: {
    provider: string;
    endpoint?: string;
    model?: string;
  };
  status: SessionStatus;
  error?: string;
}

export interface TemplateFileMeta {
  name: string;
  size: number;
}

export interface TemplateMeta {
  id: string;
  name: string;
  instruction: string;
  files: TemplateFileMeta[];
  createdAt: string;
  updatedAt: string;
}

export interface TemplateFile {
  name: string;
  content: string;
}

export interface XplainIndex {
  version: 1;
  anchors: Anchor[];
  sessions: SessionMeta[];
}

/** The not-yet-sent context being assembled by the user. */
export type DraftItem =
  | {
      kind: 'code';
      anchorId: string;
      file: string;
      startLine: number;
      endLine: number;
      language: string;
      text: string;
    }
  | {
      kind: 'result';
      sessionId: string;
      title: string;
    };

/** Language the agent should write the explanation in. */
export type ExplainLanguage = 'en' | 'ru';

export const EXPLAIN_LANGUAGES: Array<{ id: ExplainLanguage; label: string }> = [
  { id: 'en', label: 'English' },
  { id: 'ru', label: 'Russian' },
];

export interface DraftState {
  items: DraftItem[];
  question: string;
  templateId: string | null;
  /** Language for the agent's answer. */
  explainLanguage: ExplainLanguage;
  /** Ask the agent to use the bundled Excalidraw Diagram skill. */
  useExcalidraw: boolean;
}

export type BackgroundFit = 'cover' | 'contain' | 'tile';

export interface BackgroundState {
  /** Webview-safe URI or null when no background is set. */
  uri: string | null;
  opacity: number;
  blur: number;
  fit: BackgroundFit;
  scope: 'user' | 'workspace' | null;
}

export interface BusyState {
  busy: boolean;
  label?: string;
  sessionId?: string;
}

export const DEFAULT_DRAFT: DraftState = {
  items: [],
  question: '',
  templateId: null,
  explainLanguage: 'en',
  useExcalidraw: false,
};

/* ------------------------------------------------------------ agent setup */

/** Backends the extension can talk to. */
export type AgentProviderId = 'xplain' | 'hermes' | 'openai' | 'anthropic' | 'mock';

export const AGENT_PROVIDER_IDS: AgentProviderId[] = ['xplain', 'hermes', 'openai', 'anthropic', 'mock'];

export interface ChatProviderSettings {
  baseUrl: string;
  model: string;
}

/** Everything the Agent tab edits. Secrets are never included, only `hasKey`. */
export interface AgentSettings {
  provider: AgentProviderId;
  /** XPlain-contract endpoint (provider = xplain). */
  endpoint: string;
  timeoutMs: number;
  streaming: boolean;
  /** Extra headers sent to any provider. */
  headers: Record<string, string>;
  /** Empty = built-in default prompt (chat providers only). */
  systemPrompt: string;
  hermes: ChatProviderSettings;
  openai: ChatProviderSettings;
  anthropic: ChatProviderSettings & { maxTokens: number };
}

export type SettingsTarget = 'global' | 'workspace';

export interface AgentSettingsView extends AgentSettings {
  /** Which providers have an API key stored in SecretStorage. */
  hasKey: Record<AgentProviderId, boolean>;
  /** Where `xplain.agent.provider` is currently defined. */
  target: SettingsTarget;
  hasWorkspace: boolean;
}

export interface AgentTestResult {
  provider: AgentProviderId;
  ok: boolean;
  message: string;
  models?: string[];
}

/** Answer to `listModels`: the models the provider's server advertises. */
export interface AgentModelsResult {
  requestId: number;
  provider: AgentProviderId;
  baseUrl: string;
  models: string[];
  /** Set when the list could not be fetched (server down, bad key, no discovery endpoint). */
  error?: string;
}
