/**
 * Small filesystem abstraction so XplainStore can run on `vscode.workspace.fs`
 * inside the extension and on Node's `fs` in unit tests.
 * All paths are POSIX-style and relative to the store root.
 */
export interface StoreFs {
  readFile(relPath: string): Promise<Uint8Array>;
  writeFile(relPath: string, data: Uint8Array): Promise<void>;
  /** Atomically replace `relPath` with `data` (write temp + rename). */
  writeFileAtomic(relPath: string, data: Uint8Array): Promise<void>;
  mkdirp(relPath: string): Promise<void>;
  exists(relPath: string): Promise<boolean>;
  readdir(relPath: string): Promise<string[]>;
  delete(relPath: string): Promise<void>;
  stat(relPath: string): Promise<{ size: number } | undefined>;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');

export function encodeText(text: string): Uint8Array {
  return encoder.encode(text);
}

export function decodeText(data: Uint8Array): string {
  return decoder.decode(data);
}

export function joinPath(...parts: string[]): string {
  return parts
    .filter((p) => p.length > 0)
    .join('/')
    .replace(/\/+/g, '/');
}

/** Node implementation (used by tests and by install scripts). */
export class NodeStoreFs implements StoreFs {
  constructor(private readonly root: string) {}

  private abs(rel: string): string {
    return `${this.root}/${rel}`.replace(/\/+/g, '/');
  }

  async readFile(rel: string): Promise<Uint8Array> {
    const fs = await import('node:fs/promises');
    return new Uint8Array(await fs.readFile(this.abs(rel)));
  }

  async writeFile(rel: string, data: Uint8Array): Promise<void> {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    await fs.mkdir(path.dirname(this.abs(rel)), { recursive: true });
    await fs.writeFile(this.abs(rel), data);
  }

  async writeFileAtomic(rel: string, data: Uint8Array): Promise<void> {
    const fs = await import('node:fs/promises');
    const tmp = `${rel}.${process.pid}.tmp`;
    await this.writeFile(tmp, data);
    await fs.rename(this.abs(tmp), this.abs(rel));
  }

  async mkdirp(rel: string): Promise<void> {
    const fs = await import('node:fs/promises');
    await fs.mkdir(this.abs(rel), { recursive: true });
  }

  async exists(rel: string): Promise<boolean> {
    const fs = await import('node:fs/promises');
    try {
      await fs.access(this.abs(rel));
      return true;
    } catch {
      return false;
    }
  }

  async readdir(rel: string): Promise<string[]> {
    const fs = await import('node:fs/promises');
    try {
      return await fs.readdir(this.abs(rel));
    } catch {
      return [];
    }
  }

  async delete(rel: string): Promise<void> {
    const fs = await import('node:fs/promises');
    await fs.rm(this.abs(rel), { recursive: true, force: true });
  }

  async stat(rel: string): Promise<{ size: number } | undefined> {
    const fs = await import('node:fs/promises');
    try {
      const s = await fs.stat(this.abs(rel));
      return { size: s.size };
    } catch {
      return undefined;
    }
  }
}
