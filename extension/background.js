chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'mr_badge') {
    chrome.action.setBadgeText({ text: msg.text || '' });
    chrome.action.setBadgeBackgroundColor({ color: '#2e8b57' });
  }
});