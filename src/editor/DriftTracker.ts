/**
 * Computes, per session, how far the current code has drifted from the text the
 * agent explained. Uses open documents (via LiveAnchors) when available, else
 * reads files from disk. Results are cached and recomputed (debounced) on edits.
 */
import * as vscode from 'vscode';
import type { DriftMap } from '../shared/protocol';
import type { Anchor, SessionDriftSummary, SessionMeta } from '../shared/types';
import type { XplainStore } from '../storage/XplainStore';
import { Emitter } from '../util/emitter';
import { findSnippet, hashBlock, rangeMatchesHash } from './anchors';
import { toRange } from './decorations';
import { computeDrift, DEFAULT_DRIFT_THRESHOLDS, worstLevel, type DriftInfo, type DriftThresholds } from './drift';
import { LiveAnchors } from './LiveAnchors';

export interface AnchorDrift {
  anchor: Anchor;
  info: DriftInfo;
  /** Text the agent saw (from context.json); undefined if unavailable. */
  oldText?: string;
  /** Current block text; undefined when lost. */
  newText?: string;
}

export interface SessionDrift {
  summary: SessionDriftSummary;
  anchors: AnchorDrift[];
}

export class DriftTracker implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly changeEmitter = new Emitter<DriftMap>();
  /** Fires with the full recomputed map. */
  readonly onDidChange = this.changeEmitter.event;

  private contextCache = new Map<string, Map<string, string>>();
  private fileCache = new Map<string, { text: string; mtime: number }>();
  private summaries: DriftMap = {};
  private timer: NodeJS.Timeout | undefined;
  private computing: Promise<DriftMap> | undefined;
  private dirty = false;

  constructor(
    private readonly store: XplainStore,
    private readonly live: LiveAnchors,
  ) {
    this.disposables.push(
      live.onDidChange(() => this.schedule(400)),
      store.onDidChange((c) => {
        if (c.kind === 'session') this.contextCache.delete(c.sessionId);
        if (c.kind === 'index') this.contextCache.clear();
        this.schedule(150);
      }),
      vscode.workspace.onDidSaveTextDocument(() => this.schedule(150)),
      vscode.workspace.onDidCloseTextDocument((d) => {
        const rel = LiveAnchors.relPath(d.uri);
        if (rel) this.fileCache.delete(rel);
        this.schedule(150);
      }),
    );
  }

  /** Last computed map (may be empty until the first compute finishes). */
  get current(): DriftMap {
    return this.summaries;
  }

  thresholds(): DriftThresholds {
    const cfg = vscode.workspace.getConfiguration('xplain.drift');
    return {
      outdatedRatio: cfg.get<number>('outdatedRatio', DEFAULT_DRIFT_THRESHOLDS.outdatedRatio),
      driftedMaxLines: cfg.get<number>('driftedMaxLines', DEFAULT_DRIFT_THRESHOLDS.driftedMaxLines),
    };
  }

  /** Recompute everything now and emit. */
  async refresh(): Promise<DriftMap> {
    if (this.computing) {
      this.dirty = true;
      return this.computing;
    }
    this.computing = (async () => {
      try {
        const map: DriftMap = {};
        const done = this.store.sessions.filter((s) => s.status === 'done' && s.anchorIds.length > 0);
        for (const s of done) {
          try {
            map[s.id] = (await this.sessionDrift(s)).summary;
          } catch {
            /* skip */
          }
        }
        this.summaries = map;
        this.changeEmitter.fire(map);
        return map;
      } finally {
        this.computing = undefined;
        if (this.dirty) {
          this.dirty = false;
          this.schedule(50);
        }
      }
    })();
    return this.computing;
  }

  /** Drift of one session, with per-anchor old/new text (for diff + refresh). */
  async sessionDrift(session: SessionMeta): Promise<SessionDrift> {
    const thresholds = this.thresholds();
    const anchors: AnchorDrift[] = [];
    let changedLines = 0;
    let changedBlocks = 0;
    let codeModifiedAt: number | undefined;
    const files = new Set<string>();

    for (const anchorId of session.anchorIds) {
      const anchor = this.store.getAnchor(anchorId);
      if (!anchor) continue;
      files.add(anchor.file);
      const newText = await this.currentBlockText(anchor);
      const oldHash = session.codeHashes?.[anchorId];
      // Fast path: hashes agree → fresh without touching context.json.
      if (newText !== undefined && oldHash && hashBlock(newText) === oldHash) {
        anchors.push({
          anchor,
          info: { level: 'fresh', changedLines: 0, totalLines: 0, ratio: 0, cosmetic: false, headChanged: false },
          newText,
        });
        continue;
      }
      const oldText = (await this.oldTexts(session.id)).get(anchorId) ?? (oldHash ? undefined : anchor.snippet);
      if (oldText === undefined) {
        // No record of what the agent saw: cannot judge, treat as fresh unless lost.
        anchors.push({
          anchor,
          info:
            newText === undefined
              ? { level: 'lost', changedLines: 0, totalLines: 0, ratio: 1, cosmetic: false, headChanged: true }
              : { level: 'fresh', changedLines: 0, totalLines: 0, ratio: 0, cosmetic: false, headChanged: false },
          newText,
        });
        if (newText === undefined) changedBlocks += 1;
        continue;
      }
      const info = computeDrift(oldText, newText, thresholds);
      anchors.push({ anchor, info, oldText, newText });
      if (info.level !== 'fresh') {
        changedBlocks += 1;
        changedLines += info.changedLines;
      }
    }

    const level = worstLevel(anchors.map((a) => a.info.level));
    if (level !== 'fresh') {
      for (const f of files) {
        const m = await this.fileMtime(f);
        if (m !== undefined) codeModifiedAt = Math.max(codeModifiedAt ?? 0, m);
      }
    }
    return {
      summary: {
        level,
        changedLines,
        blocks: anchors.length,
        changedBlocks,
        codeModifiedAt: codeModifiedAt ? new Date(codeModifiedAt).toISOString() : undefined,
      },
      anchors,
    };
  }

  /** Current text of the block (open doc → live range; else disk + hash/snippet). */
  async currentBlockText(anchor: Anchor): Promise<string | undefined> {
    const doc = vscode.workspace.textDocuments.find((d) => LiveAnchors.relPath(d.uri) === anchor.file);
    if (doc) {
      const live = this.live.forDocument(doc).find((l) => l.anchor.id === anchor.id);
      if (!live || live.stale) return undefined;
      return doc.getText(toRange(doc, live.range.startLine, live.range.endLine));
    }
    const text = await this.readFile(anchor.file);
    if (text === undefined) return undefined;
    const lines = text.split(/\r?\n/);
    const range = { startLine: anchor.startLine, endLine: anchor.endLine };
    if (rangeMatchesHash(lines, range, anchor.textHash)) return lines.slice(range.startLine - 1, range.endLine).join('\n');
    const found = findSnippet(lines, anchor.snippet, anchor.startLine);
    if (found) return lines.slice(found.startLine - 1, found.endLine).join('\n');
    return undefined;
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    for (const d of this.disposables) d.dispose();
    this.changeEmitter.dispose();
  }

  /* --------------------------------------------------------------- internals */

  private schedule(ms: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.refresh(), ms);
  }

  private async oldTexts(sessionId: string): Promise<Map<string, string>> {
    const cached = this.contextCache.get(sessionId);
    if (cached) return cached;
    const map = new Map<string, string>();
    const ctx = await this.store.readSessionContext(sessionId);
    for (const i of ctx?.items ?? []) if (i.kind === 'code') map.set(i.anchorId, i.text);
    this.contextCache.set(sessionId, map);
    return map;
  }

  private workspaceUri(rel: string): vscode.Uri | undefined {
    const folder = vscode.workspace.workspaceFolders?.[0];
    return folder ? vscode.Uri.joinPath(folder.uri, ...rel.split('/')) : undefined;
  }

  private async fileMtime(rel: string): Promise<number | undefined> {
    const uri = this.workspaceUri(rel);
    if (!uri) return undefined;
    try {
      return (await vscode.workspace.fs.stat(uri)).mtime;
    } catch {
      return undefined;
    }
  }

  private async readFile(rel: string): Promise<string | undefined> {
    const uri = this.workspaceUri(rel);
    if (!uri) return undefined;
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      const cached = this.fileCache.get(rel);
      if (cached && cached.mtime === stat.mtime) return cached.text;
      if (stat.size > 2 * 1024 * 1024) return undefined;
      const text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
      this.fileCache.set(rel, { text, mtime: stat.mtime });
      return text;
    } catch {
      return undefined;
    }
  }
}
