/**
 * Prompt text for the bundled Excalidraw Diagram skill
 * (https://github.com/coleam00/excalidraw-diagram-skill). No vscode dependency.
 */

export const EXCALIDRAW_SKILL_ID = 'excalidraw-diagram';
export const EXCALIDRAW_SKILL_REPO = 'https://github.com/coleam00/excalidraw-diagram-skill';
/** Workspace-relative install path (POSIX). */
export const EXCALIDRAW_SKILL_WORKSPACE_PATH = `.claude/skills/${EXCALIDRAW_SKILL_ID}`;

/** Instruction block appended to the agent request when the checkbox is on. */
export function excalidrawAgentInstructions(skillPath: string = EXCALIDRAW_SKILL_WORKSPACE_PATH): string {
  return [
    '## Diagrams (required for this request)',
    'You MUST use the **Excalidraw Diagram** skill to illustrate this explanation with at least one diagram whenever a visual argument helps (architecture, data flow, concurrency, state machines, pipelines, etc.).',
    '',
    `1. **Skill location in this workspace:** \`${skillPath}/\` (XPlain installs/updates it from ${EXCALIDRAW_SKILL_REPO} before sending).`,
    '2. If that folder is missing or incomplete, restore it: clone or copy the repo into that path (or into `skills/excalidraw-diagram/`), then follow `SKILL.md` / `README.md` — including renderer setup (`uv sync` + Playwright Chromium under `references/`) if you need visual validation.',
    `3. Read \`${skillPath}/SKILL.md\` and \`${skillPath}/references/color-palette.md\` before drawing. Follow the skill's methodology (diagrams that *argue*, evidence artifacts for technical diagrams).`,
    '4. Write one or more `.excalidraw` JSON files under `.xplain/diagrams/` (create the folder if needed) and reference their paths in your Markdown answer. Briefly describe what each diagram shows.',
    '5. Do not invent a different diagram format; use this skill.',
  ].join('\n');
}
