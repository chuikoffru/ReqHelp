# Chrome-расширение ТЗ-Ассистент

Дата: 2026-08-17  
Статус: утверждено в обсуждении (подход A)

## Проблема

Аналитик читает ТЗ в Confluence, почте или трекере. Чтобы разобрать текст тем же LLM-анализом, что на сайте, сейчас нужно копировать его вручную. Нужно расширение Chrome, которое забирает текст со страницы и показывает тот же отчёт в боковой панели.

## Цель

Unpacked Manifest V3 расширение в репозитории. По клику на иконку или пункт контекстного меню открывается Side Panel: если есть выделение — анализируется оно, иначе видимый текст страницы. Анализ идёт через существующий `POST /api/analyze`. Сессия сайта переиспользуется. Ключ OpenRouter на клиент и в расширение не попадает.

Вне скоупа: логин внутри расширения, настройки URL API, публикация в Chrome Web Store, автотесты, overlay на странице, iframe сайта.

## Контекст сайта

Сайт — помощник по ТЗ для 1С. Пользователь вставляет текст, сервер через OpenRouter возвращает `AnalysisResult`: объекты конфигурации, реквизиты, разделы, пробелы, рекомендации.

- Клиент: `http://localhost:5173`, API проксируется Vite на `http://localhost:3001`.
- Cookie `auth_token`: httpOnly, SameSite=Lax, Path=/. Браузер ставит её на origin `http://localhost:5173`, не на `:3001`.
- `POST /api/analyze` требует авторизации. Сейчас только cookie. CORS пускает только `localhost:5173` / `127.0.0.1:5173`.
- Лимиты текста: минимум 10 символов, максимум 50 000 (`shared/analysis.ts`).

Расширение не может опереться на cookie при `fetch` с `chrome-extension://`: SameSite=Lax на кросс-сайт POST не отправится. Поэтому worker читает cookie через `chrome.cookies` и шлёт JWT в `Authorization: Bearer`.

## Архитектура

```
Страница
  └── content.js — выделенный текст или innerText body
        └── runtime message → background.js

background.js
  ├── action / contextMenus → chrome.sidePanel.open
  ├── chrome.cookies.get(auth_token с http://localhost:5173)
  └── POST http://localhost:3001/api/analyze  (Authorization: Bearer)

sidepanel.html
  └── превью текста → анализ → отчёт как на сайте
```

Папка `extension/` — статика без сборки. React/Vite сайта не трогаем.

Сервер: CORS для `chrome-extension://`; `requireAuth` принимает cookie или Bearer с тем же JWT.

Секрет cookie в страницу не инжектится: его читает только service worker.

## Файлы

### Расширение

| Путь | Назначение |
|---|---|
| `extension/manifest.json` | MV3, side_panel, permissions |
| `extension/background.js` | Меню, панель, cookie, API, маршрутизация сообщений |
| `extension/content.js` | Сбор текста, ответ на `GET_PAGE_TEXT` |
| `extension/sidepanel.html` | Разметка панели |
| `extension/sidepanel.css` | Стили в духе сайта (slate/indigo) |
| `extension/sidepanel.js` | Состояния UI, вызов анализа, рендер отчёта |
| `extension/icons/icon16.png` | Иконка 16 |
| `extension/icons/icon48.png` | Иконка 48 |
| `extension/icons/icon128.png` | Иконка 128 |

### Сервер (точечные правки)

- `server/index.ts` — CORS: origin `chrome-extension://` с `credentials: true`.
- `server/middleware/auth.ts` — JWT из cookie `auth_token` или из `Authorization: Bearer <token>`.
- `server/routes/auth.ts` `/me` — тот же разбор токена (cookie или Bearer), чтобы API был единообразным. Панель `/me` не вызывает: нет cookie или 401 на analyze → `need_login`.

### Документация установки

`extension/README.md`: загрузить распакованное из `extension/`, нужен запущенный `npm run dev` и логин на сайте.

## Manifest

- `manifest_version`: 3
- `name`: «ТЗ-Ассистент»
- `action`: клик открывает side panel (`chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` при установке)
- `side_panel.default_path`: `sidepanel.html`
- `background.service_worker`: `background.js`
- `content_scripts`: `content.js` на `http://*/*` и `https://*/*` (document_idle)
- `permissions`: `sidePanel`, `activeTab`, `scripting`, `contextMenus`, `cookies`
- `host_permissions`: `http://localhost:5173/*`, `http://127.0.0.1:5173/*`, `http://localhost:3001/*`, `http://127.0.0.1:3001/*`
- `minimum_chrome_version`: 114 (Side Panel API)

`scripting` нужен, чтобы на вкладке без уже вставленного content script один раз выполнить сбор текста (пользователь только что поставил расширение).

## Сбор текста

Правило: непустой `window.getSelection().toString().trim()` — берём его. Иначе видимый текст страницы.

Текст страницы:

