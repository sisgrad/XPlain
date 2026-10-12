/**
 * Subscription providers via Claudexor (https://github.com/razzant/claudexor).
 *
 * Claudexor drives the vendor CLIs that are logged in with a *subscription*
 * (Claude Code → Anthropic Claude Pro/Max, Codex CLI → ChatGPT Plus/Pro), so no
 * API key is needed. The CLI ships inside the XPlain VSIX (`node_modules/claudexor`);
 * the vendor CLI itself is installed/logged in through Claudexor (see setup command).
 *
 * Two routes:
 *  - `ask`   — read-only answer. The prompt already contains every code block, so no
 *              project access is needed and the run cannot touch any files.
 *  - `agent` — a write-capable in-place run (`--in-place --access workspace_write`), used
 *              when the Excalidraw skill must render PNGs. It runs either in the user's
 *              workspace (only if it is already a git repo — Claudexor git-inits non-git
 *              folders with a baseline commit) or in a private per-workspace project dir
 *              under globalStorage; diagrams are then mirrored back into `.xplain/diagrams/`.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AgentError, type AgentCallOptions, type AgentProvider, type AgentRequest, type AgentResponse } from './AgentProvider';
import { ensureSelfContainedHtml, extractHtmlTitle } from './htmlResult';
import { installManagedNode, listManagedNodes } from './nodeRuntime';
import { buildChatPrompt } from './prompt';
import { recoverHtmlAnswer } from './recoverHtml';

export type ClaudexorHarness = 'claude' | 'codex';
export type ClaudexorMode = 'auto' | 'ask' | 'agent';

/** Minimum Node.js the bundled Claudexor CLI supports (package.json engines). */
export const CLAUDEXOR_MIN_NODE = [24, 15, 0] as const;

export interface ClaudexorConfig {
  harness: ClaudexorHarness;
  /** `--effort <level>` reasoning hint; empty = model default. Claudexor clamps to what the model advertises. */
  effort?: string;
  /** Vendor model id; empty = harness default. */
  model: string;
  /** Explicit `claudexor` CLI entry (`.../bin/claudexor.js` or a global `claudexor`). Empty = bundled. */
  cliPath?: string;
  /** Explicit Node.js binary (>= 24.15). Empty = auto-detect. */
  nodePath?: string;
  /** Extension install dir (to find the bundled CLI). */
  extensionPath: string;
  /** `context.globalStorageUri.fsPath` — managed Node runtime lives under `node-runtime/`. */
  globalStoragePath: string;
  /** Download an official Node.js build when none >= 24.15 is found (default true). */
  autoInstallNode?: boolean;
  /** Version to download (default DEFAULT_MANAGED_NODE_VERSION). */
  nodeVersion?: string;
  /** Progress sink for the one-time Node download. */
  onProgress?: (message: string) => void;
  /** Private working dir for `ask` runs and prompt files (never the user's project). */
  workDir: string;
  /** `auto` = agent when Excalidraw is requested, else ask. */
  mode: ClaudexorMode;
  /**
   * Project dir for `agent` runs: the workspace root (git repos only) or a private
   * per-workspace dir. When it differs from `workspaceRoot`, the Excalidraw skill is
   * copied there and `.xplain/diagrams/<sessionId>/` is mirrored back afterwards.
   */
  projectDir: string;
  /** The user's real workspace root (mirror target). */
  workspaceRoot?: string;
  timeoutMs: number;
  streaming: boolean;
  systemPrompt?: string;
  onLog?: (message: string) => void;
}

export const HARNESS_LABELS: Record<ClaudexorHarness, string> = {
  claude: 'Claude Code (Anthropic subscription)',
  codex: 'Codex CLI (ChatGPT subscription)',
};

/* ------------------------------------------------------------- locating */

export function bundledCliPath(extensionPath: string): string {
  return path.join(extensionPath, 'node_modules', 'claudexor', 'bin', 'claudexor.js');
}

