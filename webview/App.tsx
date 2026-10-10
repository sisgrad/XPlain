import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { HostMessage, InitState, PanelTab } from '@shared/protocol';
import type {
  AgentModelsResult,
  AgentSettingsView,
  AgentTestResult,
  BackgroundState,
  BusyState,
  DraftState,
  ResultFormat,
  SessionMeta,
  TemplateFile,
  TemplateMeta,
} from '@shared/types';
import { DEFAULT_DRAFT } from '@shared/types';
import { AgentTab } from './components/AgentTab';
import { ContextTab } from './components/ContextTab';
import { HistoryTab } from './components/HistoryTab';
import { ResultTab } from './components/ResultTab';
import { TemplatesTab, type TemplateEditorState } from './components/TemplatesTab';
import { getPersisted, onHostMessage, persist, post } from './vscode';

export interface ResultView {
  session: SessionMeta;
  format: ResultFormat;
  content: string;
  htmlUri?: string;
}

interface StreamState {
  sessionId: string;
  title: string;
  text: string;
}

interface Notice {
  level: 'info' | 'warn' | 'error';
  message: string;
}

const EMPTY_BG: BackgroundState = { uri: null, opacity: 0.18, blur: 0, fit: 'cover', scope: null };
const EMPTY_EDITOR: TemplateEditorState = { id: null, name: '', instruction: '', files: [] };

