# Bundled by XPlain

This folder is a copy of [coleam00/excalidraw-diagram-skill](https://github.com/coleam00/excalidraw-diagram-skill)
shipped inside the XPlain VS Code / Cursor extension.

When the user enables **Draw diagrams with the Excalidraw skill** on the Context tab, XPlain installs
this skill into the workspace at `.xplain/skills/excalidraw-diagram/` (agent-agnostic store)
and, at send time, adapts it for the selected agent (e.g. a `.cursor/skills/` or `.claude/skills/`
discovery bridge).

**XPlain integration:** for each Send, write and render PNGs only under
`.xplain/diagrams/<sessionId>/` with this skill's tools, then put path-only `<img src="…">` in the
HTML answer. Do **not** reuse PNGs from other sessions or from `.xplain/diagrams/` root. Do not paste
base64 into the reply — XPlain inlines the new files when saving `result.html`.

**Renderer note:** `references/render_template.html` loads `@excalidraw/excalidraw` from
`https://esm.sh/...` inside Playwright. If that CDN is unreachable from the machine, PNG export fails
— fix network/CDN access (or vendor the bundle); do not fall back to someone else's PNG.