export function resolveCliPath(cfg: Pick<ClaudexorConfig, 'cliPath' | 'extensionPath'>): string {
  const explicit = cfg.cliPath?.trim();
  if (explicit) {
    if (!fs.existsSync(explicit)) throw new AgentError(`Claudexor CLI not found at ${explicit} (xplain.agent.claudexor.cliPath).`);
    return explicit;
  }
  const bundled = bundledCliPath(cfg.extensionPath);
  if (!fs.existsSync(bundled)) {
    throw new AgentError(`Bundled Claudexor CLI is missing (${bundled}). Reinstall the XPlain extension, or set xplain.agent.claudexor.cliPath.`);
  }
  return bundled;
}

interface NodeBinary {
  /** Executable to spawn. */
  command: string;
  /** Extra env (e.g. ELECTRON_RUN_AS_NODE for the extension host binary). */
  env: Record<string, string>;
  version: string;
}

let cachedNode: { key: string; value: NodeBinary } | undefined;

function parseVersion(v: string): [number, number, number] | undefined {
  const m = /v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
}

export function versionSatisfies(v: string, min: readonly [number, number, number] = CLAUDEXOR_MIN_NODE): boolean {
  const p = parseVersion(v);
  if (!p) return false;
  for (let i = 0; i < 3; i++) {
    if (p[i] > min[i]) return true;
    if (p[i] < min[i]) return false;
  }
  return true;
}

function probeNode(command: string, env: Record<string, string>): string | undefined {
  try {
    const out = execFileSync(command, ['-v'], { env: { ...process.env, ...env }, encoding: 'utf8', timeout: 5_000, stdio: ['ignore', 'pipe', 'ignore'] });
    return out.trim();
  } catch {
    return undefined;
  }
}

function nvmCandidates(): string[] {
  const nvmDir = process.env.NVM_DIR || path.join(os.homedir(), '.nvm');
  const root = path.join(nvmDir, 'versions', 'node');
  try {
    return fs
      .readdirSync(root)
      .filter((d) => /^v\d+\.\d+\.\d+$/.test(d))
      .sort((a, b) => {
        const pa = parseVersion(a)!;
        const pb = parseVersion(b)!;
        for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pb[i] - pa[i];
        return 0;
      })
      .map((d) => path.join(root, d, 'bin', process.platform === 'win32' ? 'node.exe' : 'node'));
  } catch {
    return [];
  }
}

/** Find a Node.js >= 24.15 to run the CLI with. Cached per explicit path. */
export function resolveNode(nodePath?: string, globalStoragePath?: string): NodeBinary {
  const key = `${nodePath?.trim() || ''}|${globalStoragePath ?? ''}`;
  if (cachedNode && cachedNode.key === key) return cachedNode.value;

  const tried: string[] = [];
  const consider = (command: string, env: Record<string, string> = {}): NodeBinary | undefined => {
    const version = probeNode(command, env);
    tried.push(`${command}${version ? ` (${version})` : ' (not runnable)'}`);
    if (version && versionSatisfies(version)) return { command, env, version };
    return undefined;
  };

  let found: NodeBinary | undefined;
  const explicit = nodePath?.trim();
  if (explicit) {
    found = consider(explicit);
    if (!found) throw new AgentError(`xplain.agent.claudexor.nodePath (${explicit}) is not a Node.js >= ${CLAUDEXOR_MIN_NODE.join('.')}: ${tried[0]}`);
  } else {
    // 0. A runtime XPlain downloaded earlier (stable, independent of the host).
    if (globalStoragePath) for (const m of listManagedNodes(globalStoragePath)) if ((found = consider(m.binary))) break;
    // 1. The extension host runtime itself (node for cursor-server, electron on desktop).
    if (!found && versionSatisfies(process.versions.node)) {
      found = consider(process.execPath, { ELECTRON_RUN_AS_NODE: '1' });
    }
    // 2. `node` on PATH.
    if (!found) found = consider(process.platform === 'win32' ? 'node.exe' : 'node');
    // 3. nvm installs (the extension host PATH often lacks them).
    if (!found) for (const c of nvmCandidates()) if ((found = consider(c))) break;
    // 4. Common prefixes.
    if (!found) for (const c of ['/usr/local/bin/node', '/opt/homebrew/bin/node', path.join(os.homedir(), '.local', 'bin', 'node')]) if (fs.existsSync(c) && (found = consider(c))) break;
    if (!found) {
      throw new NodeNotFoundError(
        `No Node.js >= ${CLAUDEXOR_MIN_NODE.join('.')} found for the Claudexor CLI (tried: ${tried.join(', ') || 'nothing'}). Enable xplain.agent.claudexor.autoInstallNode, install Node 24+ or set xplain.agent.claudexor.nodePath.`,
      );
    }
  }
  cachedNode = { key, value: found };
  return found;
}

