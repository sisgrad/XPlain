/**
 * Prompt text for the bundled Excalidraw Diagram skill
 * (https://github.com/coleam00/excalidraw-diagram-skill). No vscode dependency.
 */
import { canonicalSkillPath, type SkillBridgeKind } from './skillPaths';

export const EXCALIDRAW_SKILL_ID = 'excalidraw-diagram';
export const EXCALIDRAW_SKILL_REPO = 'https://github.com/coleam00/excalidraw-diagram-skill';
/** Durable store path (agent-agnostic). */
export const EXCALIDRAW_SKILL_CANONICAL_PATH = canonicalSkillPath(EXCALIDRAW_SKILL_ID);
/** @deprecated Use EXCALIDRAW_SKILL_CANONICAL_PATH — kept for older docs/tests. */
export const EXCALIDRAW_SKILL_WORKSPACE_PATH = EXCALIDRAW_SKILL_CANONICAL_PATH;

export interface ExcalidrawInstructionOpts {
  /** Path the agent should open for this request (bridge or canonical). */
  agentPath?: string;
  /** Always `.xplain/skills/excalidraw-diagram`. */
  canonicalPath?: string;
  workspaceRoot?: string;
  bridge?: SkillBridgeKind;
}

/** Instruction block appended to the agent request when the checkbox is on. */
export function excalidrawAgentInstructions(
  agentPathOrOpts: string | ExcalidrawInstructionOpts = EXCALIDRAW_SKILL_CANONICAL_PATH,
  workspaceRoot?: string,
): string {
  const opts: ExcalidrawInstructionOpts =
    typeof agentPathOrOpts === 'string'
      ? { agentPath: agentPathOrOpts, workspaceRoot, canonicalPath: EXCALIDRAW_SKILL_CANONICAL_PATH }
      : agentPathOrOpts;
  const agentPath = opts.agentPath ?? EXCALIDRAW_SKILL_CANONICAL_PATH;
  const canonicalPath = opts.canonicalPath ?? EXCALIDRAW_SKILL_CANONICAL_PATH;
  const root = opts.workspaceRoot;
  const diagramsDir = root ? `${root.replace(/\\/g, '/')}/.xplain/diagrams` : '.xplain/diagrams';
  const bridgeNote =
    opts.bridge && opts.bridge !== 'none' && agentPath !== canonicalPath
      ? `XPlain synced a discovery bridge to \`${agentPath}/\` for your agent; the durable copy lives at \`${canonicalPath}/\`.`
      : `The skill lives at \`${canonicalPath}/\` (XPlain's agent-agnostic skill store).`;

  return [
    '## Diagrams (required for this request)',
    'You MUST use the **Excalidraw Diagram** skill to illustrate this explanation with at least one diagram whenever a visual argument helps (architecture, data flow, concurrency, state machines, pipelines, etc.).',
    '',
    `1. **Skill for this request:** \`${agentPath}/\` (from ${EXCALIDRAW_SKILL_REPO}). ${bridgeNote}`,
    '2. If that folder is missing or incomplete, restore from the durable store or re-run Send with the Excalidraw checkbox on, then follow `SKILL.md` / `README.md` — including renderer setup (`uv sync` + Playwright Chromium under `references/`) if you need visual validation.',
    `3. **Read** \`${agentPath}/SKILL.md\` and \`${agentPath}/references/color-palette.md\` before drawing. Follow the skill's methodology (diagrams that *argue*, evidence artifacts for technical diagrams). Do not improvise a different diagram toolchain.`,
    `4. Write \`.excalidraw\` sources and **render** \`.png\` files under \`${diagramsDir}/\` (create the folder if needed) using the skill's render tools — never invent PNG bytes by hand.`,
    '5. **In the final HTML, reference each PNG by path only**, e.g. `<img src=".xplain/diagrams/foo.png" alt="…">` (or an absolute path under the workspace).',
    '   **Do not** paste `data:image/...;base64,...` into the HTML — XPlain inlines those files into `result.html` after you finish. Figcaptions may still mention the path for humans.',
    '6. Do not invent a different diagram format; use this skill.',
  ].join('\n');
}
