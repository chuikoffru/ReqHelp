import { SITE_URL, SITE_URL_ALT, COOKIE_NAME, MAX_TZ_CHARS } from './config.js'

const pendingCaptures = new Map()

function getSidePanelPath(tabId) {
  return `sidepanel.html?tabId=${tabId}`
}

async function configurePanelForTab(tabId) {
  if (!Number.isInteger(tabId) || tabId < 0) return
  try {
    await chrome.sidePanel.setOptions({
      tabId,
      path: getSidePanelPath(tabId),
      enabled: true,
    })
  } catch {
    // Некоторые служебные вкладки могут быть недоступны для конфигурации панели.
  }
}

async function configureExistingTabs() {
  const tabs = await chrome.tabs.query({})
  await Promise.all(tabs.map((tab) => configurePanelForTab(tab.id)))
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  chrome.contextMenus.create({
    id: 'analyze-tz',
    title: 'Проанализировать ТЗ',
    contexts: ['selection', 'page'],
  })
  configureExistingTabs()
})

chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  configureExistingTabs()
})

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'analyze-tz' || !tab?.id) return
  const selected = (info.selectionText ?? '').trim()
  if (selected) {
    const truncated = selected.length > MAX_TZ_CHARS
    pendingCaptures.set(tab.id, {
      ok: true,
      text: truncated ? selected.slice(0, MAX_TZ_CHARS) : selected,
      truncated,
      source: 'selection',
    })
  } else {
    pendingCaptures.delete(tab.id)
  }
  await configurePanelForTab(tab.id)
  await chrome.sidePanel.open({ tabId: tab.id })
})

chrome.tabs.onCreated.addListener((tab) => {
  configurePanelForTab(tab.id)
})

chrome.tabs.onUpdated.addListener((tabId, _changeInfo, _tab) => {
  configurePanelForTab(tabId)
})

chrome.tabs.onActivated.addListener(({ tabId }) => {
  configurePanelForTab(tabId)
})

async function getAuthToken() {
  for (const url of [SITE_URL, SITE_URL_ALT]) {
    const cookie = await chrome.cookies.get({ url, name: COOKIE_NAME })
    if (cookie?.value) return cookie.value
  }
  return null
}

function takePendingCapture(tabId) {
  const capture = pendingCaptures.get(tabId) ?? null
  if (capture) {
    pendingCaptures.delete(tabId)
  }
  return capture
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
      const tabId = Number.isInteger(msg?.tabId) ? msg.tabId : null
      if (!Number.isInteger(tabId)) {
        sendResponse({ ok: false, error: 'page_unavailable' })
        return
      }

      const pendingCapture = takePendingCapture(tabId)
      if (pendingCapture) {
        sendResponse(pendingCapture)
        return
      }

      sendResponse(await captureFromTab(tabId))
    })()
    return true
  }
})
