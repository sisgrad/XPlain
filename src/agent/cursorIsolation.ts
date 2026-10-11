/**
 * Manage a marked block inside workspace `.cursorignore` so Cursor sandbox / Landlock
 * cannot read other sessions' results or diagrams during an agent run.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export const CURSORIGNORE_BEGIN = '# >>> xplain-agent-isolation';
export const CURSORIGNORE_END = '# <<< xplain-agent-isolation';

/** Build the managed ignore block for one session's diagram allow-exception. */
export function buildIsolationBlock(sessionId: string): string {
  const id = sessionId.trim() || '_none_';
  return [
    CURSORIGNORE_BEGIN,
    '# Managed by XPlain — do not edit by hand (rewritten on each Send).',
    '# Hide all prior explanations; the current request carries explicit draft items.',
    '.xplain/sessions/**',
    '# Hide all diagram folders except this session.',
    '.xplain/diagrams/**',
    `!.xplain/diagrams/${id}/`,
    `!.xplain/diagrams/${id}/**`,
    '# Skills stay visible for Excalidraw / tools.',
    '!.xplain/skills/',
    '!.xplain/skills/**',
    CURSORIGNORE_END,
    '',
  ].join('\n');
}

/** Upsert or remove the managed isolation block in `<workspace>/.cursorignore`. */
export async function applyCursorIsolation(workspaceRoot: string, sessionId: string | null): Promise<void> {
  const file = path.join(workspaceRoot, '.cursorignore');
  let prev = '';
  try {
    prev = await fs.readFile(file, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw err;
  }
  const stripped = stripIsolationBlock(prev).replace(/\s+$/, '');
  const next = sessionId
    ? `${stripped ? `${stripped}\n\n` : ''}${buildIsolationBlock(sessionId)}`
    : stripped
      ? `${stripped}\n`
      : '';
  if (next === prev) return;
  if (!next.trim()) {
    try {
      await fs.unlink(file);
    } catch {
      await fs.writeFile(file, '', 'utf8');
    }
    return;
  }
  await fs.writeFile(file, next.endsWith('\n') ? next : `${next}\n`, 'utf8');
}

/** Keep sessions denied, drop per-session diagram allow-exception (safe default after a run). */
export async function clearCursorSessionAllow(workspaceRoot: string): Promise<void> {
  // Keep a stable deny block without a diagram allow-exception.
  await applyCursorIsolation(workspaceRoot, '_idle_');
}

export function stripIsolationBlock(text: string): string {
  const begin = text.indexOf(CURSORIGNORE_BEGIN);
  if (begin < 0) return text;
  const end = text.indexOf(CURSORIGNORE_END, begin);
  if (end < 0) return text.slice(0, begin).replace(/\s+$/, '');
  const after = text.slice(end + CURSORIGNORE_END.length).replace(/^\r?\n/, '');
  return (text.slice(0, begin) + after).replace(/\n{3,}/g, '\n\n').replace(/^\s+/, '').replace(/\s+$/, '');
}
