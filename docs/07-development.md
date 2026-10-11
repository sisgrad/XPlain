# Разработка

## Подготовка окружения

```bash
bash scripts/setup.sh --no-package   # поставит Node (если нужно), зависимости, соберёт бандлы
# или вручную при наличии Node >= 20:
npm install                          # postinstall собирает dist/
```

Node устанавливается через nvm в `~/.nvm`; в новой оболочке нужен `. ~/.nvm/nvm.sh` (скрипт
добавляет строки в `~/.bashrc`, если их там нет).

## Скрипты npm

| Команда | Действие |
| --- | --- |
| `npm run build` | Сборка `dist/extension.js` и `dist/webview.js` + копирование CSS/шрифтов (с sourcemap) |
| `npm run watch` | То же в режиме наблюдения |
| `npm run check` | `tsc --noEmit` для хоста (`tsconfig.json`) и webview (`webview/tsconfig.json`) |
| `npm run lint` | ESLint для `src/` и `webview/` |
| `npm test` | Компиляция в `out/` (`tsconfig.test.json`) и запуск mocha |
| `npm run package` | Production-сборка (minify, без sourcemap) + `vsce package` → `dist/xplain-<версия>.vsix` |
| `npm run install:ide` | `scripts/install.sh` — установка `.vsix` в найденные Cursor/VS Code |

## Отладка (F5)

`.vscode/launch.json` содержит конфигурацию **Run Extension**: собирает проект (`npm: build`) и запускает
Extension Development Host с открытой папкой `debug_samples/`. Там лежит `4_warp_specialization.cu` —
удобный большой файл для проверки якорей и CodeLens.

Рекомендуемый цикл:

1. `npm run watch` в терминале.
2. F5. После правок — **Developer: Reload Window** в окне Development Host (Ctrl+R).
3. Логи хоста — Output → **XPlain**; ошибки webview — **Developer: Open Webview Developer Tools**.

Для проверки без агента: вкладка Agent → **Mock (offline)** (или `xplain.agent.provider = mock`), либо
`python3 examples/agent_server.py` с провайдером **XPlain HTTP agent**. Для проверки чат-провайдеров без
внешних ключей удобен любой OpenAI-совместимый локальный сервер (Ollama, vLLM) через провайдер **OpenAI**.

## Структура исходников

```
src/                  extension host (TypeScript, CommonJS-бандл)
  shared/             типы и протокол, общие с webview (алиас @shared/*)
  storage/            .xplain/, абстракция FS
  editor/             якоря, CodeLens, декорации, pick mode
  agent/              AgentRegistry, провайдеры (xplain/hermes/openai/anthropic/cursor/mock), prompt, stream, titles
  skills/             bundled Excalidraw skill + install helpers
  panel/              WebviewView, фон
  context/            ContextDraft
  util/
webview/              UI (Preact, IIFE-бандл для браузера)
test/                 mocha-тесты (Node, без vscode)
scripts/              setup/install для Linux/macOS/Windows
examples/             референсный агент-сервер
media/                иконки
```

Два tsconfig: `tsconfig.json` (хост, `lib: ES2022`, без DOM) и `webview/tsconfig.json`
(браузер, `jsx: react-jsx`, `jsxImportSource: preact`). Общий код в `src/shared/` не должен
использовать ни `vscode`, ни Node-специфичные API.

## Сборка (esbuild.mjs)

- Хост: `src/extension.ts` → `dist/extension.js`, `platform: node`, `external: ['vscode']`, target node18.
- Webview: `webview/main.tsx` → `dist/webview.js`, `platform: browser`, формат IIFE, alias `@shared`.
- Статика: `webview/styles.css` → `dist/webview.css`; `highlight.js/styles/github-dark.min.css` → `dist/hljs.css`;
  `@vscode/codicons` → `dist/codicon.css` + `codicon.ttf`.
- Флаги: `--watch`, `--production` (minify, без sourcemap).

## Тесты

Юнит-тесты не зависят от `vscode`: хранилище работает через `NodeStoreFs` во временной директории,
провайдеры — против реального локального `http.Server`.

