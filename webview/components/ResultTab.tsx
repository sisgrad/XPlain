import { BrandMark } from './BrandMark';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { BusyState, SessionDriftSummary } from '@shared/types';
import type { ResultView } from '../App';
import { renderMarkdown } from '../markdown';
import { post } from '../vscode';
import { DriftChip } from './DriftChip';

interface Props {
  result: ResultView | null;
  stream: { sessionId: string; title: string; text: string } | null;
  busy: BusyState;
  drift?: SessionDriftSummary;
}

export function ResultTab({ result, stream, busy, drift }: Props) {
  if (stream && (!result || result.session.id !== stream.sessionId)) {
    return (
      <div class="result-tab">
        <div class="result-header">
          <h2 class="result-title">
            <span class="codicon codicon-loading codicon-modifier-spin" /> {stream.title}
          </h2>
          <div class="result-actions">
            <button class="button secondary small" onClick={() => post({ type: 'cancel' })} title="Abort the request (also stops the agent)">
              <span class="codicon codicon-debug-stop" /> Stop
            </button>
          </div>
        </div>
        <StreamingBody text={stream.text} label={busy.label} />
      </div>
    );
  }

  if (!result) {
    return (
      <div class="hint centered">
        <BrandMark class="hero" size={96} variant="detail" />
        <p>No explanation open. Click an <em>XPlain</em> CodeLens above a code block, or pick one from History.</p>
      </div>
    );
  }

  const pending = !!result.contentPending && !result.content.trim();
  const drifted = !!drift && drift.level !== 'fresh' && result.session.status === 'done';

  return (
    <div class="result-tab">
      <div class="result-header">
        <EditableTitle sessionId={result.session.id} title={result.session.title} />
        <div class="result-actions">
          {drifted && (
            <button
              class="button small"
              title="Re-explain against the current code (sends the old explanation, the current code and a diff to the agent)"
              disabled={busy.busy}
              onClick={() => post({ type: 'refreshSession', sessionId: result.session.id })}
            >
              <span class="codicon codicon-sync" /> Refresh
            </button>
          )}
          {result.session.status === 'done' && (
            <button
              class="button secondary small"
              title="Revise this explanation: add a follow-up question, files, or more code, then overwrite"
              onClick={() => post({ type: 'beginExtend', sessionId: result.session.id })}
            >
              <span class="codicon codicon-edit" /> Extend
            </button>
          )}
          <button
            class="button secondary small"
            title="Save result.html / result.md to disk (does not wait for panel render)"
            onClick={() => post({ type: 'downloadSession', sessionId: result.session.id })}
          >
            <span class="codicon codicon-desktop-download" /> Download
          </button>
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
      {drifted && drift && (
        <div class={`drift-banner drift-${drift.level}`} role="status">
          <span class={`codicon ${drift.level === 'drifted' ? 'codicon-edit' : 'codicon-warning'}`} />
          <span class="drift-text">
            {drift.level === 'lost'
              ? 'The explained code could not be found in the current file(s).'
              : `Code changed since this explanation: ${drift.changedLines} line${drift.changedLines === 1 ? '' : 's'} in ${drift.changedBlocks} of ${drift.blocks} block${drift.blocks === 1 ? '' : 's'}.`}
            {drift.codeModifiedAt ? ` Code modified ${new Date(drift.codeModifiedAt).toLocaleString()}.` : ''}
            <DriftChip drift={drift} compact />
          </span>
          <span class="drift-actions">
            {drift.level !== 'lost' && (
              <button class="link" onClick={() => post({ type: 'showCodeDiff', sessionId: result.session.id })}>
                <span class="codicon codicon-diff" /> Show diff
              </button>
            )}
            <button class="link" disabled={busy.busy} onClick={() => post({ type: 'refreshSession', sessionId: result.session.id })}>
              <span class="codicon codicon-sync" /> Refresh
            </button>
          </span>
        </div>
      )}
      {result.format === 'html' ? (
        pending ? (
          <div class="html-result-pending-block" aria-live="polite">
            <span class="codicon codicon-loading codicon-modifier-spin" /> Preparing HTML…
            <span class="muted"> You can Download the file without waiting.</span>
          </div>
        ) : result.content.trim() ? (
          <HtmlFrame html={result.content} title={result.session.title} />
        ) : result.htmlUri ? (
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

/**
 * Render agent HTML in a closed Shadow DOM (not a nested iframe).
 * VS Code webviews often block `data:` images inside sandboxed srcdoc iframes
 * even when parent CSP allows them; shadow roots use the page CSP and show images.
 *
 * Large self-contained HTML (multi‑MB data: images) is parsed after a yield so the
 * Result toolbar (Download) stays interactive while "Rendering…" is shown.
 */
function HtmlFrame({ html, title }: { html: string; title: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    setReady(false);
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '';

    // :empty on the host never clears for Shadow DOM children — do not rely on CSS :empty.
    // Yield so "Rendering…" paints, then do the heavy DOMParser / innerHTML work.
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      try {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        for (const el of Array.from(doc.head?.querySelectorAll('style, link[rel="stylesheet"]') ?? [])) {
          shadow.appendChild(el.cloneNode(true));
        }
        const root = document.createElement('div');
        root.className = 'xplain-html-root';
        root.setAttribute('data-title', title);
        root.innerHTML = doc.body?.innerHTML?.trim() ? doc.body.innerHTML : html;
        shadow.appendChild(root);
      } catch {
        const pre = document.createElement('pre');
        pre.textContent = html;
        shadow.appendChild(pre);
      }
      if (!cancelled) setReady(true);
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [html, title]);

  return (
    <div class="html-result-frame">
      {!ready && (
        <div class="html-result-pending-block" aria-live="polite">
          <span class="codicon codicon-loading codicon-modifier-spin" /> Rendering…
          <span class="muted"> Large diagrams can take a few seconds. Download is available above.</span>
        </div>
      )}
      <div
        class={`html-result html-result-shadow${ready ? ' is-ready' : ' is-pending'}`}
        ref={hostRef}
        role="article"
        aria-label={title}
        aria-busy={!ready}
      />
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
        <button class="button secondary small" onClick={() => post({ type: 'cancel' })} title="Abort the request (also stops the agent)">
          <span class="codicon codicon-debug-stop" /> Stop request
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
