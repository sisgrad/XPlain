/**
 * Typed message protocol between the extension host and the webview.
 * `HostMessage` flows host -> webview, `ViewMessage` flows webview -> host.
 */
import type {
  AgentModelsResult,
  AgentProviderId,
  AgentSettings,
  AgentSettingsView,
  AgentTestResult,
  ClaudexorHarnessId,
  BusyState,
  DraftState,
  ExplainLanguage,
  ResultFormat,
  SessionDriftSummary,
  SessionMeta,
  SettingsTarget,
  TemplateFile,
  TemplateMeta,
} from './types';

/** sessionId → drift summary (sessions without code blocks are omitted). */
export type DriftMap = Record<string, SessionDriftSummary>;

export type ClaudexorSetupAction = 'install' | 'login' | 'doctor' | 'quota' | 'node';

export type PanelTab = 'context' | 'result' | 'templates' | 'history' | 'agent';

export interface InitState {
  draft: DraftState;
  sessions: SessionMeta[];
  templates: TemplateMeta[];
  pickMode: boolean;
  busy: BusyState;
  /** Webview URI of the stylesheet for highlight.js. */
  hasWorkspace: boolean;
  agentLabel: string;
  agentSettings: AgentSettingsView;
  drift: DriftMap;
}

export type HostMessage =
  | { type: 'init'; state: InitState }
  | { type: 'draft'; draft: DraftState }
  | { type: 'sessions'; sessions: SessionMeta[] }
  | { type: 'drift'; drift: DriftMap }
  | { type: 'templates'; templates: TemplateMeta[] }
  | { type: 'pickMode'; active: boolean }
  | { type: 'busy'; busy: BusyState }
  | { type: 'agentLabel'; label: string }
  | {
      type: 'showResult';
      session: SessionMeta;
      format: ResultFormat;
      /** Markdown source, or full HTML document (rendered via Shadow DOM). */
      content: string;
      /** True while host still prepares HTML; Result chrome (Download) is usable. */
      contentPending?: boolean;
      /** @deprecated Prefer `content` + Shadow DOM; kept as a fallback URI. */
      htmlUri?: string;
    }
  | { type: 'streamStart'; sessionId: string; title: string }
  | { type: 'streamDelta'; sessionId: string; text: string }
  | { type: 'streamEnd'; sessionId: string }
  | { type: 'templateFiles'; files: TemplateFile[] }
  | { type: 'editTemplate'; template: TemplateMeta; files: TemplateFile[] }
  | { type: 'tab'; tab: PanelTab }
  | { type: 'agentSettings'; settings: AgentSettingsView }
  | { type: 'agentTest'; result: AgentTestResult }
  | { type: 'agentModels'; result: AgentModelsResult }
  | { type: 'notice'; level: 'info' | 'warn' | 'error'; message: string };

export type ViewMessage =
  | { type: 'ready' }
  | { type: 'setQuestion'; text: string }
  | { type: 'setTemplate'; templateId: string | null }
  | { type: 'setExplainLanguage'; language: ExplainLanguage }
  | { type: 'setUseExcalidraw'; enabled: boolean }
  | { type: 'removeItem'; index: number }
  | { type: 'moveItem'; from: number; to: number }
  | { type: 'clearDraft' }
  | { type: 'send' }
  | { type: 'cancel' }
  | { type: 'beginExtend'; sessionId: string }
  | { type: 'cancelExtend' }
  /** Re-explain against the current code (seeds Extend with a diff and sends). */
  | { type: 'refreshSession'; sessionId: string }
  /** Open VS Code diff editors: code the agent saw vs the code now. */
  | { type: 'showCodeDiff'; sessionId: string }
  | { type: 'addDraftFiles'; files: Array<{ name: string; content: string }> }
  | { type: 'openSession'; sessionId: string }
  | { type: 'openSessionInEditor'; sessionId: string }
  | { type: 'downloadSession'; sessionId: string }
  | { type: 'addSessionToDraft'; sessionId: string }
  | { type: 'deleteSession'; sessionId: string }
  | { type: 'renameSession'; sessionId: string; title: string }
  | { type: 'revealAnchor'; anchorId: string }
  | { type: 'togglePickMode' }
  | {
      type: 'saveTemplate';
      id: string | null;
      name: string;
      instruction: string;
      files: TemplateFile[];
      /** Required for new templates; ignored when updating an existing id (keeps its scope). */
      scope: 'user' | 'project';
    }
  | { type: 'deleteTemplate'; templateId: string }
  | { type: 'loadTemplateForEdit'; templateId: string }
  | { type: 'duplicateTemplate'; templateId: string; scope: 'user' | 'project' }
  | { type: 'pickTemplateFiles' }
  | { type: 'readUris'; uris: string[]; destination?: 'template' | 'draft' }
  | { type: 'openSettings' }
  | { type: 'saveAgentSettings'; settings: AgentSettings; target: SettingsTarget }
  | { type: 'setAgentKey'; provider: AgentProviderId; key: string }
  | { type: 'clearAgentKey'; provider: AgentProviderId }
  | { type: 'testAgent'; settings: AgentSettings }
  | { type: 'listModels'; settings: AgentSettings; requestId: number }
  /** Open a terminal that installs / logs in / diagnoses a Claudexor harness (subscription providers). */
  | { type: 'claudexorSetup'; harness: ClaudexorHarnessId; action: ClaudexorSetupAction }
  | { type: 'openExternal'; url: string }
  | { type: 'log'; message: string };

export function isViewMessage(value: unknown): value is ViewMessage {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}