export class NodeNotFoundError extends AgentError {}

export type NodeRuntimeConfig = Pick<ClaudexorConfig, 'nodePath' | 'globalStoragePath' | 'autoInstallNode' | 'nodeVersion' | 'onProgress'> & { signal?: AbortSignal };

/**
 * Like `resolveNode`, but when nothing suitable exists and auto-install is on,
 * download an official Node.js build into global storage first.
 */
export async function ensureNode(cfg: NodeRuntimeConfig): Promise<NodeBinary> {
  try {
    return resolveNode(cfg.nodePath, cfg.globalStoragePath);
  } catch (err) {
    if (!(err instanceof NodeNotFoundError) || cfg.autoInstallNode === false) throw err;
    cfg.onProgress?.(`No Node.js >= ${CLAUDEXOR_MIN_NODE.join('.')} found — downloading a managed runtime for Claudexor…`);
    await installManagedNode({ globalStoragePath: cfg.globalStoragePath, version: cfg.nodeVersion, onProgress: cfg.onProgress, signal: cfg.signal });
    cachedNode = undefined;
    return resolveNode(cfg.nodePath, cfg.globalStoragePath);
  }
}

/** Environment for CLI runs: our Node first on PATH plus common user bin dirs (vendor CLIs live there). */
export function cliEnv(node: NodeBinary, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const home = os.homedir();
  const sep = path.delimiter;
  const dirs = [
    path.dirname(node.command),
    path.join(home, '.claudexor', 'node', 'bin'),
    path.join(home, '.local', 'bin'),
    path.join(home, '.npm-global', 'bin'),
    path.join(home, 'bin'),
    '/usr/local/bin',
    '/opt/homebrew/bin',
  ];
  const current = (process.env.PATH ?? '').split(sep).filter(Boolean);
  const merged = [...dirs.filter((d) => !current.includes(d) && fs.existsSync(d)), ...current];
  return { ...process.env, ...node.env, ...extra, PATH: merged.join(sep), FORCE_COLOR: '0', NO_COLOR: '1' };
}

export interface CliInvocation {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cli: string;
  node: NodeBinary;
}

export type CliConfig = Pick<ClaudexorConfig, 'cliPath' | 'extensionPath'> & NodeRuntimeConfig;

export async function cliInvocation(cfg: CliConfig, args: string[]): Promise<CliInvocation> {
  const cli = resolveCliPath(cfg);
  const node = await ensureNode(cfg);
  return { command: node.command, args: [cli, ...args], env: cliEnv(node), cli, node };
}

