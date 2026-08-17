chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'GET_PAGE_TEXT') return
  try {
    sendResponse(collectPageText())
  } catch {
    sendResponse({ ok: false, error: 'page_unavailable' })
  }
  return true
})
