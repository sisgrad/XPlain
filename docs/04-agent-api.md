# Провайдеры агентов и HTTP-контракт

XPlain не содержит LLM — он формирует контекст и отправляет его выбранному *провайдеру*. Провайдер
выбирается во вкладке **Agent** панели (см. [руководство](02-user-guide.md#вкладка-agent)) или
настройкой `xplain.agent.provider`.

| `provider` | Назначение | Протокол |
| --- | --- | --- |
| `hermes` | Локальный Hermes Agent harness | OpenAI-совместимый Chat Completions + SSE |
| `anthropic` | Claude через Anthropic Messages API | `POST /v1/messages` + SSE |
| `openai` | OpenAI / Codex-модели или любой OpenAI-совместимый сервер (Ollama, vLLM, LiteLLM, OpenRouter) | Chat Completions + SSE |
| `cursor` | Cursor Agent SDK (`@cursor/sdk`) локально против workspace | SDK `Agent.create` + stream |
| `xplain` | Собственный сервис, говорящий на контракте XPlain (ниже) | JSON или NDJSON |
| `mock` | Встроенный ответ без сети | — |

Общие параметры для всех: `timeoutMinutes` (idle-таймаут в минутах: тишина до заголовков / между чанками тела; сброс на любом байте; по умолчанию 10), `streaming`,
`headers` (дополнительные HTTP-заголовки). Ключи API хранятся в `SecretStorage` по одному на провайдера
(`xplain.agent.apiKey.<provider>`), в `settings.json` и `.xplain/` не попадают.

## Cursor SDK (`provider = cursor`)

Локальный агент через [`@cursor/sdk`](https://cursor.com/docs/sdk/typescript): `Agent.create({ local: { cwd: <workspace> } })`.
Нужен Cursor API key (вкладка Agent → Save key; dashboard → Integrations). Модель — из `Cursor.models.list()`
(по умолчанию `composer-2.5`, настройка `xplain.agent.cursor.model`). Промпт тот же, что у чат-провайдеров;
ответ нормализуется в self-contained HTML. Для хранения локальных runs используется `JsonlLocalAgentStore`
в globalStorage расширения (без зависимости от `node:sqlite`).

## Чат-провайдеры: Hermes, OpenAI, Anthropic, Cursor

Для этих провайдеров XPlain сам превращает контекст в диалог (`src/agent/prompt.ts`):

- **system** — `xplain.agent.systemPrompt`, а если пусто — встроенный промпт: «ты XPlain, объясняй код;
  ответ в Markdown, первая строка — один заголовок `#` до 8 слов (как название чата), ссылайся на строки
  `L12-L48`, без вступлений».
- **user** — один текст в порядке: инструкция шаблона и его файлы → ранее полученные результаты →
  блоки кода (` ```<language> ` с указанием файла и диапазона строк; если код сам содержит ```` ``` ````,
  ограждение удлиняется) → вопрос пользователя (или просьба объяснить блоки, если вопрос пуст).

Ответ модели нормализуется в HTML и сохраняется как `result.html`. Промпт просит `<!DOCTYPE html>`
с inline CSS и **путями** к картинкам (не base64 в токенах); XPlain затем встраивает локальные
файлы через `inlineAssets`. Если модель вернула Markdown или HTML-фрагмент, ответ оборачивается
в полноценную страницу. Заголовок — из `<title>` / `<h1>` или первого `#`.

### Hermes Agent

Hermes должен быть запущен с включённым API-сервером:

```bash
# ~/.hermes/.env
API_SERVER_ENABLED=true
API_SERVER_KEY=<ваш ключ>
API_SERVER_PORT=8642         # по умолчанию

hermes api-server            # или hermes gateway с включённым api-server
```

В XPlain: Base URL `http://127.0.0.1:8642/v1`, модель `hermes-agent` (или имя профиля), ключ =
`API_SERVER_KEY`.

**Не путать с dashboard/gateway.** У Hermes два разных HTTP-сервиса:

| Сервис | Порт по умолчанию | Кто им пользуется | Аутентификация |
| --- | --- | --- | --- |
| Dashboard / gateway (`hermes dashboard`, `hermes serve`) | 9119 | Hermes Desktop (Settings → Gateways → Remote gateway), браузер | логин/пароль или OAuth, cookie-сессия; чат — через WebSocket `/api/ws` |
| API server (`API_SERVER_*`) | 8642 | OpenAI-совместимые клиенты, **XPlain** | `Authorization: Bearer API_SERVER_KEY` |

Адрес из Hermes Desktop (например `http://192.168.1.61:9120`) — это dashboard; `GET /v1/models` на нём
отвечает редиректом на `/login`, а `/api/*` — `401 no_cookie`. XPlain распознаёт эту ситуацию: при ошибке
загрузки моделей для провайдера `hermes` он опрашивает публичный `GET {origin}/api/status` и, если это
dashboard, сообщает, где по данным самого Hermes слушает API-сервер (`gateway_platforms.api_server.listener_base`)
и что сделать. Если API-сервер привязан к `127.0.0.1` (значение по умолчанию), с другой машины он
недоступен; варианты:

```bash
# на машине Hermes, ~/.hermes/.env
API_SERVER_ENABLED=true
API_SERVER_HOST=0.0.0.0        # слушать не только loopback
API_SERVER_KEY=<ключ>
# перезапустить gateway; в XPlain: Base URL http://<host>:8642/v1

# либо не открывать порт, а пробросить его по SSH с машины, где работает XPlain:
ssh -N -L 8642:127.0.0.1:8642 <user>@<host>   # в XPlain: http://127.0.0.1:8642/v1
``` Запрос — `POST {baseUrl}/chat/completions` с `stream: true`. Hermes присылает
стандартные чанки `chat.completion.chunk`, свои события `event: hermes.tool.progress` (ход работы
инструментов — XPlain их пропускает), комментарии `: keepalive` и `data: [DONE]`. В результат попадает
только итоговый ответ агента. **Test connection** вызывает `GET /v1/models` и показывает профили.

При Remote-SSH `127.0.0.1` — это удалённая машина (где работает extension host); Hermes должен
работать там же или быть доступен по сети.

### OpenAI / Codex и совместимые серверы

`POST {baseUrl}/chat/completions`, `Authorization: Bearer <ключ>`, тело
`{ model, messages: [system, user], stream }`. SSE-чанки `choices[0].delta.content` склеиваются;
без стриминга берётся `choices[0].message.content`. Ошибки API (`{ "error": { "message" } }`)
показываются как есть. Для локальных серверов ключ не обязателен. **Test connection** — `GET /models`.

Base URL по умолчанию `https://api.openai.com/v1`, модель `chat-latest`; подставьте любой id из списка
моделей (в том числе Codex-модели).

### Anthropic (Claude)

`POST {baseUrl}/v1/messages`, заголовки `x-api-key`, `anthropic-version: 2023-06-01`; тело
`{ model, max_tokens, system, messages: [{ role: "user", content }], stream }`. Из SSE берутся
события `content_block_delta` с `delta.type == "text_delta"`; без стриминга — все блоки `text` из
`content`. Ключ обязателен. **Test connection** — `GET /v1/models`.

## Контракт XPlain (provider = `xplain`)

Сервис может быть чем угодно (одиночная модель, мультиагентный пайплайн, RAG), лишь бы он принимал
запрос и возвращал ответ в формате ниже. Референсная реализация на чистой стандартной библиотеке
Python — [`examples/agent_server.py`](../examples/agent_server.py).

### Запрос

```
POST <xplain.agent.endpoint>
Content-Type: application/json
Accept: application/x-ndjson, application/json     # или только application/json при streaming=false
Authorization: Bearer <ключ>                       # если задан ключ для провайдера xplain
<дополнительные заголовки из xplain.agent.headers>
```

Тело:

```jsonc
{
  "sessionId": "mv2ngpzs-a1e0626c",   // id сессии в .xplain/sessions/<id>/
  "question": "Why does the MMA warp wait on this barrier?",  // может быть пустой строкой
  "workspace": "XPlain",              // имя папки проекта (опционально)
  "workspaceRoot": "/hdd/XPlain",     // абсолютный корень workspace (опционально)
  "explainLanguage": "en",            // "en" | "ru" — язык письменного ответа
  "useExcalidraw": false,             // true → агент обязан использовать Excalidraw-скилл
  "excalidrawSkillPath": ".cursor/skills/excalidraw-diagram",        // путь для агента (bridge или store)
  "excalidrawSkillCanonicalPath": ".xplain/skills/excalidraw-diagram", // устойчивое хранилище
  "excalidrawSkillBridge": "cursor",  // "cursor" | "claude" | "none"
  "systemPrompt": "You are XPlain…",  // общий system — тот же текст, что у chat/Cursor
  "instructions": "## Language\n…\n## Output format…\n## Artifact access…", // общий user-блок
  "extendSessionId": "mv2ngpzs-a1e0626c", // задано при Result → Extend (overwrite той же сессии)
  "items": [ /* code | result | file | template — только то, что в черновике */ ]
}
```

**Одинаковые инструкции для всех агентов.** Перед Send XPlain вызывает `withSharedInstructions`
(`src/agent/prompt.ts`): один `systemPrompt` + один блок `instructions` (язык, HTML с путями к
картинкам, **Artifact access**, опционально Excalidraw / Extend mode). Hermes / OpenAI / Anthropic /
Cursor SDK получают тот же текст через `buildChatPrompt`; провайдер `xplain` — те же поля в JSON.
Диаграммы — только `.xplain/diagrams/<sessionId>/`. Чужие `sessions/` и `diagrams/<other>/` —
запрещены, пока пользователь явно не положил результат в draft. Cursor SDK пишет managed `.cursorignore`
(опционально Landlock sandbox через `xplain.agent.cursor.useSandbox`). Канон скилла — `.xplain/skills/<id>/` (offline vendor
Excalidraw в `references/vendor/`).

#### Элементы `items`

Блок кода:

```jsonc
{
  "type": "code",
  "file": "examples/kernels/warp_specialization.cu",  // путь относительно корня workspace, POSIX
  "startLine": 192, "endLine": 221,                   // 1-based, включительно — фокус объяснения
  "language": "cuda",                                 // languageId VS Code
  "text": "for (int kv_tile = 0; ...\n  ...",         // текст фокус-блока на момент отправки
  "fileText": "// entire file contents...\n"          // полный файл как контекст (опционально)
}
```

`fileText` — весь файл на момент Send (один раз на путь, даже если в контексте несколько блоков из
него). Агент должен объяснять **только** диапазон `startLine`–`endLine` / поле `text`; полный файл —
окружающий контекст (типы, вызывающий код, соседи). Если файл не прочитан или больше 512 КБ, поле
опускается. Для чат-провайдеров XPlain дополнительно пишет секции `## Scope`, `## Focus block(s)` и
`## Full file(s) (context only)` в user-сообщении.

Ранее полученный результат (добавлен через pick mode / «Add to context»):

```jsonc
{
  "type": "result",
  "title": "Pipeline overview",
  "format": "markdown",          // или "html"
  "content": "# Pipeline overview\n..."
}
```

Шаблон (не более одного на запрос, всегда последним):

```jsonc
{
  "type": "template",
  "name": "CUDA kernel review",
  "instruction": "Explain memory access patterns and bank conflicts...",
  "files": [ { "name": "notes.md", "content": "..." } ]   // текстовые файлы шаблона
}
```

Рекомендация агенту: трактовать `template.instruction` как системную/ролевую инструкцию,
`template.files` — как справочные материалы, `result` — как уже известный контекст,
`question` — как пользовательский запрос.

### Ответ: один JSON-документ

`Content-Type: application/json` (или любой другой, не содержащий `ndjson` / `event-stream`):

```jsonc
{
  "title": "Barrier phases in the KV loop",   // опционально, ≤ ~70 символов, как название чата
  "format": "html",                           // "markdown" | "html" — на входе; XPlain всегда сохраняет html
  "content": "<!DOCTYPE html>..."             // обязательное поле (HTML предпочтителен; Markdown тоже ок)
}
```

Допускаются синонимы: `answer`, `markdown` (вместо `content`), `html` (подразумевает `format: html`).
Тело, не являющееся JSON, принимается как текст и тоже конвертируется в HTML.

### Ответ: поток NDJSON

`Content-Type: application/x-ndjson`, по одному JSON-объекту на строку:

| Событие | Поля | Назначение |
| --- | --- | --- |
| `delta` | `text` | Фрагмент текста; отображается в панели сразу, конкатенируется в `content` |
| `title` | `title` | Заголовок можно отправить в любой момент (например, сразу после планирования) |
| `done` | `title?`, `format?`, `content?` | Завершение. Если `content` задан — он заменяет накопленные `delta` (удобно для HTML или пост-обработки) |
| `error` | `message` | Прервать с ошибкой; сессия помечается `failed` |

Пример:

```
{"type":"title","title":"Barrier phases in the KV loop"}
{"type":"delta","text":"The MMA warp "}
{"type":"delta","text":"waits because ..."}
{"type":"done","format":"markdown"}
```

Также поддерживается `Content-Type: text/event-stream` с теми же объектами в строках `data: {...}`
(строка `data: [DONE]` игнорируется). Строки, не являющиеся JSON, добавляются к тексту как есть.

Стриминг имеет смысл только для Markdown: HTML рендерится после завершения.

## Заголовок результата

Заголовки в UI должны быть содержательными (не `v1`/`v2`). Приоритет:

1. `title` из ответа агента (только контракт XPlain; рекомендуется);
2. первый заголовок `#`/`##`/`###` в Markdown или `<title>`/`<h1>` в HTML;
3. вопрос пользователя;
4. `имя_файла LNN-LMM: первая строка блока`.

Длинные заголовки обрезаются до 72 символов.

## Ошибки и таймауты

| Ситуация | Поведение XPlain |
| --- | --- |
| HTTP-статус не 2xx | Ошибка `HTTP <код>: <первые 500 символов тела>` (для OpenAI/Anthropic — текст `error.message`) |
| Сетевая ошибка / сервис недоступен | `Cannot reach agent at <url>: …` |
| Нет ответа в течение idle-таймаута (до заголовков) | `Agent did not respond within N minute(s).` |
| Тишина после начала тела (нет чанков) | `Agent went idle for N minute(s) (no data)…` — запрос abort'нут, агент (Hermes/GPU) тоже останавливается. Увеличьте `xplain.agent.timeoutMinutes` или убедитесь, что сервер шлёт keepalive / progress |
| Остановка пользователем (**Stop** / команда / Cancel прогресса) | Сессия удаляется, уведомление «Request stopped.» |
| Событие `error` в потоке | Сообщение показывается пользователю, сессия помечена `failed` |
| Пустой ответ | `… empty answer` / `Agent stream finished without any content` |
| Не задан ключ Anthropic / модель / base URL | Ошибка до отправки с подсказкой открыть вкладку Agent |

Текст ошибки сохраняется в `context.json` сессии и виден в History. Контекст пользователя при ошибке
не очищается — можно исправить и отправить снова. Провайдер, endpoint/base URL и модель, которыми был
получен ответ, записываются в `context.json` (`agent.provider`, `agent.endpoint`, `agent.model`).

## Список моделей и проверка соединения

Вкладка Agent заполняет выпадающий список **Model** автоматически (сообщение `listModels`, таймаут ≤ 15 с):

| Провайдер | Запрос |
| --- | --- |
| `hermes`, `openai` | `GET {baseUrl}/models` → `data[].id` (у Hermes — профили harness'а) |
| `anthropic` | `GET {baseUrl}/v1/models?limit=100` → `data[].id` |
| `xplain`, `mock` | нет discovery-эндпойнта; модель не выбирается |

Запрос выполняется при открытии вкладки, смене провайдера/Base URL (с задержкой 400 мс при наборе),
после сохранения ключа и по кнопке ↻. Ответ помечен `provider` и `baseUrl`, поэтому список от старого
адреса не показывается для нового. При ошибке (`error`) форма переключается на ручной ввод id.

**Test connection** использует значения из формы (ещё не сохранённые) и **сохранённый** ключ API; таймаут
— не более 20 с:

| Провайдер | Что делает |
| --- | --- |
| `hermes`, `openai`, `anthropic`, `cursor` | список моделей; сообщает их число и есть ли среди них выбранная |
| `xplain` | Отправляет короткий запрос-«ping» с пустым `items` и ждёт любой валидный ответ |
| `mock` | Всегда успешно |

## Безопасность

- Ключи API живут в `SecretStorage` VS Code (по одному на провайдера), в настройки и `.xplain/` не
  попадают. Отправляются как `Authorization: Bearer` (Hermes, OpenAI, XPlain) или `x-api-key` (Anthropic).
- Итоговый ответ всегда HTML в Shadow DOM панели Result (без nested iframe), без доступа к API VS Code.
  Markdown от агента перед сохранением конвертируется без raw-HTML (`markdown-it` `html: false`).
- При Remote-SSH запрос уходит с удалённой машины (где работает extension host), а не с клиента —
  учитывайте это при настройке сетевого доступа к агенту (например, `127.0.0.1` означает удалённый хост).

## Минимальный сервер (Python)

```python
from http.server import BaseHTTPRequestHandler, HTTPServer
import json

class H(BaseHTTPRequestHandler):
    def do_POST(self):
        req = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        answer = my_agent(req["question"], req["items"])          # ваша логика
        body = json.dumps({"title": answer.title, "format": "markdown", "content": answer.text}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)

HTTPServer(("127.0.0.1", 8765), H).serve_forever()
```
