# Chrome-расширение ТЗ-Ассистент Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unpacked MV3-расширение в `extension/`, которое берёт текст со страницы (выделение или страница) и показывает в Side Panel тот же LLM-анализ, что сайт, через `POST /api/analyze`.

**Architecture:** Статика без сборки. Content script собирает текст, service worker читает cookie `auth_token` с `localhost:5173` через `chrome.cookies` и шлёт JWT как `Authorization: Bearer` на `localhost:3001`. Side Panel рисует превью, прогресс и отчёт. Сервер: CORS для `chrome-extension://` и разбор токена из cookie или Bearer.

**Tech Stack:** Chrome Manifest V3, vanilla JS (ES modules в worker и панели), Hono CORS/auth, существующий OpenRouter-анализ.

## Global Constraints

- Автотестов нет (spec). Проверка: curl для API, ручной чеклист для расширения.
- API: `http://localhost:3001`, сайт: `http://localhost:5173`. URL не конфигурируются.
- Cookie: `auth_token` (httpOnly, SameSite=Lax) на origin сайта, не на :3001.
- Лимиты текста: мин. 10, макс. 50 000 символов.
- Ключ OpenRouter и JWT не попадают в content script и на страницу.
- CORS: не использовать `origin: '*'`.
- Состояния панели: `idle` | `need_login` | `page_unavailable` | `too_short` | `analyzing` | `results` | `error`.
- Chrome ≥ 114. Имя расширения: «ТЗ-Ассистент».
- Вне скоупа: логин в расширении, overlay, iframe сайта, Vite-сборка, публикация в магазине.

## File map

**Создать**

| Файл | Ответственность |
|---|---|
| `extension/manifest.json` | MV3, permissions, side panel, content scripts |
| `extension/config.js` | `SITE_URL`, `API_URL`, лимиты, имя cookie, тексты ошибок |
| `extension/extract.js` | `collectPageText()` — выделение или innerText body |
| `extension/content.js` | Слушает `GET_PAGE_TEXT`, вызывает `collectPageText` |
| `extension/background.js` | Меню, панель, cookie, `CAPTURE_TEXT` / `ANALYZE` / `GET_SESSION` |
| `extension/markdown.js` | `buildMarkdown(result)` — копия логики `src/lib/exporter.ts` |
| `extension/sidepanel.html` | Разметка панели |
| `extension/sidepanel.css` | Стили в духе сайта (slate/indigo) |
| `extension/sidepanel.js` | Состояния UI, рендер отчёта, экспорт |
| `extension/icons/icon16.png` | Иконка 16 |
| `extension/icons/icon48.png` | Иконка 48 |
| `extension/icons/icon128.png` | Иконка 128 |
| `extension/README.md` | Как загрузить unpacked |

**Изменить**

| Файл | Что |
|---|---|
| `server/middleware/auth.ts` | `getAuthToken(c)`: cookie или Bearer; `requireAuth` через него |
| `server/routes/auth.ts` | `/me` через `getAuthToken` |
| `server/index.ts` | CORS: localhost + `chrome-extension://`, `Authorization` |

**Протокол сообщений** (фиксируем здесь, все задачи используют эти имена)

```js
// sidepanel → background
{ type: 'GET_SESSION' }
// ← { ok: true, loggedIn: boolean }

{ type: 'CAPTURE_TEXT' }
// ← { ok: true, text: string, truncated: boolean, source: 'selection' | 'page' }
// ← { ok: false, error: 'page_unavailable' }

{ type: 'ANALYZE', text: string }
// ← { ok: true, result: AnalysisResult }
// ← { ok: false, code: 'need_login' | 'unavailable' | 'server', error: string }

// background → content
{ type: 'GET_PAGE_TEXT' }
// ← тот же CaptureResult, что CAPTURE_TEXT ok:true
```

`AnalysisResult`: `{ words, entities, attributes, sections, gaps, recommendations }` как в `shared/analysis.ts`.

---

### Task 1: Bearer-токен и CORS

**Files:**
- Modify: `server/middleware/auth.ts`
- Modify: `server/routes/auth.ts`
- Modify: `server/index.ts`

**Interfaces:**
- Consumes: `COOKIE_NAME`, `verifyToken` из `server/lib/token.ts`; `getCookie` из `hono/cookie`
- Produces: `getAuthToken(c: Context): string | undefined` — cookie `auth_token` или `Authorization: Bearer <jwt>`

- [ ] **Step 1: Добавить `getAuthToken` и переключить `requireAuth`**

В `server/middleware/auth.ts` заменить содержимое на:

```ts
import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { getCookie } from 'hono/cookie'
import { COOKIE_NAME, verifyToken } from '../lib/token'

export type AuthVariables = {
  userId: number
  userLogin: string
}

export function getAuthToken(c: Context): string | undefined {
  const fromCookie = getCookie(c, COOKIE_NAME)
  if (fromCookie) return fromCookie

  const header = c.req.header('Authorization') ?? ''
  const parts = header.split(/\s+/)
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer' || !parts[1]) {
    return undefined
  }
  return parts[1]
}

export const requireAuth = createMiddleware<{ Variables: AuthVariables }>(
  async (c, next) => {
    const token = getAuthToken(c)
    if (!token) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const payload = await verifyToken(token)
    if (!payload) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    c.set('userId', payload.sub)
    c.set('userLogin', payload.login)
    await next()
  },
)
```

