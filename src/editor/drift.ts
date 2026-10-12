/**
 * Pure helpers for deciding how far a code block has drifted from the text an
 * explanation was written against, plus a small line diff. No `vscode` import.
 */
import type { DriftLevel } from '../shared/types';
import { normalizeBlock } from './anchors';

export interface DriftInfo {
  level: DriftLevel;
  /** Added + removed lines (0 when fresh / cosmetic). */
  changedLines: number;
  /** Lines in the larger of the two versions. */
  totalLines: number;
  /** changedLines / totalLines (0..2). */
  ratio: number;
  /** True when only whitespace / comments differ. */
  cosmetic: boolean;
  /** True when the first non-blank line (usually a signature) changed. */
  headChanged: boolean;
}

export interface DriftThresholds {
  /** Up to this ratio of changed lines counts as `drifted`; above → `outdated`. */
  outdatedRatio: number;
  /** Up to this many changed lines counts as `drifted` regardless of ratio. */
  driftedMaxLines: number;
}

export const DEFAULT_DRIFT_THRESHOLDS: DriftThresholds = { outdatedRatio: 0.3, driftedMaxLines: 10 };

/** Compare the text an explanation saw with the current block text. */
export function computeDrift(
  oldText: string,
  currentText: string | undefined,
  thresholds: DriftThresholds = DEFAULT_DRIFT_THRESHOLDS,
): DriftInfo {
  const oldNorm = normalizeBlock(oldText);
  if (currentText === undefined) {
    const n = oldNorm ? oldNorm.split('\n').length : 0;
    return { level: 'lost', changedLines: n, totalLines: n, ratio: n ? 1 : 0, cosmetic: false, headChanged: true };
  }
  const newNorm = normalizeBlock(currentText);
  if (oldNorm === newNorm) {
    const n = oldNorm ? oldNorm.split('\n').length : 0;
    return { level: 'fresh', changedLines: 0, totalLines: n, ratio: 0, cosmetic: false, headChanged: false };
  }
  if (stripCosmetic(oldNorm) === stripCosmetic(newNorm)) {
    const n = Math.max(oldNorm.split('\n').length, newNorm.split('\n').length);
    return { level: 'fresh', changedLines: 0, totalLines: n, ratio: 0, cosmetic: true, headChanged: false };
  }
  const oldLines = oldNorm.split('\n');
  const newLines = newNorm.split('\n');
  const ops = lineDiff(oldLines, newLines);
  let changed = 0;
  for (const op of ops) if (op.type !== 'same') changed += 1;
  const total = Math.max(oldLines.length, newLines.length, 1);
  const ratio = changed / total;
  const headChanged = firstCodeLine(oldLines) !== firstCodeLine(newLines);
  const level: DriftLevel =
    headChanged || (ratio > thresholds.outdatedRatio && changed > thresholds.driftedMaxLines) ? 'outdated' : 'drifted';
  return { level, changedLines: changed, totalLines: total, ratio, cosmetic: false, headChanged };
}

/** Worst level across several blocks. */
export function worstLevel(levels: DriftLevel[]): DriftLevel {
  const order: DriftLevel[] = ['fresh', 'drifted', 'outdated', 'lost'];
  let worst = 0;
  for (const l of levels) worst = Math.max(worst, order.indexOf(l));
  return order[worst] ?? 'fresh';
}

export function describeDrift(info: Pick<DriftInfo, 'level' | 'changedLines'>): string {
  switch (info.level) {
    case 'fresh':
      return 'code unchanged';
    case 'drifted':
      return `code changed (${info.changedLines} line${info.changedLines === 1 ? '' : 's'})`;
    case 'outdated':
      return `outdated (${info.changedLines} line${info.changedLines === 1 ? '' : 's'} changed)`;
    case 'lost':
      return 'code block not found';
  }
}

/* --------------------------------------------------------------- diffing */

export type DiffOp = { type: 'same' | 'add' | 'del'; text: string };

/** Minimal LCS line diff. Falls back to "replace all" for very large inputs. */
export function lineDiff(a: string[], b: string[], maxCells = 4_000_000): DiffOp[] {
  const n = a.length;
  const m = b.length;
  if (n * m > maxCells) {
    return [...a.map((text) => ({ type: 'del' as const, text })), ...b.map((text) => ({ type: 'add' as const, text }))];
  }
  // dp[i][j] = LCS length of a[i..] and b[j..]
  const width = m + 1;
  const dp = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * width + j] = a[i] === b[j] ? dp[(i + 1) * width + j + 1] + 1 : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
    }
  }
  const out: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', text: a[i] });
      i++;
      j++;
    } else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) {
      out.push({ type: 'del', text: a[i++] });
    } else {
      out.push({ type: 'add', text: b[j++] });
    }
  }
  while (i < n) out.push({ type: 'del', text: a[i++] });
  while (j < m) out.push({ type: 'add', text: b[j++] });
  return out;
}

/** Unified-diff-like text (no hunk headers; small blocks). */
export function unifiedDiff(oldText: string, newText: string, header: { file: string; oldLabel?: string; newLabel?: string }): string {
  const ops = lineDiff(normalizeBlock(oldText).split('\n'), normalizeBlock(newText).split('\n'));
  const lines = [`--- ${header.file} (${header.oldLabel ?? 'explained'})`, `+++ ${header.file} (${header.newLabel ?? 'current'})`];
  for (const op of ops) lines.push((op.type === 'same' ? ' ' : op.type === 'add' ? '+' : '-') + op.text);
  return lines.join('\n');
}

/* --------------------------------------------------------------- helpers */

/**
 * Drop comments and all whitespace so cosmetic edits compare equal.
 * Handles `//`, `/* *\/`, `#` (full-line) and `--` (full-line) comments.
 * Strings are not parsed; this is a heuristic for "did the code change".
 */
export function stripCosmetic(text: string): string {
  let out = text.replace(/\/\*[\s\S]*?\*\//g, '');
  out = out
    .split('\n')
    .map((line) => {
      const t = line.trim();
      if (/^(#|--|\/\/)/.test(t)) return '';
      return line.replace(/\/\/.*$/, '');
    })
    .join('\n');
  return out.replace(/\s+/g, '');
}

function firstCodeLine(lines: string[]): string {
  for (const l of lines) {
    const t = l.trim();
    if (!t || /^(\/\/|#|--|\/\*|\*)/.test(t)) continue;
    return t.replace(/\s+/g, ' ');
  }
  return '';
}
