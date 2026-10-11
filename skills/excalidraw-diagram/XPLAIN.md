# Bundled by XPlain

This folder is a copy of [coleam00/excalidraw-diagram-skill](https://github.com/coleam00/excalidraw-diagram-skill)
shipped inside the XPlain VS Code / Cursor extension.

When the user enables **Draw diagrams with the Excalidraw skill** on the Context tab, XPlain installs
this skill into the workspace at `.xplain/skills/excalidraw-diagram/` (agent-agnostic store)
and, at send time, adapts it for the selected agent (e.g. a `.cursor/skills/` or `.claude/skills/`
discovery bridge).