- [ ] **Step 2: `/me` читает тот же токен**

В `server/routes/auth.ts`:

- Убрать неиспользуемые импорты `getCookie` и `COOKIE_NAME`, если после правки они не нужны в `/me` (они по-прежнему нужны `setCookie`/`deleteCookie` в login/logout — `getCookie` и `COOKIE_NAME` можно убрать только если больше нигде в файле не используются; `COOKIE_NAME` остаётся для `setCookie`).
- Импортировать `getAuthToken` из `../middleware/auth`.
- В `auth.get('/me')` заменить `const token = getCookie(c, COOKIE_NAME)` на `const token = getAuthToken(c)`.

Итоговый `/me`:

```ts
auth.get('/me', async (c) => {
  const token = getAuthToken(c)
  if (!token) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const payload = await verifyToken(token)
  if (!payload) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const user = findUserById(payload.sub)
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  return c.json({ id: user.id, login: user.login })
})
```

- [ ] **Step 3: CORS для расширения**

В `server/index.ts` заменить блок `cors(...)` на:

```ts
app.use(
  '/api/*',
  cors({
    origin: (origin) => {
      const allowed = ['http://localhost:5173', 'http://127.0.0.1:5173']
      if (allowed.includes(origin)) return origin
      if (origin.startsWith('chrome-extension://')) return origin
      return undefined
    },
    credentials: true,
    allowHeaders: ['Content-Type', 'Authorization'],
  }),
)
```

- [ ] **Step 4: Проверить curl**

Сервер должен быть запущен (`npm run dev` или `npm run dev:server`).

```bash
curl -s -o /tmp/me.json -w "%{http_code}" http://localhost:3001/api/auth/me
# ожидается 401

curl -s -o /tmp/me.json -w "%{http_code}" \
  -H "Authorization: Bearer not-a-jwt" \
  http://localhost:3001/api/auth/me
# ожидается 401

TOKEN=$(curl -s -D - -o /tmp/login.json -X POST http://localhost:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"login":"<существующий>","password":"<пароль>"}' \
  | awk -F'[=;]' '/[Ss]et-[Cc]ookie: auth_token=/ {print $2; exit}')

curl -s -w "\n%{http_code}\n" \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/auth/me
# ожидается 200 и JSON { id, login }
```

Сайт через прокси (`/api/auth/me` с cookie) не должен сломаться: откройте `http://localhost:5173` уже залогиненным.

- [ ] **Step 5: Commit**

```bash
git add server/middleware/auth.ts server/routes/auth.ts server/index.ts
git commit -m "$(cat <<'EOF'
feat: accept Bearer JWT and allow chrome-extension CORS

EOF
)"
```

---

### Task 2: Каркас расширения

**Files:**
- Create: `extension/manifest.json`
- Create: `extension/config.js`
- Create: `extension/sidepanel.html`
- Create: `extension/sidepanel.css`
- Create: `extension/sidepanel.js`
- Create: `extension/background.js`
- Create: `extension/README.md`
- Create: `extension/icons/icon16.png`, `icon48.png`, `icon128.png`

**Interfaces:**
- Consumes: ничего из Task 1 на клиенте
- Produces: константы `SITE_URL`, `API_URL`, `COOKIE_NAME`, `MIN_TZ_CHARS`, `MAX_TZ_CHARS`, `ERROR_MESSAGES` из `extension/config.js`; пустой worker, который ставит `openPanelOnActionClick`

- [ ] **Step 1: `extension/config.js`**

```js
export const SITE_URL = 'http://localhost:5173'
export const SITE_URL_ALT = 'http://127.0.0.1:5173'
export const API_URL = 'http://localhost:3001'
export const COOKIE_NAME = 'auth_token'
export const MIN_TZ_CHARS = 10
export const MAX_TZ_CHARS = 50_000

export const ERROR_MESSAGES = {
  too_short:
    'Слишком мало текста. Выделите фрагмент ТЗ или откройте страницу с описанием задачи.',
  need_login: 'Войдите на сайте ТЗ-Ассистент',
  unavailable: 'Сервер недоступен. Запустите сайт (`npm run dev`) и попробуйте снова.',
  page_unavailable:
    'На этой странице текст недоступен. Откройте обычную веб-страницу или выделите текст.',
}
```

- [ ] **Step 2: `extension/manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "ТЗ-Ассистент",
  "version": "1.0.0",
  "description": "Анализ текста ТЗ со страницы — объекты, реквизиты, пробелы и рекомендации.",
  "minimum_chrome_version": "114",
  "action": {
    "default_title": "ТЗ-Ассистент",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  "side_panel": {
    "default_path": "sidepanel.html"
  },
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["http://*/*", "https://*/*"],
      "js": ["extract.js", "content.js"],
      "run_at": "document_idle"
    }
  ],
  "permissions": ["sidePanel", "activeTab", "scripting", "contextMenus", "cookies"],
  "host_permissions": [
    "http://localhost:5173/*",
    "http://127.0.0.1:5173/*",
    "http://localhost:3001/*",
    "http://127.0.0.1:3001/*"
  ]
}
```

Пока `extract.js` и `content.js` ещё нет — в Task 2 временно уберите `"js": ["extract.js", "content.js"]` из `content_scripts` **или** сразу создайте пустые файлы:

`extension/extract.js`:

```js
function collectPageText() {
  return { ok: true, text: '', truncated: false, source: 'page' }
}
```

