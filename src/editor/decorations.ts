/**
 * Editor decorations: a gutter icon + subtle background for anchored blocks,
 * with a hover listing the explanations (clickable command links), plus a
 * distinct highlight for blocks currently in the draft context.
 */
import * as vscode from 'vscode';
import type { ContextDraft } from '../context/ContextDraft';
import type { DriftLevel } from '../shared/types';
import type { XplainStore } from '../storage/XplainStore';
import type { DriftTracker } from './DriftTracker';
import { describeDrift } from './drift';
import type { LiveAnchors } from './LiveAnchors';

export class AnchorDecorations implements vscode.Disposable {
  private readonly anchored: vscode.TextEditorDecorationType;
  /** Dimmed, dashed variant for blocks whose explanations no longer match the code. */
  private readonly drifted: vscode.TextEditorDecorationType;
  private readonly inDraft: vscode.TextEditorDecorationType;
  private readonly disposables: vscode.Disposable[] = [];
  private timer: NodeJS.Timeout | undefined;

  constructor(
    context: vscode.ExtensionContext,
    private readonly store: XplainStore,
    private readonly live: LiveAnchors,
    private readonly draft: ContextDraft,
    private readonly drift: DriftTracker,
  ) {
    this.anchored = vscode.window.createTextEditorDecorationType({
      gutterIconSize: 'contain',
      light: { gutterIconPath: vscode.Uri.joinPath(context.extensionUri, 'media', 'gutter-light.svg') },
      dark: { gutterIconPath: vscode.Uri.joinPath(context.extensionUri, 'media', 'gutter-dark.svg') },
      overviewRulerColor: new vscode.ThemeColor('editorInfo.foreground'),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      isWholeLine: true,
      backgroundColor: new vscode.ThemeColor('editor.rangeHighlightBackground'),
    });
    this.drifted = vscode.window.createTextEditorDecorationType({
      gutterIconSize: 'contain',
      light: { gutterIconPath: vscode.Uri.joinPath(context.extensionUri, 'media', 'gutter-drift-light.svg') },
      dark: { gutterIconPath: vscode.Uri.joinPath(context.extensionUri, 'media', 'gutter-drift-dark.svg') },
      overviewRulerColor: new vscode.ThemeColor('editorWarning.foreground'),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      isWholeLine: true,
      borderWidth: '0 0 0 2px',
      borderStyle: 'dashed',
      borderColor: new vscode.ThemeColor('editorWarning.foreground'),
      backgroundColor: new vscode.ThemeColor('editor.rangeHighlightBackground'),
    });
    this.inDraft = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: new vscode.ThemeColor('diffEditor.insertedLineBackground'),
      borderWidth: '0 0 0 2px',
      borderStyle: 'solid',
      borderColor: new vscode.ThemeColor('focusBorder'),
    });
    this.disposables.push(
      this.anchored,
      this.drifted,
      this.inDraft,
      vscode.window.onDidChangeVisibleTextEditors(() => this.schedule()),
      live.onDidChange(() => this.schedule()),
      store.onDidChange(() => this.schedule()),
      draft.onDidChange(() => this.schedule()),
      drift.onDidChange(() => this.schedule()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('xplain.editor') || e.affectsConfiguration('xplain.drift')) this.schedule();
      }),
    );
    this.schedule();
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.refreshAll(), 60);
  }

  refreshAll(): void {
    for (const editor of vscode.window.visibleTextEditors) this.refresh(editor);
  }

  private refresh(editor: vscode.TextEditor): void {
    const cfg = vscode.workspace.getConfiguration('xplain.editor');
    const show = cfg.get<boolean>('highlightBlocks', true);
    const hideOutdated = cfg.get<boolean>('hideOutdated', false);
    const driftMap = this.drift.current;
    const doc = editor.document;
    const anchoredOpts: vscode.DecorationOptions[] = [];
    const driftedOpts: vscode.DecorationOptions[] = [];
    const draftOpts: vscode.DecorationOptions[] = [];
    const draftIds = new Set(this.draft.snapshot.items.flatMap((i) => (i.kind === 'code' ? [i.anchorId] : [])));
    const levelOf = (id: string): DriftLevel => driftMap[id]?.level ?? 'fresh';

    for (const liveAnchor of this.live.forDocument(doc)) {
      if (liveAnchor.stale) continue;
      const range = toRange(doc, liveAnchor.range.startLine, liveAnchor.range.endLine);
      if (draftIds.has(liveAnchor.anchor.id)) {
        draftOpts.push({ range, hoverMessage: 'In XPlain context (not sent yet)' });
      }
      if (!show) continue;
      let sessions = this.store.sessionsForAnchor(liveAnchor.anchor.id).filter((s) => s.status === 'done');
      if (hideOutdated) sessions = sessions.filter((s) => levelOf(s.id) !== 'outdated' && levelOf(s.id) !== 'lost');
      if (sessions.length === 0) continue;

      const anyDrift = sessions.some((s) => levelOf(s.id) !== 'fresh');
      const md = new vscode.MarkdownString(undefined, true);
      md.isTrusted = true;
      md.supportThemeIcons = true;
      md.appendMarkdown(`**XPlain** · lines ${liveAnchor.range.startLine}-${liveAnchor.range.endLine}\n\n`);
      for (const s of sessions.slice(0, 8)) {
        const open = `command:xplain.openResult?${encodeURIComponent(JSON.stringify([s.id]))}`;
        const add = `command:xplain.addResultToContext?${encodeURIComponent(JSON.stringify([s.id]))}`;
        const refresh = `command:xplain.refreshExplanation?${encodeURIComponent(JSON.stringify([s.id]))}`;
        const diff = `command:xplain.showCodeDiff?${encodeURIComponent(JSON.stringify([s.id]))}`;
        const d = driftMap[s.id];
        let line = `- [${escapeMd(s.title)}](${open} "Open") · [$(add)](${add} "Add to context")`;
        if (d && d.level !== 'fresh') {
          const icon = d.level === 'outdated' || d.level === 'lost' ? '$(warning)' : '$(edit)';
          line += ` · ${icon} _${describeDrift(d)}_ · [$(diff) diff](${diff} "Show code diff") · [$(sync) refresh](${refresh} "Re-explain against current code")`;
        }
        md.appendMarkdown(`${line}\n`);
      }
      if (sessions.length > 8) md.appendMarkdown(`- … ${sessions.length - 8} more\n`);
      const all = `command:xplain.showResults?${encodeURIComponent(JSON.stringify([liveAnchor.anchor.id]))}`;
      md.appendMarkdown(`\n[$(list-unordered) All explanations](${all})`);
      (anyDrift ? driftedOpts : anchoredOpts).push({ range, hoverMessage: md });
    }
    editor.setDecorations(this.anchored, anchoredOpts);
    editor.setDecorations(this.drifted, driftedOpts);
    editor.setDecorations(this.inDraft, draftOpts);
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.disposables.forEach((d) => d.dispose());
  }
}

export function toRange(doc: vscode.TextDocument, startLine: number, endLine: number): vscode.Range {
  const s = Math.max(0, Math.min(doc.lineCount - 1, startLine - 1));
  const e = Math.max(s, Math.min(doc.lineCount - 1, endLine - 1));
  return new vscode.Range(s, 0, e, doc.lineAt(e).text.length);
}

function escapeMd(text: string): string {
  return text.replace(/[[\]\\`*_]/g, (m) => `\\${m}`);
}
