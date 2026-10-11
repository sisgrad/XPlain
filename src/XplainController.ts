/**
 * Orchestrates everything: commands, webview messages, the draft context,
 * agent calls and result persistence.
 */
import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { AgentError, type AgentItem, type AgentRequest } from './agent/AgentProvider';
import { applyCursorIsolation, clearCursorSessionAllow } from './agent/cursorIsolation';
import { withSharedInstructions } from './agent/prompt';
import { AgentRegistry, PROVIDER_LABELS } from './agent/AgentRegistry';
import { inlineLocalAssets } from './agent/inlineAssets';
import { recoverHtmlAnswer } from './agent/recoverHtml';
import { deriveTitle } from './agent/titles';
import { ContextDraft } from './context/ContextDraft';
import { writeContextPrefs } from './context/ContextPrefs';
import { EXCALIDRAW_SKILL_CANONICAL_PATH, prepareExcalidrawSkillForProvider } from './skills/excalidraw';
import { formatRange } from './editor/anchors';
import { toRange } from './editor/decorations';
import { LiveAnchors } from './editor/LiveAnchors';
import { PickMode } from './editor/pickMode';
import { BackgroundManager } from './panel/background';
import type { XplainViewProvider } from './panel/XplainViewProvider';
import type { InitState, ViewMessage } from './shared/protocol';
import {
  AGENT_PROVIDER_IDS,
  DRAFT_FILE_MAX_BYTES,
  type AgentProviderId,
  type AgentSettings,
  type BusyState,
  type ContextItem,
  type DraftItem,
  type DraftState,
  type SessionMeta,
  type TemplateFile,
} from './shared/types';
import type { XplainStore } from './storage/XplainStore';
import type { VscodeStoreFs } from './storage/vscodeFs';

const MAX_TEMPLATE_FILE = 1024 * 1024;

interface Deps {
  context: vscode.ExtensionContext;
  store: XplainStore | undefined;
  storeFs: VscodeStoreFs | undefined;
  view: XplainViewProvider;
  live: LiveAnchors | undefined;
  draft: ContextDraft;
  pickMode: PickMode;
  background: BackgroundManager;
  output: vscode.OutputChannel;
}

