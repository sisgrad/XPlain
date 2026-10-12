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
  /**
   * Hash of the block text the agent actually saw, per anchor id. Compared with the
   * current code to detect drift (the anchor's own hash follows edits, this one does not).
   * Legacy sessions are backfilled from context.json on load.
   */
  codeHashes?: Record<string, string>;
}

/* ------------------------------------------------------------------ drift */

/**
 * How far the current code has moved from what an explanation described.
 *  fresh    — identical (or only whitespace / comments changed)
 *  drifted  — small edit; explanation is probably still mostly right
 *  outdated — large edit or the block's first line (signature) changed
 *  lost     — the block cannot be found in the file any more
 */
export type DriftLevel = 'fresh' | 'drifted' | 'outdated' | 'lost';

/** Per-session drift summary pushed to the webview (History / Result). */
export interface SessionDriftSummary {
  level: DriftLevel;
  /** Added + removed lines across all changed blocks. */
  changedLines: number;
  /** Code blocks referenced by the session. */
  blocks: number;
  /** Blocks whose text differs from what the agent saw (incl. lost). */
  changedBlocks: number;
  /** Newest mtime of the files holding the blocks (when not fresh). */
  codeModifiedAt?: string;
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
      kind: 'file';
      name: string;
      /** Text content only (binary attachments are rejected). */
      content: string;
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

/** Where a template is stored. */
export type TemplateScope = 'builtin' | 'user' | 'project';

export const TEMPLATE_SCOPES: TemplateScope[] = ['builtin', 'user', 'project'];

/** Scopes the user can write to (built-in templates are read-only). */
export type WritableTemplateScope = 'user' | 'project';

export interface TemplateMeta {
  id: string;
  /** Storage layer. Missing/legacy project templates are treated as `project`. */
  scope: TemplateScope;
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
    }
  | {
      kind: 'file';
      name: string;
      content: string;
    };

/** Max UTF-8 bytes for a draft file attachment (same spirit as template files). */
export const DRAFT_FILE_MAX_BYTES = 1_048_576;

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
  /**
   * When set, Send revises this session in place (overwrite result.html) instead of
   * creating a new session. Used by the Result → Extend flow.
   */
  extendSessionId: string | null;
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
  extendSessionId: null,
};

/* ------------------------------------------------------------ agent setup */

/** Backends the extension can talk to. */
export type AgentProviderId =
  | 'xplain'
  | 'hermes'
  | 'openai'
  | 'anthropic'
  | 'openaiSubscription'
  | 'anthropicSubscription'
  | 'cursor'
  | 'mock';

export const AGENT_PROVIDER_IDS: AgentProviderId[] = [
  'xplain',
  'hermes',
  'openai',
  'anthropic',
  'openaiSubscription',
  'anthropicSubscription',
  'cursor',
  'mock',
];

/** Providers that run through the bundled Claudexor CLI with a vendor subscription login. */
export type SubscriptionProviderId = 'openaiSubscription' | 'anthropicSubscription';
export const SUBSCRIPTION_PROVIDER_IDS: SubscriptionProviderId[] = ['openaiSubscription', 'anthropicSubscription'];
export type ClaudexorHarnessId = 'claude' | 'codex';
export const SUBSCRIPTION_HARNESS: Record<SubscriptionProviderId, ClaudexorHarnessId> = {
  openaiSubscription: 'codex',
  anthropicSubscription: 'claude',
};

export interface ChatProviderSettings {
  baseUrl: string;
  model: string;
}

/** Providers whose reasoning effort can be tuned (everything but Hermes / xplain / mock). */
export type EffortProviderId = 'openai' | 'anthropic' | 'openaiSubscription' | 'anthropicSubscription' | 'cursor';
export const EFFORT_PROVIDER_IDS: EffortProviderId[] = ['openai', 'anthropic', 'openaiSubscription', 'anthropicSubscription', 'cursor'];

/**
 * Known effort vocabularies, weakest → strongest. Open lists: the UI lets you type any
 * slug, since vendors add levels (and Claudexor clamps to what the model advertises).
 * Cursor levels come from the model's parameter definitions at list time.
 */
export const EFFORT_LEVELS: Record<EffortProviderId, string[]> = {
  openai: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
  anthropic: ['low', 'medium', 'high', 'xhigh', 'max'],
  openaiSubscription: ['minimal', 'low', 'medium', 'high', 'xhigh'],
  anthropicSubscription: ['low', 'medium', 'high', 'xhigh', 'max'],
  cursor: ['low', 'medium', 'high'],
};

export interface EffortSettings {
  /** Reasoning effort level; empty = vendor/model default. */
  effort: string;
}

export interface CursorProviderSettings extends EffortSettings {
  /** Model id from Cursor.models.list(), e.g. composer-2.5. */
  model: string;
}

export interface SubscriptionProviderSettings extends EffortSettings {
  /** Vendor model id passed to the harness; empty = harness default. */
  model: string;
}

export type ClaudexorMode = 'auto' | 'ask' | 'agent';
export type ClaudexorProject = 'auto' | 'workspace' | 'private';

export interface ClaudexorSettings {
  /** Explicit `claudexor` CLI entry; empty = the copy bundled with XPlain. */
  cliPath: string;
  /** Node.js >= 24.15 binary used to run the CLI; empty = auto-detect. */
  nodePath: string;
  /** `auto`: write-capable `agent` run when Excalidraw is on, read-only `ask` otherwise. */
  mode: ClaudexorMode;
  /** Where `agent` runs work: the workspace (git repos only in `auto`) or a private per-workspace dir. */
  project: ClaudexorProject;
  /** Download an official Node.js build into global storage when none >= 24.15 is found. */
  autoInstallNode: boolean;
  /** Version to download; empty = extension default. */
  nodeVersion: string;
}

/** Everything the Agent tab edits. Secrets are never included, only `hasKey`. */
export interface AgentSettings {
  provider: AgentProviderId;
  /** XPlain-contract endpoint (provider = xplain). */
  endpoint: string;
  /** Idle timeout in whole minutes (UI + settings). Converted to ms for HTTP. */
  timeoutMinutes: number;
  streaming: boolean;
  /** Extra headers sent to any provider. */
  headers: Record<string, string>;
  /** Empty = built-in default prompt (chat providers only). */
  systemPrompt: string;
  hermes: ChatProviderSettings;
  openai: ChatProviderSettings & EffortSettings;
  anthropic: ChatProviderSettings & EffortSettings & { maxTokens: number };
  openaiSubscription: SubscriptionProviderSettings;
  anthropicSubscription: SubscriptionProviderSettings;
  cursor: CursorProviderSettings;
  claudexor: ClaudexorSettings;
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
  /** Per-model reasoning-effort levels advertised by the server (Cursor model parameters). */
  efforts?: Record<string, string[]>;
  /** Set when the list could not be fetched (server down, bad key, no discovery endpoint). */
  error?: string;
}
