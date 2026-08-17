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
