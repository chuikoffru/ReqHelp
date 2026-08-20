import { MIN_TZ_CHARS, MAX_TZ_CHARS, ERROR_MESSAGES, SITE_URL } from './config.js'
import { buildMarkdown } from './markdown.js'

const app = document.getElementById('app')
const parsedPanelTabId = Number.parseInt(new URLSearchParams(window.location.search).get('tabId') ?? '', 10)
const panelTabId = Number.isInteger(parsedPanelTabId) ? parsedPanelTabId : null
const ANALYZE_STEPS = [
  'Разбор текста ТЗ',
  'Поиск объектов конфигурации',
  'Выделение реквизитов',
  'Проверка пробелов в требованиях',
  'Ожидание ответа модели',
]
const SEVERITY_LABELS = { critical: 'Критично', warning: 'Важно', info: 'Уточнить' }

let currentCapture = null

function countWords(text) {
  return text.trim() ? text.trim().split(/\s+/).filter(Boolean).length : 0
}

function formatClock(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms} мс`
  const totalSec = ms / 1000
  if (totalSec < 60) return `${totalSec.toFixed(1)} с`
  const minutes = Math.floor(totalSec / 60)
  const seconds = Math.round(totalSec % 60)
  return `${minutes} мин ${seconds} с`
}

function clearAnalyzingTimer() {
  if (renderAnalyzing._clock) {
    clearInterval(renderAnalyzing._clock)
    renderAnalyzing._clock = null
  }
  if (renderAnalyzing._steps) {
    clearInterval(renderAnalyzing._steps)
    renderAnalyzing._steps = null
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
  setAppHtml(`
    <div class="banner banner-error">${ERROR_MESSAGES.page_unavailable}</div>
    <textarea id="paste" class="preview" rows="10" placeholder="Вставьте текст технического задания"></textarea>
    <div style="margin-top:12px">
      <button class="btn btn-primary" id="analyze-paste" disabled>Проанализировать ТЗ</button>
    </div>
  `)
  const input = document.getElementById('paste')
  const button = document.getElementById('analyze-paste')
  const sync = () => {
    button.disabled = input.value.trim().length < MIN_TZ_CHARS
  }
  input.addEventListener('input', sync)
  button.onclick = () => analyzeCapturedText(input.value)
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
  document.getElementById('analyze').onclick = () => analyzeCapturedText(currentCapture?.text ?? '')
}

async function analyzeCapturedText(text) {
  const value = text.trim()
  if (value.length < MIN_TZ_CHARS) return
  currentCapture = {
    ok: true,
    text: value,
    truncated: value.length > MAX_TZ_CHARS,
    source: currentCapture?.source ?? 'page',
  }
  renderAnalyzing()
  try {
    const res = await chrome.runtime.sendMessage({ type: 'ANALYZE', text: value })
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

function renderAnalyzing() {
  setAppHtml(`
    <div class="spinner" aria-hidden="true"></div>
    <h2 class="analyzing-title">Идёт анализ…</h2>
    <p class="timer" id="timer" aria-live="polite">00:00</p>
    <p class="timer-hint">Обычно это занимает от 20 секунд до нескольких минут</p>
    <div class="progress"><span id="bar"></span></div>
    <ul class="steps" id="steps"></ul>
  `)
  let index = 0
  const started = Date.now()
  const stepsEl = document.getElementById('steps')
  const bar = document.getElementById('bar')
  const timerEl = document.getElementById('timer')
  const paint = () => {
    stepsEl.innerHTML = ANALYZE_STEPS.map((label, i) => {
      const cls = i < index ? 'step done' : i === index ? 'step active' : 'step'
      const mark = i < index ? '\u2713' : String(i + 1)
      return `<li class="${cls}"><span>${mark}</span><span>${label}</span></li>`
    }).join('')
    bar.style.width = `${Math.min(92, ((index + 1) / ANALYZE_STEPS.length) * 88)}%`
  }
  paint()
  renderAnalyzing._clock = setInterval(() => {
    timerEl.textContent = formatClock(Date.now() - started)
  }, 200)
  renderAnalyzing._steps = setInterval(() => {
    index = Math.min(index + 1, ANALYZE_STEPS.length - 1)
    paint()
  }, 4000)
}

function renderTiming(timing) {
  if (!timing) return ''
  const llmMs = (timing.firstLlmMs ?? 0) + (timing.retryLlmMs ?? 0)
  const rows = [
    { label: 'Запрос к модели', ms: timing.firstLlmMs ?? 0 },
    ...(timing.retryLlmMs > 0 ? [{ label: 'Повторный запрос', ms: timing.retryLlmMs }] : []),
    { label: 'Разбор JSON', ms: timing.parseMs ?? 0 },
  ]
  const maxMs = Math.max(timing.totalMs ?? 1, 1)
  const llmPct = timing.totalMs > 0 ? Math.round((llmMs / timing.totalMs) * 100) : 0
  return `
    <section class="timing">
      <div class="timing-head">
        <div>
          <h2>Время анализа</h2>
          <p class="muted">${escapeHtml(timing.model ?? '')} · ${
            timing.attempts === 1 ? 'один запрос' : `${timing.attempts} попытки`
          }</p>
        </div>
        <p class="timing-total">${formatDuration(timing.totalMs ?? 0)}</p>
      </div>
      ${rows
        .map(
          (row) => `<div class="timing-row">
            <div class="timing-row-meta">
              <span>${escapeHtml(row.label)}</span>
              <span>${formatDuration(row.ms)}</span>
            </div>
            <div class="timing-bar"><span style="width:${Math.max(1, Math.round((row.ms / maxMs) * 100))}%"></span></div>
          </div>`,
        )
        .join('')}
      <dl class="timing-meta">
        <div><dt>Доля LLM</dt><dd>${llmPct}%</dd></div>
        <div><dt>Размер промпта</dt><dd>${Number(timing.promptChars ?? 0).toLocaleString('ru-RU')} симв.</dd></div>
        <div><dt>Токены ответа</dt><dd>${timing.completionTokens ?? '—'}</dd></div>
        <div><dt>Reasoning-токены</dt><dd>${timing.reasoningTokens ?? '—'}</dd></div>
      </dl>
    </section>
  `
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
    ${renderTiming(result.timing)}
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
