/** The context the user is assembling before confirming the send. */
import type { DraftItem, DraftState, ExplainLanguage } from '../shared/types';
import { DEFAULT_DRAFT } from '../shared/types';
import { Emitter } from '../util/emitter';

export class ContextDraft {
  private state: DraftState = { ...DEFAULT_DRAFT, items: [] };
  private readonly changeEmitter = new Emitter<DraftState>();
  readonly onDidChange = this.changeEmitter.event;

  get snapshot(): DraftState {
    return { ...this.state, items: [...this.state.items] };
  }

  get isEmpty(): boolean {
    return this.state.items.length === 0 && this.state.question.trim() === '' && !this.state.templateId;
  }

  /** Adds an item; identical code blocks / results are not duplicated. */
  add(item: DraftItem): boolean {
    const dup = this.state.items.some((i) =>
      i.kind === 'code' && item.kind === 'code'
        ? i.anchorId === item.anchorId
        : i.kind === 'result' && item.kind === 'result'
          ? i.sessionId === item.sessionId
          : false,
    );
    if (dup) return false;
    this.state.items.push(item);
    this.fire();
    return true;
  }

  removeAt(index: number): void {
    if (index < 0 || index >= this.state.items.length) return;
    this.state.items.splice(index, 1);
    this.fire();
  }

  move(from: number, to: number): void {
    const n = this.state.items.length;
    if (from < 0 || from >= n || to < 0 || to >= n || from === to) return;
    const [item] = this.state.items.splice(from, 1);
    this.state.items.splice(to, 0, item);
    this.fire();
  }

  setQuestion(text: string): void {
    if (this.state.question === text) return;
    this.state.question = text;
    this.fire();
  }

  setTemplate(templateId: string | null): void {
    if (this.state.templateId === templateId) return;
    this.state.templateId = templateId;
    this.fire();
  }

  setExplainLanguage(lang: ExplainLanguage): void {
    if (this.state.explainLanguage === lang) return;
    this.state.explainLanguage = lang;
    this.fire();
  }

  setUseExcalidraw(value: boolean): void {
    if (this.state.useExcalidraw === value) return;
    this.state.useExcalidraw = value;
    this.fire();
  }

  /** Update ranges of code items when anchors move. */
  updateCodeRanges(update: (anchorId: string) => { startLine: number; endLine: number } | undefined): void {
    let changed = false;
    for (const item of this.state.items) {
      if (item.kind !== 'code') continue;
      const r = update(item.anchorId);
      if (r && (r.startLine !== item.startLine || r.endLine !== item.endLine)) {
        item.startLine = r.startLine;
        item.endLine = r.endLine;
        changed = true;
      }
    }
    if (changed) this.fire();
  }

  clear(options: { keepQuestion?: boolean } = {}): void {
    // Keep language / diagram preferences across clears — they are UI choices, not context items.
    this.state = {
      items: [],
      question: options.keepQuestion ? this.state.question : '',
      templateId: null,
      explainLanguage: this.state.explainLanguage,
      useExcalidraw: this.state.useExcalidraw,
    };
    this.fire();
  }

  private fire(): void {
    this.changeEmitter.fire(this.snapshot);
  }
}
