import type { ResultFormat } from '../shared/types';

/** Items exactly as they are sent to the agent service. */
export type AgentItem =
  | {
      type: 'code';
      file: string;
      startLine: number;
      endLine: number;
      language: string;
      text: string;
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
