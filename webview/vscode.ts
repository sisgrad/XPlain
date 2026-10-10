import type { HostMessage, ViewMessage } from '@shared/protocol';

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const api: VsCodeApi = acquireVsCodeApi();

export function post(message: ViewMessage): void {
  api.postMessage(message);
}

export function onHostMessage(handler: (message: HostMessage) => void): () => void {
  const listener = (event: MessageEvent) => {
    const data = event.data;
    if (data && typeof data === 'object' && typeof data.type === 'string') handler(data as HostMessage);
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}

export function getPersisted<T>(): T | undefined {
  return api.getState() as T | undefined;
}

export function persist(state: unknown): void {
  api.setState(state);
}
