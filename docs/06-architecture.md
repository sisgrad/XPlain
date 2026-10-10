# Архитектура

## Обзор

```mermaid
flowchart LR
  Editor[TextEditor] -->|Shift+X| AddCmd[xplain.addSelectionToContext]
  AddCmd --> Store[(XplainStore .xplain)]
  AddCmd --> Draft[ContextDraft]
  Draft <-->|HostMessage / ViewMessage| Panel[XplainViewProvider WebviewView]
  Panel -->|send| Controller[XplainController]
  Controller --> Agent[AgentProvider http or mock]
  Agent -->|delta / done| Controller
  Controller --> Store
  Store --> Live[LiveAnchors]
  Live --> Lens[XplainCodeLensProvider]
  Live --> Deco[AnchorDecorations]
  Lens -->|click| QP[QuickPick results]
  QP -->|open| Controller
  QP -->|pick mode| Draft
  Pick[PickMode status bar] -.-> QP
```

Расширение состоит из двух процессов:

- **Extension host** (`src/`, Node.js, бандл `dist/extension.js`) — вся логика, доступ к файлам и API VS Code.
- **Webview** (`webview/`, браузер, бандл `dist/webview.js`) — UI панели на Preact. Не имеет доступа ни к
  файлам, ни к API VS Code; общается с хостом только сообщениями.

## Модули extension host

| Модуль | Ответственность |
| --- | --- |
| `extension.ts` | Активация: создание `XplainStore` для первого workspace-фолдера, регистрация view/CodeLens/декораций, watcher `.xplain`, сборка `XplainController` |
| `XplainController.ts` | Оркестрация: команды, обработка `ViewMessage`, добавление выделения, отправка агенту, открытие результатов, QuickPick, шаблоны, фон |
| `context/ContextDraft.ts` | Состояние неотправленного контекста (items, question, templateId), дедупликация, события изменений |
| `storage/XplainStore.ts` | Персистентность `.xplain/`: индекс, якоря (`upsertAnchor`), сессии, результаты, шаблоны, фон. Работает поверх абстракции `StoreFs` |
| `storage/fs.ts`, `storage/vscodeFs.ts` | `StoreFs` (relative POSIX-пути): `NodeStoreFs` для тестов, `VscodeStoreFs` поверх `workspace.fs` (работает и при Remote) |
| `editor/anchors.ts` | Чистые функции: нормализация/хеш блока, `toLineChange`, `applyLineChange(s)`, `findSnippet`, `rangeMatchesHash` |
| `editor/LiveAnchors.ts` | Актуальные диапазоны якорей для открытых документов: применяет `onDidChangeTextDocument`, валидирует по хешу, переищет по snippet, отложенно сохраняет в store |
| `editor/XplainCodeLensProvider.ts` | CodeLens над каждым нестареющим якорем с ≥ 1 готовой сессией |
| `editor/decorations.ts` | Gutter-иконка, подсветка, hover с command-ссылками; подсветка блоков текущего контекста |
| `editor/pickMode.ts` | Флаг pick mode, status bar item, контекстный ключ `xplain.pickMode`, автовыключение |
| `agent/AgentProvider.ts` | Интерфейс `AgentProvider`, типы `AgentRequest/AgentItem/AgentResponse`, `AgentError` |
| `agent/HttpAgentProvider.ts` | `fetch` к endpoint, JSON / NDJSON / SSE, таймаут, отмена, заголовки, Bearer-ключ |
| `agent/MockAgentProvider.ts` | Офлайн-ответ со стримингом для демо и smoke-тестов |
| `agent/titles.ts` | `deriveTitle`: агент → заголовок md/html → вопрос → файл+диапазон; обрезка до 72 символов |
| `panel/XplainViewProvider.ts` | `WebviewViewProvider`: HTML-оболочка, CSP с nonce, `localResourceRoots`, очередь сообщений до resolve |
| `panel/background.ts` | Выбор/сохранение/очистка фона (user scope в `globalStorageUri`, workspace scope в `.xplain/ui/`), состояние для webview |
| `shared/types.ts`, `shared/protocol.ts` | Общие типы данных и протокол сообщений (используются и хостом, и webview через алиас `@shared/*`) |
| `util/emitter.ts`, `util/ids.ts` | Мини-эмиттер без зависимости от `vscode`, генерация id, sha1 |

Зависимости направлены «внутрь»: `storage`, `context`, `agent`, `editor/anchors`, `shared`, `util` не
импортируют `vscode` (кроме `vscodeFs`) и покрываются unit-тестами в Node. Всё, что трогает VS Code,
сосредоточено в `extension.ts`, `XplainController.ts`, `editor/*` (кроме `anchors.ts`) и `panel/*`.

## Webview

