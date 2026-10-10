import * as vscode from 'vscode';
import type { HostMessage, ViewMessage } from '../shared/protocol';
import { isViewMessage } from '../shared/protocol';
import { Emitter } from '../util/emitter';

export const VIEW_ID = 'xplain.panel';

/** Hosts the sidebar webview and relays typed messages both ways. */
export class XplainViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private readonly messageEmitter = new Emitter<ViewMessage>();
  readonly onDidReceiveMessage = this.messageEmitter.event;
  private readonly resolvedEmitter = new Emitter<vscode.Webview>();
  /** Fires every time the webview is (re)created. */
  readonly onDidResolve = this.resolvedEmitter.event;
  private readonly visibilityEmitter = new Emitter<boolean>();
  readonly onDidChangeVisibility = this.visibilityEmitter.event;
  private readonly disposables: vscode.Disposable[] = [];
  private queue: HostMessage[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly extraResourceRoots: () => vscode.Uri[],
  ) {}

  get webview(): vscode.Webview | undefined {
    return this.view?.webview;
  }

  get visible(): boolean {
    return this.view?.visible ?? false;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    const webview = webviewView.webview;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'dist'),
        vscode.Uri.joinPath(this.context.extensionUri, 'media'),
        this.context.globalStorageUri,
        ...this.extraResourceRoots(),
      ],
    };
    webview.html = this.renderHtml(webview);
    this.disposables.push(
      webview.onDidReceiveMessage((raw: unknown) => {
        if (isViewMessage(raw)) this.messageEmitter.fire(raw);
      }),
      webviewView.onDidChangeVisibility(() => this.visibilityEmitter.fire(webviewView.visible)),
      webviewView.onDidDispose(() => {
        this.view = undefined;
      }),
    );
    this.resolvedEmitter.fire(webview);
    for (const m of this.queue.splice(0)) void webview.postMessage(m);
  }

  post(message: HostMessage): void {
    if (this.view) {
      void this.view.webview.postMessage(message);
    } else {
      this.queue.push(message);
      if (this.queue.length > 50) this.queue.shift();
    }
  }

  async reveal(preserveFocus = true): Promise<void> {
    if (this.view) {
      this.view.show(preserveFocus);
    } else {
      await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
    }
  }

  asWebviewUri(uri: vscode.Uri): string | undefined {
    return this.view?.webview.asWebviewUri(uri).toString();
  }

  private renderHtml(webview: vscode.Webview): string {
    const nonce = makeNonce();
    const dist = vscode.Uri.joinPath(this.context.extensionUri, 'dist');
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.css'));
    const hljsUri = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'hljs.css'));
    const codiconUri = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'codicon.css'));
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} https: data: blob:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
      // Self-contained HTML results are served from .xplain via a sandboxed iframe.
      `frame-src ${webview.cspSource}`,
    ].join('; ');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${codiconUri}">
<link rel="stylesheet" href="${hljsUri}">
<link rel="stylesheet" href="${styleUri}">
<title>XPlain</title>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.messageEmitter.dispose();
    this.resolvedEmitter.dispose();
    this.visibilityEmitter.dispose();
  }
}

function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
