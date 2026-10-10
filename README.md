# XPlain

Explain code with your own LLM agent, directly from VS Code or Cursor.

XPlain lets you collect code blocks into a *context*, add a question and an optional
template (instruction + reference files), send it to an agent and keep every
answer anchored to the code it explains. Answers are stored in the project
(`.xplain/`) and surface in the editor as CodeLens entries above the blocks.

Agents are pluggable and configured from the panel's **Agent** tab: a local
**Hermes Agent** harness, **Anthropic (Claude)**, **OpenAI / Codex** (or any
OpenAI-compatible server), your own service speaking the **XPlain HTTP contract**,
or an offline **mock**.

Built only on stable VS Code APIs (no proposed APIs), so it works in VS Code and Cursor,
locally and through Remote-SSH.

Full documentation (installation, user guide, configuration, agent providers, storage format,
architecture, development, troubleshooting) lives in the `docs/` folder of the repository
(start with `docs/README.md`).

## Workflow

1. Select a block of code and press **Shift+X**. The block appears in the XPlain panel as
   `file.cu L61-L224`. Repeat for more blocks (sub-ranges are tracked separately).
2. In the panel, optionally type a question, pick a template, choose the explanation language
   (English / Russian), and optionally enable **Draw diagrams with the Excalidraw skill**
   ([coleam00/excalidraw-diagram-skill](https://github.com/coleam00/excalidraw-diagram-skill) —
   XPlain installs it into `.claude/skills/` on send).
3. Press **Send to agent** (or Ctrl+Enter in the question box). Nothing is sent until you confirm.
4. The answer streams into the **Result** tab and is saved as `.xplain/sessions/<id>/result.md`
   (or `result.html` for self-contained HTML answers).
5. Every block that was part of the context gets a CodeLens: `XPlain: <title>` or
   `XPlain: 3 explanations · <latest title>`. Clicking it opens a dropdown of all explanations
   attached to that block; titles are chat-like summaries, not `v1`/`v2`.
6. To reuse an explanation as input, leave the editor, press **Shift+X** (pick mode turns on and
   is shown in the status bar), click the block's CodeLens and choose the result. It is added to
   the context. The hover over a block and the dropdown also offer "Add to context" buttons.

### Keyboard

| Shortcut | Where | Action |
| --- | --- | --- |
| `Shift+X` | editor with a selection | add the selection to the context |
| `Shift+X` | anywhere outside the editor (sidebar, explorer, panel) | toggle pick mode |
| `Ctrl+Enter` | question box | send |

`Shift+X` with a selection replaces typing a capital `X` over the selection. Change the
binding in *Keyboard Shortcuts* (`xplain.addSelectionToContext`) if that bothers you.

## Installation

### Option A - from a `.vsix`

1. Download or build `xplain-<version>.vsix` (see Option B).
2. In VS Code / Cursor: Extensions view -> `...` menu -> **Install from VSIX...**.
   From the command line: `cursor --install-extension xplain-0.2.0.vsix` (or `code ...`).
3. **Remote-SSH**: the extension runs on the remote side (`extensionKind: workspace`).
   Copy the `.vsix` to the remote machine and run `bash scripts/install.sh path/to/xplain.vsix`
   there, or install from the Extensions view while connected (it is installed remotely automatically).
4. Reload the window.

### Option B - from sources (dependencies are installed automatically)

The setup script checks for Node.js >= 20 and installs it when missing (via `nvm` into your
home directory on Linux/macOS, no `sudo`; via `winget` on Windows), installs npm
dependencies, builds and packages the extension.

```bash
# Linux / macOS / WSL (add --install to also install into Cursor/VS Code)
bash scripts/setup.sh --install
```

```powershell
# Windows
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1 -Install
```

`scripts/install.sh` detects `cursor`, `code`, and the Remote-SSH server CLIs
(`~/.cursor-server`, `~/.vscode-server`) and runs `--install-extension` for you.

### Option C - development

```bash
bash scripts/setup.sh --no-package   # or: npm install && npm run build
npm run watch                        # rebuild on change
```

Press **F5** to launch the Extension Development Host with `debug_samples/` opened.

## Choosing an agent

Open the **Agent** tab in the XPlain panel (or click the agent name in the footer of the
Context tab, or run **XPlain: Configure Agent**). Pick a provider, fill in its fields, paste
the API key (stored in the IDE's secret storage, never in `settings.json` or `.xplain/`),
press **Test connection** and then **Save** (to your user settings or to this workspace).

| Provider | What it talks to | Fields |
| --- | --- | --- |
| **Hermes Agent** | Hermes harness **API server** (OpenAI-compatible, port 8642) — not the dashboard/Remote-gateway URL Hermes Desktop uses. Enable it with `API_SERVER_ENABLED=true`, `API_SERVER_KEY=...` (and `API_SERVER_HOST=0.0.0.0` for remote access) in `~/.hermes/.env`. | Base URL (`http://127.0.0.1:8642/v1`), model/profile picked from the list the harness reports, key = `API_SERVER_KEY`. Tool-progress events are ignored, the final answer is streamed. |
| **Anthropic (Claude)** | Anthropic Messages API. | Base URL, model picked from the server list, `max_tokens`, API key (`x-api-key`). |
| **OpenAI / Codex** | OpenAI Chat Completions, or any compatible server (Ollama, vLLM, LiteLLM, OpenRouter). | Base URL (`https://api.openai.com/v1`), model picked from the server list, API key (Bearer). |
| **XPlain HTTP agent** | Your own service speaking the contract below. | Endpoint URL, optional Bearer key. |
| **Mock (offline)** | Built-in canned answer. | - |

The **Model** dropdown is filled from the server's `/models` endpoint automatically (when the tab
opens, when the provider, base URL or key changes, or via the refresh button); if the list cannot be
fetched you can type the id manually. **Test connection** verifies the same endpoint and reports
whether the chosen model is offered. For chat providers the context is rendered into one user
message (templates, previous results, fenced code blocks with `L` ranges, question) preceded by a
system prompt that asks for a Markdown answer starting with a short `#` title; override it under
*Advanced -> System prompt*.

## Configuration

| Setting | Default | Description |
| --- | --- | --- |
| `xplain.agent.provider` | `xplain` | `xplain`, `hermes`, `openai`, `anthropic` or `mock`. |
| `xplain.agent.endpoint` | `http://127.0.0.1:8765/explain` | [xplain] URL that receives the context. |
| `xplain.agent.hermes.baseUrl` / `model` | `http://127.0.0.1:8642/v1` / `hermes-agent` | [hermes] API server and model/profile. |
| `xplain.agent.openai.baseUrl` / `model` | `https://api.openai.com/v1` / `chat-latest` | [openai] API base and model id. |
| `xplain.agent.anthropic.baseUrl` / `model` / `maxTokens` | `https://api.anthropic.com` / `claude-sonnet-5` / `8192` | [anthropic] API base, model, `max_tokens`. |
| `xplain.agent.systemPrompt` | `""` | [hermes/openai/anthropic] Custom system prompt; empty = built-in. |
| `xplain.agent.timeoutMs` | `180000` | Request timeout (headers + body). |
| `xplain.agent.streaming` | `true` | Stream partial output (NDJSON or SSE). |
| `xplain.agent.headers` | `{}` | Extra headers sent to any provider. |
| `xplain.editor.showCodeLens` | `true` | CodeLens above explained blocks. |
| `xplain.editor.highlightBlocks` | `true` | Gutter icon / hover for explained blocks. |
| `xplain.ui.background.opacity` / `blur` / `fit` | `0.18` / `0` / `cover` | Panel background image. |

API keys are per provider. Set them in the Agent tab or via **XPlain: Set Agent API Key** /
**XPlain: Clear Agent API Key** (both ask which provider).

### XPlain agent HTTP contract

Request (`POST` to `xplain.agent.endpoint`, `Content-Type: application/json`):

```json
{
  "sessionId": "m2abc-1f2e3d4c",
  "question": "Why does the MMA warp wait on this barrier?",
  "workspace": "XPlain",
  "items": [
    { "type": "code", "file": "debug_samples/4_warp_specialization.cu",
      "startLine": 192, "endLine": 221, "language": "cuda", "text": "for (int kv_tile ..." },
    { "type": "result", "title": "Pipeline overview", "format": "markdown", "content": "# ..." },
    { "type": "template", "name": "CUDA review", "instruction": "Focus on ...",
      "files": [ { "name": "notes.md", "content": "..." } ] }
  ]
}
```

Response, either a single JSON document:

```json
{ "title": "Barrier phases in the KV loop", "format": "markdown", "content": "# ..." }
```

or an NDJSON stream (`Content-Type: application/x-ndjson`), one JSON object per line:

```
{"type":"delta","text":"The MMA warp "}
{"type":"delta","text":"waits because ..."}
{"type":"done","title":"Barrier phases in the KV loop","format":"markdown"}
```

`format` is `markdown` or `html` (self-contained HTML is rendered in a sandboxed iframe).
If `title` is omitted XPlain derives one from the first heading, the question or the code.

A stdlib-only reference implementation lives in `examples/agent_server.py`:

```bash
python3 examples/agent_server.py --port 8765   # then keep the default endpoint setting
```

Replace its `explain()` generator with a call into your agent system.

## Templates

Templates bundle an instruction and reference files. In the **Templates** tab, drag files from
the Explorer or from your computer onto the panel (or click the drop zone to browse), write the
instruction and save. Select a template in the **Context** tab before sending; its instruction
and files are included in the request. Templates live in `.xplain/templates/<id>/`.

## Panel background

**XPlain: Choose Background Image...** (title bar icon) or drop an image onto the panel. You
can store it for yourself (all projects) or for this project (`.xplain/ui/`). Tune
`xplain.ui.background.*` for opacity, blur and fit; **XPlain: Clear Background Image** removes it.

## Storage layout

```
.xplain/
  index.json                      anchors (file, lines, hash, snippet) and session metadata
  sessions/<id>/context.json      everything that was sent, with the title and status
  sessions/<id>/result.md|html    the agent's answer
  templates/<id>/template.json    name, instruction, file list
  templates/<id>/files/...        attached files
  ui/background.<ext>             optional per-project panel background
```

Anchors follow edits: ranges are shifted as you type, and blocks are re-found by content when
a file is reopened. Edited blocks keep their explanations and adopt the new text on save.
Commit `.xplain/` if you want to share explanations with your team.

## Development

```bash
npm run check    # type-check extension + webview
npm run lint
npm test         # mocha unit tests (storage, anchors, titles, draft, providers)
npm run package  # dist/xplain-<version>.vsix
```
