import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js/lib/common';
import cuda from 'highlight.js/lib/languages/cpp';

hljs.registerLanguage('cuda', cuda);
hljs.registerLanguage('cu', cuda);

const md = new MarkdownIt({
  html: false, // agent output is untrusted: never inject raw HTML into the panel
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

// Open links in a new context (VS Code intercepts and opens externally).
const defaultLinkOpen =
  md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet('target', '_blank');
  tokens[idx].attrSet('rel', 'noopener noreferrer');
  return defaultLinkOpen(tokens, idx, options, env, self);
};

export function renderMarkdown(source: string): string {
  return md.render(source);
}
