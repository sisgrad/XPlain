/**
 * Persistent storage under `<workspace>/.xplain/`.
 *
 * .xplain/
 *   index.json                    anchors + session metadata
 *   sessions/<id>/context.json    full context that was sent
 *   sessions/<id>/result.md|html  agent answer
 *   templates/<id>/template.json  name, instruction, file list
 *   templates/<id>/files/<name>   attached files
 */
import type {
  Anchor,
  ContextItem,
  ResultFormat,
  SessionContext,
  SessionMeta,
  TemplateFile,
  TemplateMeta,
  XplainIndex,
} from '../shared/types';
import { Emitter } from '../util/emitter';
import { newId } from '../util/ids';
import { hashBlock, type LineRange } from '../editor/anchors';
import { decodeText, encodeText, joinPath, type StoreFs } from './fs';

export const XPLAIN_DIR = '.xplain';
const INDEX_FILE = 'index.json';
const SESSIONS_DIR = 'sessions';
const TEMPLATES_DIR = 'templates';

export interface AnchorInput {
  file: string;
  startLine: number;
  endLine: number;
  text: string;
  language: string;
}

export interface NewSessionInput {
  title: string;
  question: string;
  items: SessionContext['items'];
  agent: SessionContext['agent'];
}

export type StoreChange =
  | { kind: 'index' }
  | { kind: 'session'; sessionId: string }
  | { kind: 'templates' };

