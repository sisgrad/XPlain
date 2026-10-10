/**
 * Keeps anchor ranges in sync with open documents while they are edited and
 * re-finds blocks by content when the text under an anchor no longer matches.
 */
import * as vscode from 'vscode';
import type { Anchor } from '../shared/types';
import type { XplainStore } from '../storage/XplainStore';
import { Emitter } from '../util/emitter';
import {
  applyLineChanges,
  findSnippet,
  rangeMatchesHash,
  toLineChange,
  type LineRange,
} from './anchors';

export interface LiveAnchor {
  anchor: Anchor;
  range: LineRange;
  /** True when the block could not be found in the current document text. */
  stale: boolean;
  /** True while the block text differs from the stored snippet (being edited). */
  modified: boolean;
}

export class LiveAnchors implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly byDoc = new Map<string, Map<string, LiveAnchor>>();
  private readonly persistTimers = new Map<string, NodeJS.Timeout>();
  private readonly changeEmitter = new Emitter<vscode.Uri | undefined>();
  /** Fires with the document uri whose anchors changed, or undefined for "everything". */
  readonly onDidChange = this.changeEmitter.event;

  constructor(private readonly store: XplainStore) {
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => this.handleChange(e)),
      vscode.workspace.onDidCloseTextDocument((d) => this.byDoc.delete(d.uri.toString())),
      vscode.workspace.onDidSaveTextDocument((d) => this.persistNow(d)),
      store.onDidChange((c) => {
        if (c.kind === 'index') {
          this.byDoc.clear();
          this.changeEmitter.fire(undefined);
        }
      }),
    );
  }

  /** Workspace-relative POSIX path for a document, or undefined if outside the workspace. */
  static relPath(uri: vscode.Uri): string | undefined {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) return undefined;
    const rel = vscode.workspace.asRelativePath(uri, false);
    return rel.replace(/\\/g, '/');
  }

  /** Live anchors for a document, computed on first access and kept up to date. */
  forDocument(doc: vscode.TextDocument): LiveAnchor[] {
    const key = doc.uri.toString();
    let map = this.byDoc.get(key);
    if (!map) {
      map = this.build(doc);
      this.byDoc.set(key, map);
    }
    return Array.from(map.values());
  }

  /** Current range of an anchor (from an open document if available, else from the store). */
  currentRange(anchorId: string): LineRange | undefined {
    for (const map of this.byDoc.values()) {
      const live = map.get(anchorId);
      if (live) return live.range;
    }
    const a = this.store.getAnchor(anchorId);
    return a ? { startLine: a.startLine, endLine: a.endLine } : undefined;
  }

  private build(doc: vscode.TextDocument): Map<string, LiveAnchor> {
    const map = new Map<string, LiveAnchor>();
    const rel = LiveAnchors.relPath(doc.uri);
    if (!rel) return map;
    const lines = doc.getText().split(/\r?\n/);
    for (const anchor of this.store.anchorsForFile(rel)) {
      const live = this.validate(anchor, { startLine: anchor.startLine, endLine: anchor.endLine }, lines);
      map.set(anchor.id, live);
    }
    return map;
  }

  private validate(anchor: Anchor, range: LineRange | null, lines: string[], tracked = false): LiveAnchor {
    if (range && rangeMatchesHash(lines, range, anchor.textHash)) {
      return { anchor, range, stale: false, modified: false };
    }
    const found = findSnippet(lines, anchor.snippet, range?.startLine ?? anchor.startLine);
    if (found) return { anchor, range: found, stale: false, modified: false };
    if (range && tracked && range.startLine >= 1 && range.endLine <= lines.length) {
      // The block is being edited in place: keep following it.
      return { anchor, range, stale: false, modified: true };
    }
    return { anchor, range: range ?? { startLine: anchor.startLine, endLine: anchor.endLine }, stale: true, modified: false };
  }

  private handleChange(e: vscode.TextDocumentChangeEvent): void {
    if (e.contentChanges.length === 0) return;
    const key = e.document.uri.toString();
    const map = this.byDoc.get(key);
    if (!map || map.size === 0) return;
    // Apply changes in order; VS Code reports them relative to the document
    // *before* the whole event, sorted descending, so process ascending-safe by
    // sorting ascending and compensating with cumulative deltas is complex.
    // Instead: apply each change in reverse order of position (bottom-up) which
    // keeps earlier positions valid.
    const changes = [...e.contentChanges]
      .sort((a, b) => b.range.start.compareTo(a.range.start))
      .map((c) =>
        toLineChange({
          startLine: c.range.start.line,
          startChar: c.range.start.character,
          endLine: c.range.end.line,
          endChar: c.range.end.character,
          text: c.text,
        }),
      );
    const lines = e.document.getText().split(/\r?\n/);
    for (const live of map.values()) {
      const next = live.stale ? null : applyLineChanges(live.range, changes);
      const updated = this.validate(live.anchor, next, lines, true);
      live.range = updated.range;
      live.stale = updated.stale;
      live.modified = updated.modified;
    }
    this.changeEmitter.fire(e.document.uri);
    this.schedulePersist(e.document);
  }

  private schedulePersist(doc: vscode.TextDocument): void {
    const key = doc.uri.toString();
    const existing = this.persistTimers.get(key);
    if (existing) clearTimeout(existing);
    this.persistTimers.set(
      key,
      setTimeout(() => this.persistNow(doc), 1500),
    );
  }

  private persistNow(doc: vscode.TextDocument): void {
    const key = doc.uri.toString();
    const timer = this.persistTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.persistTimers.delete(key);
    }
    const map = this.byDoc.get(key);
    if (!map) return;
    const lines = doc.getText().split(/\r?\n/);
    const updates = Array.from(map.values())
      .filter((l) => !l.stale)
      .map((l) => ({
        id: l.anchor.id,
        range: l.range,
        // An edited block adopts its new text so it can be re-found next time.
        text: l.modified ? lines.slice(l.range.startLine - 1, l.range.endLine).join('\n') : undefined,
      }));
    // updateAnchorRanges only fires (and clears our cache) when something changed.
    void this.store.updateAnchorRanges(updates);
  }

  dispose(): void {
    for (const t of this.persistTimers.values()) clearTimeout(t);
    this.disposables.forEach((d) => d.dispose());
    this.changeEmitter.dispose();
  }
}
