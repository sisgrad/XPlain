/**
 * Orchestrates everything: commands, webview messages, the draft context,
 * agent calls and result persistence.
 */
import * as vscode from 'vscode';
import { AgentError, type AgentItem, type AgentProvider, type AgentRequest } from './agent/AgentProvider';
import { HttpAgentProvider } from './agent/HttpAgentProvider';
import { MockAgentProvider } from './agent/MockAgentProvider';
import { deriveTitle } from './agent/titles';
import { ContextDraft } from './context/ContextDraft';
import { formatRange } from './editor/anchors';
import { toRange } from './editor/decorations';
import { LiveAnchors } from './editor/LiveAnchors';
import { PickMode } from './editor/pickMode';
import { BackgroundManager } from './panel/background';
import type { XplainViewProvider } from './panel/XplainViewProvider';
import type { InitState, ViewMessage } from './shared/protocol';
import type { BusyState, ContextItem, DraftItem, DraftState, SessionMeta, TemplateFile } from './shared/types';
import type { XplainStore } from './storage/XplainStore';
import type { VscodeStoreFs } from './storage/vscodeFs';

const API_KEY_SECRET = 'xplain.agent.apiKey';
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
  private current: { sessionId: string; abort: AbortController } | undefined;
  private readonly providers: Record<string, AgentProvider>;

  constructor(private readonly d: Deps) {
    this.providers = {
      mock: new MockAgentProvider(),
      http: new HttpAgentProvider(async () => {
        const cfg = vscode.workspace.getConfiguration('xplain.agent');
        return {
          endpoint: cfg.get<string>('endpoint', ''),
          timeoutMs: cfg.get<number>('timeoutMs', 180000),
          streaming: cfg.get<boolean>('streaming', true),
          headers: cfg.get<Record<string, string>>('headers', {}),
          apiKey: await d.context.secrets.get(API_KEY_SECRET),
        };
      }),
    };

    this.disposables.push(
      d.view.onDidReceiveMessage((m) => void this.handleMessage(m)),
      d.view.onDidResolve(() => void this.sendInit()),
      d.draft.onDidChange((draft) => d.view.post({ type: 'draft', draft })),
      d.pickMode.onDidChange((active) => d.view.post({ type: 'pickMode', active })),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('xplain.ui.background')) void this.pushBackground();
        if (e.affectsConfiguration('xplain.agent')) d.view.post({ type: 'agentLabel', label: this.agentLabel() });
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
    reg('xplain.setAgentApiKey', () => this.setApiKey());
    reg('xplain.clearAgentApiKey', async () => {
      await this.d.context.secrets.delete(API_KEY_SECRET);
      void vscode.window.showInformationMessage('XPlain: agent API key removed.');
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

    const items = await this.buildContextItems(draft);
    const agentItems = await this.buildAgentItems(draft);
    const provider = this.provider();
    const provisionalTitle = deriveTitle({ question: draft.question, format: 'markdown', content: '', items: draft.items });
    const session = await store.createSession({
      title: provisionalTitle,
      question: draft.question,
      items,
      agent: { provider: provider.id, endpoint: provider.id === 'http' ? vscode.workspace.getConfiguration('xplain.agent').get('endpoint') : undefined },
    });

    const abort = new AbortController();
    this.current = { sessionId: session.id, abort };
    this.setBusy({ busy: true, label: `Asking ${provider.label}…`, sessionId: session.id });
    this.d.view.post({ type: 'streamStart', sessionId: session.id, title: provisionalTitle });
    this.d.view.post({ type: 'tab', tab: 'result' });

    const request: AgentRequest = {
      sessionId: session.id,
      question: draft.question,
      items: agentItems,
      workspace: vscode.workspace.workspaceFolders?.[0]?.name,
    };
    this.d.output.appendLine(`[send] session ${session.id} via ${provider.id}: ${agentItems.length} item(s)`);

    try {
      const response = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: 'XPlain: waiting for agent', cancellable: false },
        () =>
          provider.explain(request, {
            signal: abort.signal,
            onDelta: (text) => this.d.view.post({ type: 'streamDelta', sessionId: session.id, text }),
          }),
      );
      const title = deriveTitle({
        agentTitle: response.title,
        question: draft.question,
        format: response.format,
        content: response.content,
        items: draft.items,
      });
      await store.completeSession(session.id, { title, format: response.format, content: response.content });
      this.d.view.post({ type: 'streamEnd', sessionId: session.id });
      this.d.draft.clear();
      await this.openResult(session.id);
    } catch (err) {
      const message = err instanceof AgentError || err instanceof Error ? err.message : String(err);
      this.d.output.appendLine(`[error] session ${session.id}: ${message}`);
      this.d.view.post({ type: 'streamEnd', sessionId: session.id });
      if (abort.signal.aborted) {
        await store.deleteSession(session.id);
        this.d.view.post({ type: 'notice', level: 'info', message: 'Request cancelled.' });
      } else {
        await store.failSession(session.id, message);
        this.d.view.post({ type: 'notice', level: 'error', message });
      }
      this.d.view.post({ type: 'tab', tab: 'context' });
    } finally {
      this.current = undefined;
      this.setBusy({ busy: false });
    }
  }

  cancel(): void {
    this.current?.abort.abort();
  }

  private provider(): AgentProvider {
    const id = vscode.workspace.getConfiguration('xplain.agent').get<string>('provider', 'http');
    return this.providers[id] ?? this.providers.http;
  }

  private agentLabel(): string {
    const p = this.provider();
    if (p.id === 'http') {
      const ep = vscode.workspace.getConfiguration('xplain.agent').get<string>('endpoint', '');
      return ep ? `HTTP · ${ep}` : 'HTTP · endpoint not set';
    }
    return p.label;
  }

  private async buildContextItems(draft: DraftState): Promise<ContextItem[]> {
    const out: ContextItem[] = draft.items.map((i) => ({ ...i }));
    if (draft.templateId) {
      const t = this.d.store?.getTemplate(draft.templateId);
      if (t) out.push({ kind: 'template', templateId: t.id, name: t.name });
    }
    return out;
  }

  private async buildAgentItems(draft: DraftState): Promise<AgentItem[]> {
    const store = this.d.store!;
    const out: AgentItem[] = [];
    for (const item of draft.items) {
      if (item.kind === 'code') {
        out.push({
          type: 'code',
          file: item.file,
          startLine: item.startLine,
          endLine: item.endLine,
          language: item.language,
          text: await this.freshText(item),
        });
      } else {
        const res = await store.readResult(item.sessionId);
        if (res) out.push({ type: 'result', title: item.title, format: res.format, content: res.content });
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
    await this.d.view.reveal(true);
    if (result.format === 'html') {
      const uri = this.d.storeFs ? this.d.view.asWebviewUri(this.d.storeFs.uri(store.resultPath(sessionId, 'html'))) : undefined;
      this.d.view.post({ type: 'showResult', session, format: 'html', content: '', htmlUri: uri ? `${uri}?v=${Date.now()}` : undefined });
    } else {
      this.d.view.post({ type: 'showResult', session, format: 'markdown', content: result.content });
    }
    this.d.view.post({ type: 'tab', tab: 'result' });
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
      enableScripts: true,
      localResourceRoots: [],
    });
    panel.webview.html = result.content;
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
      agentLabel: this.agentLabel(),
    };
    this.d.view.post({ type: 'init', state });
  }

  private sortedSessions(): SessionMeta[] {
    return [...(this.d.store?.sessions ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private setBusy(busy: BusyState): void {
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
          break;
        case 'removeItem':
          this.d.draft.removeAt(m.index);
          break;
        case 'moveItem':
          this.d.draft.move(m.from, m.to);
          break;
        case 'clearDraft':
          this.d.draft.clear();
          break;
        case 'send':
          await this.send();
          break;
        case 'cancel':
          this.cancel();
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
          if (uris.length) this.d.view.post({ type: 'templateFiles', files: await this.readFiles(uris) });
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
    const value = await vscode.window.showInputBox({
      title: 'XPlain: agent API key',
      prompt: 'Sent as "Authorization: Bearer <key>" to your agent endpoint. Stored in the secure secret storage.',
      password: true,
      ignoreFocusOut: true,
    });
    if (value === undefined) return;
    if (value.trim()) {
      await this.d.context.secrets.store(API_KEY_SECRET, value.trim());
      void vscode.window.showInformationMessage('XPlain: agent API key saved.');
    } else {
      await this.d.context.secrets.delete(API_KEY_SECRET);
      void vscode.window.showInformationMessage('XPlain: agent API key removed.');
    }
  }

  dispose(): void {
    this.cancel();
    this.disposables.forEach((d) => d.dispose());
  }
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
