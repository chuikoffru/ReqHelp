chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'GET_PAGE_TEXT') {
    sendResponse(collectPageText())
  }
})
