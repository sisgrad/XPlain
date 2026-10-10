/**
 * "Pick mode": armed with Shift+X while the editor is not focused. The next
 * click on a block's CodeLens offers its explanations for adding to the
 * context instead of opening them.
 */
import * as vscode from 'vscode';
import { Emitter } from '../util/emitter';

export class PickMode implements vscode.Disposable {
  private _active = false;
  private readonly statusItem: vscode.StatusBarItem;
  private readonly changeEmitter = new Emitter<boolean>();
  readonly onDidChange = this.changeEmitter.event;
  private autoOffTimer: NodeJS.Timeout | undefined;

  constructor() {
    this.statusItem = vscode.window.createStatusBarItem('xplain.pickMode', vscode.StatusBarAlignment.Left, 10000);
    this.statusItem.name = 'XPlain pick mode';
    this.statusItem.command = 'xplain.togglePickMode';
    this.statusItem.text = '$(target) XPlain: click a block to add its explanation';
    this.statusItem.tooltip = 'Pick mode is on. Click an XPlain CodeLens to add one of its explanations to the context. Click here or press Shift+X again to turn off.';
    this.statusItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  }

  get active(): boolean {
    return this._active;
  }

  toggle(): void {
    this.set(!this._active);
  }

  set(active: boolean): void {
    if (this._active === active) return;
    this._active = active;
    void vscode.commands.executeCommand('setContext', 'xplain.pickMode', active);
    if (active) {
      this.statusItem.show();
      // Safety: turn off automatically after 2 minutes of inactivity.
      this.autoOffTimer = setTimeout(() => this.set(false), 2 * 60 * 1000);
    } else {
      this.statusItem.hide();
      if (this.autoOffTimer) clearTimeout(this.autoOffTimer);
      this.autoOffTimer = undefined;
    }
    this.changeEmitter.fire(active);
  }

  dispose(): void {
    if (this.autoOffTimer) clearTimeout(this.autoOffTimer);
    this.statusItem.dispose();
    this.changeEmitter.dispose();
  }
}
