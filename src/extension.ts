import * as vscode from 'vscode';
import { ContextDraft } from './context/ContextDraft';
import { AnchorDecorations } from './editor/decorations';
import { LiveAnchors } from './editor/LiveAnchors';
import { PickMode } from './editor/pickMode';
import { XplainCodeLensProvider } from './editor/XplainCodeLensProvider';
import { BackgroundManager } from './panel/background';
import { VIEW_ID, XplainViewProvider } from './panel/XplainViewProvider';
import { VscodeStoreFs } from './storage/vscodeFs';
import { XPLAIN_DIR, XplainStore } from './storage/XplainStore';
import { XplainController } from './XplainController';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel('XPlain');
  context.subscriptions.push(output);

  const folder = vscode.workspace.workspaceFolders?.[0];
  let store: XplainStore | undefined;
  let storeFs: VscodeStoreFs | undefined;
  let live: LiveAnchors | undefined;

  if (folder) {
    storeFs = new VscodeStoreFs(vscode.Uri.joinPath(folder.uri, XPLAIN_DIR));
    store = new XplainStore(storeFs);
    try {
      await store.init();
      output.appendLine(`[init] storage: ${storeFs.uri('').fsPath}`);
    } catch (err) {
      output.appendLine(`[init] failed to initialise .xplain: ${(err as Error).message}`);
      void vscode.window.showErrorMessage(`XPlain: cannot create ${XPLAIN_DIR} folder: ${(err as Error).message}`);
      store = undefined;
      storeFs = undefined;
    }
  } else {
    output.appendLine('[init] no workspace folder; storage disabled');
  }

  const draft = new ContextDraft();
  const pickMode = new PickMode();
  const view = new XplainViewProvider(context, () => (storeFs ? [storeFs.uri('')] : []));
  const background = new BackgroundManager(context, store, storeFs);
  context.subscriptions.push(
    pickMode,
    view,
    vscode.window.registerWebviewViewProvider(VIEW_ID, view, { webviewOptions: { retainContextWhenHidden: true } }),
  );

  if (store) {
    live = new LiveAnchors(store);
    const lens = new XplainCodeLensProvider(store, live);
    const decorations = new AnchorDecorations(context, store, live, draft);
    context.subscriptions.push(
      live,
      lens,
      decorations,
      vscode.languages.registerCodeLensProvider({ scheme: 'file' }, lens),
    );

    // Pick up external edits to .xplain (git checkout, manual edits, another window).
    const s = store;
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(folder!, `${XPLAIN_DIR}/{index.json,templates/**}`),
    );
    let reloadTimer: NodeJS.Timeout | undefined;
    let ownWrite = 0;
    const scheduleReload = () => {
      // Our own writes also trigger the watcher; skip events shortly after them.
      if (Date.now() - ownWrite < 1500) return;
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => void s.reload(), 500);
    };
    context.subscriptions.push(
      watcher,
      watcher.onDidChange(scheduleReload),
      watcher.onDidCreate(scheduleReload),
      watcher.onDidDelete(scheduleReload),
      s.onDidChange(() => {
        ownWrite = Date.now();
      }),
    );
  }

  const controller = new XplainController({ context, store, storeFs, view, live, draft, pickMode, background, output });
  controller.registerCommands();
  context.subscriptions.push(controller);

  void vscode.commands.executeCommand('setContext', 'xplain.pickMode', false);
  output.appendLine('[init] XPlain activated');
}

export function deactivate(): void {
  /* subscriptions are disposed by VS Code */
}