`extension/content.js`:

```js
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'GET_PAGE_TEXT') {
    sendResponse(collectPageText())
  }
})
```

Полная реализация — Task 3. Пустые заглушки нужны, чтобы Chrome загрузил манифест.

- [ ] **Step 3: Иконки**

```bash
python3 - <<'PY'
import struct, zlib, pathlib
def png(size, rgb=(79, 70, 229)):
    raw = b''.join(b'\x00' + bytes(rgb) * size for _ in range(size))
    def chunk(tag, data):
        crc = zlib.crc32(tag + data) & 0xffffffff
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', crc)
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
out = pathlib.Path('extension/icons')
out.mkdir(parents=True, exist_ok=True)
for s in (16, 48, 128):
    (out / f'icon{s}.png').write_bytes(png(s))
print('ok')
PY
```

- [ ] **Step 4: Заглушки панели и worker**

`extension/background.js`:

```js
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  chrome.contextMenus.create({
    id: 'analyze-tz',
    title: 'Проанализировать ТЗ',
    contexts: ['selection', 'page'],
  })
})

chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
})

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'analyze-tz' || !tab?.id) return
  await chrome.sidePanel.open({ tabId: tab.id })
})
```

`extension/sidepanel.html`:

```html
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ТЗ-Ассистент</title>
    <link rel="stylesheet" href="sidepanel.css" />
  </head>
  <body>
    <header class="header">
      <h1>ТЗ-Ассистент</h1>
    </header>
    <main id="app">
      <p class="muted">Загрузка…</p>
    </main>
    <script type="module" src="sidepanel.js"></script>
  </body>
</html>
```

`extension/sidepanel.css`:

```css
:root {
  --bg: #f8fafc;
  --card: #ffffff;
  --text: #0f172a;
  --muted: #64748b;
  --line: #e2e8f0;
  --indigo: #4f46e5;
  --indigo-hover: #4338ca;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  background: linear-gradient(#f8fafc, #ffffff);
  color: var(--text);
  font-size: 14px;
  line-height: 1.45;
  min-height: 100vh;
}
.header {
  padding: 16px 16px 8px;
  border-bottom: 1px solid var(--line);
}
.header h1 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
}
main { padding: 16px; }
.muted { color: var(--muted); }
```

`extension/sidepanel.js`:

```js
document.getElementById('app').innerHTML =
  '<p class="muted">Расширение загружено. Сбор текста появится в следующем шаге.</p>'
```

`extension/README.md`:

```markdown
# ТЗ-Ассистент — расширение Chrome

1. Запустите сайт: `npm run dev` и войдите на http://localhost:5173
2. Откройте `chrome://extensions`, включите «Режим разработчика»
3. «Загрузить распакованное расширение» → папка `extension/`
4. На странице с ТЗ нажмите иконку расширения или пункт «Проанализировать ТЗ» в контекстном меню
```

- [ ] **Step 5: Проверить загрузку**

`chrome://extensions` → загрузить `extension/`. Ошибок в манифесте нет. Клик по иконке открывает боковую панель с текстом «Расширение загружено…». Правый клик на странице показывает «Проанализировать ТЗ».

- [ ] **Step 6: Commit**

```bash
git add extension
git commit -m "$(cat <<'EOF'
feat: add unpacked Chrome extension scaffold

EOF
)"
```

---

### Task 3: Сбор текста и превью в панели

**Files:**
- Modify: `extension/extract.js`
- Modify: `extension/content.js`
- Modify: `extension/background.js`
- Modify: `extension/sidepanel.html`
- Modify: `extension/sidepanel.css`
- Modify: `extension/sidepanel.js`

**Interfaces:**
- Consumes: `MAX_TZ_CHARS`, `MIN_TZ_CHARS`, `ERROR_MESSAGES` из `config.js`
- Produces: `collectPageText()` → `{ ok: true, text, truncated, source }`; background обрабатывает `CAPTURE_TEXT` и `GET_SESSION`; панель состояния `idle` | `too_short` | `page_unavailable` | `need_login`

- [ ] **Step 1: Реализовать `collectPageText`**

`extension/extract.js` — классический скрипт (не module), функция в изолированном мире content script:

```js
function collectPageText() {
  const MAX = 50000
  const selection = (window.getSelection()?.toString() ?? '').trim()
  if (selection) {
    const truncated = selection.length > MAX
    return {
      ok: true,
      text: truncated ? selection.slice(0, MAX) : selection,
      truncated,
      source: 'selection',
    }
  }

  if (!document.body) {
    return { ok: true, text: '', truncated: false, source: 'page' }
  }

  const clone = document.body.cloneNode(true)
  clone.querySelectorAll('script, style, noscript, svg, canvas').forEach((el) => el.remove())
  const raw = clone.innerText ?? ''
  const text = raw
    .split(/\n+/)
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim()
  const truncated = text.length > MAX
  return {
    ok: true,
    text: truncated ? text.slice(0, MAX) : text,
    truncated,
    source: 'page',
  }
}
```

`extension/content.js`:

```js
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'GET_PAGE_TEXT') return
  try {
    sendResponse(collectPageText())
  } catch {
    sendResponse({ ok: false, error: 'page_unavailable' })
  }
  return true
})
```

- [ ] **Step 2: Worker — сессия, захват, fallback `scripting`**

Заменить `extension/background.js` целиком:

