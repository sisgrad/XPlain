/**
 * Pure helpers for anchoring code blocks to line ranges and keeping those
 * ranges valid while the document is edited. No dependency on `vscode`.
 */
import { sha1 } from '../util/ids';

export interface LineRange {
  /** 1-based inclusive. */
  startLine: number;
  /** 1-based inclusive. */
  endLine: number;
}

/**
 * A single content change expressed in whole lines (1-based, inclusive).
 * `endLine` may equal `startLine - 1` for a pure insertion of whole lines
 * *before* `startLine` (nothing existing is touched).
 */
export interface LineChange {
  /** First existing line whose content is modified. */
  startLine: number;
  /** Last existing line whose content is modified. */
  endLine: number;
  /** Net change in the document line count caused by this edit. */
  delta: number;
}

/**
 * Convert an editor content change (0-based positions) into a LineChange.
 * `startLine/endLine/startChar/endChar` describe the replaced range,
 * `text` is the inserted text.
 */
export function toLineChange(c: {
  startLine: number;
  startChar: number;
  endLine: number;
  endChar: number;
  text: string;
}): LineChange {
  const removedNewlines = c.endLine - c.startLine;
  const addedNewlines = (c.text.match(/\n/g) ?? []).length;
  const delta = addedNewlines - removedNewlines;
  const start = c.startLine + 1;
  const isInsertion = removedNewlines === 0 && c.startChar === c.endChar;
  if (isInsertion && c.startChar === 0 && c.text.endsWith('\n')) {
    // Whole lines inserted before `start`: existing lines untouched.
    return { startLine: start, endLine: start - 1, delta };
  }
  // A range ending at column 0 of a later line does not modify that line's text.
  const end = c.endChar === 0 && c.endLine > c.startLine ? c.endLine : c.endLine + 1;
  return { startLine: start, endLine: Math.max(end, start), delta };
}

export function normalizeBlock(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/g, ''))
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
}

export function hashBlock(text: string): string {
  return sha1(normalizeBlock(text));
}

/**
 * Shift a range after a document change. Returns `null` if the whole block
 * was deleted. Lines strictly above the block move it; lines below do nothing;
 * overlapping edits grow/shrink the block end.
 */
export function applyLineChange(range: LineRange, change: LineChange): LineRange | null {
  const { delta } = change;
  if (change.endLine < range.startLine) {
    // Entirely above the block (or a whole-line insertion right before it).
    return { startLine: range.startLine + delta, endLine: range.endLine + delta };
  }
  if (change.startLine > range.endLine) {
    return range;
  }
  // Overlap.
  if (change.startLine <= range.startLine && change.endLine >= range.endLine) {
    // The whole block was covered by the edit. Keep pointing at whatever
    // replaced it (the caller re-validates by hash); destroyed if nothing is left.
    const newCount = change.endLine - change.startLine + 1 + delta;
    if (newCount <= 0) return null;
    return { startLine: change.startLine, endLine: change.startLine + newCount - 1 };
  }
  const start = Math.min(range.startLine, change.startLine);
  const end = Math.max(start, range.endLine + delta);
  return { startLine: start, endLine: end };
}

export function applyLineChanges(range: LineRange, changes: LineChange[]): LineRange | null {
  let current: LineRange | null = range;
  for (const c of changes) {
    if (!current) return null;
    current = applyLineChange(current, c);
  }
  return current;
}

/**
 * Find the block `snippet` in `lines` (document split by '\n').
 * Returns the match whose start is closest to `preferredStart`, or null.
 */
export function findSnippet(lines: string[], snippet: string, preferredStart: number): LineRange | null {
  const target = normalizeBlock(snippet).split('\n');
  if (target.length === 0 || (target.length === 1 && target[0] === '')) return null;
  const norm = lines.map((l) => l.replace(/\s+$/g, ''));
  const candidates: number[] = [];
  outer: for (let i = 0; i + target.length <= norm.length; i++) {
    for (let j = 0; j < target.length; j++) {
      if (norm[i + j] !== target[j]) continue outer;
    }
    candidates.push(i + 1);
  }
  if (candidates.length === 0) return null;
  let best = candidates[0];
  for (const c of candidates) {
    if (Math.abs(c - preferredStart) < Math.abs(best - preferredStart)) best = c;
  }
  return { startLine: best, endLine: best + target.length - 1 };
}

/** True when `lines[range]` still hashes to `expectedHash`. */
export function rangeMatchesHash(lines: string[], range: LineRange, expectedHash: string): boolean {
  if (range.startLine < 1 || range.endLine > lines.length || range.endLine < range.startLine) return false;
  const text = lines.slice(range.startLine - 1, range.endLine).join('\n');
  return hashBlock(text) === expectedHash;
}

export function rangesOverlap(a: LineRange, b: LineRange): boolean {
  return a.startLine <= b.endLine && b.startLine <= a.endLine;
}

export function formatRange(range: LineRange): string {
  return range.startLine === range.endLine ? `L${range.startLine}` : `L${range.startLine}-L${range.endLine}`;
}
