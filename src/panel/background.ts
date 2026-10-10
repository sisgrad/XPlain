/**
 * Panel background image. Stored either per user (globalStorageUri) or per
 * project (.xplain/ui/). Project scope wins when both exist.
 */
import * as vscode from 'vscode';
import type { BackgroundFit, BackgroundState } from '../shared/types';
import type { XplainStore } from '../storage/XplainStore';
import type { VscodeStoreFs } from '../storage/vscodeFs';

const IMAGE_FILTER = { Images: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'] };
const USER_KEY = 'xplain.background.userFile';

export class BackgroundManager {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly store: XplainStore | undefined,
    private readonly storeFs: VscodeStoreFs | undefined,
  ) {}

  async getState(webview: vscode.Webview | undefined): Promise<BackgroundState> {
    const cfg = vscode.workspace.getConfiguration('xplain.ui.background');
    const base: BackgroundState = {
      uri: null,
      opacity: clamp(cfg.get<number>('opacity', 0.18), 0, 1),
      blur: clamp(cfg.get<number>('blur', 0), 0, 40),
      fit: cfg.get<BackgroundFit>('fit', 'cover'),
      scope: null,
    };
    if (!webview) return base;

    const projectRel = await this.store?.findBackgroundFile();
    if (projectRel && this.storeFs) {
      const uri = this.storeFs.uri(projectRel);
      return { ...base, uri: withCacheBuster(webview.asWebviewUri(uri)), scope: 'workspace' };
    }
    const userFile = this.context.globalState.get<string>(USER_KEY);
    if (userFile) {
      const uri = vscode.Uri.joinPath(this.context.globalStorageUri, userFile);
      try {
        await vscode.workspace.fs.stat(uri);
        return { ...base, uri: withCacheBuster(webview.asWebviewUri(uri)), scope: 'user' };
      } catch {
        await this.context.globalState.update(USER_KEY, undefined);
      }
    }
    return base;
  }

  /** Open a file dialog, then ask for the scope, then store the image. */
  async choose(): Promise<boolean> {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: IMAGE_FILTER,
      openLabel: 'Use as background',
      title: 'XPlain: choose a background image',
    });
    if (!picked || picked.length === 0) return false;
    const data = await vscode.workspace.fs.readFile(picked[0]);
    const ext = extOf(picked[0].path);
    return this.save(ext, data);
  }

  /** Store image bytes (e.g. dropped onto the panel). */
  async save(ext: string, data: Uint8Array): Promise<boolean> {
    if (data.byteLength > 15 * 1024 * 1024) {
      void vscode.window.showWarningMessage('XPlain: background image is larger than 15 MB; please pick a smaller file.');
      return false;
    }
    const scope = await this.askScope();
    if (!scope) return false;
    if (scope === 'workspace') {
      if (!this.store) {
        void vscode.window.showWarningMessage('XPlain: open a folder to store a per-project background.');
        return false;
      }
      await this.store.writeBackground(ext, data);
    } else {
      await vscode.workspace.fs.createDirectory(this.context.globalStorageUri);
      const previous = this.context.globalState.get<string>(USER_KEY);
      if (previous) {
        try {
          await vscode.workspace.fs.delete(vscode.Uri.joinPath(this.context.globalStorageUri, previous));
        } catch {
          /* ignore */
        }
      }
      const name = `background.${ext}`;
      await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(this.context.globalStorageUri, name), data);
      await this.context.globalState.update(USER_KEY, name);
    }
    return true;
  }

  async clear(): Promise<void> {
    const options: vscode.QuickPickItem[] = [];
    const hasProject = Boolean(await this.store?.findBackgroundFile());
    const hasUser = Boolean(this.context.globalState.get<string>(USER_KEY));
    if (hasProject) options.push({ label: 'This project', description: '.xplain/ui/background.*' });
    if (hasUser) options.push({ label: 'My user setting', description: 'applies to all projects' });
    if (options.length === 0) {
      void vscode.window.showInformationMessage('XPlain: no background image is set.');
      return;
    }
    const pick =
      options.length === 1 ? options[0] : await vscode.window.showQuickPick(options, { title: 'Clear which background?' });
    if (!pick) return;
    if (pick.label === 'This project') {
      await this.store?.clearBackground();
    } else {
      const previous = this.context.globalState.get<string>(USER_KEY);
      if (previous) {
        try {
          await vscode.workspace.fs.delete(vscode.Uri.joinPath(this.context.globalStorageUri, previous));
        } catch {
          /* ignore */
        }
      }
      await this.context.globalState.update(USER_KEY, undefined);
    }
  }

  private async askScope(): Promise<'user' | 'workspace' | undefined> {
    const items: Array<vscode.QuickPickItem & { scope: 'user' | 'workspace' }> = [
      { label: '$(account) For me (all projects)', description: 'stored in the extension\u2019s global storage', scope: 'user' },
      { label: '$(folder) For this project', description: 'stored in .xplain/ui/', scope: 'workspace' },
    ];
    const pick = await vscode.window.showQuickPick(items, { title: 'Where should the background apply?' });
    return pick?.scope;
  }
}

function extOf(path: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(path);
  const ext = (m?.[1] ?? 'png').toLowerCase();
  return ext === 'jpeg' ? 'jpg' : ext;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
}

function withCacheBuster(uri: vscode.Uri): string {
  return `${uri.toString()}?v=${Date.now()}`;
}