```js
import { SITE_URL, SITE_URL_ALT, COOKIE_NAME, MAX_TZ_CHARS } from './config.js'

let pendingCapture = null

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  chrome.contextMenus.create({
    id: 'analyze-tz',
    title: 'Проанализировать ТЗ',
    contexts: ['selection', 'page'],
  })
})

chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
})

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'analyze-tz' || !tab?.id) return
  const selected = (info.selectionText ?? '').trim()
  if (selected) {
    const truncated = selected.length > MAX_TZ_CHARS
    pendingCapture = {
      ok: true,
      text: truncated ? selected.slice(0, MAX_TZ_CHARS) : selected,
      truncated,
      source: 'selection',
    }
  } else {
    pendingCapture = null
  }
  await chrome.sidePanel.open({ tabId: tab.id })
})

async function getAuthToken() {
  for (const url of [SITE_URL, SITE_URL_ALT]) {
    const cookie = await chrome.cookies.get({ url, name: COOKIE_NAME })
    if (cookie?.value) return cookie.value
  }
  return null
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  return tabs[0] ?? null
}

async function captureFromTab(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'GET_PAGE_TEXT' })
    if (response?.ok) return response
  } catch {
    // content script ещё не вставлен
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['extract.js'],
    })
    const [injected] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => collectPageText(),
    })
    if (injected?.result?.ok) return injected.result
  } catch {
    return { ok: false, error: 'page_unavailable' }
  }

  return { ok: false, error: 'page_unavailable' }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'GET_SESSION') {
    getAuthToken()
      .then((token) => sendResponse({ ok: true, loggedIn: Boolean(token) }))
      .catch(() => sendResponse({ ok: true, loggedIn: false }))
    return true
  }

  if (msg?.type === 'CAPTURE_TEXT') {
    ;(async () => {
      if (pendingCapture) {
        const capture = pendingCapture
        pendingCapture = null
        sendResponse(capture)
        return
      }
      const tab = await getActiveTab()
      if (!tab?.id) {
        sendResponse({ ok: false, error: 'page_unavailable' })
        return
      }
      sendResponse(await captureFromTab(tab.id))
    })()
    return true
  }
})
```

- [ ] **Step 3: Превью в панели**

`extension/sidepanel.html` — `main#app` оставить пустым, рендер из JS.

Дополнить `extension/sidepanel.css`:

```css
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 0;
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  width: 100%;
}
.btn:disabled { cursor: not-allowed; background: #cbd5e1; color: #fff; }
.btn-primary { background: var(--indigo); color: #fff; }
.btn-primary:hover:not(:disabled) { background: var(--indigo-hover); }
.btn-ghost {
  background: #fff;
  color: #334155;
  border: 1px solid #cbd5e1;
}
.preview {
  background: #f8fafc;
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 12px;
  max-height: 220px;
  overflow: auto;
  white-space: pre-wrap;
  font-size: 13px;
  color: #1e293b;
}
.banner {
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 13px;
  margin-bottom: 12px;
}
.banner-warn { background: #fffbeb; border: 1px solid #fde68a; color: #92400e; }
.banner-error { background: #fff1f2; border: 1px solid #fecdd3; color: #9f1239; }
.meta { font-size: 12px; color: var(--muted); margin: 8px 0 12px; }
```

`extension/sidepanel.js`:

```js
import { MIN_TZ_CHARS, ERROR_MESSAGES, SITE_URL } from './config.js'

const app = document.getElementById('app')

function countWords(text) {
  return text.trim() ? text.trim().split(/\s+/).filter(Boolean).length : 0
}

function renderNeedLogin() {
  app.innerHTML = `
    <div class="banner banner-error">${ERROR_MESSAGES.need_login}</div>
    <button class="btn btn-primary" id="open-site">Открыть сайт</button>
  `
  document.getElementById('open-site').onclick = () => chrome.tabs.create({ url: SITE_URL })
}

function renderUnavailable() {
  app.innerHTML = `<div class="banner banner-error">${ERROR_MESSAGES.page_unavailable}</div>`
}

function renderIdle(capture) {
  const tooShort = capture.text.trim().length < MIN_TZ_CHARS
  app.innerHTML = `
    ${capture.truncated ? '<div class="banner banner-warn">Текст обрезан до 50 000 символов.</div>' : ''}
    ${tooShort ? `<div class="banner banner-error">${ERROR_MESSAGES.too_short}</div>` : ''}
    <p class="meta">${countWords(capture.text)} слов · ${
      capture.source === 'selection' ? 'выделение' : 'страница'
    }</p>
    <pre class="preview">${escapeHtml(capture.text) || '—'}</pre>
    <div style="margin-top:12px">
      <button class="btn btn-primary" id="analyze" ${tooShort ? 'disabled' : ''}>Проанализировать ТЗ</button>
    </div>
  `
}

function escapeHtml(s) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

async function init() {
  const session = await chrome.runtime.sendMessage({ type: 'GET_SESSION' })
  if (!session?.loggedIn) {
    renderNeedLogin()
    return
  }
  const capture = await chrome.runtime.sendMessage({ type: 'CAPTURE_TEXT' })
  if (!capture?.ok) {
    renderUnavailable()
    return
  }
  renderIdle(capture)
}

init()
```

Кнопка «Проанализировать» пока ничего не делает — Task 4.

- [ ] **Step 4: Проверить захват**

