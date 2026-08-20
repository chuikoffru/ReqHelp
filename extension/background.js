import { SITE_URL, SITE_URL_ALT, API_URL, COOKIE_NAME, MAX_TZ_CHARS } from './config.js'

const pendingCaptures = new Map()
const lastConfiguredTabByWindow = new Map()

function getSidePanelPath(tabId) {
  return `sidepanel.html?tabId=${tabId}`
}

async function configurePanelForTab(tabId, windowId) {
  if (!Number.isInteger(tabId) || tabId < 0) return
  try {
    await chrome.sidePanel.setOptions({
      tabId,
      path: getSidePanelPath(tabId),
      enabled: true,
    })
    if (Number.isInteger(windowId)) {
      lastConfiguredTabByWindow.set(windowId, tabId)
    }
  } catch {
    // Некоторые служебные вкладки могут быть недоступны для конфигурации панели.
  }
}

async function configureExistingTabs() {
  const tabs = await chrome.tabs.query({})
  await Promise.all(tabs.map((tab) => configurePanelForTab(tab.id, tab.windowId)))
  for (const tab of tabs) {
    if (tab.active && Number.isInteger(tab.id) && Number.isInteger(tab.windowId)) {
      lastConfiguredTabByWindow.set(tab.windowId, tab.id)
    }
  }
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
  if (info.menuItemId !== 'analyze-tz' || !Number.isInteger(tab?.id)) return
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

  // open() должен быть вызван в том же синхронном такте, что и пользовательский клик.
  const openingPanel = chrome.sidePanel.open({ tabId: tab.id })
  await configurePanelForTab(tab.id, tab.windowId)
  await openingPanel

  try {
    await chrome.runtime.sendMessage({
      type: 'RECAPTURE',
      tabId: tab.id,
      windowId: tab.windowId,
    })
  } catch {
    // Новая панель сама вызовет init(); получателя может ещё не быть.
  }
})

chrome.tabs.onCreated.addListener((tab) => {
  configurePanelForTab(tab.id, tab.windowId)
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    configurePanelForTab(tabId, tab.windowId)
  }
})

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  configurePanelForTab(tabId, windowId)
})

chrome.tabs.onRemoved.addListener((tabId) => {
  pendingCaptures.delete(tabId)
  for (const [windowId, configuredTabId] of lastConfiguredTabByWindow) {
    if (configuredTabId === tabId) {
      lastConfiguredTabByWindow.delete(windowId)
    }
  }
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

async function resolveCaptureTabId(requestedTabId) {
  if (Number.isInteger(requestedTabId) && requestedTabId >= 0) {
    return requestedTabId
  }

  try {
    const lastFocusedWindow = await chrome.windows.getLastFocused()
    const configuredTabId = lastConfiguredTabByWindow.get(lastFocusedWindow.id)
    if (Number.isInteger(configuredTabId)) {
      return configuredTabId
    }
  } catch {
    // Перейдём к активной вкладке последнего активного окна.
  }

  const [activeTab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  })
  return Number.isInteger(activeTab?.id) ? activeTab.id : null
}

function bestCapture(captures) {
  const usable = captures.filter(
    (result) => result?.ok && typeof result.text === 'string' && result.text.trim(),
  )
  if (!usable.length) return null
  usable.sort((a, b) => b.text.length - a.text.length)
  return usable[0]
}

async function captureFromAllFrames(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['extract.js'],
    })
    const injected = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => (typeof collectPageText === 'function' ? collectPageText() : null),
    })
    return bestCapture((injected ?? []).map((item) => item?.result))
  } catch {
    return null
  }
}

async function captureFromTab(tabId) {
  const fromFrames = await captureFromAllFrames(tabId)
  if (fromFrames) return fromFrames

  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'GET_PAGE_TEXT' })
    if (response?.ok && response.text?.trim()) return response
  } catch {
    // content script не вставлен или страница недоступна (PDF, chrome://, file://)
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
      const tabId = await resolveCaptureTabId(msg?.tabId)
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
          body: JSON.stringify({ text: msg?.text }),
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
