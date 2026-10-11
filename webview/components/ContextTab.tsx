import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { BusyState, DraftState, ExplainLanguage, TemplateMeta } from '@shared/types';
import { EXPLAIN_LANGUAGES } from '@shared/types';
import { post } from '../vscode';

interface Props {
  draft: DraftState;
  templates: TemplateMeta[];
  busy: BusyState;
  agentLabel: string;
  pickMode: boolean;
  onConfigureAgent: () => void;
}

export function ContextTab({ draft, templates, busy, agentLabel, pickMode, onConfigureAgent }: Props) {
  // Keep the textarea responsive: edit locally, push to the host debounced.
  const [question, setQuestion] = useState(draft.question);
  const lastSent = useRef(draft.question);
  useEffect(() => {
    if (draft.question !== lastSent.current) {
      setQuestion(draft.question);
      lastSent.current = draft.question;
    }
  }, [draft.question]);
  useEffect(() => {
    if (question === lastSent.current) return;
    const t = window.setTimeout(() => {
      lastSent.current = question;
      post({ type: 'setQuestion', text: question });
    }, 250);
    return () => window.clearTimeout(t);
  }, [question]);

  const canSend = !busy.busy && (draft.items.length > 0 || question.trim().length > 0);
  const template = draft.templateId ? templates.find((t) => t.id === draft.templateId) : undefined;

  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && canSend) {
      e.preventDefault();
      lastSent.current = question;
      post({ type: 'setQuestion', text: question });
      post({ type: 'send' });
    }
  };

  return (
    <div class="context-tab">
      <section class="section">
        <div class="section-header">
          <h2>
            <span class="codicon codicon-list-selection" /> Context
            <span class="muted"> · {draft.items.length} item{draft.items.length === 1 ? '' : 's'}</span>
          </h2>
          {draft.items.length > 0 && (
            <button class="icon-button" title="Clear context" onClick={() => post({ type: 'clearDraft' })}>
              <span class="codicon codicon-clear-all" />
            </button>
          )}
        </div>
        {draft.items.length === 0 ? (
          <div class="hint">
            <p>
              Select code in the editor and press <kbd>Shift</kbd>+<kbd>X</kbd> to add it here. Each selection becomes a block <code>L12-L48</code>; sub-ranges are tracked separately.
            </p>
            <p>
              To reuse an earlier explanation, leave the editor, press <kbd>Shift</kbd>+<kbd>X</kbd> {pickMode ? '(pick mode is on)' : 'to arm pick mode'}, then click the block's <em>XPlain</em> CodeLens.
            </p>
          </div>
        ) : (
          <ul class="items">
            {draft.items.map((item, index) => (
              <li class="item" key={item.kind === 'code' ? item.anchorId : item.sessionId}>
                {item.kind === 'code' ? (
                  <>
                    <span class="codicon codicon-symbol-file item-icon" />
                    <button class="link item-main" title="Reveal in editor" onClick={() => post({ type: 'revealAnchor', anchorId: item.anchorId })}>
                      <span class="item-title">
                        {basename(item.file)} <strong>{formatRange(item.startLine, item.endLine)}</strong>
                      </span>
                      <span class="item-sub">{item.file} · {item.language} · {item.text.split('\n').length} lines</span>
                    </button>
                  </>
                ) : (
                  <>
                    <span class="codicon codicon-comment-discussion item-icon" />
                    <button class="link item-main" title="Open explanation" onClick={() => post({ type: 'openSession', sessionId: item.sessionId })}>
                      <span class="item-title">{item.title}</span>
                      <span class="item-sub">previous explanation</span>
                    </button>
                  </>
                )}
                <div class="item-actions">
                  <button class="icon-button" title="Move up" disabled={index === 0} onClick={() => post({ type: 'moveItem', from: index, to: index - 1 })}>
                    <span class="codicon codicon-arrow-up" />
                  </button>
                  <button class="icon-button" title="Remove" onClick={() => post({ type: 'removeItem', index })}>
                    <span class="codicon codicon-close" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section class="section">
        <h2>
          <span class="codicon codicon-symbol-snippet" /> Template <span class="muted">· optional</span>
        </h2>
        <div class="row">
          <select
            class="select"
            value={draft.templateId ?? ''}
            onChange={(e) => post({ type: 'setTemplate', templateId: (e.target as HTMLSelectElement).value || null })}
          >
            <option value="">No template</option>
            {templates.map((t) => (
              <option value={t.id} key={t.id}>
                {t.name}
                {t.files.length ? ` (${t.files.length} file${t.files.length === 1 ? '' : 's'})` : ''}
              </option>
            ))}
          </select>
          {template && (
            <button class="icon-button" title="Edit template" onClick={() => post({ type: 'loadTemplateForEdit', templateId: template.id })}>
              <span class="codicon codicon-edit" />
            </button>
          )}
        </div>
        {template?.instruction && <div class="template-preview">{template.instruction}</div>}
      </section>

      <section class="section">
        <h2>
          <span class="codicon codicon-settings" /> Options
        </h2>
        <Field label="Explanation language">
          <select
            class="select"
            value={draft.explainLanguage}
            onChange={(e) => post({ type: 'setExplainLanguage', language: (e.target as HTMLSelectElement).value as ExplainLanguage })}
            title="Language the agent should write the explanation in"
          >
            {EXPLAIN_LANGUAGES.map((l) => (
              <option value={l.id} key={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </Field>
        <label
          class="check options-check"
          title="Stores the Excalidraw Diagram skill in .xplain/skills/ and exposes it to the selected agent (Cursor/Claude bridge when needed)"
        >
          <input
            type="checkbox"
            checked={draft.useExcalidraw}
            onChange={(e) => post({ type: 'setUseExcalidraw', enabled: (e.target as HTMLInputElement).checked })}
          />
          <span>
            Draw diagrams with the <strong>Excalidraw</strong> skill
            <span class="muted"> · stored in .xplain/skills/, adapted per agent</span>
          </span>
        </label>
        {draft.useExcalidraw && (
          <p class="small muted">
            On Send, XPlain copies{' '}
            <a href="https://github.com/coleam00/excalidraw-diagram-skill" onClick={(e) => { e.preventDefault(); post({ type: 'openExternal', url: 'https://github.com/coleam00/excalidraw-diagram-skill' }); }}>
              coleam00/excalidraw-diagram-skill
            </a>{' '}
            into the workspace and tells the agent to use it for diagrams.
          </p>
        )}
      </section>

      <section class="section grow">
        <h2>
          <span class="codicon codicon-question" /> Your question <span class="muted">· optional</span>
        </h2>
        <textarea
          class="question"
          placeholder="What do you want to know about this code? (Ctrl+Enter to send)"
          value={question}
          onInput={(e) => setQuestion((e.target as HTMLTextAreaElement).value)}
          onKeyDown={onKeyDown}
          rows={5}
        />
      </section>

      <footer class="send-bar">
        <div class="agent-label" title="Open the Agent tab to change provider, model or API key">
          <button class="link" onClick={onConfigureAgent}>
            <span class="codicon codicon-plug" /> {agentLabel || 'agent'}
          </button>
        </div>
        {busy.busy ? (
          <button class="button secondary" onClick={() => post({ type: 'cancel' })} title="Abort the request (also stops the agent)">
            <span class="codicon codicon-debug-stop" /> Stop request
          </button>
        ) : (
          <button class="button primary" disabled={!canSend} onClick={() => post({ type: 'send' })} title="Send the context to the agent (Ctrl+Enter)">
            <span class="codicon codicon-send" /> Send to agent
          </button>
        )}
      </footer>
    </div>
  );
}

export function basename(path: string): string {
  return path.split('/').pop() ?? path;
}

export function formatRange(start: number, end: number): string {
  return start === end ? `L${start}` : `L${start}-L${end}`;
}

function Field(props: { label: string; children: ComponentChildren }) {
  return (
    <label class="field">
      <span class="field-label">{props.label}</span>
      {props.children}
    </label>
  );
}
