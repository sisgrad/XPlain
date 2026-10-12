import * as vscode from 'vscode';
import type { DriftLevel } from '../shared/types';
import type { XplainStore } from '../storage/XplainStore';
import type { DriftTracker } from './DriftTracker';
import type { LiveAnchors } from './LiveAnchors';

/**
 * One CodeLens above every anchored block: "N explanations · <latest title>",
 * with a drift marker when the code moved on since the explanation.
 */
export class XplainCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changeEmitter.event;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly store: XplainStore,
    private readonly live: LiveAnchors,
    private readonly drift: DriftTracker,
  ) {
    this.disposables.push(
      live.onDidChange(() => this.changeEmitter.fire()),
      store.onDidChange(() => this.changeEmitter.fire()),
      drift.onDidChange(() => this.changeEmitter.fire()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('xplain.editor') || e.affectsConfiguration('xplain.drift')) this.changeEmitter.fire();
      }),
    );
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const cfg = vscode.workspace.getConfiguration('xplain.editor');
    if (!cfg.get<boolean>('showCodeLens', true)) return [];
    const hideOutdated = cfg.get<boolean>('hideOutdated', false);
    const driftMap = this.drift.current;
    const lenses: vscode.CodeLens[] = [];
    for (const live of this.live.forDocument(document)) {
      if (live.stale) continue;
      let sessions = this.store.sessionsForAnchor(live.anchor.id).filter((s) => s.status === 'done');
      const levelOf = (id: string): DriftLevel => driftMap[id]?.level ?? 'fresh';
      if (hideOutdated) sessions = sessions.filter((s) => levelOf(s.id) !== 'outdated' && levelOf(s.id) !== 'lost');
      if (sessions.length === 0) continue;

      const line = Math.max(0, Math.min(document.lineCount - 1, live.range.startLine - 1));
      const range = new vscode.Range(line, 0, line, 0);
      const latest = sessions[0];
      const outdated = sessions.filter((s) => levelOf(s.id) === 'outdated').length;
      const drifted = sessions.filter((s) => levelOf(s.id) === 'drifted').length;

      let title =
        sessions.length === 1
          ? `$(comment-discussion) XPlain: ${latest.title}`
          : `$(comment-discussion) XPlain: ${sessions.length} explanations · ${latest.title}`;
      let tooltip = `Lines ${live.range.startLine}-${live.range.endLine}. Click to choose an explanation.`;
      if (sessions.length === 1) {
        const lvl = levelOf(latest.id);
        if (lvl === 'outdated') {
          title += ' · $(warning) outdated';
          tooltip += `\nCode changed significantly since this explanation (${driftMap[latest.id]?.changedLines ?? 0} lines). Use Refresh.`;
        } else if (lvl === 'drifted') {
          title += ' · $(edit) code changed';
          tooltip += `\nCode changed since this explanation (${driftMap[latest.id]?.changedLines ?? 0} lines).`;
        }
      } else if (outdated || drifted) {
        const parts: string[] = [];
        if (outdated) parts.push(`${outdated} outdated`);
        if (drifted) parts.push(`${drifted} changed`);
        title += ` · $(warning) ${parts.join(', ')}`;
        tooltip += `\n${parts.join(', ')} since the code was edited.`;
      }

      lenses.push(
        new vscode.CodeLens(range, {
          title,
          tooltip,
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
