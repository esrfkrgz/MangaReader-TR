function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function fetchOnce(url, referer) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
    'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
  };
  if (referer) headers['Referer'] = referer;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const type = res.headers.get('content-type') || 'image/jpeg';
  const buf = await res.arrayBuffer();
  return 'data:' + type + ';base64,' + bytesToBase64(new Uint8Array(buf));
}

async function fetchAsDataUrl(url, referer) {
  try {
    return await fetchOnce(url, referer);
  } catch (e) {
    // Hitomi a1/a2 CDN sunucularından biri 404 dönerse diğerini dene.
    if (String(e.message).includes('404')) {
      const alt = url.replace('a1.', 'a2.').replace('a2.', 'a1.');
      if (alt !== url) {
        try { return await fetchOnce(alt, referer); } catch (e2) {}
      }
    }
    throw e;
  }
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
      const tabReferer = sender.tab && sender.tab.url;
      const items = msg.items || (msg.urls || []).map(u => ({ url: u, referer: tabReferer }));
      for (const item of items) {
        try {
          results.push(await fetchAsDataUrl(item.url, item.referer || tabReferer));
        } catch (e) {
          results.push('__FETCH_ERROR__' + e.message);
        }
      }
      sendResponse({ images: results });
    })();
    return true;
  }
});