1. Перезагрузить расширение на `chrome://extensions`.
2. Залогиниться на сайте, открыть любую статью → иконка → в панели превью текста страницы и число слов.
3. Выделить абзац → «Проанализировать ТЗ» → в превью только выделение, подпись «выделение».
4. `chrome://settings` → «текст недоступен».
5. Выйти на сайте, открыть панель → предложение войти.

- [ ] **Step 5: Commit**

```bash
git add extension
git commit -m "$(cat <<'EOF'
feat: capture page or selection text in the side panel

EOF
)"
```

---

### Task 4: Вызов `/api/analyze` и экраны анализа / ошибок

**Files:**
- Modify: `extension/background.js`
- Modify: `extension/sidepanel.js`
- Modify: `extension/sidepanel.css`

**Interfaces:**
- Consumes: `getAuthToken()` и `CAPTURE_TEXT` из Task 3; `API_URL`, `ERROR_MESSAGES`
- Produces: обработчик `{ type: 'ANALYZE', text: string }`; UI-состояния `analyzing`, `error`, `need_login` после 401

- [ ] **Step 1: ANALYZE в worker**

В конец `extension/background.js` (внутрь существующего `onMessage`, рядом с `CAPTURE_TEXT`) добавить ветку. Не дублировать listener — один `onMessage`. Итоговый listener:

```js
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'GET_SESSION') {
    getAuthToken()
      .then((token) => sendResponse({ ok: true, loggedIn: Boolean(token) }))
      .catch(() => sendResponse({ ok: true, loggedIn: false }))
    return true
  }

  if (msg?.type === 'CAPTURE_TEXT') {
    ;(async () => {
      if (pendingCapture) {
        const capture = pendingCapture
        pendingCapture = null
        sendResponse(capture)
        return
      }
      const tab = await getActiveTab()
      if (!tab?.id) {
        sendResponse({ ok: false, error: 'page_unavailable' })
        return
      }
      sendResponse(await captureFromTab(tab.id))
    })()
    return true
  }

  if (msg?.type === 'ANALYZE') {
    ;(async () => {
      const token = await getAuthToken()
      if (!token) {
        sendResponse({
          ok: false,
          code: 'need_login',
          error: 'Войдите на сайте ТЗ-Ассистент',
        })
        return
      }

      try {
        const res = await fetch(`${API_URL}/api/analyze`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ text: msg.text }),
        })

        let data = null
        const raw = await res.text()
        if (raw) {
          try {
            data = JSON.parse(raw)
          } catch {
            data = { error: raw }
          }
        }

        if (res.status === 401) {
          sendResponse({
            ok: false,
            code: 'need_login',
            error: 'Войдите на сайте ТЗ-Ассистент',
          })
          return
        }

        if (!res.ok) {
          const message =
            data && typeof data === 'object' && typeof data.error === 'string'
              ? data.error
              : 'Не удалось проанализировать ТЗ'
          sendResponse({
            ok: false,
            code: 'server',
            error: message,
          })
          return
        }

        sendResponse({ ok: true, result: data })
      } catch {
        sendResponse({
          ok: false,
          code: 'unavailable',
          error: 'Сервер недоступен. Запустите сайт (`npm run dev`) и попробуйте снова.',
        })
      }
    })()
    return true
  }
})
```

Добавить импорт `API_URL` в существующую строку импорта из `./config.js`.

- [ ] **Step 2: Экран «Идёт анализ…» и обработка ответа**

В `sidepanel.js` хранить последний `capture` в переменной модуля `let currentCapture = null`. В `init()` после успешного `CAPTURE_TEXT` присвоить `currentCapture = capture` до `renderIdle(capture)`.

Константа шагов (как `AnalyzingStep`):

```js
const ANALYZE_STEPS = [
  'Разбор текста ТЗ',
  'Поиск объектов конфигурации',
  'Выделение реквизитов',
  'Проверка пробелов в требованиях',
  'Формирование отчёта',
]
```

`renderAnalyzing()` рисует список шагов и прогресс-бар. Запускать `setInterval` на 700 мс, индекс от 0 до `ANALYZE_STEPS.length - 1`. Сбрасывать интервал при уходе с экрана.

Кнопка `#analyze`:

```js
document.getElementById('analyze').onclick = async () => {
  const text = currentCapture.text
  renderAnalyzing()
  const res = await chrome.runtime.sendMessage({ type: 'ANALYZE', text })
  if (!res?.ok) {
    if (res?.code === 'need_login') {
      renderNeedLogin()
      return
    }
    const message =
      res?.code === 'unavailable' ? ERROR_MESSAGES.unavailable : (res?.error ?? ERROR_MESSAGES.unavailable)
    renderError(message)
    return
  }
  // renderResults — Task 5; пока:
  app.innerHTML = `<p>Анализ готов: ${res.result.entities?.length ?? 0} объектов. Полный отчёт — в следующем шаге.</p>
    <button class="btn btn-ghost" id="reset">Новый анализ</button>`
  document.getElementById('reset').onclick = init
}
```

`renderError(message)`:

```js
function renderError(message) {
  app.innerHTML = `
    <div class="banner banner-error">${escapeHtml(message)}</div>
    <button class="btn btn-ghost" id="retry">Повторить</button>
  `
  document.getElementById('retry').onclick = init
}
```

`renderAnalyzing` CSS:

