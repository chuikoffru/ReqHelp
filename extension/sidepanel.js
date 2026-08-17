import { MIN_TZ_CHARS, ERROR_MESSAGES, SITE_URL } from './config.js'

const app = document.getElementById('app')
const panelTabId = Number.parseInt(new URLSearchParams(window.location.search).get('tabId') ?? '', 10)
const ANALYZE_STEPS = [
  'Разбор текста ТЗ',
  'Поиск объектов конфигурации',
  'Выделение реквизитов',
  'Проверка пробелов в требованиях',
  'Формирование отчёта',
]

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
      setAppHtml(`<p>Анализ готов: ${res.result?.entities?.length ?? 0} объектов. Полный отчёт — в следующем шаге.</p>
        <button class="btn btn-ghost" id="reset">Новый анализ</button>`)
      document.getElementById('reset').onclick = init
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

function escapeHtml(s) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

async function init() {
  try {
    const session = await chrome.runtime.sendMessage({ type: 'GET_SESSION' })
    if (!session?.loggedIn) {
      currentCapture = null
      renderNeedLogin()
      return
    }
    const capture = await chrome.runtime.sendMessage({ type: 'CAPTURE_TEXT', tabId: panelTabId })
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

init()
