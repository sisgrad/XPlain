# Устранение неполадок

Первый шаг при любой проблеме — Output → **XPlain** (логи хоста) и, для панели,
**Developer: Open Webview Developer Tools**.

## Иконки XPlain нет в левой панели

- Расширение не установлено там, где работает extension host. При Remote-SSH оно должно быть на
  **удалённой** стороне: Extensions → раздел «SSH: …» → найти XPlain; либо выполнить
  `bash scripts/install.sh` на удалённой машине.
- После установки нужен **Developer: Reload Window**.
- Иконка могла быть скрыта: правый клик по activity bar → отметить XPlain.

## Панель пустая / не реагирует

- Откройте Webview Developer Tools и посмотрите консоль. Типичная причина — старый `dist/` после
  изменения исходников: `npm run build`, затем Reload Window.
- При разработке через F5 убедитесь, что `npm run watch` запущен или выполнена сборка.

## Shift+X не добавляет блок

- Должно быть выделение в текстовом редакторе (`editorHasSelection`), фокус — в редакторе.
- Файл должен лежать внутри открытой папки workspace и иметь схему `file` (не untitled, не diff,
  не Output). Иначе появится предупреждение «only files inside the workspace…».
- Нет открытой папки → «XPlain needs an open folder…»; откройте папку (File → Open Folder).
- Конфликт сочетаний: Keyboard Shortcuts → найдите `shift+x` и проверьте, нет ли другого биндинга с
  более высоким приоритетом; при необходимости переназначьте `xplain.addSelectionToContext`.

## Shift+X печатает «X» вместо pick mode

Pick mode переключается только когда фокус **не** в редакторе, не в поле ввода, не в терминале и не в
Quick Open. Кликните в панель XPlain или Explorer и нажмите снова. Внутри панели сочетание работает,
если фокус не в текстовом поле.

## Запрос падает с ошибкой

| Сообщение | Причина / действие |
| --- | --- |
| `… endpoint is not configured` / `base URL is not configured` / `model is not configured` | Заполните поля во вкладке **Agent** и нажмите Save |
| `Anthropic: API key is not set` | Вкладка Agent → API key → Save key (ключ обязателен для Anthropic) |
| `Cannot reach agent at …` | Сервис не запущен или недоступен с машины, где работает extension host. При Remote-SSH `127.0.0.1` — это удалённый хост, а не ваш ноутбук; запустите Hermes/агент там или укажите доступный адрес |
| `Agent did not respond within N minute(s)` | Агент не отдал заголовки ответа за idle-таймаут. Проверьте сервис; увеличьте **Idle timeout, minutes** во вкладке Agent (по умолчанию 10). |
| `Agent went idle for N minute(s) (no data)…` | Дольше idle-таймаута не пришло ни одного байта тела — XPlain сделал abort (GPU у Hermes при этом гаснет). Keepalive / `hermes.tool.progress` сбрасывают таймер; если Hermes молчит во время tool-вызова, поднимите `xplain.agent.timeoutMinutes` |
| `HTTP 401/403` / `Invalid API key` / `authentication_error` | Ключ не задан или неверный: Agent → API key → Save key. Для Hermes ключ = `API_SERVER_KEY`. Проверьте, что ключ сохранён именно для выбранного провайдера (индикатор `saved`) |
| `HTTP 404` у Hermes/OpenAI | Base URL должен заканчиваться на `/v1` (XPlain добавляет `/chat/completions` и `/models`). У Anthropic — наоборот, без `/v1` |
| `HTTP 4xx/5xx: …` | Смотрите тело ответа в сообщении и логи своего сервиса / Output → XPlain |
| `… response has no message content` / `empty answer` | Модель вернула пустой ответ; выберите другую модель из списка и проверьте системный промпт |
| `Agent response has no "content" field` | [xplain] Ответ должен содержать `content` (или `answer`/`markdown`/`html`) — см. [04-agent-api.md](04-agent-api.md) |
| `Agent stream finished without any content` | [xplain] В NDJSON-потоке не было `delta` и `done.content` |

Для изоляции проблемы переключите провайдера на **Mock (offline)**: если всё работает, дело в сервисе
или сети. Кнопка **Test connection** во вкладке Agent показывает ту же ошибку, что и запрос, но быстрее.
Контракт XPlain можно проверить `curl`-ом:

```bash
curl -sS -X POST -H 'Content-Type: application/json' -H 'Accept: application/x-ndjson' \
  -d '{"sessionId":"t","question":"ping","items":[]}' http://127.0.0.1:8765/explain
```

Hermes API-сервер:

```bash
curl -sS -H 'Authorization: Bearer <API_SERVER_KEY>' http://127.0.0.1:8642/v1/models
```

## Hermes: «… is the Hermes dashboard/gateway, not the OpenAI-compatible API server»

