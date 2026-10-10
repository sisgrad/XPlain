/** Offline provider used for development and demos: echoes the context as markdown. */
import { AgentError, type AgentCallOptions, type AgentProvider, type AgentRequest, type AgentResponse } from './AgentProvider';

export class MockAgentProvider implements AgentProvider {
  readonly id = 'mock';
  readonly label = 'Mock agent (offline)';

  async explain(request: AgentRequest, options: AgentCallOptions): Promise<AgentResponse> {
    const codeItems = request.items.filter((i) => i.type === 'code');
    const first = codeItems[0];
    const title = first
      ? `${first.file.split('/').pop()} L${first.startLine}-L${first.endLine}: ${request.question.trim() || 'overview'}`
      : request.question.trim() || 'Explanation';

    const parts: string[] = [];
    parts.push(`# ${title}\n`);
    if (request.question.trim()) parts.push(`> **Question:** ${request.question.trim()}\n`);
    parts.push(`This is a response from the **mock agent**. Switch \`xplain.agent.provider\` to \`http\` to use your own agent service.\n`);
    for (const item of request.items) {
      if (item.type === 'code') {
        const lines = item.text.split('\n');
        parts.push(`## \`${item.file}\` L${item.startLine}-L${item.endLine}\n`);
        parts.push(`The block has ${lines.length} line(s) of ${item.language || 'code'}. First line:\n`);
        parts.push('```' + (item.language || '') + '\n' + lines[0] + '\n```\n');
      } else if (item.type === 'result') {
        parts.push(`## Referenced result: ${item.title}\n`);
        parts.push(`Included ${item.content.length} characters of a previous ${item.format} answer.\n`);
      } else {
        parts.push(`## Template: ${item.name}\n`);
        if (item.instruction) parts.push(`Instruction: ${item.instruction}\n`);
        if (item.files.length) parts.push(`Files: ${item.files.map((f) => `\`${f.name}\``).join(', ')}\n`);
      }
    }
    parts.push(`\n$$ \\text{softmax}(x)_i = \\frac{e^{x_i}}{\\sum_j e^{x_j}} $$\n`);
    const content = parts.join('\n');

    // Stream word by word to exercise the UI.
    const words = content.split(/(?<=\s)/);
    for (const w of words) {
      if (options.signal.aborted) throw new AgentError('Cancelled.');
      options.onDelta?.(w);
      await delay(8);
    }
    return { title: title.slice(0, 80), format: 'markdown', content };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
