/** Minimal event emitter with no dependency on the `vscode` module (keeps storage unit-testable). */
export type Listener<T> = (value: T) => void;

export interface Disposable {
  dispose(): void;
}

export class Emitter<T> {
  private listeners = new Set<Listener<T>>();

  readonly event = (listener: Listener<T>): Disposable => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };

  fire(value: T): void {
    for (const l of Array.from(this.listeners)) {
      try {
        l(value);
      } catch (err) {
        console.error('[xplain] listener failed', err);
      }
    }
  }

  dispose(): void {
    this.listeners.clear();
  }
}
