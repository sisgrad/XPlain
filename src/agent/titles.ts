/** Derive a short, chat-like title for a session. */
import type { DraftItem, ResultFormat } from '../shared/types';

const MAX = 72;

export function deriveTitle(input: {
  agentTitle?: string;
  question: string;
  format: ResultFormat;
  content: string;
  items: DraftItem[];
}): string {
  const fromAgent = clean(input.agentTitle ?? '');
  if (fromAgent) return truncate(fromAgent);

  if (input.format === 'markdown') {
    const heading = input.content.match(/^\s{0,3}#{1,3}\s+(.+?)\s*#*\s*$/m);
    if (heading) {
      const h = clean(heading[1]);
      if (h) return truncate(h);
    }
  } else {
    const t = input.content.match(/<title[^>]*>([\s\S]*?)<\/title>/i) ?? input.content.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (t) {
      const h = clean(t[1].replace(/<[^>]+>/g, ''));
      if (h) return truncate(h);
    }
  }

  const q = clean(input.question);
  if (q) return truncate(q);

  const code = input.items.find((i) => i.kind === 'code');
  if (code && code.kind === 'code') {
    const name = code.file.split('/').pop() ?? code.file;
    const firstLine = clean(code.text.split('\n').find((l) => l.trim()) ?? '');
    return truncate(`${name} L${code.startLine}-L${code.endLine}${firstLine ? `: ${firstLine}` : ''}`);
  }

  const firstLine = clean(input.content.split('\n').find((l) => l.trim()) ?? '');
  return truncate(firstLine || 'Explanation');
}

function clean(text: string): string {
  return text
    .replace(/^[\s#>]+/, '') // leading heading / quote markers
    .replace(/[`*]+/g, '') // emphasis and code spans (keep underscores: identifiers)
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(text: string): string {
  if (text.length <= MAX) return text;
  const cut = text.slice(0, MAX - 1);
  const space = cut.lastIndexOf(' ');
  return (space > MAX * 0.75 ? cut.slice(0, space) : cut).trimEnd() + '…';
}