export function App() {
  const persisted = useMemo(() => getPersisted<{ tab?: PanelTab; editor?: TemplateEditorState }>(), []);
  const [tab, setTab] = useState<PanelTab>(persisted?.tab ?? 'context');
  const [draft, setDraft] = useState<DraftState>(DEFAULT_DRAFT);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [templates, setTemplates] = useState<TemplateMeta[]>([]);
  const [pickMode, setPickMode] = useState(false);
  const [busy, setBusy] = useState<BusyState>({ busy: false });
  const [background, setBackground] = useState<BackgroundState>(EMPTY_BG);
  const [hasWorkspace, setHasWorkspace] = useState(true);
  const [agentLabel, setAgentLabel] = useState('');
  const [agentSettings, setAgentSettings] = useState<AgentSettingsView | null>(null);
  const [agentTest, setAgentTest] = useState<AgentTestResult | null>(null);
  const [agentTesting, setAgentTesting] = useState(false);
  const [agentModels, setAgentModels] = useState<AgentModelsResult | null>(null);
  const [result, setResult] = useState<ResultView | null>(null);
  const [stream, setStream] = useState<StreamState | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [editor, setEditor] = useState<TemplateEditorState>(persisted?.editor ?? EMPTY_EDITOR);
  const [dragOver, setDragOver] = useState(false);
  const noticeTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    persist({ tab, editor });
  }, [tab, editor]);

  const showNotice = useCallback((n: Notice) => {
    setNotice(n);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), n.level === 'error' ? 9000 : 4500);
  }, []);

  const appendTemplateFiles = useCallback((files: TemplateFile[]) => {
    if (files.length === 0) return;
    setEditor((e) => {
      const names = new Set(e.files.map((f) => f.name));
      const merged = [...e.files];
      for (const f of files) {
        if (names.has(f.name)) {
          const idx = merged.findIndex((x) => x.name === f.name);
          merged[idx] = f;
        } else {
          merged.push(f);
        }
      }
      return { ...e, files: merged };
    });
    setTab('templates');
  }, []);

  useEffect(() => {
    const off = onHostMessage((m: HostMessage) => {
      switch (m.type) {
        case 'init':
          applyInit(m.state);
          break;
        case 'draft':
          setDraft(m.draft);
          break;
        case 'sessions':
          setSessions(m.sessions);
          setResult((r) => {
            if (!r) return r;
            const s = m.sessions.find((x) => x.id === r.session.id);
            return s ? { ...r, session: s } : r;
          });
          break;
        case 'templates':
          setTemplates(m.templates);
          break;
        case 'pickMode':
          setPickMode(m.active);
          break;
        case 'busy':
          setBusy(m.busy);
          break;
        case 'background':
          setBackground(m.background);
          break;
        case 'agentLabel':
          setAgentLabel(m.label);
          break;
        case 'agentSettings':
          setAgentSettings(m.settings);
          break;
        case 'agentTest':
          setAgentTest(m.result);
          setAgentTesting(false);
          break;
        case 'agentModels':
          setAgentModels(m.result);
          break;
        case 'showResult':
          setStream(null);
          setResult({ session: m.session, format: m.format, content: m.content, htmlUri: m.htmlUri });
          break;
        case 'streamStart':
          setStream({ sessionId: m.sessionId, title: m.title, text: '' });
          break;
        case 'streamDelta':
          setStream((s) => (s && s.sessionId === m.sessionId ? { ...s, text: s.text + m.text } : s));
          break;
        case 'streamEnd':
          // Keep the streamed text until showResult replaces it (or an error notice arrives).
          break;
        case 'templateFiles':
          appendTemplateFiles(m.files);
          break;
        case 'editTemplate':
          setEditor({ id: m.template.id, name: m.template.name, instruction: m.template.instruction, files: m.files });
          setTab('templates');
          break;
        case 'tab':
          setTab(m.tab);
          break;
        case 'notice':
          showNotice({ level: m.level, message: m.message });
          if (m.level === 'error') setStream(null);
          break;
      }
    });
    post({ type: 'ready' });
    return off;

    function applyInit(s: InitState) {
      setDraft(s.draft);
      setSessions(s.sessions);
      setTemplates(s.templates);
      setPickMode(s.pickMode);
      setBusy(s.busy);
      setBackground(s.background);
      setHasWorkspace(s.hasWorkspace);
      setAgentLabel(s.agentLabel);
      setAgentSettings(s.agentSettings);
    }
  }, [appendTemplateFiles, showNotice]);

  // Shift+X anywhere in the panel (outside inputs) toggles pick mode.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (!inField && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === 'x') {
        e.preventDefault();
        post({ type: 'togglePickMode' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* --------------------------------------------------- drag & drop (panel) */

  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer) return;
    const types = Array.from(e.dataTransfer.types);
    if (types.includes('Files') || types.includes('text/uri-list')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setDragOver(true);
    }
  };

  const onDragLeave = (e: DragEvent) => {
    if ((e.target as HTMLElement).id === 'root' || !(e.relatedTarget as Node | null)) setDragOver(false);
  };

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dt = e.dataTransfer;
    if (!dt) return;
    const files = Array.from(dt.files ?? []);
    const images = files.filter((f) => f.type.startsWith('image/'));
    const others = files.filter((f) => !f.type.startsWith('image/'));

    // Images dropped anywhere become the panel background.
    if (images.length && others.length === 0 && tab !== 'templates') {
      const img = images[0];
      const dataBase64 = await readAsBase64(img);
      post({ type: 'dropBackground', name: img.name, dataBase64 });
      return;
    }
    // Everything else is attached to the template being edited.
    const textFiles: TemplateFile[] = [];
    for (const f of files) {
      if (f.size > 1024 * 1024) {
        showNotice({ level: 'warn', message: `Skipped ${f.name}: larger than 1 MB.` });
        continue;
      }
      textFiles.push({ name: f.name, content: await f.text() });
    }
    if (textFiles.length) appendTemplateFiles(textFiles);
    const uriList = dt.getData('text/uri-list');
    if (uriList) {
      const uris = uriList
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'));
      if (uris.length) post({ type: 'readUris', uris });
    }
  };

  /* --------------------------------------------------------------- render */

  const bgStyle = background.uri
    ? {
        backgroundImage: `url("${background.uri}")`,
        opacity: background.opacity,
        filter: background.blur ? `blur(${background.blur}px)` : undefined,
        backgroundSize: background.fit === 'tile' ? 'auto' : background.fit,
        backgroundRepeat: background.fit === 'tile' ? 'repeat' : 'no-repeat',
      }
    : undefined;

  const resultCount = sessions.filter((s) => s.status === 'done').length;

  return (
    <div class={`app ${dragOver ? 'drag-over' : ''}`} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      {bgStyle && <div class="background" style={bgStyle} />}
      <header class="tabs" role="tablist">
        <TabButton id="context" current={tab} onSelect={setTab} icon="list-selection" label="Context" badge={draft.items.length || undefined} />
        <TabButton id="result" current={tab} onSelect={setTab} icon="book" label="Result" />
        <TabButton id="templates" current={tab} onSelect={setTab} icon="symbol-snippet" label="Templates" />
        <TabButton id="history" current={tab} onSelect={setTab} icon="history" label="History" badge={resultCount || undefined} />
        <TabButton id="agent" current={tab} onSelect={setTab} icon="server-process" label="Agent" />
      </header>

      {pickMode && (
        <div class="banner pick" onClick={() => post({ type: 'togglePickMode' })} title="Click to turn off">
          <span class="codicon codicon-target" /> Pick mode: click an XPlain CodeLens in the editor to add one of its explanations to the context. Shift+X to cancel.
        </div>
      )}
      {!hasWorkspace && (
        <div class="banner warn">
          <span class="codicon codicon-warning" /> Open a folder to enable XPlain storage (.xplain/).
        </div>
      )}
      {notice && (
        <div class={`banner ${notice.level}`} onClick={() => setNotice(null)}>
          <span class={`codicon codicon-${notice.level === 'error' ? 'error' : notice.level === 'warn' ? 'warning' : 'info'}`} /> {notice.message}
        </div>
      )}

      <main class="content">
        {tab === 'context' && (
          <ContextTab draft={draft} templates={templates} busy={busy} agentLabel={agentLabel} pickMode={pickMode} onConfigureAgent={() => setTab('agent')} />
        )}
        {tab === 'result' && <ResultTab result={result} stream={stream} busy={busy} />}
        {tab === 'templates' && (
          <TemplatesTab templates={templates} editor={editor} setEditor={setEditor} activeTemplateId={draft.templateId} />
        )}
        {tab === 'history' && <HistoryTab sessions={sessions} current={result?.session.id} />}
        {tab === 'agent' && (
          <AgentTab settings={agentSettings} test={agentTest} testing={agentTesting} onTestStart={() => setAgentTesting(true)} models={agentModels} />
        )}
      </main>

      {dragOver && (
        <div class="drop-overlay">
          <span class="codicon codicon-cloud-upload" />
          <div>{tab === 'templates' ? 'Drop files to attach them to the template' : 'Drop an image for the background, or files for a template'}</div>
        </div>
      )}
    </div>
  );
}

function TabButton(props: {
  id: PanelTab;
  current: PanelTab;
  onSelect: (t: PanelTab) => void;
  icon: string;
  label: string;
  badge?: number;
}) {
  const active = props.id === props.current;
  return (
    <button class={`tab ${active ? 'active' : ''}`} role="tab" aria-selected={active} onClick={() => props.onSelect(props.id)} title={props.label}>
      <span class={`codicon codicon-${props.icon}`} />
      <span class="tab-label">{props.label}</span>
      {props.badge !== undefined && <span class="badge">{props.badge}</span>}
    </button>
  );
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