```
webview/
  main.tsx            точка входа, render(<App/>)
  App.tsx             состояние панели, приём HostMessage, вкладки, drag-and-drop, Shift+X, фон
  vscode.ts           обёртка acquireVsCodeApi: post(), onHostMessage(), persist()/getPersisted()
  markdown.ts         markdown-it (html:false, linkify) + highlight.js (common + cuda/cpp)
  components/
    ContextTab.tsx    список элементов, шаблон, вопрос (debounce 250 мс), Send/Cancel
    ResultTab.tsx     рендер Markdown / iframe для HTML / потоковый вывод / переименование
    TemplatesTab.tsx  редактор шаблона (имя, инструкция, файлы, drop-zone), список шаблонов
    HistoryTab.tsx    список сессий с фильтром
  styles.css          стили на CSS-переменных темы VS Code
```

Состояние UI (активная вкладка, черновик редактируемого шаблона) сохраняется через `setState` webview и
переживает скрытие панели; `retainContextWhenHidden: true` сохраняет и DOM (важно для стриминга).

## Протокол extension ↔ webview

Определён в `src/shared/protocol.ts` как discriminated unions.

**Host → Webview (`HostMessage`)**: `init` (полное состояние), `draft`, `sessions`, `templates`, `pickMode`,
`busy`, `background`, `agentLabel`, `showResult`, `streamStart` / `streamDelta` / `streamEnd`,
`templateFiles`, `editTemplate`, `tab`, `notice`.

**Webview → Host (`ViewMessage`)**: `ready`, `setQuestion`, `setTemplate`, `removeItem`, `moveItem`,
`clearDraft`, `send`, `cancel`, `openSession`, `openSessionInEditor`, `addSessionToDraft`, `deleteSession`,
`renameSession`, `revealAnchor`, `togglePickMode`, `saveTemplate`, `deleteTemplate`, `loadTemplateForEdit`,
`pickTemplateFiles`, `readUris`, `chooseBackground`, `clearBackground`, `dropBackground`, `openSettings`,
`openExternal`, `log`.

Принцип: источник истины — хост. Webview отправляет намерение, хост меняет состояние и рассылает
обновление (`draft`, `sessions`, …). Исключение — локальный текст вопроса (debounce) и черновик шаблона.

## Ключевые потоки

### Shift+X → контекст

1. Keybinding `shift+x` (`editorTextFocus && editorHasSelection`) → `xplain.addSelectionToContext`.
2. Для каждого выделения: расширение до целых строк → `store.upsertAnchor` (поиск/создание якоря) →
   `draft.add({kind:'code', …})`.
3. `draft.onDidChange` → `view.post({type:'draft'})`; декорации подсвечивают блок; панель открывается с
   `preserveFocus`.

### Отправка

1. `send` → проверка, что нет активного запроса → `store.createSession` (status `pending`, предварительный заголовок).
2. Формирование `AgentItem[]`: для блоков берётся свежий текст из открытого документа по текущему диапазону якоря;
   для результатов — содержимое `result.*`; для шаблона — инструкция + файлы.
3. `provider.explain(request, {signal, onDelta})` под `window.withProgress`; дельты транслируются в webview.
4. Успех → `deriveTitle` → `store.completeSession` → `draft.clear()` → `openResult`.
   Отмена → `deleteSession`. Ошибка → `failSession`, контекст сохраняется.

### Результаты в редакторе

1. `LiveAnchors.forDocument(doc)` строит актуальные диапазоны (валидация по хешу / поиск по snippet).
2. `XplainCodeLensProvider` создаёт CodeLens с командой `xplain.showResults(anchorId)` для якорей с готовыми сессиями.
3. `showResultsForAnchor` → `createQuickPick` с кнопками (`QuickInputButton`). В pick mode выбор добавляет
   результат в draft и выключает режим; иначе открывает результат в панели.
4. HTML-результат отдаётся в webview как `asWebviewUri` файла в `.xplain/` и рендерится в `iframe sandbox`;
   `.xplain/` входит в `localResourceRoots`, CSP содержит `frame-src ${cspSource}`.

## Используемые API VS Code (все стабильные)

`contributes.viewsContainers/views/commands/menus/keybindings/configuration`, `WebviewViewProvider`,
`Webview.asWebviewUri/cspSource/postMessage`, `languages.registerCodeLensProvider`,
`window.createTextEditorDecorationType`, `MarkdownString.isTrusted` + `command:`-ссылки,
`window.createQuickPick` + `QuickInputButton`, `window.createStatusBarItem`, `workspace.fs`,
`workspace.createFileSystemWatcher`, `workspace.onDidChangeTextDocument`, `ExtensionContext.secrets`,
`globalState`, `globalStorageUri`, `window.withProgress`, `commands.executeCommand('setContext')`,
контекстные ключи `editorTextFocus`, `editorHasSelection`, `inputFocus`, `focusedView`.

Proposed API не используются. Нижняя граница совместимости — `engines.vscode ^1.85`.

## Безопасность

- CSP webview: `default-src 'none'`, скрипты только с nonce, стили/шрифты/картинки из `cspSource`
  (+ `https:`/`data:` для картинок), фреймы только из `cspSource`.
- Markdown агента рендерится без raw HTML; HTML агента — только в sandboxed iframe.
- Файлы шаблонов: ограничение 1 МБ, бинарные отбрасываются, имена санитизируются.
- Ключ API — только в `SecretStorage`.
