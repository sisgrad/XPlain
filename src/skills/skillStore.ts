/**
 * Install bundled skills into the agent-agnostic store (`.xplain/skills/`) and
 * optionally materialize a provider-specific discovery bridge at send time.
 */
import * as vscode from 'vscode';
import type { AgentProviderId } from '../shared/types';
import {
  bridgeSkillPath,
  canonicalSkillPath,
  skillBridgeForProvider,
  type SkillAdaptation,
} from './skillPaths';

export { XPLAIN_SKILLS_DIR, canonicalSkillPath, skillBridgeForProvider, bridgeSkillPath } from './skillPaths';
export type { SkillAdaptation, SkillBridgeKind } from './skillPaths';

/** Copy `extension/skills/<skillId>/` → `.xplain/skills/<skillId>/`. */
export async function ensureSkillInStore(extensionUri: vscode.Uri, skillId: string): Promise<string> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) throw new Error('Open a folder to install skills.');
  const srcRoot = vscode.Uri.joinPath(extensionUri, 'skills', skillId);
  const dstRoot = vscode.Uri.joinPath(folder.uri, ...canonicalSkillPath(skillId).split('/'));
  await copyTree(srcRoot, dstRoot);
  return canonicalSkillPath(skillId);
}

/**
 * Ensure the skill exists in `.xplain/skills/`, then sync a bridge directory for
 * the selected agent (Cursor → `.cursor/skills/`, Claude/Hermes → `.claude/skills/`).
 */
export async function prepareSkillForProvider(
  extensionUri: vscode.Uri,
  skillId: string,
  provider: AgentProviderId,
): Promise<SkillAdaptation> {
  const canonicalPath = await ensureSkillInStore(extensionUri, skillId);
  const bridge = skillBridgeForProvider(provider);
  const agentPath = bridgeSkillPath(skillId, bridge);
  if (bridge !== 'none') {
    const folder = vscode.workspace.workspaceFolders![0];
    const srcRoot = vscode.Uri.joinPath(folder.uri, ...canonicalPath.split('/'));
    const dstRoot = vscode.Uri.joinPath(folder.uri, ...agentPath.split('/'));
    await copyTree(srcRoot, dstRoot);
  }
  return { skillId, canonicalPath, agentPath, bridge };
}

async function copyTree(src: vscode.Uri, dst: vscode.Uri): Promise<void> {
  await vscode.workspace.fs.createDirectory(dst);
  for (const [name, type] of await vscode.workspace.fs.readDirectory(src)) {
    if (name === '.git' || name === '.gitignore') continue;
    const from = vscode.Uri.joinPath(src, name);
    const to = vscode.Uri.joinPath(dst, name);
    if (type === vscode.FileType.Directory) await copyTree(from, to);
    else if (type === vscode.FileType.File) await vscode.workspace.fs.copy(from, to, { overwrite: true });
  }
}
