# Настройки, команды, горячие клавиши

## Настройки (`settings.json`)

### Агент

| Ключ | Тип / значения | По умолчанию | Описание |
| --- | --- | --- | --- |
| `xplain.agent.provider` | `http` \| `mock` | `http` | `http` — ваш сервис по адресу `endpoint`; `mock` — встроенный офлайн-ответ для демонстрации |
| `xplain.agent.endpoint` | string (URL) | `http://127.0.0.1:8765/explain` | Адрес, на который отправляется `POST` с контекстом |
| `xplain.agent.timeoutMs` | number ≥ 1000 | `180000` | Таймаут запроса (мс). Для стриминга — общий таймаут на весь ответ |
| `xplain.agent.streaming` | boolean | `true` | Отправлять `Accept: application/x-ndjson, application/json` и рендерить ответ по мере поступления |
| `xplain.agent.headers` | object (string → string) | `{}` | Дополнительные HTTP-заголовки (например `X-Project`). Ключ API сюда не кладите — см. команду Set Agent API Key |

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
  "xplain.agent.endpoint": "http://gpu-box:9000/xplain",
  "xplain.agent.timeoutMs": 600000,
  "xplain.agent.headers": { "X-Team": "kernels" },
  "xplain.ui.background.opacity": 0.1,
  "xplain.ui.background.fit": "contain"
}
```

Настройки читаются при каждом запросе — перезагрузка окна не нужна. Workspace-настройки
(`.vscode/settings.json`) удобно использовать для адреса агента конкретного проекта.

### Секреты

Ключ API хранится в `SecretStorage` (не в settings) и отправляется как `Authorization: Bearer <key>`.

- **XPlain: Set Agent API Key** — ввести/заменить (пустая строка — удалить).
- **XPlain: Clear Agent API Key** — удалить.

## Команды (Command Palette, категория **XPlain**)

| Команда | ID | Описание |
| --- | --- | --- |
| Add Selection to Context | `xplain.addSelectionToContext` | Добавить выделение (или все выделения) в контекст. Также в контекстном меню редактора |
| Toggle Pick Mode | `xplain.togglePickMode` | Включить/выключить режим выбора результата для добавления в контекст. Кнопка-мишень в заголовке панели |
| Open XPlain Panel | `xplain.focus` | Открыть панель |
| Clear Context | `xplain.clearContext` | Очистить контекст |
| Set Agent API Key / Clear Agent API Key | `xplain.setAgentApiKey` / `xplain.clearAgentApiKey` | Управление ключом |
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
