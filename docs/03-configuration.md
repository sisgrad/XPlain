# Настройки, команды, горячие клавиши

## Настройки (`settings.json`)

### Агент

Все эти настройки редактируются во вкладке **Agent** панели (см. [руководство](02-user-guide.md#вкладка-agent));
править `settings.json` вручную не обязательно.

| Ключ | Тип / значения | По умолчанию | Описание |
| --- | --- | --- | --- |
| `xplain.agent.provider` | `xplain` \| `hermes` \| `openai` \| `anthropic` \| `openaiSubscription` \| `anthropicSubscription` \| `cursor` \| `mock` | `xplain` | Кто отвечает. В UI вкладки Agent — hermes / anthropic(Sub) / openai(Sub) / cursor; `xplain` и `mock` задаются здесь. Устаревшее `http` → `xplain` |
| `xplain.agent.endpoint` | string (URL) | `http://127.0.0.1:8765/explain` | [xplain] Адрес, на который отправляется `POST` с контекстом |
| `xplain.agent.hermes.baseUrl` | string (URL) | `http://127.0.0.1:8642/v1` | [hermes] Base URL API-сервера Hermes (с `/v1`) |
| `xplain.agent.hermes.model` | string | `hermes-agent` | [hermes] Модель/профиль |
| `xplain.agent.openai.baseUrl` | string (URL) | `https://api.openai.com/v1` | [openai] Base URL OpenAI-совместимого API |
| `xplain.agent.openai.model` | string | `chat-latest` | [openai] Id модели (включая Codex-модели) |
| `xplain.agent.anthropic.baseUrl` | string (URL) | `https://api.anthropic.com` | [anthropic] Base URL |
| `xplain.agent.anthropic.model` | string | `claude-sonnet-5` | [anthropic] Id модели Claude |
| `xplain.agent.anthropic.maxTokens` | number ≥ 256 | `8192` | [anthropic] `max_tokens` ответа |
| `xplain.agent.openai.effort` | string | `""` | [openai] `reasoning_effort` (`none`/`minimal`/`low`/`medium`/`high`/`xhigh`, зависит от модели); пусто — по умолчанию |
| `xplain.agent.anthropic.effort` | string | `""` | [anthropic] `output_config.effort` (`low`/`medium`/`high`/`xhigh`/`max`); пусто — по умолчанию модели |
| `xplain.agent.openaiSubscription.effort` / `xplain.agent.anthropicSubscription.effort` | string | `""` | [subscription] Подсказка `--effort` для Claudexor; подрезается до уровней, объявленных моделью |
| `xplain.agent.cursor.effort` | string | `""` | [cursor] Уровень effort/thinking, сопоставляемый с параметром модели из `Cursor.models.list()`; у модели без такого параметра игнорируется |
| `xplain.agent.anthropicSubscription.model` | string | `""` | [anthropicSubscription] Модель для Claude Code (пусто — по умолчанию у harness'а). Подписка Claude Pro/Max через Claudexor, без ключа |
| `xplain.agent.openaiSubscription.model` | string | `""` | [openaiSubscription] Модель для Codex CLI (пусто — по умолчанию). Подписка ChatGPT через Claudexor, без ключа |
| `xplain.agent.claudexor.cliPath` | string (path) | `""` | Путь к `claudexor` (bin/claudexor.js или глобальный бинарник); пусто — копия, поставляемая с XPlain |
| `xplain.agent.claudexor.nodePath` | string (path) | `""` | Node.js ≥ 24.15 для запуска Claudexor; пусто — автопоиск (управляемый runtime в global storage, runtime extension host, `PATH`, nvm, `/usr/local/bin`) |
| `xplain.agent.claudexor.autoInstallNode` | boolean | `true` | Если подходящего Node нет — скачать официальную сборку с nodejs.org (проверка SHA-256) в `<globalStorage>/node-runtime/`; без sudo и `PATH` |
| `xplain.agent.claudexor.nodeVersion` | string | `""` | Какую версию скачивать (например `24.21.0`); пусто — значение по умолчанию расширения |
| `xplain.agent.claudexor.mode` | `auto` \| `ask` \| `agent` | `auto` | `auto` — read-only `ask`, а при включённом Excalidraw — write-capable `agent` (нужен для рендера PNG); `ask` / `agent` — всегда соответствующий маршрут |
| `xplain.agent.claudexor.project` | `auto` \| `workspace` \| `private` | `auto` | Где работает `agent`: `auto` — workspace, если это git-репозиторий, иначе приватная папка в global storage (диаграммы переносятся в `.xplain/diagrams/`); `workspace` — всегда проект (**внимание**: не-git папку Claudexor инициализирует как git); `private` — всегда приватная папка |
| `xplain.agent.systemPrompt` | string (многострочная) | `""` | [hermes/openai/anthropic/cursor] Свой системный промпт; пусто — встроенный промпт XPlain |
| `xplain.agent.cursor.model` | string | `composer-2.5` | [cursor] Id модели Cursor Agent SDK |
| `xplain.agent.cursor.useSandbox` | boolean | `false` | [cursor] Landlock sandbox; на Remote-SSH обычно выключен (изоляция через `.cursorignore` + промпт) |
| `xplain.agent.timeoutMinutes` | number 1…180 | `10` | Idle-таймаут в **минутах**: ожидание заголовков, затем тишина между чанками тела. Любые байты (keepalive, tool-progress, delta) сбрасывают таймер. Прежнее `timeoutMs` при чтении мигрирует (округление вверх до минут) |
| `xplain.agent.streaming` | boolean | `true` | Показывать ответ по мере поступления (NDJSON для `xplain`, SSE для остальных) |
| `xplain.agent.headers` | object (string → string) | `{}` | Дополнительные HTTP-заголовки для любого провайдера. Ключи API сюда не кладите — см. «Секреты» |

### Редактор

| Ключ | По умолчанию | Описание |
| --- | --- | --- |
| `xplain.editor.showCodeLens` | `true` | CodeLens «XPlain: …» над блоками с объяснениями |
| `xplain.editor.highlightBlocks` | `true` | Иконка в gutter, подсветка и hover у блоков с объяснениями (подсветка блоков в текущем контексте остаётся всегда) |
| `xplain.editor.hideOutdated` | `false` | Не показывать CodeLens для объяснений, чей код сильно изменился (outdated/lost). Сессии не удаляются |

### Drift (изменение кода после объяснения)

| Ключ | По умолчанию | Описание |
| --- | --- | --- |
| `xplain.drift.outdatedRatio` | `0.3` | Доля изменённых строк блока, выше которой объяснение считается *outdated*, а не *code changed*. Правки только комментариев/пробелов не учитываются |
| `xplain.drift.driftedMaxLines` | `10` | Абсолютное число изменённых строк, выше которого блок *outdated* независимо от доли |
| `xplain.refresh.mode` | `overwrite` | Что делает **Refresh**: `overwrite` — перезаписать ту же сессию (как Extend); `newSession` — создать новое объяснение на тех же блоках |

Пример:

```jsonc
{
  "xplain.agent.provider": "hermes",
  "xplain.agent.hermes.baseUrl": "http://127.0.0.1:8642/v1",
  "xplain.agent.hermes.model": "hermes-agent",
  "xplain.agent.timeoutMinutes": 15,
  "xplain.agent.headers": { "X-Team": "kernels" }
}
```

Настройки читаются при каждом запросе — перезагрузка окна не нужна. Workspace-настройки
(`.vscode/settings.json`) удобно использовать для провайдера/адреса конкретного проекта; во вкладке
Agent это переключатель **Save to: This workspace**. При сохранении в пользовательские настройки из
вкладки Agent workspace-переопределения `xplain.agent.*` удаляются.

### Секреты

Ключи API хранятся в `SecretStorage` (не в settings), отдельно для каждого провайдера
(`xplain.agent.apiKey.<provider>`), и отправляются как `Authorization: Bearer <key>` (Hermes, OpenAI,
XPlain) или `x-api-key` (Anthropic). Ключ, сохранённый в версии 0.1 (`xplain.agent.apiKey`), продолжает
использоваться провайдером `xplain`.

- Вкладка **Agent** → поле *API key* → **Save key** / **Clear**.
- **XPlain: Set Agent API Key** — выбрать провайдера, ввести/заменить ключ (пустая строка — удалить).
- **XPlain: Clear Agent API Key** — выбрать провайдера, удалить ключ.

## Команды (Command Palette, категория **XPlain**)

| Команда | ID | Описание |
| --- | --- | --- |
| Add Selection to Context | `xplain.addSelectionToContext` | Добавить выделение (или все выделения) в контекст. Также в контекстном меню редактора |
| Toggle Pick Mode | `xplain.togglePickMode` | Включить/выключить режим выбора результата для добавления в контекст. Кнопка-мишень в заголовке панели |
| Open XPlain Panel | `xplain.focus` | Открыть панель |
| Clear Context | `xplain.clearContext` | Очистить контекст |
| Stop Agent Request | `xplain.cancelRequest` | Прервать текущий запрос к агенту. Иконка в заголовке панели (когда `xplain.busy`), баннер **Stop**, Cancel в прогрессе окна |
| Configure Agent (Provider, Model, API Key) | `xplain.configureAgent` | Открыть вкладку **Agent** панели. Есть в меню «…» заголовка панели |
| Set Agent API Key / Clear Agent API Key | `xplain.setAgentApiKey` / `xplain.clearAgentApiKey` | Управление ключом выбранного провайдера (API-провайдеры) |
| Set Up Subscription Harness… | `xplain.setupSubscription` | Терминал с `claudexor harness install` / `auth login` / `doctor` / `quota` для Claude Code или Codex CLI; пункт `node` — скачать/проверить управляемый Node.js runtime |
| Reveal .xplain Folder | `xplain.openStorageFolder` | Показать `.xplain/index.json` в Explorer |

Служебные команды (скрыты из палитры, вызываются из CodeLens/hover/webview):
`xplain.showResults` (anchorId), `xplain.openResult` (sessionId), `xplain.openResultInEditor` (sessionId),
`xplain.addResultToContext` (sessionId), `xplain.showCodeDiff` (sessionId — diff «explained ↔ current»),
`xplain.refreshExplanation` (sessionId — переобъяснить под текущий код).

## Горячие клавиши

| Клавиши | `when` | Команда |
| --- | --- | --- |
| `shift+x` | `editorTextFocus && editorHasSelection` | `xplain.addSelectionToContext` |
| `shift+x` | `!editorTextFocus && !inputFocus && !terminalFocus && !findInputFocussed && !inQuickOpen && focusedView != xplain.panel` | `xplain.togglePickMode` |

Внутри панели XPlain Shift+X обрабатывается самим webview (вне полей ввода), поэтому ввод заглавной
«X» в поле вопроса или инструкции работает нормально.

Переназначение — Keyboard Shortcuts (`Ctrl+K Ctrl+S`), поиск `xplain`. Пример `keybindings.json`:

```jsonc
[
  { "key": "ctrl+alt+x", "command": "xplain.addSelectionToContext", "when": "editorTextFocus && editorHasSelection" },
  { "key": "shift+x", "command": "-xplain.addSelectionToContext" }
]
```

## Контекстные ключи (`when`)

| Ключ | Значение |
| --- | --- |
| `xplain.pickMode` | `true`, пока включён pick mode (можно использовать в своих keybindings/menus) |
| `xplain.busy` | `true`, пока идёт запрос к агенту (показывает кнопку Stop в заголовке панели) |
