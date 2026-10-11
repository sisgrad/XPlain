/**
 * Rewrite local image/file references inside HTML into data: URIs so result.html
 * is truly self-contained (no separate assets needed at view time).
 */
import * as path from 'node:path';

const SKIP_SCHEME = /^(data:|https?:|blob:|mailto:|#)/i;
const ATTR_RE = /\b(?:src|href)=(["'])([^"']+)\1/gi;
const SRCSET_RE = /\bsrcset=(["'])([^"']+)\1/gi;
const CSS_URL_RE = /url\(\s*(['"]?)([^"')]+)\1\s*\)/gi;

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
};

export interface InlineAssetsOptions {
  /** Absolute workspace folder paths. */
  workspaceRoots: string[];
  /** Read an absolute filesystem path; return undefined when missing/unreadable. */
  readFile: (absPath: string) => Promise<Uint8Array | undefined>;
  /** Optional directory listing for basename fallback under `.xplain/diagrams`. */
  listDir?: (absPath: string) => Promise<string[]>;
  /** Skip files larger than this (bytes). Default 12 MiB. */
  maxBytes?: number;
}

export interface InlineAssetsResult {
  html: string;
  inlined: string[];
  missing: string[];
}

/** Inline every resolvable local asset reference in `html`. */
export async function inlineLocalAssets(html: string, opts: InlineAssetsOptions): Promise<InlineAssetsResult> {
  const maxBytes = opts.maxBytes ?? 12 * 1024 * 1024;
  const cache = new Map<string, string | undefined>();
  const inlined: string[] = [];
  const missing: string[] = [];

  const resolveDataUri = async (ref: string): Promise<string | undefined> => {
    const cleaned = decodeHtmlEntities(ref.trim());
    if (!cleaned || SKIP_SCHEME.test(cleaned)) return undefined;
    if (cache.has(cleaned)) return cache.get(cleaned);

    const candidates = candidatePaths(cleaned, opts.workspaceRoots);
    if (opts.listDir) {
      const base = path.posix.basename(cleaned.replace(/\\/g, '/'));
      if (base && !base.includes('..')) {
        for (const root of opts.workspaceRoots) {
          const dir = path.join(root, '.xplain', 'diagrams');
          try {
            const names = await opts.listDir(dir);
            if (names.includes(base)) candidates.push(path.join(dir, base));
          } catch {
            /* ignore */
          }
        }
      }
    }

    let dataUri: string | undefined;
    for (const abs of unique(candidates)) {
      const bytes = await opts.readFile(abs);
      if (!bytes || bytes.byteLength === 0 || bytes.byteLength > maxBytes) continue;
      const mime = mimeFor(abs, bytes);
      if (!mime) continue;
      dataUri = `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
      inlined.push(cleaned);
      break;
    }
    if (!dataUri) missing.push(cleaned);
    cache.set(cleaned, dataUri);
    return dataUri;
  };

  let out = html;

  out = await replaceAsync(out, ATTR_RE, async (full, quote: string, ref: string) => {
    const data = await resolveDataUri(ref);
    return data ? full.replace(ref, data) : full;
  });

  out = await replaceAsync(out, SRCSET_RE, async (full, quote: string, value: string) => {
    const parts = value.split(',').map((p) => p.trim()).filter(Boolean);
    let changed = false;
    const next: string[] = [];
    for (const part of parts) {
      const m = part.match(/^(\S+)(\s+.+)?$/);
      if (!m) {
        next.push(part);
        continue;
      }
      const data = await resolveDataUri(m[1]);
      if (data) {
        changed = true;
        next.push(`${data}${m[2] ?? ''}`);
      } else {
        next.push(part);
      }
    }
    if (!changed) return full;
    return `srcset=${quote}${next.join(', ')}${quote}`;
  });

  out = await replaceAsync(out, CSS_URL_RE, async (full, _q: string, ref: string) => {
    const data = await resolveDataUri(ref);
    return data ? `url("${data}")` : full;
  });

  return { html: out, inlined: unique(inlined), missing: unique(missing) };
}

/** Build filesystem candidates for a path/URL appearing in HTML. */
export function candidatePaths(ref: string, workspaceRoots: string[]): string[] {
  const out: string[] = [];
  let raw = ref.trim();
  if (raw.startsWith('file://')) {
    try {
      raw = decodeURIComponent(raw.slice('file://'.length));
    } catch {
      raw = raw.slice('file://'.length);
    }
  }
  const posix = raw.replace(/\\/g, '/');

  if (path.isAbsolute(raw) || posix.startsWith('/')) {
    out.push(raw);
    out.push(posix);
  }

  // Agent containers often mount the project at /workspace/...
  const stripped = posix.startsWith('/workspace/') ? posix.slice('/workspace/'.length) : '';

  const relCandidates = new Set<string>();
  if (!path.isAbsolute(posix) && !posix.startsWith('/')) relCandidates.add(posix.replace(/^\.\//, ''));
  if (posix.includes('.xplain/')) {
    const idx = posix.indexOf('.xplain/');
    relCandidates.add(posix.slice(idx));
  }
  if (stripped) {
    relCandidates.add(stripped.replace(/^\.\//, ''));
    if (stripped.includes('.xplain/')) {
      const idx = stripped.indexOf('.xplain/');
      relCandidates.add(stripped.slice(idx));
    }
  }

  const base = path.posix.basename(posix);
  for (const root of workspaceRoots) {
    for (const rel of relCandidates) {
      out.push(path.join(root, ...rel.split('/').filter(Boolean)));
    }
    if (base && base.includes('.')) {
      out.push(path.join(root, '.xplain', 'diagrams', base));
      out.push(path.join(root, '.xplain', base));
    }
  }
  return unique(out);
}

function mimeFor(absPath: string, bytes: Uint8Array): string | undefined {
  const ext = path.extname(absPath).toLowerCase();
  if (MIME_BY_EXT[ext]) return MIME_BY_EXT[ext];
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  const head = Buffer.from(bytes.slice(0, 256)).toString('utf8').trimStart();
  if (head.startsWith('<svg') || head.startsWith('<?xml')) return 'image/svg+xml';
  return undefined;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

async function replaceAsync(
  input: string,
  re: RegExp,
  replacer: (...args: string[]) => Promise<string>,
): Promise<string> {
  const parts: string[] = [];
  let last = 0;
  for (const m of input.matchAll(re)) {
    const idx = m.index ?? 0;
    parts.push(input.slice(last, idx));
    parts.push(await replacer(...m));
    last = idx + m[0].length;
  }
  parts.push(input.slice(last));
  return parts.join('');
}
