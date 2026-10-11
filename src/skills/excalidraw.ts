/**
 * Install the bundled Excalidraw Diagram skill into the workspace so coding
 * agents can load it from `.claude/skills/…` (Claude/Hermes) and
 * `.cursor/skills/…` (Cursor IDE / Cursor SDK).
 */
import * as vscode from 'vscode';
import {
  EXCALIDRAW_SKILL_CURSOR_PATH,
  EXCALIDRAW_SKILL_ID,
  EXCALIDRAW_SKILL_WORKSPACE_PATH,
} from './excalidrawInstructions';

export {
  EXCALIDRAW_SKILL_CURSOR_PATH,
  EXCALIDRAW_SKILL_ID,
  EXCALIDRAW_SKILL_REPO,
  EXCALIDRAW_SKILL_WORKSPACE_PATH,
  excalidrawAgentInstructions,
} from './excalidrawInstructions';

/** Source directory inside the packaged extension. */
export function bundledSkillUri(extensionUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, 'skills', EXCALIDRAW_SKILL_ID);
}

/**
 * Copy the bundled skill into both Claude- and Cursor-compatible skill roots.
 * Overwrites existing files so the workspace stays in sync with the skill
 * version shipped in the extension. Returns the Claude-compatible relative path
 * (kept for backward compatibility with prompts / logs).
 */
export async function ensureExcalidrawSkillInstalled(extensionUri: vscode.Uri): Promise<string> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) throw new Error('Open a folder to install the Excalidraw skill.');
  const srcRoot = bundledSkillUri(extensionUri);
  const destinations = [
    vscode.Uri.joinPath(folder.uri, '.claude', 'skills', EXCALIDRAW_SKILL_ID),
    vscode.Uri.joinPath(folder.uri, '.cursor', 'skills', EXCALIDRAW_SKILL_ID),
  ];
  for (const dstRoot of destinations) await copyTree(srcRoot, dstRoot);
  return EXCALIDRAW_SKILL_WORKSPACE_PATH;
}

/** Cursor-native path (same install as {@link ensureExcalidrawSkillInstalled}). */
export function excalidrawCursorSkillPath(): string {
  return EXCALIDRAW_SKILL_CURSOR_PATH;
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