| Файл | Что проверяет |
| --- | --- |
| `test/anchors.test.ts` | нормализация/хеш, `toLineChange`, сдвиги диапазонов, поиск snippet, валидация хеша |
| `test/store.test.ts` | создание `.xplain`, переиспользование якорей, сессии ↔ якоря, результаты md/html, reload, шаблоны, фон |
| `test/html-result.test.ts` | `ensureSelfContainedHtml`: документ / фрагмент / Markdown→HTML |
| `test/inline-assets.test.ts` | встраивание локальных PNG-путей в `data:` URI |
| `test/skill-paths.test.ts` | канон `.xplain/skills/` и bridge-пути по провайдеру |
| `test/http.test.ts` | Провайдер `xplain`: JSON-ответ, NDJSON-стрим с дельтами, `done.content`, не-JSON тело, HTTP-ошибки, таймаут, отмена |
| `test/chat-providers.test.ts` | язык ответа / Excalidraw / focus+full-file в `buildChatPrompt`; `hermesHints` (разбор `/api/status`, тексты подсказок, probe); `buildChatPrompt` (порядок секций, ограждения, свой system prompt), `joinUrl`, `detectHtml`; OpenAI/Hermes SSE (keepalive, `hermes.tool.progress`, `[DONE]`), JSON-ответ, ошибки API, `/models`; Anthropic SSE/JSON, заголовки, обязательный ключ, `/v1/models` |
| `test/misc.test.ts` | `deriveTitle`, `ContextDraft`, `isViewMessage` |

`AgentRegistry` импортирует `vscode`, поэтому в mocha не тестируется; его можно проверить smoke-скриптом
с подменой модуля `vscode` через `Module._load` (стаб `workspace.getConfiguration` с `get/inspect/update`
и `context.secrets`).

Запуск: `npm test`. Один файл: `npx mocha out/test/anchors.test.js` после `tsc -p tsconfig.test.json`.

Интеграционных тестов в реальном VS Code нет (нет дисплея на хосте разработки). Ручной чек-лист перед релизом:

1. Shift+X на выделении → элемент `L..-L..` в панели, подсветка блока.
2. Send (mock) → стриминг во вкладке Result, CodeLens над блоком, запись в `.xplain/`.
3. Второй send того же блока → CodeLens `2 explanations`, Quick Pick с двумя пунктами.
4. Подблок внутри блока → отдельный CodeLens.
5. Pick mode: Shift+X вне редактора → клик CodeLens → результат в контексте.
6. Правка выше блока → CodeLens сдвигается; reload окна → якорь найден.
7. Templates: drop из Explorer и из ОС, сохранение, выбор в Context, передача в запрос.
8. Фон: выбор файла, drop картинки, настройки opacity/blur/fit, очистка.
9. Ответ всегда `result.html` (iframe в панели, Open in editor); Markdown от агента оборачивается автоматически.
10. Вкладка Agent: смена провайдера показывает его поля; Save key → индикатор `saved`, ключа нет в
    `settings.json`; выпадающий список Model заполняется с Hermes/Ollama сам (и после Save key), ↻ перезагружает, ✎ — ручной ввод;
    Save в workspace → `.vscode/settings.json`, футер Context обновился; Send через выбранного провайдера.

## Соглашения

- Только стабильные API VS Code; `engines.vscode` не поднимать без необходимости.
- Всё, что можно, держать вне зависимости от `vscode` ради тестируемости.
- UI-строки на английском; протокол и типы — в `src/shared/`, менять синхронно с webview.
- Изменения формата `.xplain/` — поднимать `XplainIndex.version` и писать миграцию в `XplainStore.init`.
- Коммиты — по фичам; перед коммитом `npm run check && npm run lint && npm test`.
- **Документация обновляется в том же изменении, что и код.** Любая правка поведения, настроек, команд,
  протокола, формата хранения или контракта агента сопровождается правкой соответствующих файлов в
  `docs/` (и `README.md`, если затронут обзор). Изменение без обновлённой документации считается незавершённым.
- Новый провайдер агента: реализовать `AgentProvider` в `src/agent/`, добавить id в `AGENT_PROVIDER_IDS`
  и `AgentSettings` (`src/shared/types.ts`), ветки в `AgentRegistry` (`read/save/provider/label/test`),
  ключи `xplain.agent.<id>.*` в `package.json`, поля формы в `webview/components/AgentTab.tsx`,
  тесты против локального `http.Server`, разделы в `docs/02`, `03`, `04`.

## Выпуск версии

1. Обновить `version` в `package.json` (и CHANGELOG при наличии).
2. `npm run check && npm run lint && npm test`.
3. `npm run package` → `dist/xplain-<версия>.vsix`.
4. `npm run install:ide` для локальной проверки; приложить `.vsix` к релизу.

Поле `repository` в `package.json` не задано, поэтому `vsce` вызывается с `--allow-missing-repository`;
при появлении удалённого репозитория добавьте поле и уберите флаг.
