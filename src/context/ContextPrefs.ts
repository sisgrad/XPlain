/**
 * Persist Context-tab choices across clears and IDE reloads.
 * Question text is intentionally not stored.
 */
import type * as vscode from 'vscode';
import type { ExplainLanguage } from '../shared/types';

const KEY = 'xplain.contextPrefs';

export interface ContextPrefs {
  templateId: string | null;
  explainLanguage: ExplainLanguage;
  useExcalidraw: boolean;
}

export const DEFAULT_CONTEXT_PREFS: ContextPrefs = {
  templateId: null,
  explainLanguage: 'en',
  useExcalidraw: false,
};

export function readContextPrefs(state: vscode.Memento): ContextPrefs {
  const raw = state.get<Partial<ContextPrefs>>(KEY);
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CONTEXT_PREFS };
  return {
    templateId: typeof raw.templateId === 'string' ? raw.templateId : raw.templateId === null ? null : null,
    explainLanguage: raw.explainLanguage === 'ru' ? 'ru' : 'en',
    useExcalidraw: Boolean(raw.useExcalidraw),
  };
}

export async function writeContextPrefs(state: vscode.Memento, prefs: ContextPrefs): Promise<void> {
  await state.update(KEY, {
    templateId: prefs.templateId,
    explainLanguage: prefs.explainLanguage,
    useExcalidraw: prefs.useExcalidraw,
  });
}
