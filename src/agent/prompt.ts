/**
 * Turns an AgentRequest into a system prompt + a single user message for
 * plain chat models (Hermes, OpenAI, Anthropic). The XPlain HTTP contract
 * sends the structured request instead and does not use this.
 */
import type { ExplainLanguage } from '../shared/types';
import { excalidrawAgentInstructions } from '../skills/excalidrawInstructions';
import type { AgentItem, AgentRequest } from './AgentProvider';

export const DEFAULT_SYSTEM_PROMPT = `You are XPlain, an expert code explainer embedded in a code editor.
The user sends one or more code blocks (with file paths and line numbers), optionally earlier explanations, reference material from a template, and a question.

Rules:
- Start your answer with a single Markdown H1 line: a concise, specific title (max 8 words) that summarises this explanation like a chat title. Do not use generic titles.
- Answer in well-structured Markdown: short sections, bullet points where useful, fenced code blocks with a language tag for code.
- Refer to code by file and line numbers (e.g. "L192-L221") when it helps.
- If a template instruction is present, follow it. Treat template files as reference material, not as code to explain unless asked.
- Be precise and technical; do not pad the answer. If something cannot be determined from the given code, say so.
- Obey the Language and Diagrams instructions in the user message when present.`;

export interface ChatPrompt {
  system: string;
  user: string;
}

export function buildChatPrompt(request: AgentRequest, systemPrompt?: string): ChatPrompt {
  const parts: string[] = [];
  const codes = request.items.filter((i): i is Extract<AgentItem, { type: 'code' }> => i.type === 'code');
  const results = request.items.filter((i): i is Extract<AgentItem, { type: 'result' }> => i.type === 'result');
  const templates = request.items.filter((i): i is Extract<AgentItem, { type: 'template' }> => i.type === 'template');

  parts.push(languageInstruction(request.explainLanguage));
  if (request.useExcalidraw) {
    parts.push(excalidrawAgentInstructions(request.excalidrawSkillPath));
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
    parts.push(codes.length === 1 ? '## Code' : `## Code (${codes.length} blocks)`);
    for (const c of codes) {
      parts.push(`### ${c.file} L${c.startLine}-L${c.endLine}\n${fence(c.text, c.language)}`);
    }
  }

  const q = request.question.trim();
  parts.push(`## Question\n${q || (codes.length ? 'Explain this code: what it does, how it works, and anything non-obvious or risky.' : 'Please help with the material above.')}`);

  if (request.workspace) parts.unshift(`Workspace: ${request.workspace}`);

  return {
    system: (systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT).trim(),
    user: parts.join('\n\n'),
  };
}

export function languageInstruction(lang: ExplainLanguage | undefined): string {
  if (lang === 'ru') {
    return [
      '## Language',
      'Write the **entire** explanation in **Russian** (русский язык).',
      'Keep code identifiers, keywords, file paths, and line references (e.g. `L12-L48`) in their original form; do not translate them.',
      'The H1 title may be in Russian.',
    ].join('\n');
  }
  return [
    '## Language',
    'Write the **entire** explanation in **English**.',
    'Keep code identifiers, file paths, and line references unchanged.',
  ].join('\n');
}

function fence(text: string, lang = ''): string {
  // Pick a fence longer than any run of backticks inside the text.
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

/** Heuristic: did a chat model answer with a self-contained HTML document? */
export function detectHtml(content: string): boolean {
  const head = content.trimStart().slice(0, 200).toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html');
}
