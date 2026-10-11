/**
 * When an agent (especially Cursor SDK) writes the real HTML to a workspace file
 * and returns a stub chat message, recover the document from disk.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { detectHtml, unwrapHtmlFence } from './htmlResult';

const HTML_PATH_RE = /(?:^|[\s"'`(])((?:\/|(?:\.\.?\/)?|\w:\\)[^\s"'`<>)]+?\.html)/gi;

const STUB_HINT =
  /не помещается|does not fit|too large|saved (?:to|as)|wrote (?:to|the)|open (?:this|the) file|cat\s+\S+\.html|полный html|full html.*(?:file|файл)/i;

export interface RecoverHtmlOptions {
  /** Workspace root(s) used to resolve relative paths. */
  workspaceRoots: string[];
  /** Ignore session result.html under .xplain/sessions/. */
  excludeSessions?: boolean;
  /** Also pick up .html files under .xplain/ modified after this time (ms). */
  sinceMs?: number;
}

/**
 * Return the best HTML document for the agent answer: the message itself if it
 * already is a full page, otherwise a workspace HTML file the message points at
 * (or a recently written `.xplain/*.html` artifact).
 */
export async function recoverHtmlAnswer(content: string, opts: RecoverHtmlOptions): Promise<{ html: string; recoveredFrom?: string }> {
  const raw = unwrapHtmlFence(content).trim();
  if (isCompleteHtmlDocument(raw) && !STUB_HINT.test(raw)) {
    return { html: raw };
  }

  const candidates: string[] = [];
  for (const ref of extractHtmlPaths(raw)) {
    candidates.push(...resolveCandidates(ref, opts.workspaceRoots));
  }
  if (opts.sinceMs !== undefined) {
    for (const root of opts.workspaceRoots) {
      candidates.push(...(await listRecentXplainHtml(root, opts.sinceMs, opts.excludeSessions !== false)));
    }
  }

  let best: { path: string; html: string; score: number } | undefined;
  for (const abs of unique(candidates)) {
    try {
      const html = await fs.readFile(abs, 'utf8');
      if (!isCompleteHtmlDocument(html)) continue;
      const score = html.length + htmlAssetBonus(html);
      if (!best || score > best.score) best = { path: abs, html, score };
    } catch {
      /* missing */
    }
  }

  if (best && (!isCompleteHtmlDocument(raw) || best.html.length > raw.length * 1.2 || STUB_HINT.test(raw))) {
    return { html: best.html, recoveredFrom: best.path };
  }
  return { html: raw };
}

function htmlAssetBonus(html: string): number {
  let n = 0;
  if (/data:image\//i.test(html)) n += 50_000;
  // Prefer docs that already point at diagram files (XPlain will inline them).
  if (/<img[^>]+src=["'][^"']+\.(?:png|jpe?g|gif|webp|svg)/i.test(html)) n += 40_000;
  return n;
}

export function isCompleteHtmlDocument(text: string): boolean {
  if (!detectHtml(text)) return false;
  if (!/<\/html>/i.test(text)) return false;
  // Tiny shells that only say "see file X" are not complete answers.
  if (text.length < 800 && STUB_HINT.test(text)) return false;
  return (
    text.length >= 400 ||
    /data:image\//i.test(text) ||
    /<img[^>]+src=["'][^"']+\.(?:png|jpe?g|gif|webp|svg)/i.test(text)
  );
}

export function extractHtmlPaths(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(HTML_PATH_RE)) {
    const p = m[1]?.trim();
    if (p) out.push(p.replace(/[.,;:]+$/, ''));
  }
  return unique(out);
}

function resolveCandidates(ref: string, roots: string[]): string[] {
  const out: string[] = [];
  const normalized = ref.replace(/\\/g, '/');
  if (path.isAbsolute(ref) || normalized.startsWith('/')) out.push(ref);
  for (const root of roots) {
    if (!path.isAbsolute(ref)) out.push(path.join(root, ref.replace(/^\.\//, '')));
    const idx = normalized.indexOf('.xplain/');
    if (idx >= 0) out.push(path.join(root, ...normalized.slice(idx).split('/')));
  }
  return out;
}

async function listRecentXplainHtml(root: string, sinceMs: number, excludeSessions: boolean): Promise<string[]> {
  const base = path.join(root, '.xplain');
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const full = path.join(dir, name);
      let st: Awaited<ReturnType<typeof fs.stat>>;
      try {
        st = await fs.stat(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (excludeSessions && name === 'sessions') continue;
        await walk(full);
      } else if (st.isFile() && name.endsWith('.html') && st.mtimeMs >= sinceMs - 5_000) {
        out.push(full);
      }
    }
  }
  await walk(base);
  return out;
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}
