/**
 * Agent-agnostic skill layout under `.xplain/skills/`, plus per-agent bridge paths
 * used only at runtime for discovery (Cursor / Claude-compatible harnesses).
 */
import type { AgentProviderId } from '../shared/types';

export const XPLAIN_SKILLS_DIR = '.xplain/skills';

/** How an agent discovers skills on disk (if at all). */
export type SkillBridgeKind = 'cursor' | 'claude' | 'none';

/** Canonical workspace-relative path for a skill id. */
export function canonicalSkillPath(skillId: string): string {
  return `${XPLAIN_SKILLS_DIR}/${skillId}`;
}

/** Bridge root where a given agent family auto-discovers skills. */
export function bridgeSkillPath(skillId: string, kind: SkillBridgeKind): string {
  switch (kind) {
    case 'cursor':
      return `.cursor/skills/${skillId}`;
    case 'claude':
      return `.claude/skills/${skillId}`;
    case 'none':
      return canonicalSkillPath(skillId);
  }
}

/** Which bridge (if any) to materialize for this XPlain provider. */
export function skillBridgeForProvider(provider: AgentProviderId): SkillBridgeKind {
  switch (provider) {
    case 'cursor':
      return 'cursor';
    case 'hermes':
    case 'anthropic':
    case 'anthropicSubscription':
      // Hermes / Claude Code conventions: .claude/skills/
      return 'claude';
    case 'openai':
    case 'xplain':
    case 'mock':
    case 'openaiSubscription':
    default:
      // No auto-discovery — agent is told to read the canonical path from the prompt.
      return 'none';
  }
}

export interface SkillAdaptation {
  skillId: string;
  /** Always `.xplain/skills/<id>` — durable store. */
  canonicalPath: string;
  /** Path the agent should open for this request (bridge or canonical). */
  agentPath: string;
  bridge: SkillBridgeKind;
}
