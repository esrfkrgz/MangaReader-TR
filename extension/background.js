function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function fetchAsDataUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const type = res.headers.get('content-type') || 'image/jpeg';
  const buf = await res.arrayBuffer();
  return 'data:' + type + ';base64,' + bytesToBase64(new Uint8Array(buf));
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'mr_badge') {
    chrome.action.setBadgeText({ text: msg.text || '' });
    chrome.action.setBadgeBackgroundColor({ color: '#2e8b57' });
    return;
  }
  if (msg && msg.action === 'fetch_images') {
    (async () => {
      const results = [];
      for (const url of msg.urls || []) {
        try {
          results.push(await fetchAsDataUrl(url));
        } catch (e) {
          results.push(url); // hata olursa orijinal URL'i geri gönder
        }
      }
      sendResponse({ images: results });
    })();
    return true;
  }
});