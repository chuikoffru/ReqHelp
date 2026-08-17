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
