import * as vscode from 'vscode';
import type { XplainStore } from '../storage/XplainStore';
import type { LiveAnchors } from './LiveAnchors';

/** One CodeLens above every anchored block: "N explanations · <latest title>". */
export class XplainCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changeEmitter.event;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly store: XplainStore,
    private readonly live: LiveAnchors,
  ) {
    this.disposables.push(
      live.onDidChange(() => this.changeEmitter.fire()),
      store.onDidChange(() => this.changeEmitter.fire()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('xplain.editor')) this.changeEmitter.fire();
      }),
    );
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!vscode.workspace.getConfiguration('xplain.editor').get<boolean>('showCodeLens', true)) return [];
    const lenses: vscode.CodeLens[] = [];
    for (const live of this.live.forDocument(document)) {
      if (live.stale) continue;
      const sessions = this.store.sessionsForAnchor(live.anchor.id).filter((s) => s.status === 'done');
      if (sessions.length === 0) continue;
      const line = Math.max(0, Math.min(document.lineCount - 1, live.range.startLine - 1));
      const range = new vscode.Range(line, 0, line, 0);
      const latest = sessions[0];
      const title =
        sessions.length === 1
          ? `$(comment-discussion) XPlain: ${latest.title}`
          : `$(comment-discussion) XPlain: ${sessions.length} explanations · ${latest.title}`;
      lenses.push(
        new vscode.CodeLens(range, {
          title,
          tooltip: `Lines ${live.range.startLine}-${live.range.endLine}. Click to choose an explanation.`,
          command: 'xplain.showResults',
          arguments: [live.anchor.id],
        }),
      );
    }
    return lenses;
  }

  refresh(): void {
    this.changeEmitter.fire();
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.changeEmitter.dispose();
  }
}
