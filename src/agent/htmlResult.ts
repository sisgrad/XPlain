/**
 * Normalise agent answers into a self-contained HTML document saved as result.html.
 */
import hljs from 'highlight.js/lib/common';
import cuda from 'highlight.js/lib/languages/cpp';
import MarkdownIt from 'markdown-it';

hljs.registerLanguage('cuda', cuda);
hljs.registerLanguage('cu', cuda);
hljs.registerLanguage('cuda-cpp', cuda);

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
  breaks: false,
  highlight(code: string, lang: string): string {
    const language = lang && hljs.getLanguage(lang) ? lang : undefined;
    try {
      const out = language ? hljs.highlight(code, { language }).value : hljs.highlightAuto(code).value;
      return `<pre class="hljs"><code>${out}</code></pre>`;
    } catch {
      return `<pre class="hljs"><code>${md.utils.escapeHtml(code)}</code></pre>`;
    }
  },
});

/** Heuristic: does the text look like a full HTML document? */
export function detectHtml(content: string): boolean {
  const head = content.trimStart().slice(0, 200).toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html');
}

/** Heuristic: body/fragment HTML (not Markdown). */
export function looksLikeHtmlFragment(content: string): boolean {
  const head = content.trimStart();
  if (!head.startsWith('<')) return false;
  return /^<[a-zA-Z!/?]/.test(head) && /<\/[a-zA-Z][\w:-]*>|<br\s*\/?>|<hr\s*\/?>|<img\b|<meta\b/i.test(head);
}

/** Strip a leading/trailing ```html … ``` wrapper some models add. */
export function unwrapHtmlFence(content: string): string {
  const trimmed = content.trim();
  const m = trimmed.match(/^```(?:html|htm)?\s*\r?\n([\s\S]*?)\r?\n```\s*$/i);
  return m ? m[1].trim() : trimmed;
}

export function extractHtmlTitle(html: string): string | undefined {
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) ?? html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (!t) return undefined;
  const title = t[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  return title || undefined;
}

/**
 * Ensure `content` is a self-contained HTML document.
 * If the agent already returned HTML, unwrap fences and return it;
 * otherwise render Markdown into a styled standalone page.
 */
export function ensureSelfContainedHtml(content: string, fallbackTitle = 'XPlain explanation'): string {
  const raw = unwrapHtmlFence(content);
  if (detectHtml(raw)) {
    return ensureHasTitle(raw, fallbackTitle);
  }
  if (looksLikeHtmlFragment(raw)) {
    return wrapHtmlFragment(raw, fallbackTitle);
  }
  return wrapMarkdownAsHtml(raw, fallbackTitle);
}

function ensureHasTitle(html: string, fallbackTitle: string): string {
  if (/<title[^>]*>[\s\S]*?<\/title>/i.test(html)) return html;
  if (/<head[\s>]/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1><title>${escapeHtml(fallbackTitle)}</title>`);
  }
  return html;
}

function wrapHtmlFragment(fragment: string, title: string): string {
  const fromH1 = fragment.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const pageTitle = (fromH1 ? fromH1[1].replace(/<[^>]+>/g, '') : title).replace(/\s+/g, ' ').trim() || title;
  return shellDocument(pageTitle, fragment);
}

function wrapMarkdownAsHtml(markdown: string, title: string): string {
  const heading = markdown.match(/^\s{0,3}#{1,3}\s+(.+?)\s*#*\s*$/m);
  const pageTitle = (heading?.[1] ?? title).replace(/\s+/g, ' ').trim() || title;
  return shellDocument(pageTitle, md.render(markdown));
}

function shellDocument(title: string, bodyInner: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(title)}</title>
<style>${DOCUMENT_CSS}</style>
</head>
<body>
<article class="xplain">
${bodyInner}
</article>
</body>
</html>
`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Compact dark-friendly styles embedded in every converted result. */
const DOCUMENT_CSS = `
:root { color-scheme: dark; --bg:#1e1e1e; --fg:#d4d4d4; --muted:#9d9d9d; --border:#3c3c3c; --code-bg:#0d1117; --accent:#4fc1ff; --table-stripe:#252526; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: var(--bg); color: var(--fg); font: 14px/1.55 system-ui, -apple-system, Segoe UI, sans-serif; }
.xplain { max-width: 920px; margin: 0 auto; padding: 24px 20px 48px; }
h1,h2,h3,h4 { line-height: 1.25; margin: 1.4em 0 0.5em; font-weight: 650; }
h1 { font-size: 1.6rem; border-bottom: 1px solid var(--border); padding-bottom: 0.3em; margin-top: 0; }
h2 { font-size: 1.25rem; } h3 { font-size: 1.1rem; }
p, ul, ol, table, pre, blockquote { margin: 0.75em 0; }
a { color: var(--accent); }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.9em; background: var(--code-bg); padding: 0.1em 0.35em; border-radius: 3px; }
pre { background: var(--code-bg); border: 1px solid var(--border); border-radius: 6px; padding: 12px 14px; overflow: auto; }
pre code { background: none; padding: 0; font-size: 12.5px; line-height: 1.45; }
blockquote { border-left: 3px solid var(--accent); margin-left: 0; padding: 0.2em 0.8em; color: var(--muted); }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th, td { border: 1px solid var(--border); padding: 6px 10px; text-align: left; }
th { background: var(--table-stripe); }
tr:nth-child(even) td { background: var(--table-stripe); }
img { max-width: 100%; height: auto; border-radius: 4px; }
hr { border: none; border-top: 1px solid var(--border); margin: 1.5em 0; }
.hljs { color: #c9d1d9; }
.hljs-keyword,.hljs-selector-tag { color: #ff7b72; }
.hljs-string,.hljs-attr { color: #a5d6ff; }
.hljs-number,.hljs-literal { color: #79c0ff; }
.hljs-comment { color: #8b949e; font-style: italic; }
.hljs-title,.hljs-section { color: #d2a8ff; }
.hljs-built_in,.hljs-type { color: #ffa657; }
`;
