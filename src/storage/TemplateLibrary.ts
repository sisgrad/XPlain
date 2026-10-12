/**
 * Templates from three layers:
 *   builtin  — shipped under extensionUri/bundled-templates/ (read-only)
 *   user     — ExtensionContext.globalStorageUri/templates/ (all projects)
 *   project  — <workspace>/.xplain/templates/ via XplainStore
 */
import * as vscode from 'vscode';
import type { TemplateFile, TemplateMeta, TemplateScope, WritableTemplateScope } from '../shared/types';
import { Emitter } from '../util/emitter';
import { newId } from '../util/ids';
import { sanitizeFileName, type XplainStore } from './XplainStore';

const USER_TEMPLATES_DIR = 'templates';
const BUILTIN_DIR = 'bundled-templates';

const SCOPE_ORDER: Record<TemplateScope, number> = { builtin: 0, user: 1, project: 2 };

export class TemplateLibrary implements vscode.Disposable {
  private templates: TemplateMeta[] = [];
  private readonly changeEmitter = new Emitter<void>();
  readonly onDidChange = this.changeEmitter.event;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly globalStorageUri: vscode.Uri,
    private readonly store: XplainStore | undefined,
  ) {
    if (store) {
      this.disposables.push(
        store.onDidChange((c) => {
          if (c.kind === 'templates') void this.reload();
        }),
      );
    }
  }

  async init(): Promise<void> {
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(this.globalStorageUri, USER_TEMPLATES_DIR));
    await this.reload();
  }

  get list(): readonly TemplateMeta[] {
    return this.templates;
  }

  getTemplate(id: string): TemplateMeta | undefined {
    return this.templates.find((t) => t.id === id);
  }

  async reload(): Promise<void> {
    const builtin = await this.loadRoot(vscode.Uri.joinPath(this.extensionUri, BUILTIN_DIR), 'builtin');
    const user = await this.loadRoot(vscode.Uri.joinPath(this.globalStorageUri, USER_TEMPLATES_DIR), 'user');
    const project = this.store ? [...this.store.templateList] : [];
    const byId = new Map<string, TemplateMeta>();
    // Later scopes win on id collision (project > user > builtin).
    for (const t of [...builtin, ...user, ...project]) byId.set(t.id, t);
    this.templates = [...byId.values()].sort((a, b) => {
      const byScope = SCOPE_ORDER[a.scope] - SCOPE_ORDER[b.scope];
      if (byScope !== 0) return byScope;
      return a.name.localeCompare(b.name);
    });
    this.changeEmitter.fire();
  }

  async save(input: {
    id: string | null;
    name: string;
    instruction: string;
    files: TemplateFile[];
    scope: WritableTemplateScope;
  }): Promise<TemplateMeta> {
    if (input.id) {
      const existing = this.getTemplate(input.id);
      if (!existing) throw new Error(`Template not found: ${input.id}`);
      if (existing.scope === 'builtin') throw new Error('Built-in templates are read-only. Duplicate them first.');
      if (existing.scope === 'project') {
        if (!this.store) throw new Error('Open a workspace folder to edit project templates.');
        const meta = await this.store.saveTemplate(input);
        await this.reload();
        return meta;
      }
      const meta = await this.writeUserTemplate({ ...input, id: existing.id, createdAt: existing.createdAt });
      await this.reload();
      return meta;
    }

    if (input.scope === 'project') {
      if (!this.store) throw new Error('Open a workspace folder to save project templates.');
      const meta = await this.store.saveTemplate(input);
      await this.reload();
      return meta;
    }
    const meta = await this.writeUserTemplate({ ...input, id: newId(), createdAt: new Date().toISOString() });
    await this.reload();
    return meta;
  }

  async duplicate(templateId: string, scope: WritableTemplateScope): Promise<TemplateMeta> {
    const src = this.getTemplate(templateId);
    if (!src) throw new Error(`Template not found: ${templateId}`);
    const files = await this.readFiles(templateId);
    return this.save({
      id: null,
      name: `${src.name} (copy)`,
      instruction: src.instruction,
      files,
      scope,
    });
  }

  async delete(id: string): Promise<void> {
    const t = this.getTemplate(id);
    if (!t) return;
    if (t.scope === 'builtin') throw new Error('Built-in templates cannot be deleted.');
    if (t.scope === 'project') {
      if (!this.store) return;
      await this.store.deleteTemplate(id);
      await this.reload();
      return;
    }
    await deleteUri(vscode.Uri.joinPath(this.globalStorageUri, USER_TEMPLATES_DIR, id));
    await this.reload();
  }

  async readFiles(id: string): Promise<TemplateFile[]> {
    const t = this.getTemplate(id);
    if (!t) return [];
    if (t.scope === 'project') {
      if (!this.store) return [];
      return this.store.readTemplateFiles(id);
    }
    const root =
      t.scope === 'builtin'
        ? vscode.Uri.joinPath(this.extensionUri, BUILTIN_DIR, id)
        : vscode.Uri.joinPath(this.globalStorageUri, USER_TEMPLATES_DIR, id);
    const out: TemplateFile[] = [];
    for (const f of t.files) {
      try {
        const data = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, 'files', f.name));
        out.push({ name: f.name, content: Buffer.from(data).toString('utf8') });
      } catch {
        /* missing */
      }
    }
    return out;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.changeEmitter.dispose();
  }

  private async loadRoot(root: vscode.Uri, scope: TemplateScope): Promise<TemplateMeta[]> {
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(root);
    } catch {
      return [];
    }
    const list: TemplateMeta[] = [];
    for (const [name, type] of entries) {
      if (type !== vscode.FileType.Directory) continue;
      if (name.startsWith('.') || name === 'README.md') continue;
      try {
        const raw = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, name, 'template.json'));
        const parsed = JSON.parse(Buffer.from(raw).toString('utf8')) as Partial<TemplateMeta>;
        if (!parsed || parsed.id !== name) continue;
        list.push({
          id: name,
          scope,
          name: typeof parsed.name === 'string' ? parsed.name : name,
          instruction: typeof parsed.instruction === 'string' ? parsed.instruction : '',
          files: Array.isArray(parsed.files) ? parsed.files : [],
          createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date(0).toISOString(),
          updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString(),
        });
      } catch {
        /* skip */
      }
    }
    return list;
  }

  private async writeUserTemplate(input: {
    id: string;
    name: string;
    instruction: string;
    files: TemplateFile[];
    createdAt: string;
  }): Promise<TemplateMeta> {
    const dir = vscode.Uri.joinPath(this.globalStorageUri, USER_TEMPLATES_DIR, input.id);
    const filesDir = vscode.Uri.joinPath(dir, 'files');
    await vscode.workspace.fs.createDirectory(dir);
    await deleteUri(filesDir);
    await vscode.workspace.fs.createDirectory(filesDir);
    const files: TemplateMeta['files'] = [];
    const seen = new Set<string>();
    for (const f of input.files) {
      let name = sanitizeFileName(f.name);
      while (seen.has(name)) name = `_${name}`;
      seen.add(name);
      const data = Buffer.from(f.content, 'utf8');
      await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(filesDir, name), data);
      files.push({ name, size: data.byteLength });
    }
    const meta: TemplateMeta = {
      id: input.id,
      scope: 'user',
      name: input.name.trim() || 'Untitled template',
      instruction: input.instruction,
      files,
      createdAt: input.createdAt,
      updatedAt: new Date().toISOString(),
    };
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(dir, 'template.json'),
      Buffer.from(JSON.stringify(meta, null, 2), 'utf8'),
    );
    return meta;
  }
}

async function deleteUri(uri: vscode.Uri): Promise<void> {
  try {
    await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: false });
  } catch {
    /* missing */
  }
}

export function templateScopeLabel(scope: TemplateScope): string {
  switch (scope) {
    case 'builtin':
      return 'built-in';
    case 'user':
      return 'user';
    case 'project':
      return 'project';
  }
}
