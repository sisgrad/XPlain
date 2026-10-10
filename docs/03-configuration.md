# Настройки, команды, горячие клавиши

## Настройки (`settings.json`)

### Агент

Все эти настройки редактируются во вкладке **Agent** панели (см. [руководство](02-user-guide.md#вкладка-agent));
править `settings.json` вручную не обязательно.

| Ключ | Тип / значения | По умолчанию | Описание |
| --- | --- | --- | --- |
| `xplain.agent.provider` | `xplain` \| `hermes` \| `openai` \| `anthropic` \| `mock` | `xplain` | Кто отвечает на запросы. Устаревшее значение `http` читается как `xplain` |
| `xplain.agent.endpoint` | string (URL) | `http://127.0.0.1:8765/explain` | [xplain] Адрес, на который отправляется `POST` с контекстом |
| `xplain.agent.hermes.baseUrl` | string (URL) | `http://127.0.0.1:8642/v1` | [hermes] Base URL API-сервера Hermes (с `/v1`) |
| `xplain.agent.hermes.model` | string | `hermes-agent` | [hermes] Модель/профиль |
| `xplain.agent.openai.baseUrl` | string (URL) | `https://api.openai.com/v1` | [openai] Base URL OpenAI-совместимого API |
| `xplain.agent.openai.model` | string | `chat-latest` | [openai] Id модели (включая Codex-модели) |
| `xplain.agent.anthropic.baseUrl` | string (URL) | `https://api.anthropic.com` | [anthropic] Base URL |
| `xplain.agent.anthropic.model` | string | `claude-sonnet-5` | [anthropic] Id модели Claude |
| `xplain.agent.anthropic.maxTokens` | number ≥ 256 | `8192` | [anthropic] `max_tokens` ответа |
| `xplain.agent.systemPrompt` | string (многострочная) | `""` | [hermes/openai/anthropic] Свой системный промпт; пусто — встроенный промпт XPlain |
| `xplain.agent.timeoutMs` | number ≥ 1000 | `180000` | Таймаут запроса (мс) на заголовки и тело; для стриминга — общий на весь ответ |
| `xplain.agent.streaming` | boolean | `true` | Показывать ответ по мере поступления (NDJSON для `xplain`, SSE для остальных) |
| `xplain.agent.headers` | object (string → string) | `{}` | Дополнительные HTTP-заголовки для любого провайдера. Ключи API сюда не кладите — см. «Секреты» |

### Редактор

| Ключ | По умолчанию | Описание |
| --- | --- | --- |
| `xplain.editor.showCodeLens` | `true` | CodeLens «XPlain: …» над блоками с объяснениями |
| `xplain.editor.highlightBlocks` | `true` | Иконка в gutter, подсветка и hover у блоков с объяснениями (подсветка блоков в текущем контексте остаётся всегда) |

### Фон панели

| Ключ | Значения | По умолчанию |
| --- | --- | --- |
| `xplain.ui.background.opacity` | 0 … 1 | `0.18` |
| `xplain.ui.background.blur` | 0 … 40 (px) | `0` |
| `xplain.ui.background.fit` | `cover` \| `contain` \| `tile` | `cover` |

Пример:

```jsonc
{
  "xplain.agent.provider": "hermes",
  "xplain.agent.hermes.baseUrl": "http://127.0.0.1:8642/v1",
  "xplain.agent.hermes.model": "hermes-agent",
  "xplain.agent.timeoutMs": 600000,
  "xplain.agent.headers": { "X-Team": "kernels" },
  "xplain.ui.background.opacity": 0.1,
  "xplain.ui.background.fit": "contain"
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
| Configure Agent (Provider, Model, API Key) | `xplain.configureAgent` | Открыть вкладку **Agent** панели. Есть в меню «…» заголовка панели |
| Set Agent API Key / Clear Agent API Key | `xplain.setAgentApiKey` / `xplain.clearAgentApiKey` | Управление ключом выбранного провайдера |
| Choose Background Image… | `xplain.chooseBackground` | Выбрать фон панели |
| Clear Background Image | `xplain.clearBackground` | Убрать фон |
| Reveal .xplain Folder | `xplain.openStorageFolder` | Показать `.xplain/index.json` в Explorer |

Служебные команды (скрыты из палитры, вызываются из CodeLens/hover/webview):
`xplain.showResults` (anchorId), `xplain.openResult` (sessionId), `xplain.openResultInEditor` (sessionId),
`xplain.addResultToContext` (sessionId).

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