```css
.steps { list-style: none; padding: 0; margin: 16px 0 0; }
.step {
  display: flex;
  gap: 10px;
  align-items: center;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 10px 12px;
  margin-bottom: 8px;
  color: #94a3b8;
}
.step.active { border-color: #c7d2fe; background: #eef2ff; color: #3730a3; }
.step.done { border-color: #c7d2fe; background: #eef2ff; color: #3730a3; font-weight: 600; }
.progress { height: 8px; background: #e2e8f0; border-radius: 999px; overflow: hidden; }
.progress > span {
  display: block;
  height: 100%;
  background: var(--indigo);
  width: 0;
  transition: width 0.3s ease;
}
.spinner {
  width: 40px;
  height: 40px;
  border: 3px solid #c7d2fe;
  border-top-color: var(--indigo);
  border-radius: 50%;
  margin: 0 auto 16px;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .spinner { animation: none; }
  .progress > span { transition: none; }
}
```

Разметка analyzing:

```js
function renderAnalyzing() {
  app.innerHTML = `
    <div class="spinner" aria-hidden="true"></div>
    <h2 style="text-align:center;font-size:18px;margin:0 0 16px">Идёт анализ…</h2>
    <div class="progress"><span id="bar"></span></div>
    <ul class="steps" id="steps"></ul>
  `
  let index = 0
  const stepsEl = document.getElementById('steps')
  const bar = document.getElementById('bar')
  const paint = () => {
    stepsEl.innerHTML = ANALYZE_STEPS.map((label, i) => {
      const cls = i < index ? 'step done' : i === index ? 'step active' : 'step'
      const mark = i < index ? '✓' : String(i + 1)
      return `<li class="${cls}"><span>${mark}</span><span>${label}</span></li>`
    }).join('')
    bar.style.width = `${((index + 1) / ANALYZE_STEPS.length) * 100}%`
  }
  paint()
  const timer = setInterval(() => {
    index = Math.min(index + 1, ANALYZE_STEPS.length - 1)
    paint()
    if (index === ANALYZE_STEPS.length - 1) clearInterval(timer)
  }, 700)
  renderAnalyzing._timer = timer
}
```

Перед каждым новым `app.innerHTML` вызывать `clearInterval(renderAnalyzing._timer)`.

- [ ] **Step 3: Проверить анализ**

1. Сервер запущен, пользователь залогинен, OpenRouter-ключ в `.env`.
2. Страница с ТЗ ≥ 10 символов → «Проанализировать ТЗ» → шаги → временный текст «Анализ готов: N объектов».
3. Остановить сервер → «Сервер недоступен…».
4. Logout → сразу `need_login` при открытии; если сессия истекла во время анализа — 401 → `need_login`.

- [ ] **Step 4: Commit**

```bash
git add extension/background.js extension/sidepanel.js extension/sidepanel.css
git commit -m "$(cat <<'EOF'
feat: analyze captured TZ text through the existing API

EOF
)"
```

---

### Task 5: Отчёт, Markdown-экспорт, «Новый анализ»

**Files:**
- Create: `extension/markdown.js`
- Modify: `extension/sidepanel.js`
- Modify: `extension/sidepanel.css`

**Interfaces:**
- Consumes: `AnalysisResult` из ответа ANALYZE; формат `buildMarkdown` как в `src/lib/exporter.ts`
- Produces: `buildMarkdown(result: AnalysisResult): string`; `renderResults(result)`

- [ ] **Step 1: `extension/markdown.js`**

Скопировать логику `buildMarkdown` из `src/lib/exporter.ts` один в один (без TypeScript-типов):

