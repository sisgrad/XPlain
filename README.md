<p align="center"><img src="assets/social-banner.png" alt="XPlain" width="640"></p>

# XPlain

[English](README.en.md) · **Русский**

Объяснение кода вашим собственным LLM-агентом прямо из VS Code или Cursor.

XPlain позволяет собирать блоки кода в *контекст*, добавлять вопрос и необязательный шаблон
(инструкция + файлы-референсы), отправлять это агенту и хранить каждый ответ привязанным к коду,
который он объясняет. Ответы сохраняются в проекте (`.xplain/`) и показываются в редакторе как
CodeLens над блоками.

Агенты подключаемые и настраиваются во вкладке **Agent** панели: локальный harness
**Hermes Agent**, **Anthropic / Claude** и **OpenAI / Codex** — по API-ключу или через вашу
**подписку** (Claude Pro/Max, ChatGPT Plus/Pro) с помощью поставляемого в комплекте CLI
[Claudexor](https://github.com/razzant/claudexor) — **Cursor SDK**, ваш собственный сервис,
говорящий на **HTTP-контракте XPlain**, или офлайн-**mock**.

Используются только стабильные API VS Code (без proposed API), поэтому расширение работает в
VS Code и Cursor, локально и через Remote-SSH.

Полная документация (установка, руководство пользователя, конфигурация, провайдеры агентов, формат
хранения, архитектура, разработка, устранение неполадок) — в папке `docs/` репозитория
(начните с `docs/README.md`).

Готовые установочные файлы `xplain-<платформа>-<версия>.vsix` — во вкладке **Releases** репозитория
на GitHub (суффикс платформы важен: поставляемый Cursor SDK содержит нативный биндинг tree-sitter).

## Рабочий процесс

1. Выделите блок кода и нажмите **Shift+X**. Блок появится в панели XPlain как
   `file.cu L61-L224`. Повторите для других блоков (вложенные диапазоны отслеживаются отдельно).
   При отправке весь файл прикладывается как окружающий контекст, но агенту сказано объяснять
   только блок.
2. В панели при желании введите вопрос, выберите шаблон, язык объяснения (английский / русский) и
   включите **Draw diagrams with the Excalidraw skill**
   ([coleam00/excalidraw-diagram-skill](https://github.com/coleam00/excalidraw-diagram-skill) —
   XPlain хранит скилл в `.xplain/skills/` и адаптирует его под выбранного агента при отправке).
3. Нажмите **Send to agent** (или Ctrl+Enter в поле вопроса). Ничего не отправляется без вашего
   подтверждения. Текстовые файлы можно также перетащить во вкладку **Context** как вложения.
4. Ответ стримится во вкладку **Result** и сохраняется как самодостаточный
   `.xplain/sessions/<id>/result.html` (Markdown оборачивается в HTML; пути к диаграммам в
   `.xplain/diagrams/<sessionId>/` встраиваются как `data:`-URI). Агентам запрещено переиспользовать
   артефакты других сессий, если вы явно не добавили их в черновик.
5. Каждый блок, входивший в контекст, получает CodeLens: `XPlain: <заголовок>` или
   `XPlain: 3 explanations · <последний заголовок>`. Клик открывает список всех объяснений,
   привязанных к блоку; заголовки — краткие резюме в стиле чата, а не `v1`/`v2`.
6. **Extend** во вкладке Result дорабатывает это объяснение на месте (уточняющий вопрос, ещё блоки,
   файлы → **Send (overwrite)**). Pick-режим (Shift+X вне редактора) по-прежнему добавляет прежний
   результат в *новый* контекст без перезаписи.

### Клавиши

| Сочетание | Где | Действие |
| --- | --- | --- |
| `Shift+X` | редактор с выделением | добавить выделение в контекст |
| `Shift+X` | где угодно вне редактора (сайдбар, проводник, панель) | переключить pick-режим |
| `Ctrl+Enter` | поле вопроса | отправить |

`Shift+X` при выделении заменяет ввод заглавной `X` поверх выделения. Если это мешает, измените
привязку в *Keyboard Shortcuts* (`xplain.addSelectionToContext`).

## Установка

### Вариант A — из `.vsix`

1. Скачайте файл для своей платформы во вкладке **Releases** на GitHub (например
   `xplain-linux-x64-0.2.0.vsix`; при Remote-SSH платформа — сервера) или соберите сами, см. вариант B.
2. В VS Code / Cursor: вид Extensions → меню `...` → **Install from VSIX...**.
   Из командной строки: `cursor --install-extension xplain-linux-x64-0.2.0.vsix` (или `code ...`).
3. **Remote-SSH**: расширение работает на удалённой стороне (`extensionKind: workspace`).
   Скопируйте `.vsix` на удалённую машину и выполните там `bash scripts/install.sh path/to/xplain.vsix`,
   либо установите из вида Extensions при подключении (оно установится удалённо автоматически).
4. Перезагрузите окно.

### Вариант B — из исходников (зависимости ставятся автоматически)

Скрипт установки проверяет Node.js ≥ 20 и ставит его при отсутствии (через `nvm` в домашний
каталог на Linux/macOS, без `sudo`; через `winget` на Windows), устанавливает npm-зависимости,
собирает и упаковывает расширение.

```bash
# Linux / macOS / WSL (добавьте --install, чтобы сразу установить в Cursor/VS Code)
bash scripts/setup.sh --install
```

```powershell
# Windows
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1 -Install
```

`scripts/install.sh` находит `cursor`, `code` и CLI серверов Remote-SSH
(`~/.cursor-server`, `~/.vscode-server`) и запускает `--install-extension` за вас.

### Вариант C — разработка

```bash
bash scripts/setup.sh --no-package   # или: npm install && npm run build
npm run watch                        # пересборка при изменениях
```

Нажмите **F5**, чтобы запустить Extension Development Host (откройте в нём любую папку с кодом).

## Выбор агента

Откройте вкладку **Agent** в панели XPlain (или кликните имя агента в подвале вкладки Context, или
выполните **XPlain: Configure Agent**). Выберите провайдера, заполните его поля, вставьте API-ключ
(хранится в защищённом хранилище IDE, никогда — в `settings.json` или `.xplain/`), нажмите
**Test connection**, затем **Save** (в пользовательские настройки или в этот workspace).

| Провайдер | С чем общается | Поля |
| --- | --- | --- |
| **Hermes Agent** | **API-сервер** Hermes harness (OpenAI-совместимый, порт 8642) — не URL дашборда/Remote-gateway, который использует Hermes Desktop. Включается через `API_SERVER_ENABLED=true`, `API_SERVER_KEY=...` (и `API_SERVER_HOST=0.0.0.0` для удалённого доступа) в `~/.hermes/.env`. | Base URL (`http://127.0.0.1:8642/v1`), модель/профиль из списка, который сообщает harness, ключ = `API_SERVER_KEY`. События прогресса инструментов игнорируются, финальный ответ стримится. |
| **Anthropic / Claude (Subscription)** | Ваш логин Claude Pro/Max через Claude Code CLI под управлением поставляемого Claudexor: read-only `ask` либо `agent`-запуск с правом записи, когда запрошены диаграммы Excalidraw (в workspace, если это git-репозиторий, иначе в приватной папке с переносом диаграмм обратно). Node.js ≥ 24.15 скачивается автоматически при отсутствии. | Модель (пусто = по умолчанию у harness). Кнопки вкладки Agent: Install claude CLI → Log in → Test connection. Без API-ключа. |
| **Anthropic / Claude (API)** | Anthropic Messages API (оплата за токены). | Base URL, модель из списка сервера, `max_tokens`, API-ключ (`x-api-key`). |
| **OpenAI / Codex (Subscription)** | Ваш логин ChatGPT Plus/Pro через Codex CLI под управлением поставляемого Claudexor. Node.js ≥ 24.15 скачивается автоматически при отсутствии. | Модель (пусто = по умолчанию у harness). Install codex CLI → Log in → Test connection. Без API-ключа. |
| **OpenAI / Codex (API)** | OpenAI Chat Completions или любой совместимый сервер (Ollama, vLLM, LiteLLM, OpenRouter). | Base URL (`https://api.openai.com/v1`), модель из списка сервера, API-ключ (Bearer). |
| **Cursor SDK** | Локальный агент Cursor через `@cursor/sdk` в этом workspace. | Модель из аккаунта Cursor (например `composer-2.5`), API-ключ из [Integrations](https://cursor.com/dashboard/integrations). |
| **XPlain HTTP agent** | Ваш сервис, реализующий контракт ниже. | URL эндпоинта, необязательный Bearer-ключ. |
| **Mock (offline)** | Встроенный заготовленный ответ. | — |

Для всех провайдеров, кроме Hermes, под моделью есть поле **Reasoning effort** — уровень усилий
рассуждения (OpenAI `reasoning_effort`, Anthropic `output_config.effort`, Claudexor `--effort`,
параметр effort/thinking модели Cursor); пусто = значение модели по умолчанию.

Выпадающий список **Model** заполняется автоматически с эндпоинта `/models` сервера (при открытии
вкладки, смене провайдера, base URL или ключа, либо кнопкой обновления); если список получить не
удалось, id можно ввести вручную. **Test connection** проверяет тот же эндпоинт и сообщает, доступна
ли выбранная модель. Для чат-провайдеров контекст рендерится в одно пользовательское сообщение
(шаблоны, предыдущие результаты, блоки кода с диапазонами `L`, вопрос), которому предшествует
системный промпт с просьбой ответить в Markdown, начиная с короткого заголовка `#`; переопределяется в
*Advanced → System prompt*.

## Конфигурация

| Настройка | По умолчанию | Описание |
| --- | --- | --- |
| `xplain.agent.provider` | `xplain` | `xplain`, `hermes`, `openai`, `anthropic`, `openaiSubscription`, `anthropicSubscription`, `cursor` или `mock`. |
| `xplain.agent.endpoint` | `http://127.0.0.1:8765/explain` | [xplain] URL, принимающий контекст. |
| `xplain.agent.hermes.baseUrl` / `model` | `http://127.0.0.1:8642/v1` / `hermes-agent` | [hermes] API-сервер и модель/профиль. |
| `xplain.agent.openai.baseUrl` / `model` | `https://api.openai.com/v1` / `chat-latest` | [openai] База API и id модели. |
| `xplain.agent.anthropic.baseUrl` / `model` / `maxTokens` | `https://api.anthropic.com` / `claude-sonnet-5` / `8192` | [anthropic] База API, модель, `max_tokens`. |
| `xplain.agent.openaiSubscription.model` / `xplain.agent.anthropicSubscription.model` | `""` | [subscription] Id модели для Codex CLI / Claude Code; пусто = по умолчанию у harness. |
| `xplain.agent.<provider>.effort` (openai, anthropic, openaiSubscription, anthropicSubscription, cursor) | `""` | Reasoning effort: OpenAI `reasoning_effort`, Anthropic `output_config.effort`, Claudexor `--effort`, параметр effort/thinking модели Cursor. Пусто = по умолчанию модели. |
| `xplain.agent.claudexor.cliPath` / `nodePath` | `""` | Переопределить поставляемый CLI `claudexor` / Node.js ≥ 24.15 для его запуска (по умолчанию определяются автоматически). |
| `xplain.agent.claudexor.autoInstallNode` / `nodeVersion` | `true` / `""` | Если Node ≥ 24.15 не найден — скачать официальную сборку с проверкой контрольной суммы с nodejs.org в global storage расширения (без sudo, `PATH` не меняется). |
| `xplain.agent.claudexor.mode` / `project` | `auto` / `auto` | Маршрут `ask` или `agent` с правом записи; где работает `agent` (workspace, если git, иначе приватная папка). |
| `xplain.agent.systemPrompt` | `""` | [hermes/openai/anthropic] Свой системный промпт; пусто = встроенный. |
| `xplain.agent.timeoutMinutes` | `10` | Idle-таймаут в минутах (сбрасывается каждым полученным чанком / keepalive). |
| `xplain.agent.streaming` | `true` | Стримить частичный вывод (NDJSON или SSE). |
| `xplain.agent.headers` | `{}` | Дополнительные заголовки для любого провайдера. |
| `xplain.editor.showCodeLens` | `true` | CodeLens над объяснёнными блоками. |
| `xplain.editor.highlightBlocks` | `true` | Иконка в gutter / hover у объяснённых блоков. |

API-ключи задаются отдельно для каждого провайдера — во вкладке Agent или командами
**XPlain: Set Agent API Key** / **XPlain: Clear Agent API Key** (обе спрашивают провайдера).

### HTTP-контракт агента XPlain

Запрос (`POST` на `xplain.agent.endpoint`, `Content-Type: application/json`):

```json
{
  "sessionId": "m2abc-1f2e3d4c",
  "question": "Why does the MMA warp wait on this barrier?",
  "workspace": "XPlain",
  "items": [
    { "type": "code", "file": "examples/kernels/warp_specialization.cu",
      "startLine": 192, "endLine": 221, "language": "cuda", "text": "for (int kv_tile ..." },
    { "type": "result", "title": "Pipeline overview", "format": "markdown", "content": "# ..." },
    { "type": "template", "name": "CUDA review", "instruction": "Focus on ...",
      "files": [ { "name": "notes.md", "content": "..." } ] }
  ]
}
```

Ответ — либо один JSON-документ:

```json
{ "title": "Barrier phases in the KV loop", "format": "markdown", "content": "# ..." }
```

либо NDJSON-поток (`Content-Type: application/x-ndjson`), по одному JSON-объекту на строку:

```
{"type":"delta","text":"The MMA warp "}
{"type":"delta","text":"waits because ..."}
{"type":"done","title":"Barrier phases in the KV loop","format":"markdown"}
```

`format` — `markdown` или `html` (самодостаточный HTML рендерится в sandbox-iframe).
Если `title` опущен, XPlain выводит его из первого заголовка, вопроса или кода.

Референсная реализация только на stdlib — `examples/agent_server.py`:

```bash
python3 examples/agent_server.py --port 8765   # затем оставьте эндпоинт по умолчанию
```

Замените его генератор `explain()` вызовом вашей агентной системы.

## Шаблоны

Шаблон объединяет инструкцию и файлы-референсы. Во вкладке **Templates** перетащите файлы из
проводника или с компьютера на панель (или кликните зону перетаскивания, чтобы выбрать), напишите
инструкцию и сохраните. Выберите шаблон во вкладке **Context** перед отправкой; его инструкция и
файлы войдут в запрос. Шаблоны хранятся в `.xplain/templates/<id>/`.

## Структура хранения

```
.xplain/
  index.json                      якоря (файл, строки, хэш, фрагмент) и метаданные сессий
  sessions/<id>/context.json      всё, что было отправлено, с заголовком и статусом
  sessions/<id>/result.html       ответ агента (самодостаточный HTML)
  templates/<id>/template.json    имя, инструкция, список файлов
  templates/<id>/files/...        приложенные файлы
```

Якоря следуют за правками: диапазоны сдвигаются при вводе, а блоки заново находятся по содержимому
при повторном открытии файла. Отредактированные блоки сохраняют объяснения и принимают новый текст
при сохранении. Коммитьте `.xplain/`, если хотите делиться объяснениями с командой.

## Разработка

```bash
npm run check    # проверка типов расширения + webview
npm run lint
npm test         # mocha-тесты (хранилище, якоря, заголовки, черновик, провайдеры)
npm run package  # dist/xplain-<платформа>-<версия>.vsix
npm run release  # то же; файл для публикации в GitHub Releases
```
