/**
 * Managed Node.js runtime for the bundled Claudexor CLI.
 *
 * Claudexor needs Node >= 24.15 while the extension host may run an older Node
 * (or none on PATH). When nothing suitable is found, XPlain downloads an official
 * build from nodejs.org into the extension's global storage, verifies it against
 * SHASUMS256.txt and uses `bin/node` from there. No sudo, no PATH changes.
 */
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { AgentError } from './AgentProvider';

const execFileAsync = promisify(execFile);

/** Node version downloaded when nothing suitable is installed (official LTS line). */
export const DEFAULT_MANAGED_NODE_VERSION = '24.21.0';
const DIST_BASE = 'https://nodejs.org/dist';

export interface NodeRuntimeOptions {
  /** `context.globalStorageUri.fsPath` */
  globalStoragePath: string;
  /** Exact version to download, e.g. "24.21.0". */
  version?: string;
  onProgress?: (message: string) => void;
  signal?: AbortSignal;
  /** Test hook. */
  fetchImpl?: typeof fetch;
}

export function managedNodeRoot(globalStoragePath: string): string {
  return path.join(globalStoragePath, 'node-runtime');
}

function nodeBinaryIn(dir: string): string {
  return process.platform === 'win32' ? path.join(dir, 'node.exe') : path.join(dir, 'bin', 'node');
}

/** Already-downloaded managed runtimes (newest first). */
export function listManagedNodes(globalStoragePath: string): Array<{ version: string; binary: string }> {
  const root = managedNodeRoot(globalStoragePath);
  let dirs: string[];
  try {
    dirs = fs.readdirSync(root).filter((d) => /^v\d+\.\d+\.\d+$/.test(d));
  } catch {
    return [];
  }
  return dirs
    .map((d) => ({ version: d, binary: nodeBinaryIn(path.join(root, d)) }))
    .filter((e) => fs.existsSync(e.binary))
    .sort((a, b) => compareVersions(b.version, a.version));
}

function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

/** `node-v24.21.0-linux-x64.tar.gz` etc. for this machine; throws on unsupported platforms. */
export function distArchiveName(version: string, platform = process.platform, arch = process.arch): { file: string; ext: 'tar.gz' | 'zip' } {
  const plat = platform === 'linux' ? 'linux' : platform === 'darwin' ? 'darwin' : platform === 'win32' ? 'win' : undefined;
  const a = arch === 'x64' ? 'x64' : arch === 'arm64' ? 'arm64' : arch === 'arm' && platform === 'linux' ? 'armv7l' : undefined;
  if (!plat || !a) throw new AgentError(`No official Node.js build for ${platform}/${arch}; install Node >= 24.15 manually and set xplain.agent.claudexor.nodePath.`);
  const ext = plat === 'win' ? 'zip' : 'tar.gz';
  return { file: `node-v${version}-${plat}-${a}.${ext}`, ext };
}

async function download(url: string, dest: string, opts: NodeRuntimeOptions, label: string): Promise<void> {
  const f = opts.fetchImpl ?? fetch;
  const res = await f(url, { signal: opts.signal, redirect: 'follow' });
  if (!res.ok || !res.body) throw new AgentError(`Download failed (${res.status}) for ${url}`);
  const total = Number(res.headers.get('content-length') ?? 0);
  const out = fs.createWriteStream(dest);
  let received = 0;
  let lastPct = -1;
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (opts.signal?.aborted) throw new AgentError('Cancelled');
      received += value.byteLength;
      if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()));
      if (total) {
        const pct = Math.floor((received / total) * 100);
        if (pct !== lastPct && pct % 10 === 0) {
          lastPct = pct;
          opts.onProgress?.(`${label}: ${pct}% (${Math.round(received / 1_048_576)} MB)`);
        }
      }
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      out.end((err?: Error | null) => (err ? reject(err) : resolve()));
    });
  }
}