```js
export function buildMarkdown(result) {
  const lines = []
  lines.push('# Анализ технического задания')
  lines.push('', `_Сформировано автоматически. Количество слов в ТЗ: **${result.words}**._`)
  lines.push('', '> Результаты носят рекомендательный характер и требуют проверки аналитиком и разработчиком.')

  lines.push('', '## Найденные объекты конфигурации')
  if (result.entities.length === 0) {
    lines.push('', 'Явных имён объектов не обнаружено. Укажите их в кавычках с типом.')
  } else {
    lines.push('', '| Объект | Тип | Уверенность | Упоминаний |')
    lines.push('| --- | --- | --- | --- |')
    for (const e of result.entities) {
      lines.push(`| ${e.name} | ${e.type} | ${e.confidence} | ${e.count} |`)
    }
  }

  lines.push('', '## Предполагаемые реквизиты')
  if (result.attributes.length === 0) {
    lines.push('', 'Реквизиты не обнаружены.')
  } else {
    lines.push('', result.attributes.map((a) => `- ${a.name}`).join('\n'))
  }

  lines.push('', '## Затронутые разделы конфигурации')
  if (result.sections.length === 0) {
    lines.push('', 'Разделы не определены.')
  } else {
    lines.push('', result.sections.map((s) => `- ${s.name}`).join('\n'))
  }

  lines.push('', '## Пробелы в требованиях и вопросы для уточнения')
  if (result.gaps.length === 0) {
    lines.push('', 'Существенных пробелов не выявлено.')
  } else {
    for (const g of result.gaps) {
      const sev =
        g.severity === 'critical' ? 'критично' : g.severity === 'warning' ? 'важно' : 'уточнить'
      lines.push('', `### ${g.title} (${sev})`)
      lines.push('', g.description)
      lines.push('', `> **Уточнить:** ${g.question}`)
    }
  }

  lines.push('', '## Рекомендации')
  for (const r of result.recommendations) {
    lines.push('', `- ${r.text}`)
  }

  lines.push('', '## Технические детали (блок для вставки в ТЗ)')
  lines.push('', '**Объекты конфигурации:**')
  if (result.entities.length === 0) {
    lines.push('- _не указаны_')
  } else {
    for (const e of result.entities) lines.push(`- «${e.name}» — ${e.type.toLowerCase()}`)
  }
  lines.push('', '**Предполагаемые реквизиты:**')
  if (result.attributes.length === 0) {
    lines.push('- _не указаны_')
  } else {
    for (const a of result.attributes) lines.push(`- ${a.name}`)
  }
  lines.push('', '**Затронутые разделы:**')
  if (result.sections.length === 0) {
    lines.push('- _не определены_')
  } else {
    for (const s of result.sections) lines.push(`- ${s.name}`)
  }

  return lines.join('\n')
}
```

- [ ] **Step 2: Стили отчёта**

Добавить в `sidepanel.css` (цвета как в `ResultsStep`):

```css
.stats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 16px; }
.stat {
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 10px;
  background: #fff;
}
.stat strong { display: block; font-size: 20px; }
.stat span { font-size: 11px; color: var(--muted); }
.stat.blue { background: #eff6ff; border-color: #bfdbfe; }
.stat.violet { background: #f5f3ff; border-color: #ddd6fe; }
.stat.amber { background: #fffbeb; border-color: #fde68a; }
.stat.rose { background: #fff1f2; border-color: #fecdd3; }
section { margin-bottom: 20px; }
section h2 { font-size: 15px; margin: 0 0 8px; }
.table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 12px; }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
th { text-align: left; background: #f8fafc; padding: 8px; text-transform: uppercase; font-size: 10px; color: #475569; }
td { padding: 8px; border-top: 1px solid #f1f5f9; }
.badge {
  display: inline-block;
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
  border: 1px solid transparent;
}
.type-badge[data-type="Документ"] { background: #dbeafe; color: #1e40af; border-color: #bfdbfe; }
.type-badge[data-type="Справочник"] { background: #ede9fe; color: #5b21b6; border-color: #ddd6fe; }
.type-badge[data-type="Регистр"] { background: #fef3c7; color: #92400e; border-color: #fde68a; }
.type-badge[data-type="Отчёт"] { background: #d1fae5; color: #065f46; border-color: #a7f3d0; }
.type-badge[data-type="Обработка"] { background: #fce7f3; color: #9d174d; border-color: #fbcfe8; }
.type-badge[data-type="Перечисление"] { background: #cffafe; color: #155e75; border-color: #a5f3fc; }
.type-badge[data-type="Константа"] { background: #f1f5f9; color: #1e293b; border-color: #e2e8f0; }
.type-badge[data-type="Бизнес-процесс"] { background: #ffedd5; color: #9a3412; border-color: #fed7aa; }
.type-badge[data-type="Объект"] { background: #f3f4f6; color: #4b5563; border-color: #e5e7eb; }
.conf-высокая { background: #dcfce7; color: #15803d; }
.conf-средняя { background: #fef9c3; color: #a16207; }
.conf-низкая { background: #f1f5f9; color: #64748b; }
.tags { display: flex; flex-wrap: wrap; gap: 6px; }
.tag {
  border-radius: 999px;
  border: 1px solid #c7d2fe;
  background: #eef2ff;
  color: #3730a3;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 600;
}
.tag.plain { background: #fff; border-color: var(--line); color: #334155; }
.gap {
  border-radius: 12px;
  border: 1px solid var(--line);
  padding: 12px;
  margin-bottom: 8px;
}
.gap.critical { background: #fff1f2; border-color: #fecdd3; }
.gap.warning { background: #fffbeb; border-color: #fde68a; }
.gap.info { background: #f0f9ff; border-color: #bae6fd; }
.gap .sev { font-size: 10px; font-weight: 700; text-transform: uppercase; }
.ok { background: #f0fdf4; border: 1px solid #bbf7d0; color: #15803d; border-radius: 10px; padding: 12px; }
.rec { display: flex; gap: 8px; margin-bottom: 8px; font-size: 13px; }
.rec .mark { color: var(--indigo); }
.row-btns { display: flex; flex-direction: column; gap: 8px; }
```

- [ ] **Step 3: `renderResults`**

В `sidepanel.js` импортировать `buildMarkdown` из `./markdown.js`. Заменить заглушку «Анализ готов» на:

```js
const SEVERITY_LABELS = { critical: 'Критично', warning: 'Важно', info: 'Уточнить' }

function renderResults(result) {
  const entityRows =
    result.entities.length === 0
      ? `<p class="muted">Явных имён объектов не обнаружено. Укажите их в кавычках с типом, например «Документ „Заказ клиента“».</p>`
      : `<div class="table-wrap"><table>
          <thead><tr><th>Объект</th><th>Тип</th><th>Уверенность</th><th>Упоминаний</th></tr></thead>
          <tbody>
            ${result.entities
              .map(
                (e) => `<tr>
                  <td>${escapeHtml(e.name)}</td>
                  <td><span class="badge type-badge" data-type="${escapeHtml(e.type)}">${escapeHtml(e.type)}</span></td>
                  <td><span class="badge conf-${escapeHtml(e.confidence)}">${escapeHtml(e.confidence)}</span></td>
                  <td style="text-align:right">${e.count}</td>
                </tr>`,
              )
              .join('')}
          </tbody>
        </table></div>`

  const attrs =
    result.attributes.length === 0
      ? `<p class="muted">Реквизиты не обнаружены.</p>`
      : `<div class="tags">${result.attributes
          .map((a) => `<span class="tag">${escapeHtml(a.name)} <small>×${a.count}</small></span>`)
          .join('')}</div>`

  const sections =
    result.sections.length === 0
      ? `<p class="muted">Разделы не определены.</p>`
      : `<div class="tags">${result.sections
          .map((s) => `<span class="tag plain">${escapeHtml(s.name)} <small>×${s.count}</small></span>`)
          .join('')}</div>`

  const gaps =
    result.gaps.length === 0
      ? `<p class="ok">Существенных пробелов не выявлено.</p>`
      : result.gaps
          .map(
            (g) => `<div class="gap ${g.severity}">
              <div class="sev">${SEVERITY_LABELS[g.severity] ?? g.severity}</div>
              <strong>${escapeHtml(g.title)}</strong>
              <p>${escapeHtml(g.description)}</p>
              <p><span class="muted">Уточнить:</span> ${escapeHtml(g.question)}</p>
            </div>`,
          )
          .join('')

  const recs =
    result.recommendations.length === 0
      ? `<p class="muted">Нет дополнительных рекомендаций.</p>`
      : result.recommendations
          .map((r) => `<div class="rec"><span class="mark">✦</span><span>${escapeHtml(r.text)}</span></div>`)
          .join('')

  app.innerHTML = `
    <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;margin-bottom:12px">
      <div>
        <h2 style="margin:0;font-size:18px">Результаты анализа</h2>
        <p class="muted">Результаты носят рекомендательный характер и требуют проверки человеком.</p>
      </div>
    </div>
    <button class="btn btn-ghost" id="reset" style="margin-bottom:16px">Новый анализ</button>
    <div class="stats">
      <div class="stat"><strong>${result.words}</strong><span>Слов в ТЗ</span></div>
      <div class="stat blue"><strong>${result.entities.length}</strong><span>Объектов</span></div>
      <div class="stat violet"><strong>${result.attributes.length}</strong><span>Реквизитов</span></div>
      <div class="stat amber"><strong>${result.sections.length}</strong><span>Разделов</span></div>
      <div class="stat rose"><strong>${result.gaps.length}</strong><span>Пробелов</span></div>
    </div>
    <section><h2>Найденные объекты конфигурации</h2>${entityRows}</section>
    <section><h2>Предполагаемые реквизиты</h2>${attrs}</section>
    <section><h2>Затронутые разделы конфигурации</h2>${sections}</section>
    <section><h2>Пробелы и вопросы для уточнения</h2>${gaps}</section>
    <section><h2>Рекомендации</h2>${recs}</section>
    <section>
      <h2>Экспорт результата</h2>
      <div class="row-btns">
        <button class="btn btn-primary" id="download">Скачать .md</button>
        <button class="btn btn-ghost" id="copy">Скопировать</button>
      </div>
    </section>
  `

  document.getElementById('reset').onclick = init

  const markdown = buildMarkdown(result)
  document.getElementById('copy').onclick = async () => {
    try {
      await navigator.clipboard.writeText(markdown)
      document.getElementById('copy').textContent = '✓ Скопировано'
      setTimeout(() => {
        const btn = document.getElementById('copy')
        if (btn) btn.textContent = 'Скопировать'
      }, 2000)
    } catch {
      document.getElementById('copy').textContent = 'Не удалось скопировать'
    }
  }
  document.getElementById('download').onclick = () => {
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'анализ-тз.md'
    a.click()
    URL.revokeObjectURL(url)
  }
}
```

В обработчике ANALYZE вызывать `renderResults(res.result)` вместо заглушки.

`init` при «Новый анализ» снова делает `GET_SESSION` + `CAPTURE_TEXT` с текущей активной вкладки.

- [ ] **Step 4: Полный ручной чеклист из spec**

1. `npm run dev`, логин на `http://localhost:5173`.
2. Перезагрузить unpacked из `extension/`.
3. Страница с ТЗ → иконка → анализ → отчёт: объекты, реквизиты, разделы, пробелы, рекомендации. Тот же текст на сайте даёт те же поля.
4. Выделение → контекстное меню → в панели только выделение.
5. Logout → предложение войти.
6. Сервер выключен → «Сервер недоступен».
7. `chrome://settings` → «текст недоступен».
8. Длинный текст → предупреждение об обрезке.
9. «Скопировать» / «Скачать .md» — Markdown совпадает по структуре с сайтом.

- [ ] **Step 5: Commit**

```bash
git add extension/markdown.js extension/sidepanel.js extension/sidepanel.css
git commit -m "$(cat <<'EOF'
feat: render TZ analysis report and markdown export in the side panel

EOF
)"
```

---

## Spec coverage

| Требование spec | Задача |
|---|---|
| Bearer + cookie, CORS chrome-extension | Task 1 |
| Каркас MV3, side panel, меню, иконки, README | Task 2 |
| Выделение иначе страница, truncate 50k, chrome:// | Task 3 |
| Cookie с :5173, ANALYZE, 401 / сеть / 502 | Task 4 |
| Отчёт как сайт, Markdown, новый анализ | Task 5 |
| JWT не в content script | Task 3–4: cookie только в worker |
| Нет логина в расширении, нет настроек URL | соблюдено во всех задачах |
