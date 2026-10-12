/**
 * When an agent (especially Cursor SDK) writes the real HTML to a workspace file
 * and returns a stub chat message, recover the document from disk.
 *
 * Also extracts a full HTML document embedded after a short chat preamble
 * ("Here is the explanation.\n\n<!DOCTYPE html>...").
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { detectHtml, unwrapHtmlFence } from './htmlResult';

const HTML_PATH_RE = /(?:^|[\s"'`(])((?:\/|(?:\.\.?\/)?|\w:\\)[^\s"'`<>)]+?\.html)/gi;

const STUB_HINT =
  /не помещается|does not fit|too large|saved (?:to|as)|wrote (?:to|the)|open (?:this|the) file|cat\s+\S+\.html|полный html|full html.*(?:file|файл)/i;

/** Excalidraw offline render shell — never a finished XPlain explanation. */
const RENDER_TEMPLATE_SHELL =
  /id=["']root["'][\s\S]*renderDiagram|ExcalidrawExport|excalidraw-export\.iife/i;

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
  const embedded = extractEmbeddedHtmlDocument(raw);

  // Prefer a real explanation embedded in the chat over any on-disk candidate.
  if (embedded && isCompleteHtmlDocument(embedded) && !isRenderTemplateShell(embedded)) {
    return { html: embedded };
  }

  if (isCompleteHtmlDocument(raw) && !STUB_HINT.test(raw) && !isRenderTemplateShell(raw)) {
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
    if (shouldSkipRecoveryPath(abs)) continue;
    try {
      const html = await fs.readFile(abs, 'utf8');
      if (!isCompleteHtmlDocument(html) || isRenderTemplateShell(html)) continue;
      const score = html.length + htmlAssetBonus(html);
      if (!best || score > best.score) best = { path: abs, html, score };
    } catch {
      /* missing */
    }
  }

  const baseline = embedded && !isRenderTemplateShell(embedded) ? embedded : raw;
  const baselineLen = isCompleteHtmlDocument(baseline) || embedded ? baseline.length : 0;

  if (
    best &&
    best.html.length >= Math.max(400, baselineLen) &&
    (!isCompleteHtmlDocument(baseline) ||
      isRenderTemplateShell(baseline) ||
      best.html.length > baselineLen * 1.2 ||
      STUB_HINT.test(raw))
  ) {
    return { html: best.html, recoveredFrom: best.path };
  }

  if (embedded && !isRenderTemplateShell(embedded)) return { html: embedded };
  return { html: raw };
}

/** Pull `<!DOCTYPE html>…</html>` (or `<html>…</html>`) out of a chat preamble. */
export function extractEmbeddedHtmlDocument(text: string): string | undefined {
  const trimmed = text.trim();
  if (detectHtml(trimmed)) return trimmed;
  const doctype = trimmed.search(/<!DOCTYPE\s+html/i);
  const htmlTag = trimmed.search(/<html[\s>]/i);
  const start = doctype >= 0 ? doctype : htmlTag;
  if (start < 0) return undefined;
  // Preamble must stay short — avoid grabbing HTML from huge unrelated logs.
  if (start > 4_000) return undefined;
  const slice = trimmed.slice(start);
  const end = slice.search(/<\/html>/i);
  if (end < 0) return undefined;
  const doc = slice.slice(0, end + '</html>'.length).trim();
  return doc || undefined;
}

export function isRenderTemplateShell(html: string): boolean {
  if (!RENDER_TEMPLATE_SHELL.test(html)) return false;
  // Real explanations with diagrams reference PNGs / data URIs; the shell does not.
  if (/data:image\//i.test(html)) return false;
  if (/<img[^>]+src=["'][^"']+\.(?:png|jpe?g|gif|webp|svg)/i.test(html)) return false;
  return html.length < 12_000;
}

function shouldSkipRecoveryPath(abs: string): boolean {
  const norm = abs.replace(/\\/g, '/').toLowerCase();
  // Skill / vendor templates are not user explanations.
  if (norm.includes('/skills/') && norm.includes('render_template')) return true;
  if (norm.endsWith('/vendor/excalidraw-export.iife.js')) return true;
  return false;
}

function htmlAssetBonus(html: string): number {
  let n = 0;
  if (/data:image\//i.test(html)) n += 50_000;
  // Prefer docs that already point at diagram files (XPlain will inline them).
  if (/<img[^>]+src=["'][^"']+\.(?:png|jpe?g|gif|webp|svg)/i.test(html)) n += 40_000;
  return n;
}

export function isCompleteHtmlDocument(text: string): boolean {
  const doc = detectHtml(text.trim()) ? text.trim() : extractEmbeddedHtmlDocument(text);
  if (!doc || isRenderTemplateShell(doc)) return false;
  if (!detectHtml(doc)) return false;
  if (!/<\/html>/i.test(doc)) return false;
  // Tiny shells that only say "see file X" are not complete answers.
  if (doc.length < 800 && STUB_HINT.test(doc)) return false;
  return (
    doc.length >= 400 ||
    /data:image\//i.test(doc) ||
    /<img[^>]+src=["'][^"']+\.(?:png|jpe?g|gif|webp|svg)/i.test(doc)
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
        // Skill trees often contain render_template.html — never treat as an answer.
        if (name === 'skills' || name === 'vendor' || name === '.venv') continue;
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
