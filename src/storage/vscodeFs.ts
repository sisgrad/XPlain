import * as vscode from 'vscode';
import type { StoreFs } from './fs';

/** StoreFs backed by `vscode.workspace.fs`, rooted at a folder Uri. */
export class VscodeStoreFs implements StoreFs {
  constructor(private readonly root: vscode.Uri) {}

  uri(rel: string): vscode.Uri {
    return rel ? vscode.Uri.joinPath(this.root, ...rel.split('/')) : this.root;
  }

  async readFile(rel: string): Promise<Uint8Array> {
    return vscode.workspace.fs.readFile(this.uri(rel));
  }

  async writeFile(rel: string, data: Uint8Array): Promise<void> {
    const target = this.uri(rel);
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(target, '..'));
    await vscode.workspace.fs.writeFile(target, data);
  }

  async writeFileAtomic(rel: string, data: Uint8Array): Promise<void> {
    const tmp = `${rel}.${process.pid}.tmp`;
    await this.writeFile(tmp, data);
    await vscode.workspace.fs.rename(this.uri(tmp), this.uri(rel), { overwrite: true });
  }

  async mkdirp(rel: string): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.uri(rel));
  }

  async exists(rel: string): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(this.uri(rel));
      return true;
    } catch {
      return false;
    }
  }

  async readdir(rel: string): Promise<string[]> {
    try {
      const entries = await vscode.workspace.fs.readDirectory(this.uri(rel));
      return entries.map(([name]) => name);
    } catch {
      return [];
    }
  }

  async delete(rel: string): Promise<void> {
    try {
      await vscode.workspace.fs.delete(this.uri(rel), { recursive: true, useTrash: false });
    } catch {
      /* already gone */
    }
  }

  async stat(rel: string): Promise<{ size: number } | undefined> {
    try {
      const s = await vscode.workspace.fs.stat(this.uri(rel));
      return { size: s.size };
    } catch {
      return undefined;
    }
  }
}