function sha256File(file: string): string {
  const h = createHash('sha256');
  h.update(fs.readFileSync(file));
  return h.digest('hex');
}

async function extract(archive: string, ext: 'tar.gz' | 'zip', destDir: string): Promise<void> {
  fs.mkdirSync(destDir, { recursive: true });
  if (ext === 'tar.gz') {
    await execFileAsync('tar', ['-xzf', archive, '-C', destDir, '--strip-components=1'], { maxBuffer: 1 << 20 });
    return;
  }
  // Windows: Expand-Archive, then hoist the single inner folder.
  const tmp = `${destDir}.unzip`;
  fs.rmSync(tmp, { recursive: true, force: true });
  await execFileAsync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${tmp}' -Force`]);
  const inner = fs.readdirSync(tmp).map((n) => path.join(tmp, n)).find((p) => fs.statSync(p).isDirectory());
  if (!inner) throw new AgentError('Unexpected Node.js zip layout.');
  for (const name of fs.readdirSync(inner)) fs.renameSync(path.join(inner, name), path.join(destDir, name));
  fs.rmSync(tmp, { recursive: true, force: true });
}

/**
 * Download + verify + unpack Node.js into `<globalStorage>/node-runtime/v<version>/`.
 * Returns the path to the `node` binary. Idempotent: an existing valid install is reused.
 */
export async function installManagedNode(opts: NodeRuntimeOptions): Promise<string> {
  const version = (opts.version ?? DEFAULT_MANAGED_NODE_VERSION).replace(/^v/, '');
  const root = managedNodeRoot(opts.globalStoragePath);
  const finalDir = path.join(root, `v${version}`);
  const binary = nodeBinaryIn(finalDir);
  if (fs.existsSync(binary)) return binary;

  const { file, ext } = distArchiveName(version);
  fs.mkdirSync(root, { recursive: true });
  const tmpDir = fs.mkdtempSync(path.join(root, '.download-'));
  try {
    opts.onProgress?.(`Fetching Node.js v${version} checksums…`);
    const sumsRes = await (opts.fetchImpl ?? fetch)(`${DIST_BASE}/v${version}/SHASUMS256.txt`, { signal: opts.signal });
    if (!sumsRes.ok) throw new AgentError(`Node.js v${version} is not available on nodejs.org (${sumsRes.status}). Check xplain.agent.claudexor.nodeVersion.`);
    const sums = await sumsRes.text();
    const expected = sums
      .split('\n')
      .map((l) => l.trim().split(/\s+/))
      .find((parts) => parts[1] === file)?.[0];
    if (!expected) throw new AgentError(`No checksum for ${file} in SHASUMS256.txt — unsupported platform build?`);

    const archive = path.join(tmpDir, file);
    await download(`${DIST_BASE}/v${version}/${file}`, archive, opts, `Downloading Node.js v${version}`);
    opts.onProgress?.('Verifying checksum…');
    const actual = sha256File(archive);
    if (actual !== expected) throw new AgentError(`Node.js download checksum mismatch (${actual} ≠ ${expected}).`);

    opts.onProgress?.('Unpacking…');
    const stage = path.join(tmpDir, 'node');
    await extract(archive, ext, stage);
    if (!fs.existsSync(nodeBinaryIn(stage))) throw new AgentError('Unpacked Node.js has no node binary.');
    fs.rmSync(finalDir, { recursive: true, force: true });
    fs.renameSync(stage, finalDir);

    // Sanity run.
    const v = execFileSync(binary, ['-v'], { encoding: 'utf8', timeout: 10_000 }).trim();
    opts.onProgress?.(`Node.js ${v} ready at ${binary}`);
    return binary;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** Remove all managed runtimes (user-initiated cleanup). */
export function removeManagedNodes(globalStoragePath: string): void {
  fs.rmSync(managedNodeRoot(globalStoragePath), { recursive: true, force: true });
}

export function describeHost(): string {
  return `${os.platform()}/${os.arch()}`;
}
