import type { ExplainLanguage, ResultFormat } from '../shared/types';

/** Items exactly as they are sent to the agent service. */
export type AgentItem =
  | {
      type: 'code';
      file: string;
      startLine: number;
      endLine: number;
      language: string;
      /** Text of the focus block (the selection to explain). */
      text: string;
      /**
       * Full file contents at send time, for surrounding context.
       * The agent must still explain only `text` / the line range, not the whole file.
       * Omitted when the file could not be read or was too large.
       */
      fileText?: string;
    }
  | {
      type: 'result';
      title: string;
      format: ResultFormat;
      content: string;
    }
  | {
      type: 'template';
      name: string;
      instruction: string;
      files: Array<{ name: string; content: string }>;
    };

export interface AgentRequest {
  sessionId: string;
  question: string;
  items: AgentItem[];
  /** Workspace folder name, for the agent's information. */
  workspace?: string;
  /** Absolute filesystem path of the workspace root (where `.xplain/` lives). */
  workspaceRoot?: string;
  /** Preferred language for the written explanation. */
  explainLanguage?: ExplainLanguage;
  /** When true, the agent must use the Excalidraw Diagram skill. */
  useExcalidraw?: boolean;
  /**
   * Path the agent should open for this request (may be a provider bridge like
   * `.cursor/skills/…` or the durable `.xplain/skills/…` store).
   */
  excalidrawSkillPath?: string;
  /** Durable agent-agnostic store path (always `.xplain/skills/excalidraw-diagram`). */
  excalidrawSkillCanonicalPath?: string;
  /** How the skill was exposed for this provider (`none` = prompt path only). */
  excalidrawSkillBridge?: 'cursor' | 'claude' | 'none';
}

export interface AgentResponse {
  /** Short chat-like title; the extension derives one if omitted. */
  title?: string;
  format: ResultFormat;
  content: string;
}

export interface AgentCallOptions {
  signal: AbortSignal;
  /** Called with partial text while the agent streams (markdown only). */
  onDelta?: (text: string) => void;
}

export interface AgentProvider {
  readonly id: string;
  readonly label: string;
  explain(request: AgentRequest, options: AgentCallOptions): Promise<AgentResponse>;
}

export class AgentError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'AgentError';
  }
}
