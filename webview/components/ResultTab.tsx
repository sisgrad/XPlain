import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { BusyState } from '@shared/types';
import type { ResultView } from '../App';
import { renderMarkdown } from '../markdown';
import { post } from '../vscode';

interface Props {
  result: ResultView | null;
  stream: { sessionId: string; title: string; text: string } | null;
  busy: BusyState;
}

export function ResultTab({ result, stream, busy }: Props) {
  if (stream && (!result || result.session.id !== stream.sessionId)) {
    return (
      <div class="result-tab">
        <div class="result-header">
          <h2 class="result-title">
            <span class="codicon codicon-loading codicon-modifier-spin" /> {stream.title}
          </h2>
        </div>
        <StreamingBody text={stream.text} label={busy.label} />
      </div>
    );
  }

  if (!result) {
    return (
      <div class="hint centered">
        <span class="codicon codicon-book big" />
        <p>No explanation open. Click an <em>XPlain</em> CodeLens above a code block, or pick one from History.</p>
      </div>
    );
  }

  return (
    <div class="result-tab">
      <div class="result-header">
        <EditableTitle sessionId={result.session.id} title={result.session.title} />
        <div class="result-actions">
          <button class="icon-button" title="Add this explanation to the context" onClick={() => post({ type: 'addSessionToDraft', sessionId: result.session.id })}>
            <span class="codicon codicon-add" />
          </button>
          <button class="icon-button" title="Open in editor" onClick={() => post({ type: 'openSessionInEditor', sessionId: result.session.id })}>
            <span class="codicon codicon-open-preview" />
          </button>
        </div>
      </div>
      <div class="result-meta">
        {new Date(result.session.createdAt).toLocaleString()} · {result.session.anchorIds.length} block{result.session.anchorIds.length === 1 ? '' : 's'}
        {result.session.question.trim() && <div class="result-question">Q: {result.session.question}</div>}
      </div>
      {result.format === 'html' ? (
        result.htmlUri ? (
          <iframe class="html-result" src={result.htmlUri} sandbox="allow-scripts" title={result.session.title} />
        ) : (
          <div class="hint">HTML result could not be located on disk.</div>
        )
      ) : (
        <MarkdownBody source={result.content} />
      )}
    </div>
  );
}

function MarkdownBody({ source }: { source: string }) {
  const html = useMemo(() => renderMarkdown(source), [source]);
  return <article class="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />;
}

function StreamingBody({ text, label }: { text: string; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const html = useMemo(() => renderMarkdown(text), [text]);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [html]);
  return (
    <div class="stream" ref={ref}>
      {text ? <article class="markdown-body" dangerouslySetInnerHTML={{ __html: html }} /> : <div class="hint">{label ?? 'Waiting for the agent…'}</div>}
      <div class="stream-footer">
        <button class="button secondary small" onClick={() => post({ type: 'cancel' })}>
          <span class="codicon codicon-debug-stop" /> Cancel
        </button>
      </div>
    </div>
  );
}

function EditableTitle({ sessionId, title }: { sessionId: string; title: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  useEffect(() => setValue(title), [title]);
  if (!editing) {
    return (
      <h2 class="result-title" title="Click to rename" onDblClick={() => setEditing(true)}>
        <span class="codicon codicon-comment-discussion" /> {title}
        <button class="icon-button inline" title="Rename" onClick={() => setEditing(true)}>
          <span class="codicon codicon-edit" />
        </button>
      </h2>
    );
  }
  const commit = () => {
    setEditing(false);
    if (value.trim() && value.trim() !== title) post({ type: 'renameSession', sessionId, title: value.trim() });
  };
  return (
    <input
      class="input title-input"
      value={value}
      autoFocus
      onInput={(e) => setValue((e.target as HTMLInputElement).value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') {
          setValue(title);
          setEditing(false);
        }
      }}
    />
  );
}
