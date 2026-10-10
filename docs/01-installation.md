# Установка

## Требования

- VS Code 1.85+ или Cursor (любая актуальная версия; проверено на Cursor 3.12 / VS Code API 1.128).
- Для сборки из исходников — Node.js 20+ (скрипт установит его сам, если отсутствует).
- Расширение не требует ничего в рантайме: все зависимости забандлены в `.vsix`.

## Где выполняется расширение

XPlain объявлен как `extensionKind: ["workspace"]`. Это значит:

- локально — работает как обычное расширение;
- при подключении через **Remote-SSH / WSL / Dev Containers** расширение устанавливается и работает
  на удалённой стороне, рядом с файлами проекта. Папка `.xplain/` создаётся на удалённой машине.
  UI-панель (webview) при этом отображается на клиенте — это штатное поведение VS Code.

## Вариант A — из готового `.vsix`

1. Возьмите `xplain-<версия>.vsix` (из релиза или соберите по варианту B).
2. Установите одним из способов:
   - Extensions → меню `…` → **Install from VSIX…**;
   - из командной строки: `cursor --install-extension xplain-0.1.0.vsix` (или `code …`).
3. Remote-SSH: если вы подключены к удалённой машине и устанавливаете через Extensions-view,
   VS Code сам поставит расширение на удалённую сторону. Если ставите из терминала —
   скопируйте `.vsix` на удалённую машину и выполните там `bash scripts/install.sh путь/к/xplain.vsix`.
4. Выполните **Developer: Reload Window**.

## Вариант B — из исходников (зависимости ставятся автоматически)

Linux / macOS / WSL:

```bash
git clone <repo> XPlain && cd XPlain
bash scripts/setup.sh --install
```

Windows (PowerShell):

```powershell
git clone <repo> XPlain; cd XPlain
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1 -Install
```

Что делает `setup.*`:

1. Проверяет `node >= 20`. Если его нет — ставит Node LTS:
   - Linux/macOS: через **nvm** в `~/.nvm` (без `sudo`); в конце печатает строки для добавления в профиль оболочки;
   - Windows: через `winget install OpenJS.NodeJS.LTS` (или `choco`, если winget недоступен).
2. `npm ci` (или `npm install`), сборка (`npm run build`), упаковка (`npm run package`) → `dist/xplain-<версия>.vsix`.
3. С флагом `--install` / `-Install` вызывает `install.*`.

Флаг `--no-package` / `-NoPackage` пропускает упаковку (для разработки).

## Скрипт установки `install.*`

```bash
bash scripts/install.sh                 # новейший dist/*.vsix во все найденные CLI
bash scripts/install.sh path/to/x.vsix  # явный файл
bash scripts/install.sh --cli code      # конкретный CLI
npm run install:ide                     # то же, что scripts/install.sh
```

Порядок поиска CLI: `cursor`, `code`, `code-insiders`, затем серверные CLI
`~/.cursor-server/bin/*/bin/cursor-server` и `~/.vscode-server/bin/*/bin/code-server`
(нужны при Remote-SSH, когда скрипт запускается на удалённой машине).
Дубликаты (например `cursor` → remote-cli того же сервера) отфильтровываются.
Устанавливается с `--force`, поэтому скрипт годится и для обновления.

`install.ps1` ищет `cursor`, `code`, `code-insiders` в `PATH`; параметры `-Vsix`, `-Cli`.

## После установки

1. Иконка XPlain появляется в activity bar (левая вертикальная панель). Клик открывает панель.
2. При первом открытии папки расширение создаёт `.xplain/` в корне первого workspace-фолдера.
3. Откройте вкладку **Agent** в панели и выберите, кто будет отвечать:
   - **Hermes Agent** — укажите Base URL API-сервера Hermes (`http://127.0.0.1:8642/v1`), модель/профиль и
     ключ `API_SERVER_KEY`;
   - **Anthropic (Claude)** или **OpenAI / Codex** — модель и ключ API;
   - **XPlain HTTP agent** — endpoint своего сервиса (по умолчанию `http://127.0.0.1:8765/explain`;
     референсный сервер: `python3 examples/agent_server.py`);
   - **Mock (offline)** — для проверки интерфейса без бэкенда.
4. Нажмите **Test connection**, затем **Save**. Ключи сохраняются в SecretStorage IDE сразу при нажатии
   **Save key**; в `settings.json` они не попадают. Подробнее — [руководство](02-user-guide.md#вкладка-agent).

## Обновление

Соберите новую версию и снова выполните `scripts/install.sh` (или Install from VSIX). Данные в `.xplain/`
не затрагиваются.

## Удаление

Extensions → XPlain → Uninstall, либо `cursor --uninstall-extension xplain.xplain`.
Папку `.xplain/` в проекте и фон в global storage удалите вручную при необходимости.