/** Human-readable line for terminals: `"node" "cli.js" args…` */
export function shellCommand(inv: CliInvocation): string {
  const q = (s: string) => (/[\s"'$`\\]/.test(s) ? `'${s.replace(/'/g, `'\\''`)}'` : s);
  const envPrefix = Object.entries(inv.node.env)
    .map(([k, v]) => `${k}=${q(v)}`)
    .join(' ');
  return `${envPrefix ? `${envPrefix} ` : ''}${q(inv.command)} ${inv.args.map(q).join(' ')}`;
}

/* ---------------------------------------------------------------- running */

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runCli(inv: CliInvocation, opts: { cwd: string; signal?: AbortSignal; timeoutMs: number; onLine?: (line: string) => void }): Promise<RunResult> {
  return new Promise<RunResult>((resolve, reject) => {
    fs.mkdirSync(opts.cwd, { recursive: true });
    let child: ChildProcess;
    try {
      child = spawn(inv.command, inv.args, { cwd: opts.cwd, env: inv.env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      reject(new AgentError(`Could not start Claudexor: ${err instanceof Error ? err.message : String(err)}`));
      return;
    }
    let stdout = '';
    let stderr = '';
    let pending = '';
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGINT');
      setTimeout(() => child.kill('SIGKILL'), 5_000).unref();
    }, opts.timeoutMs);
    const onAbort = () => {
      killed = true;
      child.kill('SIGINT');
      setTimeout(() => child.kill('SIGKILL'), 5_000).unref();
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
      if (!opts.onLine) return;
      pending += chunk;
      let nl: number;
      while ((nl = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, nl).trim();
        pending = pending.slice(nl + 1);
        if (line) opts.onLine(line);
      }
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      reject(new AgentError(`Could not start Claudexor (${inv.command}): ${err.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      if (pending.trim() && opts.onLine) opts.onLine(pending.trim());
      if (opts.signal?.aborted) {
        reject(new AgentError('Cancelled'));
        return;
      }
      if (killed) {
        reject(new AgentError(`Claudexor run exceeded the ${Math.round(opts.timeoutMs / 60_000)} min timeout.`));
        return;
      }
      resolve({ code, stdout, stderr });
    });
  });
}

function parseJsonObjects(text: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try {
      const v = JSON.parse(t) as unknown;
      if (v && typeof v === 'object') out.push(v as Record<string, unknown>);
    } catch {
      /* not a JSON line */
    }
  }
  if (out.length === 0) {
    // `--json` prints one pretty-printed object spanning lines.
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        out.push(JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>);
      } catch {
        /* ignore */
      }
    }
  }
  return out;
}

/** Turn an NDJSON run event into a short progress line (or undefined). */
export function describeRunEvent(ev: Record<string, unknown>): string | undefined {
  const type = String(ev.type ?? ev.frame ?? '');
  const p = (ev.payload ?? {}) as Record<string, unknown>;
  const who = String(p.harness_id ?? '');
  switch (type) {
    case 'run.started':
      return `run ${String(ev.runId ?? '')} started`;
    case 'harness.started':
      return `[${who}] started`;
    case 'harness.event': {
      const sub = String(p.type ?? '');
      const detail = (p.payload ?? {}) as Record<string, unknown>;
      if (sub === 'message' && detail.buffered === true) return undefined;
      if (sub === 'message' && typeof p.title === 'string') return `[${who}] ${truncate(p.title, 160)}`;
      if (sub === 'tool_call' && p.tool && typeof p.tool === 'object') {
        const tool = p.tool as Record<string, unknown>;
        return `[${who}] tool ${String(tool.name ?? '?')}${tool.target ? ` — ${truncate(String(tool.target), 100)}` : ''}`;
      }
      if (sub === 'status' && typeof p.title === 'string') return `[${who}] ${truncate(p.title, 160)}`;
      return undefined;
    }
    case 'harness.completed':
      return `[${who}] completed: ${String(p.status ?? '?')}${p.error ? ` — ${truncate(String(p.error), 160)}` : ''}`;
    case 'output.ready':
      return `output ready: ${String(p.path ?? '?')}`;
    case 'run.terminal':
      return `run finished: ${String(ev.status ?? '?')}`;
    default:
      return undefined;
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** Read the answer the run produced (final/answer.md, or the terminal object's primary output). */
function readAnswer(terminal: Record<string, unknown> | undefined): string | undefined {
  const primary = terminal?.primaryOutput as { text?: string; kind?: string } | undefined;
  if (primary?.text?.trim() && primary.kind !== 'diagnostic') return primary.text;
  const runDir = typeof terminal?.runDir === 'string' ? terminal.runDir : undefined;
  if (runDir) {
    for (const rel of ['final/answer.md', 'final/report.md']) {
      try {
        const text = fs.readFileSync(path.join(runDir, rel), 'utf8');
        if (text.trim()) return text;
      } catch {
        /* next */
      }
    }
  }
  return undefined;
}

function terminalError(terminal: Record<string, unknown> | undefined, stderr: string, code: number | null): string {
  const parts: string[] = [];
  if (terminal) {
    if (typeof terminal.error === 'string') parts.push(terminal.error);
    if (typeof terminal.summary === 'string') parts.push(terminal.summary);
    if (typeof terminal.message === 'string') parts.push(terminal.message);
    const failure = terminal.failure as { safeMessage?: string } | undefined;
    if (failure?.safeMessage) parts.push(failure.safeMessage);
    const actions = terminal.requiredActions as Array<{ title?: string; detail?: string }> | undefined;
    if (Array.isArray(actions)) for (const a of actions) if (a?.title || a?.detail) parts.push([a.title, a.detail].filter(Boolean).join(': '));
  }
  const err = stderr.trim().split('\n').filter(Boolean).slice(-3).join(' ');
  if (err) parts.push(err);
  if (parts.length === 0) parts.push(`exit code ${code ?? '?'}`);
  return [...new Set(parts)].join(' · ');
}

export class ClaudexorProvider implements AgentProvider {
  readonly id: string;
  readonly label: string;

  constructor(
    id: string,
    label: string,
    private readonly getConfig: () => Promise<ClaudexorConfig>,
  ) {
    this.id = id;
    this.label = label;
  }

  async explain(request: AgentRequest, options: AgentCallOptions): Promise<AgentResponse> {
    const cfg = await this.getConfig();
    const mode: Exclude<ClaudexorMode, 'auto'> = cfg.mode === 'auto' ? (request.useExcalidraw ? 'agent' : 'ask') : cfg.mode;
    const cwd = mode === 'agent' ? cfg.projectDir : cfg.workDir;
    const privateProject = mode === 'agent' && !!cfg.workspaceRoot && path.resolve(cfg.projectDir) !== path.resolve(cfg.workspaceRoot);

    let req = request;
    if (mode === 'agent' && privateProject) {
      // The agent works in the private project: rewrite the workspace root in the shared
      // instructions (absolute diagram dir etc.) and make the skill available there.
      const bridge: 'claude' | 'none' = cfg.harness === 'claude' ? 'claude' : 'none';
      if (request.useExcalidraw) prepareSkillCopy(cfg.extensionPath, cfg.projectDir, EXCALIDRAW_SKILL_ID, bridge);
      req = {
        ...request,
        workspaceRoot: cfg.projectDir,
        instructions: undefined,
        excalidrawSkillBridge: request.useExcalidraw ? bridge : request.excalidrawSkillBridge,
        excalidrawSkillPath: request.useExcalidraw ? (bridge === 'claude' ? `.claude/skills/${EXCALIDRAW_SKILL_ID}` : `.xplain/skills/${EXCALIDRAW_SKILL_ID}`) : request.excalidrawSkillPath,
      };
    }
    const prompt = buildChatPrompt(req, req.systemPrompt ?? cfg.systemPrompt);
    const message = [prompt.system, '', '---', '', prompt.user].join('\n');

    fs.mkdirSync(cfg.workDir, { recursive: true });
    fs.mkdirSync(cwd, { recursive: true });
    const promptFile = path.join(cfg.workDir, `prompt-${request.sessionId}-${Date.now()}.md`);
    fs.writeFileSync(promptFile, message, 'utf8');

    const common = ['--prompt-file', promptFile, '--harness', cfg.harness, '--web', 'off', '--json-stream'];
    const args =
      mode === 'agent'
        ? ['agent', ...common, '--in-place', '--access', 'workspace_write', '--no-review']
        : ['ask', ...common];
    if (cfg.model.trim()) args.push('--model', cfg.model.trim());
    if (cfg.effort?.trim()) args.push('--effort', cfg.effort.trim());
    const maxSeconds = Math.max(60, Math.floor(cfg.timeoutMs / 1000));
    args.push('--max-seconds', String(maxSeconds));
    cfg.onLog?.(`[claudexor] mode=${mode} cwd=${cwd}${privateProject ? ' (private project; diagrams mirrored to workspace)' : ''}`);
    const startedAt = Date.now();

    const inv = await cliInvocation({ ...cfg, signal: options.signal }, args);
    cfg.onLog?.(`[claudexor] ${shellCommand(inv)}`);

    let terminal: Record<string, unknown> | undefined;
    let res: RunResult;
    try {
      res = await runCli(inv, {
        cwd,
        signal: options.signal,
        timeoutMs: cfg.timeoutMs + 30_000,
        onLine: (line) => {
          if (!line.startsWith('{')) return;
          let ev: Record<string, unknown>;
          try {
            ev = JSON.parse(line) as Record<string, unknown>;
          } catch {
            return;
          }
          if (ev.frame === 'run.terminal') terminal = ev;
          const text = describeRunEvent(ev);
          if (text) {
            cfg.onLog?.(`[claudexor] ${text}`);
            if (cfg.streaming) options.onDelta?.(`${text}\n`);
          }
        },
      });
    } finally {
      try {
        fs.unlinkSync(promptFile);
      } catch {
        /* ignore */
      }
    }

    if (!terminal) {
      const objs = parseJsonObjects(res.stdout);
      terminal = objs.reverse().find((o) => o.frame === 'run.terminal' || 'status' in o || 'ok' in o);
    }
    const status = String(terminal?.status ?? '');
    const ok = res.code === 0 && (!status || /succeeded|completed|done|ok/i.test(status)) && terminal?.ok !== false;
    const answer = readAnswer(terminal);
    if (!ok && !answer) {
      throw new AgentError(`${HARNESS_LABELS[cfg.harness]} via Claudexor failed: ${terminalError(terminal, res.stderr, res.code)}`);
    }
    if (!answer) throw new AgentError(`${HARNESS_LABELS[cfg.harness]} via Claudexor returned no answer (run ${String(terminal?.runId ?? '?')}).`);

    let content = answer.trim();
    if (mode === 'agent') {
      // The agent may have written the HTML to a file and only described it in the answer.
      try {
        const recovered = await recoverHtmlAnswer(content, { workspaceRoots: [cwd], sinceMs: startedAt, excludeSessions: true });
        if (recovered.recoveredFrom) cfg.onLog?.(`[claudexor] recovered HTML from ${recovered.recoveredFrom}`);
        content = recovered.html;
      } catch (err) {
        cfg.onLog?.(`[claudexor] recover failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (privateProject && cfg.workspaceRoot) {
        const copied = mirrorSessionDiagrams(cfg.projectDir, cfg.workspaceRoot, request.sessionId);
        if (copied) cfg.onLog?.(`[claudexor] mirrored ${copied} diagram file(s) into ${cfg.workspaceRoot}/${sessionDiagramsRelPath(request.sessionId)}`);
        // Absolute private-project paths → workspace-relative so XPlain can inline them.
        content = content.split(`${cfg.projectDir.replace(/\\/g, '/')}/`).join('');
      }
    }
    const html = ensureSelfContainedHtml(content);
    return { title: extractHtmlTitle(html), format: 'html', content: html };
  }
}

/* ----------------------------------------------------- private project dir */

const EXCALIDRAW_SKILL_ID = 'excalidraw-diagram';
const SKIP_COPY = new Set(['.git', '.gitignore', '.venv', 'node_modules', '__pycache__']);

function sessionDiagramsRelPath(sessionId: string): string {
  return `.xplain/diagrams/${sessionId}`;
}

function copyTreeSync(src: string, dst: string): number {
  let n = 0;
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP_COPY.has(entry.name)) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (entry.isDirectory()) n += copyTreeSync(from, to);
    else if (entry.isFile()) {
      fs.copyFileSync(from, to);
      n += 1;
    }
  }
  return n;
}

/** Copy the bundled skill into the private project (`.xplain/skills/<id>` + optional `.claude/skills/<id>` bridge). */
export function prepareSkillCopy(extensionPath: string, projectDir: string, skillId: string, bridge: 'claude' | 'none'): void {
  const src = path.join(extensionPath, 'skills', skillId);
  if (!fs.existsSync(src)) throw new AgentError(`Bundled skill ${skillId} is missing from the extension (${src}).`);
  copyTreeSync(src, path.join(projectDir, '.xplain', 'skills', skillId));
  if (bridge === 'claude') copyTreeSync(src, path.join(projectDir, '.claude', 'skills', skillId));
}

/** Copy `<project>/.xplain/diagrams/<sessionId>` into the real workspace, then drop the private copy. */
export function mirrorSessionDiagrams(projectDir: string, workspaceRoot: string, sessionId: string): number {
  const rel = sessionDiagramsRelPath(sessionId);
  const src = path.join(projectDir, rel);
  if (!fs.existsSync(src)) return 0;
  const n = copyTreeSync(src, path.join(workspaceRoot, rel));
  try {
    fs.rmSync(src, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  return n;
}

/** Stable private project dir for a workspace (Claudexor may git-init it freely). */
export function privateProjectDir(globalStoragePath: string, workspaceRoot: string | undefined): string {
  const key = createHash('sha1').update(workspaceRoot ?? 'no-workspace').digest('hex').slice(0, 12);
  return path.join(globalStoragePath, 'claudexor', 'projects', key);
}

/* --------------------------------------------------------- doctor / models */

export interface HarnessStatus {
  harness: ClaudexorHarness;
  available: boolean;
  status: string;
  /** Human lines: readiness checks + reasons. */
  details: string[];
  installed: boolean;
  loggedIn: boolean | undefined;
}

export async function harnessStatus(cfg: CliConfig & Pick<ClaudexorConfig, 'workDir'>, harness: ClaudexorHarness, signal?: AbortSignal): Promise<HarnessStatus> {
  const inv = await cliInvocation({ ...cfg, signal }, ['doctor', '--harness', harness, '--json']);
  const res = await runCli(inv, { cwd: cfg.workDir, signal, timeoutMs: 60_000 });
  const objs = parseJsonObjects(res.stdout);
  const root = objs[0];
  const list = (root?.harnesses as Array<Record<string, unknown>> | undefined) ?? [];
  const h = list.find((x) => x.id === harness) ?? list[0];
  if (!h) {
    throw new AgentError(`Claudexor doctor gave no result for ${harness}: ${terminalError(root, res.stderr, res.code)}`);
  }
  const status = String(h.status ?? 'unknown');
  const details: string[] = [];
  let installed = false;
  let loggedIn: boolean | undefined;
  const readiness = (h.readiness as Array<Record<string, unknown>> | undefined) ?? (h.checks as Array<Record<string, unknown>> | undefined) ?? [];
  for (const r of readiness) {
    const id = String(r.id ?? '');
    const st = String(r.status ?? '');
    const title = String(r.title ?? id);
    const detail = typeof r.detail === 'string' ? r.detail : '';
    details.push(`${title}: ${st}${detail ? ` — ${detail}` : ''}`);
    if (id === 'installed') installed = st === 'pass' || st === 'ok';
    if (/auth|login|credential/i.test(id) || /auth|login/i.test(title)) loggedIn = st === 'pass' || st === 'ok';
  }
  for (const r of (h.reasons as string[] | undefined) ?? []) if (typeof r === 'string') details.push(r);
  return { harness, available: status === 'available' || status === 'ready', status, details, installed, loggedIn };
}

export async function listHarnessModels(cfg: CliConfig & Pick<ClaudexorConfig, 'workDir'>, harness: ClaudexorHarness, signal?: AbortSignal): Promise<string[]> {
  const inv = await cliInvocation({ ...cfg, signal }, ['models', '--harness', harness, '--json']);
  const res = await runCli(inv, { cwd: cfg.workDir, signal, timeoutMs: 60_000 });
  const objs = parseJsonObjects(res.stdout);
  const root = objs[0];
  if (!root) {
    // Maybe a plain JSON array.
    try {
      const arr = JSON.parse(res.stdout.trim()) as unknown;
      if (Array.isArray(arr)) return normalizeModels(arr);
    } catch {
      /* fallthrough */
    }
    throw new AgentError(`Claudexor models: ${terminalError(undefined, res.stderr, res.code)}`);
  }
  if (root.ok === false) throw new AgentError(String(root.message ?? root.error ?? 'model list failed'));
  const candidates = [root.models, root.items, root.data, (root.harness as Record<string, unknown> | undefined)?.models];
  for (const c of candidates) if (Array.isArray(c)) return normalizeModels(c);
  return [];
}

function normalizeModels(arr: unknown[]): string[] {
  const ids = arr
    .map((m) => (typeof m === 'string' ? m : m && typeof m === 'object' ? String((m as Record<string, unknown>).id ?? (m as Record<string, unknown>).name ?? '') : ''))
    .filter(Boolean);
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

export function claudexorWorkDir(globalStoragePath: string): string {
  return path.join(globalStoragePath, 'claudexor');
}
