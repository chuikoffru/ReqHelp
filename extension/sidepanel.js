import { MIN_TZ_CHARS, ERROR_MESSAGES, SITE_URL } from './config.js'
import { buildMarkdown } from './markdown.js'

const app = document.getElementById('app')
const parsedPanelTabId = Number.parseInt(new URLSearchParams(window.location.search).get('tabId') ?? '', 10)
const panelTabId = Number.isInteger(parsedPanelTabId) ? parsedPanelTabId : null
const ANALYZE_STEPS = [
  'Разбор текста ТЗ',
  'Поиск объектов конфигурации',
  'Выделение реквизитов',
  'Проверка пробелов в требованиях',
  'Формирование отчёта',
]
const SEVERITY_LABELS = { critical: 'Критично', warning: 'Важно', info: 'Уточнить' }

let currentCapture = null

function countWords(text) {
  return text.trim() ? text.trim().split(/\s+/).filter(Boolean).length : 0
}

function clearAnalyzingTimer() {
  if (renderAnalyzing._timer) {
    clearInterval(renderAnalyzing._timer)
    renderAnalyzing._timer = null
  }
}

function setAppHtml(html) {
  clearAnalyzingTimer()
  app.innerHTML = html
}

function renderNeedLogin() {
  setAppHtml(`
    <div class="banner banner-error">${ERROR_MESSAGES.need_login}</div>
    <button class="btn btn-primary" id="open-site">Открыть сайт</button>
  `)
  document.getElementById('open-site').onclick = () => chrome.tabs.create({ url: SITE_URL })
}

function renderUnavailable() {
  setAppHtml(`<div class="banner banner-error">${ERROR_MESSAGES.page_unavailable}</div>`)
}

function renderError(message) {
  setAppHtml(`
    <div class="banner banner-error">${escapeHtml(message)}</div>
    <button class="btn btn-ghost" id="retry">Повторить</button>
  `)
  document.getElementById('retry').onclick = init
}

function renderIdle(capture) {
  const tooShort = capture.text.trim().length < MIN_TZ_CHARS
  setAppHtml(`
    ${capture.truncated ? '<div class="banner banner-warn">Текст обрезан до 50 000 символов.</div>' : ''}
    ${tooShort ? `<div class="banner banner-error">${ERROR_MESSAGES.too_short}</div>` : ''}
    <p class="meta">${countWords(capture.text)} слов · ${
      capture.source === 'selection' ? 'выделение' : 'страница'
    }</p>
    <pre class="preview">${escapeHtml(capture.text) || '—'}</pre>
    <div style="margin-top:12px">
      <button class="btn btn-primary" id="analyze" ${tooShort ? 'disabled' : ''}>Проанализировать ТЗ</button>
    </div>
  `)
  document.getElementById('analyze').onclick = async () => {
    const text = currentCapture?.text ?? ''
    renderAnalyzing()
    try {
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
      renderResults(res.result)
    } catch {
      renderError(ERROR_MESSAGES.unavailable)
    }
  }
}

function renderAnalyzing() {
  setAppHtml(`
    <div class="spinner" aria-hidden="true"></div>
    <h2 style="text-align:center;font-size:18px;margin:0 0 16px">Идёт анализ…</h2>
    <div class="progress"><span id="bar"></span></div>
    <ul class="steps" id="steps"></ul>
  `)
  let index = 0
  const stepsEl = document.getElementById('steps')
  const bar = document.getElementById('bar')
  const paint = () => {
    stepsEl.innerHTML = ANALYZE_STEPS.map((label, i) => {
      const cls = i < index ? 'step done' : i === index ? 'step active' : 'step'
      const mark = i < index ? '\u2713' : String(i + 1)
      return `<li class="${cls}"><span>${mark}</span><span>${label}</span></li>`
    }).join('')
    bar.style.width = `${((index + 1) / ANALYZE_STEPS.length) * 100}%`
  }
  paint()
  const timer = setInterval(() => {
    index = Math.min(index + 1, ANALYZE_STEPS.length - 1)
    paint()
    if (index === ANALYZE_STEPS.length - 1) {
      clearInterval(timer)
      renderAnalyzing._timer = null
    }
  }, 700)
  renderAnalyzing._timer = timer
}

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

  setAppHtml(`
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
  `)

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

function escapeHtml(s) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

async function init(tabId = panelTabId) {
  try {
    const session = await chrome.runtime.sendMessage({ type: 'GET_SESSION' })
    if (!session?.loggedIn) {
      currentCapture = null
      renderNeedLogin()
      return
    }
    const capture = await chrome.runtime.sendMessage({ type: 'CAPTURE_TEXT', tabId })
    if (!capture?.ok) {
      currentCapture = null
      renderUnavailable()
      return
    }
    currentCapture = capture
    renderIdle(capture)
  } catch {
    currentCapture = null
    renderError(ERROR_MESSAGES.unavailable)
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'RECAPTURE' || !Number.isInteger(msg.tabId)) return
  if (Number.isInteger(panelTabId) && panelTabId !== msg.tabId) return

  ;(async () => {
    if (Number.isInteger(msg.windowId)) {
      const currentWindow = await chrome.windows.getCurrent()
      if (currentWindow.id !== msg.windowId) return
    }
    await init(msg.tabId)
  })()
})

init()
