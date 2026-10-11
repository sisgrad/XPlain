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
  BackgroundState,
  BusyState,
  DraftState,
  ExplainLanguage,
  ResultFormat,
  SessionMeta,
  SettingsTarget,
  TemplateFile,
  TemplateMeta,
} from './types';

export type PanelTab = 'context' | 'result' | 'templates' | 'history' | 'agent';

export interface InitState {
  draft: DraftState;
  sessions: SessionMeta[];
  templates: TemplateMeta[];
  pickMode: boolean;
  busy: BusyState;
  background: BackgroundState;
  /** Webview URI of the stylesheet for highlight.js. */
  hasWorkspace: boolean;
  agentLabel: string;
  agentSettings: AgentSettingsView;
}

export type HostMessage =
  | { type: 'init'; state: InitState }
  | { type: 'draft'; draft: DraftState }
  | { type: 'sessions'; sessions: SessionMeta[] }
  | { type: 'templates'; templates: TemplateMeta[] }
  | { type: 'pickMode'; active: boolean }
  | { type: 'busy'; busy: BusyState }
  | { type: 'background'; background: BackgroundState }
  | { type: 'agentLabel'; label: string }
  | {
      type: 'showResult';
      session: SessionMeta;
      format: ResultFormat;
      /** Markdown source, or full HTML document (rendered via iframe srcdoc). */
      content: string;
      /** @deprecated Prefer `content` + srcdoc; kept as a fallback URI. */
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
  | { type: 'openSession'; sessionId: string }
  | { type: 'openSessionInEditor'; sessionId: string }
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
    }
  | { type: 'deleteTemplate'; templateId: string }
  | { type: 'loadTemplateForEdit'; templateId: string }
  | { type: 'pickTemplateFiles' }
  | { type: 'readUris'; uris: string[] }
  | { type: 'chooseBackground' }
  | { type: 'clearBackground' }
  | { type: 'dropBackground'; name: string; dataBase64: string }
  | { type: 'openSettings' }
  | { type: 'saveAgentSettings'; settings: AgentSettings; target: SettingsTarget }
  | { type: 'setAgentKey'; provider: AgentProviderId; key: string }
  | { type: 'clearAgentKey'; provider: AgentProviderId }
  | { type: 'testAgent'; settings: AgentSettings }
  | { type: 'listModels'; settings: AgentSettings; requestId: number }
  | { type: 'openExternal'; url: string }
  | { type: 'log'; message: string };

export function isViewMessage(value: unknown): value is ViewMessage {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}
