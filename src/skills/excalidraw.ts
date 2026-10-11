/**
 * Excalidraw Diagram skill: durable install under `.xplain/skills/`, plus
 * provider-specific discovery bridges prepared at send time.
 */
import type * as vscode from 'vscode';
import type { AgentProviderId } from '../shared/types';
import { EXCALIDRAW_SKILL_CANONICAL_PATH, EXCALIDRAW_SKILL_ID } from './excalidrawInstructions';
import { ensureSkillInStore, prepareSkillForProvider, type SkillAdaptation } from './skillStore';

export {
  EXCALIDRAW_SKILL_CANONICAL_PATH,
  EXCALIDRAW_SKILL_ID,
  EXCALIDRAW_SKILL_REPO,
  EXCALIDRAW_SKILL_WORKSPACE_PATH,
  excalidrawAgentInstructions,
} from './excalidrawInstructions';
export type { SkillAdaptation } from './skillStore';

/** @deprecated Prefer {@link prepareExcalidrawSkillForProvider}. */
export async function ensureExcalidrawSkillInstalled(extensionUri: vscode.Uri): Promise<string> {
  return ensureSkillInStore(extensionUri, EXCALIDRAW_SKILL_ID);
}

/** Install into `.xplain/skills/` and adapt for the selected agent provider. */
export async function prepareExcalidrawSkillForProvider(
  extensionUri: vscode.Uri,
  provider: AgentProviderId,
): Promise<SkillAdaptation> {
  return prepareSkillForProvider(extensionUri, EXCALIDRAW_SKILL_ID, provider);
}

export function excalidrawCanonicalPath(): string {
  return EXCALIDRAW_SKILL_CANONICAL_PATH;
}
