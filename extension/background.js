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
    // content script еще не вставлен
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
