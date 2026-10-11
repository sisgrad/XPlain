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
  /** Current XPlain session id — diagrams must live under diagrams/<sessionId>/. */
  sessionId?: string;
}

/** Relative diagrams directory for a session (POSIX). */
export function sessionDiagramsRelPath(sessionId?: string): string {
  const id = sessionId?.trim();
  return id ? `.xplain/diagrams/${id}` : '.xplain/diagrams/<sessionId>';
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
  const relDir = sessionDiagramsRelPath(opts.sessionId);
  const diagramsDir = root ? `${root.replace(/\\/g, '/')}/${relDir}` : relDir;
  const bridgeNote =
    opts.bridge && opts.bridge !== 'none' && agentPath !== canonicalPath
      ? `XPlain synced a discovery bridge to \`${agentPath}/\` for your agent; the durable copy lives at \`${canonicalPath}/\`.`
      : `The skill lives at \`${canonicalPath}/\` (XPlain's agent-agnostic skill store).`;

  return [
    '## Diagrams (required for this request)',
    'You MUST use the **Excalidraw Diagram** skill to illustrate this explanation with at least one diagram whenever a visual argument helps (architecture, data flow, concurrency, state machines, pipelines, etc.).',
    '',
    `1. **Skill for this request:** \`${agentPath}/\` (from ${EXCALIDRAW_SKILL_REPO}). ${bridgeNote}`,
    '2. If that folder is missing or incomplete, restore from the durable store or re-run Send with the Excalidraw checkbox on, then follow `SKILL.md` / `README.md`. Renderer JS is **vendored offline** under `references/vendor/` (no CDN). You may still need a one-time local Playwright Chromium: `cd <skill>/references && uv sync && uv run playwright install chromium`.',
    `3. **Read** \`${agentPath}/SKILL.md\` and \`${agentPath}/references/color-palette.md\` before drawing. Follow the skill's methodology (diagrams that *argue*, evidence artifacts for technical diagrams). Do not improvise a different diagram toolchain.`,
    `4. **Session-scoped output directory (mandatory):** create and use only \`${relDir}/\` (absolute: \`${diagramsDir}/\`).`,
    '   Put **new** `.excalidraw` sources and the PNGs you render from them in that folder. Use unique filenames for this run (e.g. `qk-mma-flow.png`).',
    '5. **Do not reuse other sessions\' diagrams.** Forbidden:',
    '   - linking to or copying PNGs / `.excalidraw` from `.xplain/diagrams/` root or from another `diagrams/<otherSessionId>/`;',
    '   - pointing `<img src>` at any pre-existing image you did not create and render in **this** session directory;',
    '   - "falling back" to an older PNG when render fails — fix the render (or omit that figure) instead of borrowing.',
    '6. **Render** each `.excalidraw` to PNG with the skill\'s `render_excalidraw.py` (Playwright). Never invent PNG bytes by hand. Never paste `data:image/...;base64,...` into the HTML.',
    `7. **In the final HTML, reference only PNGs under \`${relDir}/\`**, e.g. \`<img src="${relDir}/qk-mma-flow.png" alt="…">\`. XPlain inlines those files into \`result.html\` after you finish.`,
    '8. Do not invent a different diagram format; use this skill.',
  ].join('\n');
}
