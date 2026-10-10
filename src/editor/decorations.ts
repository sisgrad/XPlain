/**
 * Editor decorations: a gutter icon + subtle background for anchored blocks,
 * with a hover listing the explanations (clickable command links), plus a
 * distinct highlight for blocks currently in the draft context.
 */
import * as vscode from 'vscode';
import type { ContextDraft } from '../context/ContextDraft';
import type { XplainStore } from '../storage/XplainStore';
import type { LiveAnchors } from './LiveAnchors';

export class AnchorDecorations implements vscode.Disposable {
  private readonly anchored: vscode.TextEditorDecorationType;
  private readonly inDraft: vscode.TextEditorDecorationType;
  private readonly disposables: vscode.Disposable[] = [];
  private timer: NodeJS.Timeout | undefined;

  constructor(
    context: vscode.ExtensionContext,
    private readonly store: XplainStore,
    private readonly live: LiveAnchors,
    private readonly draft: ContextDraft,
  ) {
    this.anchored = vscode.window.createTextEditorDecorationType({
      gutterIconPath: vscode.Uri.joinPath(context.extensionUri, 'media', 'gutter.svg'),
      gutterIconSize: 'contain',
      overviewRulerColor: new vscode.ThemeColor('editorInfo.foreground'),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      isWholeLine: true,
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
      this.inDraft,
      vscode.window.onDidChangeVisibleTextEditors(() => this.schedule()),
      live.onDidChange(() => this.schedule()),
      store.onDidChange(() => this.schedule()),
      draft.onDidChange(() => this.schedule()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('xplain.editor')) this.schedule();
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
    const show = vscode.workspace.getConfiguration('xplain.editor').get<boolean>('highlightBlocks', true);
    const doc = editor.document;
    const anchoredOpts: vscode.DecorationOptions[] = [];
    const draftOpts: vscode.DecorationOptions[] = [];
    const draftIds = new Set(this.draft.snapshot.items.flatMap((i) => (i.kind === 'code' ? [i.anchorId] : [])));

    for (const liveAnchor of this.live.forDocument(doc)) {
      if (liveAnchor.stale) continue;
      const range = toRange(doc, liveAnchor.range.startLine, liveAnchor.range.endLine);
      if (draftIds.has(liveAnchor.anchor.id)) {
        draftOpts.push({ range, hoverMessage: 'In XPlain context (not sent yet)' });
      }
      if (!show) continue;
      const sessions = this.store.sessionsForAnchor(liveAnchor.anchor.id).filter((s) => s.status === 'done');
      if (sessions.length === 0) continue;
      const md = new vscode.MarkdownString(undefined, true);
      md.isTrusted = true;
      md.supportThemeIcons = true;
      md.appendMarkdown(`**XPlain** · lines ${liveAnchor.range.startLine}-${liveAnchor.range.endLine}\n\n`);
      for (const s of sessions.slice(0, 8)) {
        const open = `command:xplain.openResult?${encodeURIComponent(JSON.stringify([s.id]))}`;
        const add = `command:xplain.addResultToContext?${encodeURIComponent(JSON.stringify([s.id]))}`;
        md.appendMarkdown(`- [${escapeMd(s.title)}](${open} "Open") · [$(add)](${add} "Add to context")\n`);
      }
      if (sessions.length > 8) md.appendMarkdown(`- … ${sessions.length - 8} more\n`);
      const all = `command:xplain.showResults?${encodeURIComponent(JSON.stringify([liveAnchor.anchor.id]))}`;
      md.appendMarkdown(`\n[$(list-unordered) All explanations](${all})`);
      anchoredOpts.push({ range, hoverMessage: md });
    }
    editor.setDecorations(this.anchored, anchoredOpts);
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
