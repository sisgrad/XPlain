/**
 * Install the bundled Excalidraw Diagram skill into the workspace so coding
 * agents (Hermes, Claude Code, …) can load it from `.claude/skills/…`.
 */
import * as vscode from 'vscode';
import { EXCALIDRAW_SKILL_ID, EXCALIDRAW_SKILL_WORKSPACE_PATH } from './excalidrawInstructions';

export {
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
 * Copy the bundled skill into `.claude/skills/excalidraw-diagram/` of the first
 * workspace folder. Overwrites existing files so the workspace stays in sync
 * with the skill version shipped in the extension. Returns the relative path.
 */
export async function ensureExcalidrawSkillInstalled(extensionUri: vscode.Uri): Promise<string> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) throw new Error('Open a folder to install the Excalidraw skill.');
  const srcRoot = bundledSkillUri(extensionUri);
  const dstRoot = vscode.Uri.joinPath(folder.uri, '.claude', 'skills', EXCALIDRAW_SKILL_ID);
  await copyTree(srcRoot, dstRoot);
  return EXCALIDRAW_SKILL_WORKSPACE_PATH;
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
