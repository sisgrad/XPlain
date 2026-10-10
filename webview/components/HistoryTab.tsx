import { useState } from 'preact/hooks';
import type { SessionMeta } from '@shared/types';
import { post } from '../vscode';

interface Props {
  sessions: SessionMeta[];
  current?: string;
}

export function HistoryTab({ sessions, current }: Props) {
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
        {list.map((s) => (
          <li class={`item ${s.id === current ? 'current' : ''} ${s.status !== 'done' ? 'dim' : ''}`} key={s.id}>
            <span class={`codicon item-icon ${s.status === 'error' ? 'codicon-error' : s.status === 'pending' ? 'codicon-loading codicon-modifier-spin' : 'codicon-comment-discussion'}`} />
            <button class="link item-main" onClick={() => post({ type: 'openSession', sessionId: s.id })} title={s.status === 'error' ? s.error : 'Open'}>
              <span class="item-title">{s.title}</span>
              <span class="item-sub">
                {new Date(s.createdAt).toLocaleString()} · {s.anchorIds.length} block{s.anchorIds.length === 1 ? '' : 's'} · {s.resultFormat}
                {s.status === 'error' ? ' · failed' : ''}
              </span>
            </button>
            <div class="item-actions">
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
        ))}
      </ul>
    </div>
  );
}
