import type { TemplateFile, TemplateMeta, WritableTemplateScope } from '@shared/types';
import { post } from '../vscode';

export interface TemplateEditorState {
  id: string | null;
  name: string;
  instruction: string;
  files: TemplateFile[];
  /** Where a new template will be saved (or the scope of the template being edited). */
  scope: WritableTemplateScope;
}

interface Props {
  templates: TemplateMeta[];
  editor: TemplateEditorState;
  setEditor: (update: (e: TemplateEditorState) => TemplateEditorState) => void;
  activeTemplateId: string | null;
  hasWorkspace: boolean;
}

const SCOPE_LABEL: Record<TemplateMeta['scope'], string> = {
  builtin: 'built-in',
  user: 'user',
  project: 'project',
};

export function TemplatesTab({ templates, editor, setEditor, activeTemplateId, hasWorkspace }: Props) {
  const canSave = editor.name.trim().length > 0 && (editor.instruction.trim().length > 0 || editor.files.length > 0);
  const dirtyExisting = editor.id !== null;
  const saveScope: WritableTemplateScope =
    dirtyExisting ? editor.scope : editor.scope === 'project' && !hasWorkspace ? 'user' : editor.scope;

  const save = () => {
    if (!canSave) return;
    if (saveScope === 'project' && !hasWorkspace) return;
    post({
      type: 'saveTemplate',
      id: editor.id,
      name: editor.name.trim(),
      instruction: editor.instruction,
      files: editor.files,
      scope: saveScope,
    });
    setEditor(() => ({ id: null, name: '', instruction: '', files: [], scope: hasWorkspace ? 'project' : 'user' }));
  };

  const builtin = templates.filter((t) => t.scope === 'builtin');
  const user = templates.filter((t) => t.scope === 'user');
  const project = templates.filter((t) => t.scope === 'project');

  return (
    <div class="templates-tab">
      <section class="section">
        <div class="section-header">
          <h2>
            <span class="codicon codicon-symbol-snippet" /> {dirtyExisting ? 'Edit template' : 'New template'}
          </h2>
          {(editor.name || editor.instruction || editor.files.length > 0) && (
            <button
              class="icon-button"
              title="Discard"
              onClick={() => setEditor(() => ({ id: null, name: '', instruction: '', files: [], scope: hasWorkspace ? 'project' : 'user' }))}
            >
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
        {!dirtyExisting && (
          <div class="template-scope">
            <span class="muted small">Save to</span>
            <label class={`scope-option ${saveScope === 'project' ? 'active' : ''} ${!hasWorkspace ? 'disabled' : ''}`}>
              <input
                type="radio"
                name="template-scope"
                checked={saveScope === 'project'}
                disabled={!hasWorkspace}
                onChange={() => setEditor((s) => ({ ...s, scope: 'project' }))}
              />
              <span class="codicon codicon-folder" /> Project
              <span class="muted small">.xplain/templates/</span>
            </label>
            <label class={`scope-option ${saveScope === 'user' ? 'active' : ''}`}>
              <input
                type="radio"
                name="template-scope"
                checked={saveScope === 'user'}
                onChange={() => setEditor((s) => ({ ...s, scope: 'user' }))}
              />
              <span class="codicon codicon-account" /> User
              <span class="muted small">all projects</span>
            </label>
          </div>
        )}
        {dirtyExisting && (
          <div class="muted small">
            Editing {SCOPE_LABEL[editor.scope]} template
            {editor.scope === 'project' ? ' (.xplain/templates/)' : ' (user library)'}
          </div>
        )}
        <div class="dropzone" onClick={() => post({ type: 'pickTemplateFiles' })} title="Click to pick files, or drag files here">
          <span class="codicon codicon-cloud-upload" />
          <div>
            Drop files here (from Explorer or your computer) or <span class="link-text">browse…</span>
          </div>
          <div class="muted small">
            Text files up to 1 MB each · stored with the template (
            {saveScope === 'project' ? 'project' : 'user'} scope)
          </div>
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
          <button class="button primary" disabled={!canSave || (saveScope === 'project' && !hasWorkspace)} onClick={save}>
            <span class="codicon codicon-save" /> {dirtyExisting ? 'Save changes' : 'Save template'}
          </button>
        </div>
      </section>

      <TemplateGroup
        title="Built-in"
        icon="package"
        hint="Shipped with the extension (read-only). Duplicate to customize."
        templates={builtin}
        activeTemplateId={activeTemplateId}
        hasWorkspace={hasWorkspace}
        readOnly
      />
      <TemplateGroup
        title="User"
        icon="account"
        hint="Saved for you across all projects."
        templates={user}
        activeTemplateId={activeTemplateId}
        hasWorkspace={hasWorkspace}
      />
      <TemplateGroup
        title="Project"
        icon="folder"
        hint={hasWorkspace ? 'Stored in .xplain/templates/ for this workspace.' : 'Open a folder to use project templates.'}
        templates={project}
        activeTemplateId={activeTemplateId}
        hasWorkspace={hasWorkspace}
      />
    </div>
  );
}

function TemplateGroup({
  title,
  icon,
  hint,
  templates,
  activeTemplateId,
  hasWorkspace,
  readOnly,
}: {
  title: string;
  icon: string;
  hint: string;
  templates: TemplateMeta[];
  activeTemplateId: string | null;
  hasWorkspace: boolean;
  readOnly?: boolean;
}) {
  return (
    <section class="section">
      <h2>
        <span class={`codicon codicon-${icon}`} /> {title}{' '}
        <span class="muted">· {templates.length}</span>
      </h2>
      <div class="muted small" style={{ marginBottom: '8px' }}>
        {hint}
      </div>
      {templates.length === 0 ? (
        <div class="hint">{readOnly ? 'No built-in templates found.' : 'None yet.'}</div>
      ) : (
        <ul class="items">
          {templates.map((t) => (
            <li class={`item ${t.id === activeTemplateId ? 'current' : ''}`} key={t.id}>
              <span class="codicon codicon-symbol-snippet item-icon" />
              <button
                class="link item-main"
                title="Use in context"
                onClick={() => post({ type: 'setTemplate', templateId: t.id === activeTemplateId ? null : t.id })}
              >
                <span class="item-title">
                  {t.name}
                  <span class={`chip scope-${t.scope}`}>{SCOPE_LABEL[t.scope]}</span>
                  {t.id === activeTemplateId && <span class="chip">selected</span>}
                </span>
                <span class="item-sub">
                  {t.files.length} file{t.files.length === 1 ? '' : 's'} · {truncate(t.instruction, 90) || 'no instruction'}
                </span>
              </button>
              <div class="item-actions">
                {readOnly ? (
                  <>
                    <button
                      class="icon-button"
                      title="Duplicate to user library"
                      onClick={() => post({ type: 'duplicateTemplate', templateId: t.id, scope: 'user' })}
                    >
                      <span class="codicon codicon-copy" />
                    </button>
                    {hasWorkspace && (
                      <button
                        class="icon-button"
                        title="Duplicate to this project"
                        onClick={() => post({ type: 'duplicateTemplate', templateId: t.id, scope: 'project' })}
                      >
                        <span class="codicon codicon-folder" />
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <button class="icon-button" title="Edit" onClick={() => post({ type: 'loadTemplateForEdit', templateId: t.id })}>
                      <span class="codicon codicon-edit" />
                    </button>
                    <button class="icon-button" title="Delete" onClick={() => post({ type: 'deleteTemplate', templateId: t.id })}>
                      <span class="codicon codicon-trash" />
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
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