export class XplainController implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private current: { sessionId: string; abort: AbortController; extending: boolean } | undefined;
  private readonly agents: AgentRegistry;

  constructor(private readonly d: Deps) {
    this.agents = new AgentRegistry(d.context);

    this.disposables.push(
      d.view.onDidReceiveMessage((m) => void this.handleMessage(m)),
      d.view.onDidResolve(() => void this.sendInit()),
      d.draft.onDidChange((draft) => d.view.post({ type: 'draft', draft })),
      d.pickMode.onDidChange((active) => d.view.post({ type: 'pickMode', active })),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('xplain.ui.background')) void this.pushBackground();
        if (e.affectsConfiguration('xplain.agent')) void this.pushAgentSettings();
      }),
    );
    if (d.store) {
      const store = d.store;
      this.disposables.push(
        store.onDidChange((c) => {
          if (c.kind === 'index') d.view.post({ type: 'sessions', sessions: this.sortedSessions() });
          if (c.kind === 'templates') d.view.post({ type: 'templates', templates: [...store.templateList] });
        }),
      );
    }
    if (d.live) {
      const live = d.live;
      this.disposables.push(live.onDidChange(() => d.draft.updateCodeRanges((id) => live.currentRange(id))));
    }
  }

  /* ------------------------------------------------------------ commands */

  registerCommands(): void {
    const reg = (id: string, fn: (...args: unknown[]) => unknown) =>
      this.disposables.push(vscode.commands.registerCommand(id, (...args) => this.guard(() => fn(...args))));

    reg('xplain.addSelectionToContext', () => this.addSelectionToContext());
    reg('xplain.togglePickMode', () => this.d.pickMode.toggle());
    reg('xplain.showResults', (anchorId) => this.showResultsForAnchor(String(anchorId)));
    reg('xplain.openResult', (sessionId) => this.openResult(String(sessionId)));
    reg('xplain.openResultInEditor', (sessionId) => this.openResultInEditor(String(sessionId)));
    reg('xplain.addResultToContext', (sessionId) => this.addResultToDraft(String(sessionId)));
    reg('xplain.clearContext', () => this.d.draft.clear());
    reg('xplain.focus', () => this.d.view.reveal(false));
    reg('xplain.cancelRequest', () => this.cancel());
    reg('xplain.setAgentApiKey', () => this.setApiKey());
    reg('xplain.clearAgentApiKey', async () => {
      const provider = await this.pickProvider('Remove the API key of which provider?');
      if (!provider) return;
      await this.agents.clearKey(provider);
      await this.pushAgentSettings();
      void vscode.window.showInformationMessage(`XPlain: API key for ${PROVIDER_LABELS[provider]} removed.`);
    });
    reg('xplain.configureAgent', async () => {
      await this.d.view.reveal(false);
      this.d.view.post({ type: 'tab', tab: 'agent' });
    });
    reg('xplain.chooseBackground', async () => {
      if (await this.d.background.choose()) await this.pushBackground();
    });
    reg('xplain.clearBackground', async () => {
      await this.d.background.clear();
      await this.pushBackground();
    });
    reg('xplain.openStorageFolder', async () => {
      if (!this.d.storeFs) return this.noWorkspace();
      await vscode.commands.executeCommand('revealInExplorer', this.d.storeFs.uri('index.json'));
    });
  }

  private async guard(fn: () => unknown): Promise<void> {
    try {
      await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.d.output.appendLine(`[error] ${msg}`);
      void vscode.window.showErrorMessage(`XPlain: ${msg}`);
    }
  }

  private noWorkspace(): void {
    void vscode.window.showWarningMessage('XPlain needs an open folder to store its data (.xplain/).');
  }

  /* ------------------------------------------------------- context (3,4) */

  async addSelectionToContext(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    if (!this.d.store) return this.noWorkspace();
    const rel = LiveAnchors.relPath(editor.document.uri);
    if (!rel || editor.document.uri.scheme !== 'file') {
      void vscode.window.showWarningMessage('XPlain: only files inside the workspace can be added to the context.');
      return;
    }
    const doc = editor.document;
    const added: string[] = [];
    for (const sel of editor.selections) {
      let startLine = sel.start.line;
      let endLine = sel.end.line;
      if (endLine > startLine && sel.end.character === 0) endLine -= 1;
      const range = toRange(doc, startLine + 1, endLine + 1);
      const text = doc.getText(range);
      if (!text.trim()) continue;
      startLine = range.start.line + 1;
      endLine = range.end.line + 1;
      const anchor = await this.d.store.upsertAnchor({ file: rel, startLine, endLine, text, language: doc.languageId });
      const item: DraftItem = {
        kind: 'code',
        anchorId: anchor.id,
        file: rel,
        startLine,
        endLine,
        language: doc.languageId,
        text,
      };
      if (this.d.draft.add(item)) added.push(formatRange({ startLine, endLine }));
    }
    await this.d.view.reveal(true);
    if (added.length) {
      this.d.view.post({ type: 'tab', tab: 'context' });
      vscode.window.setStatusBarMessage(`$(check) XPlain: added ${added.join(', ')} of ${rel.split('/').pop()} to context`, 2500);
    } else {
      vscode.window.setStatusBarMessage('$(info) XPlain: block is already in the context', 2000);
    }
  }

  async addResultToDraft(sessionId: string): Promise<void> {
    const meta = this.d.store?.getSession(sessionId);
    if (!meta) return;
    const ok = this.d.draft.add({ kind: 'result', sessionId, title: meta.title });
    this.d.pickMode.set(false);
    await this.d.view.reveal(true);
    this.d.view.post({ type: 'tab', tab: 'context' });
    vscode.window.setStatusBarMessage(
      ok ? `$(check) XPlain: added "${meta.title}" to context` : '$(info) XPlain: result is already in the context',
      2500,
    );
  }

  /** Seed Context from an open result so Send overwrites that session. */
  async beginExtend(sessionId: string): Promise<void> {
    const store = this.d.store;
    if (!store) return this.noWorkspace();
    const meta = store.getSession(sessionId);
    if (!meta || meta.status !== 'done') {
      this.d.view.post({ type: 'notice', level: 'warn', message: 'Only a completed explanation can be extended.' });
      return;
    }
    const ctx = await store.readSessionContext(sessionId);
    this.d.draft.clear();
    this.d.draft.setExtendSessionId(sessionId);
    this.d.draft.add({ kind: 'result', sessionId, title: meta.title });
    for (const item of ctx?.items ?? []) {
      if (item.kind !== 'code') continue;
      const live = this.d.live?.currentRange(item.anchorId);
      const startLine = live?.startLine ?? item.startLine;
      const endLine = live?.endLine ?? item.endLine;
      let text = item.text;
      const doc = vscode.workspace.textDocuments.find((d) => LiveAnchors.relPath(d.uri) === item.file);
      if (doc && live) {
        const slice = doc.getText(toRange(doc, startLine, endLine));
        if (slice.trim()) text = slice;
      }
      this.d.draft.add({
        kind: 'code',
        anchorId: item.anchorId,
        file: item.file,
        startLine,
        endLine,
        language: item.language,
        text,
      });
    }
    this.d.pickMode.set(false);
    await this.d.view.reveal(true);
    this.d.view.post({ type: 'tab', tab: 'context' });
    this.d.view.post({
      type: 'notice',
      level: 'info',
      message: `Extending "${meta.title}". Add a follow-up question, files, or more blocks, then Send (overwrite).`,
    });
  }

  cancelExtend(): void {
    if (!this.d.draft.snapshot.extendSessionId) return;
    this.d.draft.clear();
    this.d.view.post({ type: 'notice', level: 'info', message: 'Extend cancelled.' });
  }

  addDraftFiles(files: Array<{ name: string; content: string }>): void {
    let added = 0;
    for (const f of files) {
      const name = sanitizeDraftFileName(f.name);
      if (!name) continue;
      const bytes = Buffer.byteLength(f.content, 'utf8');
      if (bytes > DRAFT_FILE_MAX_BYTES) {
        this.d.view.post({
          type: 'notice',
          level: 'warn',
          message: `Skipped ${name}: larger than ${DRAFT_FILE_MAX_BYTES / 1024} KB.`,
        });
        continue;
      }
      if (this.d.draft.add({ kind: 'file', name, content: f.content })) added += 1;
    }
    if (added) {
      void this.d.view.reveal(true);
      this.d.view.post({ type: 'tab', tab: 'context' });
      vscode.window.setStatusBarMessage(`$(check) XPlain: added ${added} file(s) to context`, 2500);
    }
  }

  /* ------------------------------------------------------------- send (5) */

  async send(): Promise<void> {
    const store = this.d.store;
    if (!store) return this.noWorkspace();
    if (this.current) {
      void vscode.window.showInformationMessage('XPlain: a request is already running. Cancel it first.');
      return;
    }
    const draft = this.d.draft.snapshot;
    if (draft.items.length === 0 && !draft.question.trim()) {
      this.d.view.post({ type: 'notice', level: 'warn', message: 'Add a code block (Shift+X) or type a question first.' });
      return;
    }

    const extending = Boolean(draft.extendSessionId);
    if (extending && (!draft.extendSessionId || !store.getSession(draft.extendSessionId))) {
      this.d.view.post({ type: 'notice', level: 'warn', message: 'Extend target session is missing. Cancel Extend and try again.' });
      return;
    }

    const items = await this.buildContextItems(draft);
    const agentItems = await this.buildAgentItems(draft);
    const settings = this.agents.read();
    const provider = this.agents.provider(settings);

    let excalidrawSkillPath: string | undefined;
    let excalidrawSkillCanonicalPath: string | undefined;
    let excalidrawSkillBridge: 'cursor' | 'claude' | 'none' | undefined;
    if (draft.useExcalidraw) {
      try {
        const skill = await prepareExcalidrawSkillForProvider(this.d.context.extensionUri, settings.provider);
        excalidrawSkillPath = skill.agentPath;
        excalidrawSkillCanonicalPath = skill.canonicalPath;
        excalidrawSkillBridge = skill.bridge;
        this.d.output.appendLine(
          skill.bridge === 'none'
            ? `[skills] Excalidraw ready at ${skill.canonicalPath} (prompt-only for ${provider.id})`
            : `[skills] Excalidraw store ${skill.canonicalPath} → bridge ${skill.agentPath} for ${provider.id}`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.d.view.post({ type: 'notice', level: 'error', message: `Could not install the Excalidraw skill: ${message}` });
        return;
      }
    }

    const provisionalTitle = deriveTitle({ question: draft.question, format: 'markdown', content: '', items: draft.items });
    const agentMeta = { provider: provider.id, endpoint: agentEndpoint(settings), model: agentModel(settings) };
    let sessionId: string;
    if (extending && draft.extendSessionId) {
      sessionId = draft.extendSessionId;
      const existing = store.getSession(sessionId)!;
      await store.replaceSessionContext(sessionId, {
        title: provisionalTitle || existing.title,
        question: draft.question,
        items,
        agent: agentMeta,
      });
    } else {
      const session = await store.createSession({
        title: provisionalTitle,
        question: draft.question,
        items,
        agent: agentMeta,
      });
      sessionId = session.id;
    }

    const abort = new AbortController();
    this.current = { sessionId, abort, extending };
    this.setBusy({
      busy: true,
      label: extending ? `Extending via ${provider.label}…` : `Asking ${provider.label}…`,
      sessionId,
    });
    this.d.view.post({
      type: 'streamStart',
      sessionId,
      title: provisionalTitle || store.getSession(sessionId)?.title || 'Explanation',
    });
    this.d.view.post({ type: 'tab', tab: 'result' });

    const folder = vscode.workspace.workspaceFolders?.[0];
    const request: AgentRequest = withSharedInstructions(
      {
        sessionId,
        question: draft.question,
        items: agentItems,
        workspace: folder?.name,
        workspaceRoot: folder?.uri.fsPath,
        explainLanguage: draft.explainLanguage,
        extendSessionId: extending ? sessionId : undefined,
        useExcalidraw: draft.useExcalidraw,
        excalidrawSkillPath: draft.useExcalidraw ? excalidrawSkillPath ?? EXCALIDRAW_SKILL_CANONICAL_PATH : undefined,
        excalidrawSkillCanonicalPath: draft.useExcalidraw
          ? excalidrawSkillCanonicalPath ?? EXCALIDRAW_SKILL_CANONICAL_PATH
          : undefined,
        excalidrawSkillBridge: draft.useExcalidraw ? excalidrawSkillBridge ?? 'none' : undefined,
      },
      settings.systemPrompt,
    );
    this.d.output.appendLine(
      `[send] session ${sessionId} via ${provider.id}: ${agentItems.length} item(s), lang=${draft.explainLanguage}` +
        (draft.useExcalidraw ? ', excalidraw=on' : '') +
        (extending ? ', extend=overwrite' : ''),
    );

    try {
      if (folder?.uri.fsPath) {
        try {
          await applyCursorIsolation(folder.uri.fsPath, sessionId);
        } catch (err) {
          this.d.output.appendLine(
            `[isolation] .cursorignore update failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      const response = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: extending ? 'XPlain: extending explanation' : 'XPlain: waiting for agent', cancellable: true },
        (progress, token) => {
          token.onCancellationRequested(() => this.cancel());
          return provider.explain(request, {
            signal: abort.signal,
            onDelta: (text) => this.d.view.post({ type: 'streamDelta', sessionId, text }),
          });
        },
      );
      const content =
        response.format === 'html'
          ? await this.makeHtmlSelfContained(await this.recoverHtmlIfStub(response.content), sessionId)
          : response.content;
      const title = deriveTitle({
        agentTitle: response.title,
        question: draft.question,
        format: response.format,
        content,
        items: draft.items,
      });
      await store.completeSession(sessionId, { title, format: response.format, content });
      if (extending) {
        await store.replaceSessionContext(sessionId, {
          title,
          question: draft.question,
          items,
          agent: agentMeta,
        });
      }
      this.d.view.post({ type: 'streamEnd', sessionId });
      this.d.draft.clear();
      await this.openResult(sessionId);
    } catch (err) {
      const message = err instanceof AgentError || err instanceof Error ? err.message : String(err);
      this.d.output.appendLine(`[error] session ${sessionId}: ${message}`);
      this.d.view.post({ type: 'streamEnd', sessionId });
      if (abort.signal.aborted) {
        if (!extending) await store.deleteSession(sessionId);
        this.d.view.post({
          type: 'notice',
          level: 'info',
          message: extending ? 'Extend stopped — previous result kept.' : 'Request stopped.',
        });
      } else if (extending) {
        // Keep prior result.html and done status for CodeLens.
        this.d.view.post({ type: 'notice', level: 'error', message: `Extend failed: ${message}` });
      } else {
        await store.failSession(sessionId, message);
        this.d.view.post({ type: 'notice', level: 'error', message });
      }
      this.d.view.post({ type: 'tab', tab: 'context' });
    } finally {
      const root = folder?.uri.fsPath;
      if (root) {
        try {
          await clearCursorSessionAllow(root);
        } catch (err) {
          this.d.output.appendLine(
            `[isolation] clear failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      this.current = undefined;
      this.setBusy({ busy: false });
    }
  }

  cancel(): void {
    if (!this.current) return;
    this.d.output.appendLine(`[cancel] session ${this.current.sessionId}: user stop`);
    this.current.abort.abort();
  }

  private async pushAgentSettings(): Promise<void> {
    this.d.view.post({ type: 'agentSettings', settings: await this.agents.view() });
    this.d.view.post({ type: 'agentLabel', label: this.agents.label() });
  }

  private async pickProvider(title: string): Promise<AgentProviderId | undefined> {
    const items = AGENT_PROVIDER_IDS.filter((id) => id !== 'mock').map((id) => ({ label: PROVIDER_LABELS[id], id }));
    const pick = await vscode.window.showQuickPick(items, { title });
    return pick?.id;
  }

  private async buildContextItems(draft: DraftState): Promise<ContextItem[]> {
    const out: ContextItem[] = [];
    for (const i of draft.items) {
      if (i.kind === 'code') out.push({ ...i });
      else if (i.kind === 'result') out.push({ ...i });
      else out.push({ kind: 'file', name: i.name, content: i.content });
    }
    if (draft.templateId) {
      const t = this.d.store?.getTemplate(draft.templateId);
      if (t) out.push({ kind: 'template', templateId: t.id, name: t.name });
    }
    return out;
  }

  private async buildAgentItems(draft: DraftState): Promise<AgentItem[]> {
    const store = this.d.store!;
    const out: AgentItem[] = [];
    const fileCache = new Map<string, string | undefined>();
    for (const item of draft.items) {
      if (item.kind === 'code') {
        if (!fileCache.has(item.file)) fileCache.set(item.file, await this.readWorkspaceFile(item.file));
        const fileText = fileCache.get(item.file);
        out.push({
          type: 'code',
          file: item.file,
          startLine: item.startLine,
          endLine: item.endLine,
          language: item.language,
          text: await this.freshText(item),
          ...(fileText !== undefined ? { fileText } : {}),
        });
      } else if (item.kind === 'result') {
        const res = await store.readResult(item.sessionId);
        if (res) out.push({ type: 'result', title: item.title, format: res.format, content: res.content });
      } else {
        out.push({ type: 'file', name: item.name, content: item.content });
      }
    }
    if (draft.templateId) {
      const t = store.getTemplate(draft.templateId);
      if (t) {
        out.push({ type: 'template', name: t.name, instruction: t.instruction, files: await store.readTemplateFiles(t.id) });
      }
    }
    return out;
  }

  /** Prefer the current text of the block if the document is open and the block was tracked. */
  private async freshText(item: Extract<DraftItem, { kind: 'code' }>): Promise<string> {
    const live = this.d.live;
    if (!live) return item.text;
    const doc = vscode.workspace.textDocuments.find((d) => LiveAnchors.relPath(d.uri) === item.file);
    if (!doc) return item.text;
    const range = live.currentRange(item.anchorId);
    if (!range) return item.text;
    const text = doc.getText(toRange(doc, range.startLine, range.endLine));
    return text.trim() ? text : item.text;
  }

  /** Full file text for agent context. Caps size so huge files do not blow the prompt. */
  private async readWorkspaceFile(rel: string): Promise<string | undefined> {
    const MAX = 512 * 1024;
    try {
      const open = vscode.workspace.textDocuments.find((d) => LiveAnchors.relPath(d.uri) === rel);
      if (open) {
        const text = open.getText();
        if (Buffer.byteLength(text, 'utf8') > MAX) {
          this.d.output.appendLine(`[send] full file omitted (too large): ${rel}`);
          return undefined;
        }
        return text;
      }
      const folders = vscode.workspace.workspaceFolders;
      if (!folders?.length) return undefined;
      const uri = vscode.Uri.joinPath(folders[0].uri, ...rel.split('/'));
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.size > MAX) {
        this.d.output.appendLine(`[send] full file omitted (too large): ${rel} (${stat.size} bytes)`);
        return undefined;
      }
      return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
    } catch (err) {
      this.d.output.appendLine(`[send] could not read full file ${rel}: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
  }

  /* ----------------------------------------------------------- results (5) */

  async showResultsForAnchor(anchorId: string): Promise<void> {
    const store = this.d.store;
    if (!store) return;
    const anchor = store.getAnchor(anchorId);
    if (!anchor) return;
    const sessions = store.sessionsForAnchor(anchorId).filter((s) => s.status === 'done');
    const picking = this.d.pickMode.active;

    type Item = vscode.QuickPickItem & { sessionId?: string; action?: 'addBlock' };
    const openButton: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('open-preview'), tooltip: 'Open in editor' };
    const addButton: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('add'), tooltip: 'Add to context' };
    const items: Item[] = sessions.map((s) => ({
      label: `$(comment-discussion) ${s.title}`,
      description: relativeTime(s.createdAt),
      detail: s.question.trim() ? `Q: ${firstLine(s.question)}` : `${s.anchorIds.length} block(s) in this context`,
      sessionId: s.id,
      buttons: picking ? [openButton] : [openButton, addButton],
    }));
    items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
    items.push({
      label: '$(add) Add this code block to context',
      detail: `${anchor.file} ${formatRange(this.d.live?.currentRange(anchorId) ?? anchor)}`,
      action: 'addBlock',
    });

    const qp = vscode.window.createQuickPick<Item>();
    qp.title = picking
      ? `Pick an explanation to ADD TO CONTEXT · ${anchor.file.split('/').pop()} ${formatRange(anchor)}`
      : `XPlain · ${anchor.file.split('/').pop()} ${formatRange(anchor)}`;
    qp.placeholder = picking ? 'The chosen explanation will be added to the context' : 'Open an explanation (or use the buttons)';
    qp.matchOnDetail = true;
    qp.items = items;
    qp.onDidTriggerItemButton(async (e) => {
      if (!e.item.sessionId) return;
      qp.hide();
      if (e.button === openButton) await this.openResultInEditor(e.item.sessionId);
      else await this.addResultToDraft(e.item.sessionId);
    });
    qp.onDidAccept(async () => {
      const sel = qp.selectedItems[0];
      qp.hide();
      if (!sel) return;
      if (sel.action === 'addBlock') {
        await this.addAnchorToDraft(anchorId);
        return;
      }
      if (!sel.sessionId) return;
      if (picking) await this.addResultToDraft(sel.sessionId);
      else await this.openResult(sel.sessionId);
    });
    qp.onDidHide(() => qp.dispose());
    qp.show();
  }

  private async addAnchorToDraft(anchorId: string): Promise<void> {
    const anchor = this.d.store?.getAnchor(anchorId);
    if (!anchor) return;
    const range = this.d.live?.currentRange(anchorId) ?? anchor;
    const doc = vscode.workspace.textDocuments.find((d) => LiveAnchors.relPath(d.uri) === anchor.file);
    const text = doc ? doc.getText(toRange(doc, range.startLine, range.endLine)) : anchor.snippet;
    this.d.draft.add({
      kind: 'code',
      anchorId,
      file: anchor.file,
      startLine: range.startLine,
      endLine: range.endLine,
      language: anchor.language,
      text,
    });
    await this.d.view.reveal(true);
    this.d.view.post({ type: 'tab', tab: 'context' });
  }

  async openResult(sessionId: string): Promise<void> {
    const store = this.d.store;
    if (!store) return;
    const session = store.getSession(sessionId);
    if (!session) return;
    const result = await store.readResult(sessionId);
    if (!result) {
      this.d.view.post({ type: 'notice', level: 'warn', message: session.status === 'error' ? `Session failed: ${session.error}` : 'No result stored for this session.' });
      return;
    }
    let content = result.content;
    if (result.format === 'html') {
      const recovered = await this.recoverHtmlIfStub(content);
      const inlined = await this.makeHtmlSelfContained(recovered, sessionId);
      if (inlined !== result.content) {
        content = inlined;
        const title = deriveTitle({
          agentTitle: session.title,
          question: session.question,
          format: 'html',
          content,
          items: [],
        });
        await store.completeSession(sessionId, { title: title || session.title, format: 'html', content });
        session.title = title || session.title;
      } else {
        content = inlined;
      }
    }
    await this.d.view.reveal(true);
    // Pass HTML body for srcdoc rendering. Loading result.html via asWebviewUri inside a
    // sandboxed iframe is unreliable on Remote-SSH (blank white frame).
    this.d.view.post({
      type: 'showResult',
      session,
      format: result.format,
      content,
    });
    this.d.view.post({ type: 'tab', tab: 'result' });
  }

  /** If the agent returned a stub that points at a workspace HTML file, load that file. */
  private async recoverHtmlIfStub(content: string): Promise<string> {
    const roots = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
    if (!roots.length) return content;
    try {
      const { html, recoveredFrom } = await recoverHtmlAnswer(content, {
        workspaceRoots: roots,
        excludeSessions: true,
        sinceMs: Date.now() - 2 * 60 * 60 * 1000,
      });
      if (recoveredFrom) this.d.output.appendLine(`[html] recovered full document from ${recoveredFrom}`);
      return html;
    } catch (err) {
      this.d.output.appendLine(`[html] recover failed: ${err instanceof Error ? err.message : String(err)}`);
      return content;
    }
  }

  /** Embed local <img>/url(...) assets as data: URIs so result.html needs no sidecar files. */
  private async makeHtmlSelfContained(html: string, sessionId?: string): Promise<string> {
    const roots = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
    if (!roots.length) return html;
    try {
      const { html: next, inlined, missing } = await inlineLocalAssets(html, {
        workspaceRoots: roots,
        sessionId,
        readFile: async (abs) => {
          try {
            return new Uint8Array(await fs.readFile(abs));
          } catch {
            return undefined;
          }
        },
        listDir: async (abs) => {
          try {
            return await fs.readdir(abs);
          } catch {
            return [];
          }
        },
      });
      if (inlined.length) this.d.output.appendLine(`[assets] inlined ${inlined.length} file(s): ${inlined.join(', ')}`);
      if (missing.length) this.d.output.appendLine(`[assets] could not inline: ${missing.join(', ')}`);
      return next;
    } catch (err) {
      this.d.output.appendLine(`[assets] inline failed: ${err instanceof Error ? err.message : String(err)}`);
      return html;
    }
  }

  async openResultInEditor(sessionId: string): Promise<void> {
    const store = this.d.store;
    if (!store || !this.d.storeFs) return;
    const session = store.getSession(sessionId);
    if (!session) return;
    const uri = this.d.storeFs.uri(store.resultPath(sessionId, session.resultFormat));
    if (session.resultFormat === 'markdown') {
      try {
        await vscode.commands.executeCommand('markdown.showPreview', uri);
      } catch {
        await vscode.window.showTextDocument(uri, { preview: true });
      }
      return;
    }
    const result = await store.readResult(sessionId);
    if (!result) return;
    const panel = vscode.window.createWebviewPanel('xplain.result', session.title, vscode.ViewColumn.Beside, {
      enableScripts: false,
      localResourceRoots: [],
    });
    // Direct webview document (no nested iframe) so data: images obey a permissive CSP.
    const csp = `default-src 'none'; img-src data: blob: https:; style-src 'unsafe-inline'; font-src data:;`;
    const body = result.content.includes('<html')
      ? result.content.replace(/<head([^>]*)>/i, `<head$1><meta http-equiv="Content-Security-Policy" content="${csp}"/>`)
      : `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta http-equiv="Content-Security-Policy" content="${csp}"/></head><body>${result.content}</body></html>`;
    panel.webview.html = /http-equiv=["']Content-Security-Policy["']/i.test(result.content)
      ? result.content
      : body;
  }

  async revealAnchor(anchorId: string): Promise<void> {
    const anchor = this.d.store?.getAnchor(anchorId);
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!anchor || !folder) return;
    const uri = vscode.Uri.joinPath(folder.uri, ...anchor.file.split('/'));
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: false });
    const range = this.d.live?.currentRange(anchorId) ?? anchor;
    const r = toRange(doc, range.startLine, range.endLine);
    editor.selection = new vscode.Selection(r.start, r.end);
    editor.revealRange(r, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  /* ------------------------------------------------------------ webview IO */

  private async sendInit(): Promise<void> {
    const store = this.d.store;
    const state: InitState = {
      draft: this.d.draft.snapshot,
      sessions: this.sortedSessions(),
      templates: store ? [...store.templateList] : [],
      pickMode: this.d.pickMode.active,
      busy: this.current ? { busy: true, sessionId: this.current.sessionId, label: 'Waiting for agent…' } : { busy: false },
      background: await this.d.background.getState(this.d.view.webview),
      hasWorkspace: Boolean(store),
      agentLabel: this.agents.label(),
      agentSettings: await this.agents.view(),
    };
    this.d.view.post({ type: 'init', state });
  }

  private sortedSessions(): SessionMeta[] {
    return [...(this.d.store?.sessions ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private setBusy(busy: BusyState): void {
    void vscode.commands.executeCommand('setContext', 'xplain.busy', busy.busy);
    this.d.view.post({ type: 'busy', busy });
  }

  private async pushBackground(): Promise<void> {
    this.d.view.post({ type: 'background', background: await this.d.background.getState(this.d.view.webview) });
  }

  private async handleMessage(m: ViewMessage): Promise<void> {
    const store = this.d.store;
    try {
      switch (m.type) {
        case 'ready':
          await this.sendInit();
          break;
        case 'setQuestion':
          this.d.draft.setQuestion(m.text);
          break;
        case 'setTemplate':
          this.d.draft.setTemplate(m.templateId);
          void this.persistContextPrefs();
          break;
        case 'setExplainLanguage':
          this.d.draft.setExplainLanguage(m.language);
          void this.persistContextPrefs();
          break;
        case 'setUseExcalidraw':
          this.d.draft.setUseExcalidraw(m.enabled);
          void this.persistContextPrefs();
          break;
        case 'removeItem':
          this.d.draft.removeAt(m.index);
          break;
        case 'moveItem':
          this.d.draft.move(m.from, m.to);
          break;
        case 'clearDraft': {
          const extendId = this.d.draft.snapshot.extendSessionId;
          if (extendId) {
            const meta = store?.getSession(extendId);
            this.d.draft.clear({ keepExtend: true });
            if (meta) this.d.draft.add({ kind: 'result', sessionId: extendId, title: meta.title });
          } else {
            this.d.draft.clear();
          }
          break;
        }
        case 'send':
          await this.send();
          break;
        case 'cancel':
          this.cancel();
          break;
        case 'beginExtend':
          await this.beginExtend(m.sessionId);
          break;
        case 'cancelExtend':
          this.cancelExtend();
          break;
        case 'addDraftFiles':
          this.addDraftFiles(m.files);
          break;
        case 'openSession':
          await this.openResult(m.sessionId);
          break;
        case 'openSessionInEditor':
          await this.openResultInEditor(m.sessionId);
          break;
        case 'addSessionToDraft':
          await this.addResultToDraft(m.sessionId);
          break;
        case 'deleteSession': {
          const s = store?.getSession(m.sessionId);
          if (!s) break;
          const ok = await vscode.window.showWarningMessage(`Delete explanation "${s.title}"?`, { modal: true }, 'Delete');
          if (ok === 'Delete') await store!.deleteSession(m.sessionId);
          break;
        }
        case 'renameSession':
          if (m.title.trim()) await store?.renameSession(m.sessionId, m.title.trim());
          break;
        case 'revealAnchor':
          await this.revealAnchor(m.anchorId);
          break;
        case 'togglePickMode':
          this.d.pickMode.toggle();
          break;
        case 'saveTemplate': {
          if (!store) return this.noWorkspace();
          const t = await store.saveTemplate(m);
          this.d.view.post({ type: 'notice', level: 'info', message: `Template "${t.name}" saved.` });
          break;
        }
        case 'deleteTemplate': {
          const t = store?.getTemplate(m.templateId);
          if (!t) break;
          const ok = await vscode.window.showWarningMessage(`Delete template "${t.name}"?`, { modal: true }, 'Delete');
          if (ok === 'Delete') {
            await store!.deleteTemplate(m.templateId);
            if (this.d.draft.snapshot.templateId === m.templateId) this.d.draft.setTemplate(null);
          }
          break;
        }
        case 'loadTemplateForEdit': {
          const t = store?.getTemplate(m.templateId);
          if (!t) break;
          this.d.view.post({ type: 'editTemplate', template: t, files: await store!.readTemplateFiles(t.id) });
          break;
        }
        case 'pickTemplateFiles': {
          const uris = await vscode.window.showOpenDialog({ canSelectMany: true, openLabel: 'Attach to template', title: 'XPlain: attach files to template' });
          if (uris?.length) this.d.view.post({ type: 'templateFiles', files: await this.readFiles(uris) });
          break;
        }
        case 'readUris': {
          const uris = m.uris.map((u) => safeParseUri(u)).filter((u): u is vscode.Uri => Boolean(u));
          if (!uris.length) break;
          const files = await this.readFiles(uris);
          if (m.destination === 'draft') this.addDraftFiles(files);
          else this.d.view.post({ type: 'templateFiles', files });
          break;
        }
        case 'chooseBackground':
          if (await this.d.background.choose()) await this.pushBackground();
          break;
        case 'clearBackground':
          await this.d.background.clear();
          await this.pushBackground();
          break;
        case 'dropBackground': {
          const ext = (m.name.split('.').pop() ?? 'png').toLowerCase().replace('jpeg', 'jpg');
          if (await this.d.background.save(ext, Buffer.from(m.dataBase64, 'base64'))) await this.pushBackground();
          break;
        }
        case 'openSettings':
          await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:xplain.xplain');
          break;
        case 'saveAgentSettings':
          await this.agents.save(m.settings, m.target);
          await this.pushAgentSettings();
          this.d.view.post({ type: 'notice', level: 'info', message: `Agent settings saved (${m.target === 'workspace' ? 'this workspace' : 'user settings'}).` });
          break;
        case 'setAgentKey':
          await this.agents.setKey(m.provider, m.key);
          await this.pushAgentSettings();
          this.d.view.post({ type: 'notice', level: 'info', message: m.key.trim() ? `API key for ${PROVIDER_LABELS[m.provider]} saved.` : `API key for ${PROVIDER_LABELS[m.provider]} removed.` });
          break;
        case 'clearAgentKey':
          await this.agents.clearKey(m.provider);
          await this.pushAgentSettings();
          break;
        case 'testAgent': {
          const result = await this.agents.test(m.settings);
          this.d.output.appendLine(`[test] ${result.provider}: ${result.ok ? 'ok' : 'failed'} - ${result.message}`);
          this.d.view.post({ type: 'agentTest', result });
          break;
        }
        case 'listModels': {
          const result = await this.agents.listModels(m.settings, m.requestId);
          if (result.error) this.d.output.appendLine(`[models] ${result.provider} @ ${result.baseUrl}: ${result.error}`);
          this.d.view.post({ type: 'agentModels', result });
          break;
        }
        case 'openExternal':
          if (/^https?:\/\//i.test(m.url)) await vscode.env.openExternal(vscode.Uri.parse(m.url));
          break;
        case 'log':
          this.d.output.appendLine(`[webview] ${m.message}`);
          break;
        default:
          break;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.d.output.appendLine(`[error] ${m.type}: ${msg}`);
      this.d.view.post({ type: 'notice', level: 'error', message: msg });
    }
  }

  private async readFiles(uris: vscode.Uri[]): Promise<TemplateFile[]> {
    const out: TemplateFile[] = [];
    const skipped: string[] = [];
    for (const uri of uris) {
      const name = uri.path.split('/').pop() ?? 'file';
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.type & vscode.FileType.Directory) {
          skipped.push(`${name} (folder)`);
          continue;
        }
        if (stat.size > MAX_TEMPLATE_FILE) {
          skipped.push(`${name} (> 1 MB)`);
          continue;
        }
        const bytes = await vscode.workspace.fs.readFile(uri);
        if (bytes.subarray(0, 4096).includes(0)) {
          skipped.push(`${name} (binary)`);
          continue;
        }
        out.push({ name, content: new TextDecoder('utf-8').decode(bytes) });
      } catch (err) {
        skipped.push(`${name} (${(err as Error).message})`);
      }
    }
    if (skipped.length) this.d.view.post({ type: 'notice', level: 'warn', message: `Skipped: ${skipped.join(', ')}` });
    return out;
  }

  private async setApiKey(): Promise<void> {
    const provider = await this.pickProvider('Set the API key of which provider?');
    if (!provider) return;
    const value = await vscode.window.showInputBox({
      title: `XPlain: API key for ${PROVIDER_LABELS[provider]}`,
      prompt:
        provider === 'anthropic'
          ? 'Sent as "x-api-key". Stored in the secure secret storage.'
          : 'Sent as "Authorization: Bearer <key>". Stored in the secure secret storage. Leave empty to remove.',
      password: true,
      ignoreFocusOut: true,
    });
    if (value === undefined) return;
    await this.agents.setKey(provider, value);
    await this.pushAgentSettings();
    void vscode.window.showInformationMessage(
      value.trim() ? `XPlain: API key for ${PROVIDER_LABELS[provider]} saved.` : `XPlain: API key for ${PROVIDER_LABELS[provider]} removed.`,
    );
  }

  private async persistContextPrefs(): Promise<void> {
    const s = this.d.draft.snapshot;
    await writeContextPrefs(this.d.context.workspaceState, {
      templateId: s.templateId,
      explainLanguage: s.explainLanguage,
      useExcalidraw: s.useExcalidraw,
    });
  }

  dispose(): void {
    this.cancel();
    void vscode.commands.executeCommand('setContext', 'xplain.busy', false);
    this.disposables.forEach((d) => d.dispose());
  }
}

function agentEndpoint(s: AgentSettings): string | undefined {
  switch (s.provider) {
    case 'xplain':
      return s.endpoint;
    case 'hermes':
    case 'openai':
    case 'anthropic':
      return s[s.provider].baseUrl;
    case 'cursor':
      return 'cursor://sdk';
    default:
      return undefined;
  }
}

function agentModel(s: AgentSettings): string | undefined {
  if (s.provider === 'hermes' || s.provider === 'openai' || s.provider === 'anthropic') return s[s.provider].model;
  if (s.provider === 'cursor') return s.cursor.model;
  return undefined;
}

function safeParseUri(s: string): vscode.Uri | undefined {
  try {
    return vscode.Uri.parse(s.trim(), true);
  } catch {
    return undefined;
  }
}

function firstLine(text: string): string {
  const l = text.split('\n').find((x) => x.trim()) ?? '';
  return l.length > 120 ? `${l.slice(0, 119)}…` : l;
}

function sanitizeDraftFileName(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? '';
  return base.replace(/[^\w.\- ()[\]]+/g, '_').slice(0, 180);
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} d ago`;
  return new Date(iso).toLocaleDateString();
}
