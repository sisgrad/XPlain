/**
 * Turns an AgentRequest into a system prompt + a single user message for
 * plain chat models (Hermes, OpenAI, Anthropic). The XPlain HTTP contract
 * sends the structured request instead and does not use this.
 */
import type { ExplainLanguage } from '../shared/types';
import { excalidrawAgentInstructions } from '../skills/excalidrawInstructions';
import type { AgentItem, AgentRequest } from './AgentProvider';
import { detectHtml } from './htmlResult';

export type CodeAgentItem = Extract<AgentItem, { type: 'code' }>;

export const DEFAULT_SYSTEM_PROMPT = `You are XPlain, an expert code explainer embedded in a code editor.
The user sends one or more focus code blocks (with file paths and line numbers). For each focus block the complete source file may also be included as surrounding context.

Rules:
- Reply with ONE HTML document only. Do not wrap it in Markdown fences. Do not return Markdown as the top-level answer.
- The document MUST start with <!DOCTYPE html> and include <html>, <head>, and <body>.
- Put a concise, specific chat-like title (max 8 words) in <title> and as a single <h1> at the start of <body>. Do not use generic titles.
- Embed all CSS in a <style> block in <head> (dark-friendly, readable typography, styled tables and code blocks). Do not link external stylesheets or scripts.
- For images/diagrams: produce binary files with tools (e.g. Excalidraw → PNG under .xplain/diagrams/), then reference them with short filesystem paths in <img src="...">. Never paste or stream base64 / data: URIs in the answer — that wastes tokens; XPlain inlines local files into result.html after you finish.
- Never replace the HTML answer with a short note that the document was written to a file. Always emit the full HTML document as the reply text (paths only — no embedded binaries).
- Structure the body with semantic HTML: h2/h3 sections, lists, tables, <pre><code> for code with a language hint in a class when useful.
- Explain ONLY the focus block(s) (the marked line ranges). Use the full file only as context to understand callers, types, helpers and surrounding code — do not write a line-by-line explanation of the entire file unless the user explicitly asks for that.
- Refer to code by file and line numbers (e.g. "L192-L221") when it helps.
- If a template instruction is present, follow it. Treat template files as reference material, not as code to explain unless asked.
- Be precise and technical; do not pad the answer. If something cannot be determined from the given code, say so.
- Obey the Language and Diagrams instructions in the user message when present.`;

export const HTML_OUTPUT_INSTRUCTION = [
  '## Output format (required)',
  'Return a **single HTML document** as your entire answer:',
  '- First characters: `<!DOCTYPE html>` (no preamble, no Markdown wrapping).',
  '- Include `<title>` (short chat-like title) and inline `<style>` — no external CSS/JS.',
  '- Body starts with one `<h1>` matching the title.',
  '- **Images (important):** do **not** emit `data:` URIs or base64 in the message. That burns tokens.',
  '  1. Create image files with tools (render PNG/SVG to disk, typically under `.xplain/diagrams/`).',
  '  2. In the HTML, use short path `src` values, e.g. `<img src=".xplain/diagrams/foo.png" alt="…">`.',
  '  3. XPlain rewrites those paths into embedded `data:` URIs when saving `result.html` — you do not.',
  '- **Critical:** the HTML text (with path references) MUST be the assistant message body itself.',
  '  Do **not** write only a stub that points at a file — XPlain saves the message as result.html.',
  '  Writing intermediate diagram sources under `.xplain/diagrams/` is fine and expected.',
  'If you can only produce Markdown, still answer — XPlain will wrap it into HTML and inline local image paths.',
].join('\n');

export interface ChatPrompt {
  system: string;
  user: string;
}