export class XplainStore {
  private index: XplainIndex = { version: 1, anchors: [], sessions: [] };
  private templates: TemplateMeta[] = [];
  private readonly changeEmitter = new Emitter<StoreChange>();
  readonly onDidChange = this.changeEmitter.event;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly fs: StoreFs) {}

  /* ------------------------------------------------------------------ init */

  async init(): Promise<void> {
    await this.fs.mkdirp('');
    await this.fs.mkdirp(SESSIONS_DIR);
    await this.fs.mkdirp(TEMPLATES_DIR);
    if (await this.fs.exists(INDEX_FILE)) {
      try {
        const parsed = JSON.parse(decodeText(await this.fs.readFile(INDEX_FILE))) as Partial<XplainIndex>;
        this.index = {
          version: 1,
          anchors: Array.isArray(parsed.anchors) ? parsed.anchors : [],
          sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
        };
      } catch (err) {
        console.error('[xplain] index.json is corrupt, starting fresh', err);
        this.index = { version: 1, anchors: [], sessions: [] };
      }
    } else {
      await this.persistIndex();
    }
    if (!(await this.fs.exists('.gitignore'))) {
      // Keep temp files out of git; users may still commit the folder itself.
      await this.fs.writeFile('.gitignore', encodeText('*.tmp\n'));
    }
    await this.backfillCodeHashes();
    await this.reloadTemplates();
  }

  /** Legacy sessions (before drift tracking) get codeHashes from their context.json. */
  private async backfillCodeHashes(): Promise<void> {
    let changed = false;
    for (const meta of this.index.sessions) {
      if (meta.codeHashes || meta.anchorIds.length === 0) continue;
      const ctx = await this.readSessionContext(meta.id);
      if (!ctx) continue;
      meta.codeHashes = codeHashesFromItems(ctx.items);
      changed = true;
    }
    if (changed) await this.persistIndex();
  }

  /** Reload from disk (e.g. after an external change detected by a watcher). */
  async reload(): Promise<void> {
    await this.init();
    this.changeEmitter.fire({ kind: 'index' });
    this.changeEmitter.fire({ kind: 'templates' });
  }

  /* --------------------------------------------------------------- anchors */

  get anchors(): readonly Anchor[] {
    return this.index.anchors;
  }

  getAnchor(id: string): Anchor | undefined {
    return this.index.anchors.find((a) => a.id === id);
  }

  anchorsForFile(file: string): Anchor[] {
    return this.index.anchors.filter((a) => a.file === file);
  }

  /**
   * Find an existing anchor for this block or create a new one.
   * Match order: same file+range+hash -> same file+hash (block moved) -> new.
   * Note: a sub-range of an existing block is always a *separate* anchor.
   */
  async upsertAnchor(input: AnchorInput): Promise<Anchor> {
    const textHash = hashBlock(input.text);
    const sameFile = this.index.anchors.filter((a) => a.file === input.file);
    let anchor = sameFile.find(
      (a) => a.startLine === input.startLine && a.endLine === input.endLine && a.textHash === textHash,
    );
    if (!anchor) {
      anchor = sameFile.find((a) => a.textHash === textHash);
      if (anchor) {
        anchor.startLine = input.startLine;
        anchor.endLine = input.endLine;
      }
    }
    if (!anchor) {
      anchor = {
        id: newId(),
        file: input.file,
        startLine: input.startLine,
        endLine: input.endLine,
        textHash,
        snippet: input.text,
        language: input.language,
      };
      this.index.anchors.push(anchor);
    }
    await this.persistIndex();
    this.changeEmitter.fire({ kind: 'index' });
    return anchor;
  }

  /**
   * Persist updated ranges for anchors (after tracking edits). When `text` is
   * given the anchor adopts the new block text (snippet + hash).
   */
  async updateAnchorRanges(updates: Array<{ id: string; range: LineRange; text?: string }>): Promise<void> {
    let changed = false;
    for (const u of updates) {
      const a = this.getAnchor(u.id);
      if (!a) continue;
      if (a.startLine !== u.range.startLine || a.endLine !== u.range.endLine) {
        a.startLine = u.range.startLine;
        a.endLine = u.range.endLine;
        changed = true;
      }
      if (u.text !== undefined && u.text.trim()) {
        const h = hashBlock(u.text);
        if (h !== a.textHash) {
          a.textHash = h;
          a.snippet = u.text;
          changed = true;
        }
      }
    }
    if (changed) {
      await this.persistIndex();
      this.changeEmitter.fire({ kind: 'index' });
    }
  }

  /** Anchors that no session references any more. */
  private pruneOrphanAnchors(): void {
    const used = new Set<string>();
    for (const s of this.index.sessions) s.anchorIds.forEach((id) => used.add(id));
    this.index.anchors = this.index.anchors.filter((a) => used.has(a.id));
  }

  /* -------------------------------------------------------------- sessions */

  get sessions(): readonly SessionMeta[] {
    return this.index.sessions;
  }

  getSession(id: string): SessionMeta | undefined {
    return this.index.sessions.find((s) => s.id === id);
  }

  /** Sessions attached to an anchor, newest first. */
  sessionsForAnchor(anchorId: string): SessionMeta[] {
    return this.index.sessions
      .filter((s) => s.anchorIds.includes(anchorId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async createSession(input: NewSessionInput): Promise<SessionMeta> {
    const id = newId();
    const createdAt = new Date().toISOString();
    const anchorIds = Array.from(
      new Set(input.items.flatMap((i) => (i.kind === 'code' ? [i.anchorId] : []))),
    );
    const meta: SessionMeta = {
      id,
      title: input.title,
      createdAt,
      anchorIds,
      question: input.question,
      resultFormat: 'markdown',
      status: 'pending',
      codeHashes: codeHashesFromItems(input.items),
    };
    const context: SessionContext = {
      id,
      title: input.title,
      createdAt,
      question: input.question,
      items: input.items,
      agent: input.agent,
      status: 'pending',
    };
    await this.fs.mkdirp(joinPath(SESSIONS_DIR, id));
    await this.fs.writeFileAtomic(
      joinPath(SESSIONS_DIR, id, 'context.json'),
      encodeText(JSON.stringify(context, null, 2)),
    );
    this.index.sessions.push(meta);
    await this.persistIndex();
    this.changeEmitter.fire({ kind: 'index' });
    return meta;
  }

  async completeSession(
    sessionId: string,
    result: { title: string; format: ResultFormat; content: string },
  ): Promise<SessionMeta | undefined> {
    const meta = this.getSession(sessionId);
    if (!meta) return undefined;
    meta.title = result.title;
    meta.resultFormat = result.format;
    meta.status = 'done';
    delete meta.error;
    await this.fs.writeFileAtomic(this.resultPath(sessionId, result.format), encodeText(result.content));
    // Remove the other format if it exists from a previous attempt.
    const other: ResultFormat = result.format === 'markdown' ? 'html' : 'markdown';
    if (await this.fs.exists(this.resultPath(sessionId, other))) await this.fs.delete(this.resultPath(sessionId, other));
    await this.patchContext(sessionId, { title: result.title, status: 'done', error: undefined });
    await this.persistIndex();
    this.changeEmitter.fire({ kind: 'session', sessionId });
    this.changeEmitter.fire({ kind: 'index' });
    return meta;
  }

  /**
   * Rewrite session context/question/agent without flipping status away from `done`
   * (CodeLens only lists done sessions). Used by Extend overwrite.
   */
  async replaceSessionContext(
    sessionId: string,
    patch: {
      title?: string;
      question: string;
      items: ContextItem[];
      agent: SessionContext['agent'];
      anchorIds?: string[];
    },
  ): Promise<SessionMeta | undefined> {
    const meta = this.getSession(sessionId);
    if (!meta) return undefined;
    if (patch.title !== undefined) meta.title = patch.title;
    meta.question = patch.question;
    if (patch.anchorIds) meta.anchorIds = patch.anchorIds;
    else {
      meta.anchorIds = Array.from(
        new Set(patch.items.flatMap((i) => (i.kind === 'code' ? [i.anchorId] : []))),
      );
    }
    // The agent now sees the current text: drift resets for these blocks.
    meta.codeHashes = codeHashesFromItems(patch.items);
    await this.patchContext(sessionId, {
      title: meta.title,
      question: patch.question,
      items: patch.items,
      agent: patch.agent,
      status: meta.status,
      error: meta.error,
    });
    await this.persistIndex();
    this.changeEmitter.fire({ kind: 'session', sessionId });
    this.changeEmitter.fire({ kind: 'index' });
    return meta;
  }

  async failSession(sessionId: string, error: string): Promise<void> {
    const meta = this.getSession(sessionId);
    if (!meta) return;
    meta.status = 'error';
    meta.error = error;
    await this.patchContext(sessionId, { status: 'error', error });
    await this.persistIndex();
    this.changeEmitter.fire({ kind: 'index' });
  }

  async renameSession(sessionId: string, title: string): Promise<void> {
    const meta = this.getSession(sessionId);
    if (!meta) return;
    meta.title = title;
    await this.patchContext(sessionId, { title });
    await this.persistIndex();
    this.changeEmitter.fire({ kind: 'index' });
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.index.sessions = this.index.sessions.filter((s) => s.id !== sessionId);
    this.pruneOrphanAnchors();
    await this.fs.delete(joinPath(SESSIONS_DIR, sessionId));
    await this.persistIndex();
    this.changeEmitter.fire({ kind: 'index' });
  }

  async readSessionContext(sessionId: string): Promise<SessionContext | undefined> {
    try {
      return JSON.parse(decodeText(await this.fs.readFile(joinPath(SESSIONS_DIR, sessionId, 'context.json'))));
    } catch {
      return undefined;
    }
  }

  async readResult(sessionId: string): Promise<{ format: ResultFormat; content: string } | undefined> {
    const meta = this.getSession(sessionId);
    if (!meta) return undefined;
    const path = this.resultPath(sessionId, meta.resultFormat);
    if (!(await this.fs.exists(path))) return undefined;
    return { format: meta.resultFormat, content: decodeText(await this.fs.readFile(path)) };
  }

  resultPath(sessionId: string, format: ResultFormat): string {
    return joinPath(SESSIONS_DIR, sessionId, format === 'html' ? 'result.html' : 'result.md');
  }

  private async patchContext(sessionId: string, patch: Partial<SessionContext>): Promise<void> {
    const ctx = await this.readSessionContext(sessionId);
    if (!ctx) return;
    const next = { ...ctx, ...patch };
    for (const k of Object.keys(next) as Array<keyof SessionContext>) {
      if (next[k] === undefined) delete next[k];
    }
    await this.fs.writeFileAtomic(
      joinPath(SESSIONS_DIR, sessionId, 'context.json'),
      encodeText(JSON.stringify(next, null, 2)),
    );
  }

  /* ------------------------------------------------------------- templates */

  get templateList(): readonly TemplateMeta[] {
    return this.templates;
  }

  getTemplate(id: string): TemplateMeta | undefined {
    return this.templates.find((t) => t.id === id);
  }

  private async reloadTemplates(): Promise<void> {
    const ids = await this.fs.readdir(TEMPLATES_DIR);
    const list: TemplateMeta[] = [];
    for (const id of ids) {
      try {
        const raw = decodeText(await this.fs.readFile(joinPath(TEMPLATES_DIR, id, 'template.json')));
        const parsed = JSON.parse(raw) as Partial<TemplateMeta>;
        if (!parsed || parsed.id !== id) continue;
        list.push({
          id,
          scope: 'project',
          name: typeof parsed.name === 'string' ? parsed.name : 'Untitled template',
          instruction: typeof parsed.instruction === 'string' ? parsed.instruction : '',
          files: Array.isArray(parsed.files) ? parsed.files : [],
          createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date().toISOString(),
          updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
        });
      } catch {
        /* skip broken template folders */
      }
    }
    list.sort((a, b) => a.name.localeCompare(b.name));
    this.templates = list;
  }

  async saveTemplate(input: {
    id: string | null;
    name: string;
    instruction: string;
    files: TemplateFile[];
  }): Promise<TemplateMeta> {
    const now = new Date().toISOString();
    const existing = input.id ? this.getTemplate(input.id) : undefined;
    const id = existing?.id ?? newId();
    const dir = joinPath(TEMPLATES_DIR, id);
    // Replace the files folder wholesale so removed files disappear.
    await this.fs.delete(joinPath(dir, 'files'));
    await this.fs.mkdirp(joinPath(dir, 'files'));
    const files = [];
    const seen = new Set<string>();
    for (const f of input.files) {
      let name = sanitizeFileName(f.name);
      while (seen.has(name)) name = `_${name}`;
      seen.add(name);
      const data = encodeText(f.content);
      await this.fs.writeFile(joinPath(dir, 'files', name), data);
      files.push({ name, size: data.byteLength });
    }
    const meta: TemplateMeta = {
      id,
      scope: 'project',
      name: input.name.trim() || 'Untitled template',
      instruction: input.instruction,
      files,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await this.fs.writeFileAtomic(joinPath(dir, 'template.json'), encodeText(JSON.stringify(meta, null, 2)));
    await this.reloadTemplates();
    this.changeEmitter.fire({ kind: 'templates' });
    return meta;
  }

  async deleteTemplate(id: string): Promise<void> {
    await this.fs.delete(joinPath(TEMPLATES_DIR, id));
    await this.reloadTemplates();
    this.changeEmitter.fire({ kind: 'templates' });
  }

  async readTemplateFiles(id: string): Promise<TemplateFile[]> {
    const meta = this.getTemplate(id);
    if (!meta) return [];
    const out: TemplateFile[] = [];
    for (const f of meta.files) {
      try {
        out.push({ name: f.name, content: decodeText(await this.fs.readFile(joinPath(TEMPLATES_DIR, id, 'files', f.name))) });
      } catch {
        /* missing file */
      }
    }
    return out;
  }

  /* ------------------------------------------------------------- internals */

  private persistIndex(): Promise<void> {
    const snapshot = JSON.stringify(this.index, null, 2);
    this.writeQueue = this.writeQueue
      .then(() => this.fs.writeFileAtomic(INDEX_FILE, encodeText(snapshot)))
      .catch((err) => console.error('[xplain] failed to write index.json', err));
    return this.writeQueue;
  }
}

/** anchorId → hash of the code text in `items` (what the agent saw). */
export function codeHashesFromItems(items: ContextItem[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of items) if (i.kind === 'code') out[i.anchorId] = hashBlock(i.text);
  return out;
}

export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[<>:"|?*\u0000-\u001f]/g, '_').trim();
  return clean || 'file';
}
