import { useState } from 'preact/hooks';
import type { DriftMap } from '@shared/protocol';
import type { SessionMeta } from '@shared/types';
import { post } from '../vscode';
import { DriftChip } from './DriftChip';

interface Props {
  sessions: SessionMeta[];
  current?: string;
  drift: DriftMap;
}

export function HistoryTab({ sessions, current, drift }: Props) {
  const [filter, setFilter] = useState('');
  const q = filter.trim().toLowerCase();
  const list = q
    ? sessions.filter((s) => s.title.toLowerCase().includes(q) || s.question.toLowerCase().includes(q))
    : sessions;

  if (sessions.length === 0) {
    return (
      <div class="hint centered">
        <span class="codicon codicon-history big" />
        <p>No explanations yet. Build a context and send it to the agent.</p>
      </div>
    );
  }

  return (
    <div class="history-tab">
      <input class="input" placeholder="Filter explanations…" value={filter} onInput={(e) => setFilter((e.target as HTMLInputElement).value)} />
      <ul class="items">
        {list.map((s) => {
          const d = drift[s.id];
          const drifted = d && d.level !== 'fresh';
          return (
          <li class={`item ${s.id === current ? 'current' : ''} ${s.status !== 'done' ? 'dim' : ''} ${drifted ? 'drifted' : ''}`} key={s.id}>
            <span class={`codicon item-icon ${s.status === 'error' ? 'codicon-error' : s.status === 'pending' ? 'codicon-loading codicon-modifier-spin' : 'codicon-comment-discussion'}`} />
            <button class="link item-main" onClick={() => post({ type: 'openSession', sessionId: s.id })} title={s.status === 'error' ? s.error : 'Open'}>
              <span class="item-title">
                {s.title}
                <DriftChip drift={d} compact />
              </span>
              <span class="item-sub">
                {new Date(s.createdAt).toLocaleString()} · {s.anchorIds.length} block{s.anchorIds.length === 1 ? '' : 's'} · {s.resultFormat}
                {s.status === 'error' ? ' · failed' : ''}
                {drifted && d.codeModifiedAt ? ` · code modified ${new Date(d.codeModifiedAt).toLocaleString()}` : ''}
              </span>
            </button>
            <div class="item-actions">
              {s.status === 'done' && drifted && (
                <>
                  <button class="icon-button" title="Show code diff (explained ↔ current)" onClick={() => post({ type: 'showCodeDiff', sessionId: s.id })}>
                    <span class="codicon codicon-diff" />
                  </button>
                  <button class="icon-button" title="Refresh: re-explain against the current code" onClick={() => post({ type: 'refreshSession', sessionId: s.id })}>
                    <span class="codicon codicon-sync" />
                  </button>
                </>
              )}
              {s.status === 'done' && (
                <button class="icon-button" title="Add to context" onClick={() => post({ type: 'addSessionToDraft', sessionId: s.id })}>
                  <span class="codicon codicon-add" />
                </button>
              )}
              <button class="icon-button" title="Delete" onClick={() => post({ type: 'deleteSession', sessionId: s.id })}>
                <span class="codicon codicon-trash" />
              </button>
            </div>
          </li>
          );
        })}
      </ul>
    </div>
  );
}