Вы указали адрес, который использует Hermes Desktop (Remote gateway, обычно порт 9119/9120). Это
dashboard с cookie-аутентификацией; XPlain работает с отдельным OpenAI-совместимым API-сервером Hermes
(порт 8642, `API_SERVER_KEY`). Сообщение XPlain содержит адрес API-сервера, о котором сообщил сам Hermes.
Если он `127.0.0.1:8642`, с другой машины до него не достучаться — на машине Hermes задайте
`API_SERVER_HOST=0.0.0.0` (и `API_SERVER_KEY`) в `~/.hermes/.env`, перезапустите gateway и укажите в XPlain
`http://<host>:8642/v1`; либо пробросьте порт: `ssh -N -L 8642:127.0.0.1:8642 <host>` и используйте
`http://127.0.0.1:8642/v1`. Проверка: `curl -H 'Authorization: Bearer <API_SERVER_KEY>' http://<host>:8642/v1/models`.
Подробнее — [04-agent-api.md](04-agent-api.md#hermes-agent).

## Вкладка Agent

- **Список моделей пуст / «Could not load models»** — сервер недоступен по указанному Base URL с машины
  extension host, либо не сохранён ключ (Hermes отвечает 401 без `API_SERVER_KEY`; Anthropic требует ключ
  всегда). Сохраните ключ (список перезапросится сам) или нажмите ↻. Пока список не загружен, модель можно
  ввести вручную (кнопка ✎ / текстовое поле).
- **В списке нет нужной модели** — нажмите ✎ и введите id вручную; сохранённая модель, которой нет в
  списке, показывается с пометкой «not in the server list» и продолжает использоваться.
- **Кнопка Save неактивна** — нет изменений относительно сохранённых настроек.
- **Форма «откатилась»** — настройки изменились снаружи (`settings.json`, другой инстанс) при отсутствии
  несохранённых правок; это ожидаемо.
- **Сохранил в User settings, а в проекте другой провайдер** — проверьте `.vscode/settings.json`:
  workspace-значения перекрывают пользовательские. Сохранение из вкладки Agent в *User settings* удаляет
  workspace-переопределения `xplain.agent.*`, но вручную добавленные позже — нет.
- **«This workspace» недоступно** — открыт одиночный файл без папки.
- **Test connection для XPlain-контракта «успешен», хотя ответ бессмысленный** — тест проверяет только
  доступность и формат ответа, а не содержание.
- **Hermes показывает прогресс инструментов в консоли, а в XPlain — только итог** — события
  `hermes.tool.progress` намеренно не выводятся; в панель идёт только текст ответа.

## CodeLens не появляется

- `xplain.editor.showCodeLens` должен быть `true`; также глобальная настройка `editor.codeLens`.
- CodeLens показывается только для сессий со статусом `done`. Сессии с ошибкой — в History.
- Якорь мог стать stale (блок удалён или сильно изменён). Откройте History → результат → «Add to context»
  работает и без CodeLens. Якорь вернётся, если текст блока появится снова.
- Файл открыт по другому пути (симлинк, другой регистр букв) — путь в `index.json` относительный и
  должен совпадать с `workspace.asRelativePath`.

## CodeLens на «неправильных» строках

Диапазон сохраняется с задержкой ~1.5 с после правок и при сохранении. Если файл изменён вне VS Code
(git checkout, форматирование в CLI), блок переищется по содержимому при следующем открытии. Если текст
блока изменился и вне редактора, и внутри, автоматический поиск невозможен — добавьте блок заново, старое
объяснение останется в History.

## Результат HTML не отображается (белое полотно)

- Панель рендерит HTML через `iframe srcdoc` (тело из `result.html` передаётся сообщением).
  Если видите пустой белый кадр на старой версии — обновите расширение: раньше `asWebviewUri` в
  iframe на Remote-SSH часто не загружался.
- Файл должен лежать в `.xplain/sessions/<id>/result.html`. Если удалён вручную — «HTML result could not be located on disk».
- Картинки должны быть `data:` URI внутри `result.html`. Если агент оставил путь к файлу, XPlain
  пытается встроить его с диска (workspace / `.xplain/diagrams/`, в т.ч. пути вида `/workspace/...`).
  Смотрите Output → XPlain: строки `[assets] inlined…` / `could not inline…`.
- Внешние CDN ограничены CSP панели; для диаграмм используйте локальные PNG + data URI.
- «Open in editor» открывает HTML в отдельной вкладке без ограничений панели.

## Drag-and-drop файлов не работает

- Файлы из проводника ОС при Remote-SSH читаются на клиенте и передаются как текст — работает для
  текстовых файлов до 1 МБ. Бинарные и большие пропускаются с уведомлением «Skipped: …».
- Из Explorer VS Code передаётся `text/uri-list`; файл читается на стороне хоста. Если ничего не
  произошло, посмотрите Output → XPlain и консоль webview.
- Запасной путь — клик по зоне «browse…» (системный диалог выбора файлов).

## Фон не меняется

- Проектный фон (`.xplain/ui/background.*`) имеет приоритет над пользовательским; очистите его
  командой **XPlain: Clear Background Image** → «This project».
- Файлы крупнее 15 МБ отклоняются.
- При очень низкой `opacity` фон может быть практически невидим — проверьте настройку.

## `.xplain/` не создаётся

- Нет прав на запись в корень workspace — см. сообщение «cannot create .xplain folder» и Output.
- Открыт multi-root workspace: используется **первая** папка.
- Открыт одиночный файл без папки — хранилище отключено (баннер в панели).

## Данные повреждены

`index.json` с ошибкой JSON игнорируется (в Output — «index.json is corrupt, starting fresh»), при этом
папки сессий на диске остаются. Восстановить можно, собрав `sessions[]` из `sessions/*/context.json`
вручную, или просто удалить `.xplain/` для чистого старта.

## Сбор информации для отчёта об ошибке

1. Версия Cursor/VS Code (Help → About) и XPlain (`package.json` / Extensions).
2. Содержимое Output → XPlain.
3. Консоль Webview Developer Tools при проблемах с панелью.
4. Фрагмент `.xplain/index.json` (можно без `snippet`) при проблемах с якорями.
