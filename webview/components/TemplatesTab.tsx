import type { TemplateFile, TemplateMeta } from '@shared/types';
import { post } from '../vscode';

export interface TemplateEditorState {
  id: string | null;
  name: string;
  instruction: string;
  files: TemplateFile[];
}

interface Props {
  templates: TemplateMeta[];
  editor: TemplateEditorState;
  setEditor: (update: (e: TemplateEditorState) => TemplateEditorState) => void;
  activeTemplateId: string | null;
}

export function TemplatesTab({ templates, editor, setEditor, activeTemplateId }: Props) {
  const canSave = editor.name.trim().length > 0 && (editor.instruction.trim().length > 0 || editor.files.length > 0);
  const dirtyExisting = editor.id !== null;

  const save = () => {
    if (!canSave) return;
    post({ type: 'saveTemplate', id: editor.id, name: editor.name.trim(), instruction: editor.instruction, files: editor.files });
    setEditor(() => ({ id: null, name: '', instruction: '', files: [] }));
  };

  return (
    <div class="templates-tab">
      <section class="section">
        <div class="section-header">
          <h2>
            <span class="codicon codicon-symbol-snippet" /> {dirtyExisting ? 'Edit template' : 'New template'}
          </h2>
          {(editor.name || editor.instruction || editor.files.length > 0) && (
            <button class="icon-button" title="Discard" onClick={() => setEditor(() => ({ id: null, name: '', instruction: '', files: [] }))}>
              <span class="codicon codicon-discard" />
            </button>
          )}
        </div>
        <input
          class="input"
          placeholder="Template name, e.g. “CUDA kernel review”"
          value={editor.name}
          onInput={(e) => setEditor((s) => ({ ...s, name: (e.target as HTMLInputElement).value }))}
        />
        <textarea
          class="instruction"
          rows={5}
          placeholder="Instruction for the agent, e.g. “Explain memory access patterns and bank conflicts. Reference the attached architecture notes.”"
          value={editor.instruction}
          onInput={(e) => setEditor((s) => ({ ...s, instruction: (e.target as HTMLTextAreaElement).value }))}
        />
        <div class="dropzone" onClick={() => post({ type: 'pickTemplateFiles' })} title="Click to pick files, or drag files here">
          <span class="codicon codicon-cloud-upload" />
          <div>
            Drop files here (from Explorer or your computer) or <span class="link-text">browse…</span>
          </div>
          <div class="muted small">Text files up to 1 MB each are stored inside .xplain/templates/</div>
        </div>
        {editor.files.length > 0 && (
          <ul class="files">
            {editor.files.map((f) => (
              <li key={f.name}>
                <span class="codicon codicon-file" />
                <span class="file-name" title={f.name}>
                  {f.name}
                </span>
                <span class="muted small">{formatSize(f.content.length)}</span>
                <button class="icon-button" title="Remove" onClick={() => setEditor((s) => ({ ...s, files: s.files.filter((x) => x.name !== f.name) }))}>
                  <span class="codicon codicon-close" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div class="row end">
          <button class="button primary" disabled={!canSave} onClick={save}>
            <span class="codicon codicon-save" /> {dirtyExisting ? 'Save changes' : 'Save template'}
          </button>
        </div>
      </section>

      <section class="section grow">
        <h2>
          <span class="codicon codicon-library" /> Saved templates <span class="muted">· {templates.length}</span>
        </h2>
        {templates.length === 0 ? (
          <div class="hint">Templates bundle an instruction and reference files. Select one in the Context tab before sending.</div>
        ) : (
          <ul class="items">
            {templates.map((t) => (
              <li class={`item ${t.id === activeTemplateId ? 'current' : ''}`} key={t.id}>
                <span class="codicon codicon-symbol-snippet item-icon" />
                <button class="link item-main" title="Use in context" onClick={() => post({ type: 'setTemplate', templateId: t.id === activeTemplateId ? null : t.id })}>
                  <span class="item-title">
                    {t.name}
                    {t.id === activeTemplateId && <span class="chip">selected</span>}
                  </span>
                  <span class="item-sub">
                    {t.files.length} file{t.files.length === 1 ? '' : 's'} · {truncate(t.instruction, 90) || 'no instruction'}
                  </span>
                </button>
                <div class="item-actions">
                  <button class="icon-button" title="Edit" onClick={() => post({ type: 'loadTemplateForEdit', templateId: t.id })}>
                    <span class="codicon codicon-edit" />
                  </button>
                  <button class="icon-button" title="Delete" onClick={() => post({ type: 'deleteTemplate', templateId: t.id })}>
                    <span class="codicon codicon-trash" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function truncate(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
