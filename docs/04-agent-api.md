# HTTP-контракт агента

XPlain не содержит LLM — он формирует контекст и отправляет его вашему сервису. Сервис может быть чем
угодно (одиночная модель, мультиагентный пайплайн, RAG), лишь бы он принимал запрос и возвращал ответ
в формате ниже. Референсная реализация на чистой стандартной библиотеке Python —
[`examples/agent_server.py`](../examples/agent_server.py).

## Запрос

```
POST <xplain.agent.endpoint>
Content-Type: application/json
Accept: application/x-ndjson, application/json     # или только application/json при streaming=false
Authorization: Bearer <ключ>                       # если задан через Set Agent API Key
<дополнительные заголовки из xplain.agent.headers>
```

Тело:

```jsonc
{
  "sessionId": "mv2ngpzs-a1e0626c",   // id сессии в .xplain/sessions/<id>/
  "question": "Why does the MMA warp wait on this barrier?",  // может быть пустой строкой
  "workspace": "XPlain",              // имя папки проекта (опционально)
  "items": [ /* в порядке, заданном пользователем */ ]
}
```

### Элементы `items`

Блок кода:

```jsonc
{
  "type": "code",
  "file": "debug_samples/4_warp_specialization.cu",  // путь относительно корня workspace, POSIX
  "startLine": 192, "endLine": 221,                   // 1-based, включительно
  "language": "cuda",                                 // languageId VS Code
  "text": "for (int kv_tile = 0; ...\n  ..."          // актуальный текст блока на момент отправки
}
```

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

## Ответ: один JSON-документ

`Content-Type: application/json` (или любой другой, не содержащий `ndjson` / `event-stream`):

```jsonc
{
  "title": "Barrier phases in the KV loop",   // опционально, ≤ ~70 символов, как название чата
  "format": "markdown",                       // "markdown" | "html"; по умолчанию markdown
  "content": "# Barrier phases...\n..."       // обязательное поле
}
```

Допускаются синонимы: `answer`, `markdown` (вместо `content`), `html` (подразумевает `format: html`).
Тело, не являющееся JSON, принимается как Markdown целиком.

## Ответ: поток NDJSON

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

1. `title` из ответа агента (рекомендуется);
2. первый заголовок `#`/`##`/`###` в Markdown или `<title>`/`<h1>` в HTML;
3. вопрос пользователя;
4. `имя_файла LNN-LMM: первая строка блока`.

Длинные заголовки обрезаются до 72 символов.

## Ошибки и таймауты

| Ситуация | Поведение XPlain |
| --- | --- |
| HTTP-статус не 2xx | Ошибка `Agent returned HTTP <код>: <первые 500 символов тела>` |
| Сетевая ошибка / сервис недоступен | `Cannot reach agent at <url>: …` |
| Превышен `xplain.agent.timeoutMs` | `Agent did not respond within N ms` |
| Отмена пользователем | Сессия удаляется, уведомление «Request cancelled» |
| Событие `error` в потоке | Сообщение показывается пользователю, сессия помечена `failed` |
| Пустой поток без контента | `Agent stream finished without any content` |

Текст ошибки сохраняется в `context.json` сессии и виден в History. Контекст пользователя при ошибке
не очищается — можно исправить и отправить снова.

## Безопасность

- Ключ API живёт в `SecretStorage` VS Code, в настройки и `.xplain/` не попадает.
- Ответ в формате Markdown рендерится без raw-HTML (`html: false`), HTML — в `iframe sandbox="allow-scripts"`
  без доступа к API VS Code.
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