1. Клонировать `document.body`.
2. Удалить `script`, `style`, `noscript`, `svg`, `canvas`.
3. Взять `innerText`, схлопнуть пробелы по строкам, trim.

Если результат длиннее 50 000 символов — обрезать и вернуть флаг `truncated: true`.

Ограниченные страницы (`chrome://`, Chrome Web Store, PDF viewer, `file://` без доступа): content script не работает. Worker отвечает панели ошибкой `page_unavailable`.

Активная вкладка: `chrome.tabs.query({ active: true, lastFocusedWindow: true })` окна, из которого открыли панель. Если `windowId` известен из `sidePanel.open` — использовать его.

## Поток в UI

Состояния панели: `idle` | `need_login` | `page_unavailable` | `too_short` | `analyzing` | `results` | `error`.

1. Открытие панели (иконка или меню «Проанализировать ТЗ») запрашивает текст активной вкладки.
2. Превью текста, число слов, предупреждение об обрезке. Кнопка «Проанализировать ТЗ».
3. При открытии панели worker читает cookie. Нет токена — сразу `need_login` (кнопка открывает `http://localhost:5173`). Есть токен — можно анализировать без отдельного вызова `/me`.
4. `POST /api/analyze` `{ "text": "..." }` с Bearer. 401 → `need_login`. Успех — тело `AnalysisResult`.
5. Экран результатов как на сайте: карточки слов/объектов/реквизитов/разделов/пробелов; таблица объектов; теги реквизитов и разделов; карточки пробелов с severity; список рекомендаций.
6. Экспорт: скопировать Markdown тем же форматом, что `src/lib/exporter.ts` (`buildMarkdown`). Скачать файл `анализ-тз.md` через Blob + `<a download>`.
7. «Новый анализ» снова забирает текст с текущей активной вкладки.

Контекстное меню: при создании передавать `selectionText` если есть, иначе запросить content script. Меню показывать на `selection` и `page`.

## Авторизация и CORS

Константы в расширении (без настроек):

- `SITE_URL = "http://localhost:5173"`
- `API_URL = "http://localhost:3001"`

Чтение сессии:

```
chrome.cookies.get({ url: "http://localhost:5173", name: "auth_token" })
```

Если cookie нет — то же для `http://127.0.0.1:5173`.

Запросы к API: `Authorization: Bearer <token>`. Cookie в `fetch` не полагаемся.

CORS в `server/index.ts`: к текущим origin добавить функцию: если origin начинается с `chrome-extension://` — разрешить, `credentials: true`. Не использовать `origin: '*'`.

`requireAuth` и `/api/auth/me`:

1. Cookie `auth_token`, если есть.
2. Иначе `Authorization`, если значение вида `Bearer <jwt>`.
3. `verifyToken`, как сейчас.

Токен на страницу и в content script не передаём.

## Ошибки

| Ситуация | Состояние / текст |
|---|---|
| Текст короче 10 символов | `too_short`: «Слишком мало текста. Выделите фрагмент ТЗ или откройте страницу с описанием задачи.» |
| Текст обрезан до 50 000 | Предупреждение над превью, анализ разрешён |
| Нет cookie или 401 | `need_login`: «Войдите на сайте ТЗ-Ассистент», кнопка на `http://localhost:5173` |
| Сеть / API не запущен | `error`: «Сервер недоступен. Запустите сайт (`npm run dev`) и попробуйте снова.» |
| 502 / 503 | `error`: поле `error` из JSON сервера |
| Страница недоступна content script | `page_unavailable`: «На этой странице текст недоступен. Откройте обычную веб-страницу или выделите текст.» |

Сообщения без стека и внутренних деталей.

## UI панели

Визуально близко к сайту: фон `slate-50`, акцент indigo, скругления, те же подписи секций и цветов типов/severity, что в `ResultsStep`. Экран анализа — те же 5 шагов, что в `AnalyzingStep` (локальная анимация, не стрим с сервера).

Панель узкая (~400px): таблица объектов с горизонтальным скроллом, карточки пробелов столбиком.

Копирайт в панели не нужен. Блок примеров ТЗ и загрузка файлов — нет.

## Проверка

Автотестов нет. Ручной чеклист:

1. `npm run dev`, логин на `http://localhost:5173`.
2. `chrome://extensions` → «Загрузить распакованное» → `extension/`.
3. Страница с ТЗ → иконка → текст страницы в панели → анализ → отчёт совпадает по полям с сайтом на том же тексте.
4. Выделить абзац → меню «Проанализировать ТЗ» → в панели только выделение.
5. Logout на сайте → анализ → предложение войти.
6. Остановить сервер → «Сервер недоступен».
7. `chrome://settings` → «текст недоступен».
8. Текст > 50 000 символов → предупреждение об обрезке, запрос уходит.

## Не делается в этой версии

- Логин/пароль в расширении
- Конфиг URL API
- Публикация в магазине
- Overlay / iframe сайта
- Загрузка файлов и примеры ТЗ
- Сборка через Vite