export function buildChatPrompt(request: AgentRequest, systemPrompt?: string): ChatPrompt {
  const parts: string[] = [];
  const codes = request.items.filter((i): i is CodeAgentItem => i.type === 'code');
  const results = request.items.filter((i): i is Extract<AgentItem, { type: 'result' }> => i.type === 'result');
  const templates = request.items.filter((i): i is Extract<AgentItem, { type: 'template' }> => i.type === 'template');

  parts.push(languageInstruction(request.explainLanguage));
  parts.push(HTML_OUTPUT_INSTRUCTION);
  if (request.useExcalidraw) {
    parts.push(
      excalidrawAgentInstructions({
        agentPath: request.excalidrawSkillPath,
        canonicalPath: request.excalidrawSkillCanonicalPath,
        workspaceRoot: request.workspaceRoot,
        bridge: request.excalidrawSkillBridge,
      }),
    );
  }

  for (const t of templates) {
    parts.push(`## Template: ${t.name}`);
    if (t.instruction.trim()) parts.push(`### Instruction\n${t.instruction.trim()}`);
    for (const f of t.files) {
      parts.push(`### Reference file: ${f.name}\n${fence(f.content, langFromName(f.name))}`);
    }
  }

  for (const r of results) {
    parts.push(`## Earlier explanation: ${r.title}\n${r.format === 'html' ? fence(r.content, 'html') : r.content}`);
  }

  if (codes.length) {
    parts.push(...formatCodeSections(codes));
  }

  const q = request.question.trim();
  parts.push(
    `## Question\n${
      q ||
      (codes.length
        ? 'Explain the focus block(s) above: what they do, how they work, and anything non-obvious or risky. Use the full file(s) only as surrounding context. Answer as self-contained HTML.'
        : 'Please help with the material above. Answer as self-contained HTML.')
    }`,
  );

  if (request.workspace || request.workspaceRoot) {
    const bits = [
      request.workspace ? `name=${request.workspace}` : undefined,
      request.workspaceRoot ? `root=${request.workspaceRoot}` : undefined,
    ].filter(Boolean);
    parts.unshift(`Workspace: ${bits.join(' · ')}`);
  }

  return {
    system: (systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT).trim(),
    user: parts.join('\n\n'),
  };
}

/** Builds the focus-blocks + full-file-context sections for the user message. */
export function formatCodeSections(codes: CodeAgentItem[]): string[] {
  const parts: string[] = [];
  parts.push(
    [
      '## Scope',
      'Explain **only** the focus block(s) listed below (their exact line ranges).',
      'Complete source files are included solely as surrounding context so you can resolve names, types, callers and nearby code.',
      'Do **not** explain the entire file line-by-line unless the question explicitly asks for that.',
    ].join('\n'),
  );

  parts.push(codes.length === 1 ? '## Focus block (explain this)' : `## Focus blocks (explain these · ${codes.length})`);
  for (const c of codes) {
    parts.push(`### ${c.file} L${c.startLine}-L${c.endLine}\n${fence(c.text, c.language)}`);
  }

  const files = uniqueFilesWithText(codes);
  if (files.length) {
    parts.push(files.length === 1 ? '## Full file (context only)' : `## Full files (context only · ${files.length})`);
    for (const f of files) {
      const blocks = codes.filter((c) => c.file === f.file);
      const ranges = blocks.map((c) => `L${c.startLine}-L${c.endLine}`).join(', ');
      parts.push(
        `### ${f.file}\nFocus range(s) in this file: **${ranges}**. The file below is context — explain the focus range(s), not the whole file.\n${fence(f.fileText, f.language)}`,
      );
    }
  }

  return parts;
}

function uniqueFilesWithText(codes: CodeAgentItem[]): Array<{ file: string; language: string; fileText: string }> {
  const seen = new Set<string>();
  const out: Array<{ file: string; language: string; fileText: string }> = [];
  for (const c of codes) {
    if (!c.fileText || seen.has(c.file)) continue;
    seen.add(c.file);
    out.push({ file: c.file, language: c.language, fileText: c.fileText });
  }
  return out;
}

export function languageInstruction(lang: ExplainLanguage | undefined): string {
  if (lang === 'ru') {
    return [
      '## Language',
      'Write the **entire** explanation in **Russian** (русский язык).',
      'Keep code identifiers, keywords, file paths, and line references (e.g. `L12-L48`) in their original form; do not translate them.',
      'The <title> and <h1> may be in Russian.',
    ].join('\n');
  }
  return [
    '## Language',
    'Write the **entire** explanation in **English**.',
    'Keep code identifiers, file paths, and line references unchanged.',
  ].join('\n');
}

function fence(text: string, lang = ''): string {
  const longest = Math.max(2, ...Array.from(text.matchAll(/`+/g), (m) => m[0].length));
  const ticks = '`'.repeat(longest + 1);
  return `${ticks}${normalizeLang(lang)}\n${text.replace(/\n$/, '')}\n${ticks}`;
}

function normalizeLang(lang: string): string {
  const map: Record<string, string> = { cuda: 'cpp', 'cuda-cpp': 'cpp', plaintext: '', jsonc: 'json', javascriptreact: 'jsx', typescriptreact: 'tsx' };
  return lang in map ? map[lang] : lang;
}

function langFromName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    md: 'markdown', py: 'python', js: 'javascript', ts: 'typescript', cu: 'cpp', cuh: 'cpp', c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp',
    json: 'json', yaml: 'yaml', yml: 'yaml', sh: 'bash', txt: '', rs: 'rust', go: 'go', java: 'java', toml: 'toml',
  };
  return map[ext] ?? '';
}

export { detectHtml };
