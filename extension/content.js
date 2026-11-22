if (window.__mrContentLoaded) {
  // Aynı sayfada ikinci kez enjekte edildiyi için tekrar kayıt olma.
} else {
window.__mrContentLoaded = true;
try {

const BACKEND = 'http://127.0.0.1:8000';

const AUTO_TIMEOUT_MS = 60000; // 1 dakika yeni görsel bulunamazsa otomatik modu kapat.
let lastFoundTime = Date.now();

let contextInvalid = false;
let stopped = false;

function stopAll() {
  if (stopped) return;
  stopped = true;
  try { observer.disconnect(); } catch (e) {}
  try { clearOverlays(); } catch (e) {}
  console.log('[MangaReaderTR] extension context sona erdi, durduruldu.');
}

function safeSend(msg, callback) {
  if (contextInvalid || stopped) return;
  try {
    chrome.runtime.sendMessage(msg, (response) => {
      const err = chrome.runtime && chrome.runtime.lastError;
      if (err && /invalidated|Receiving end does not exist/i.test(err.message || '')) {
        contextInvalid = true;
        stopAll();
      }
      if (callback) callback(response);
    });
  } catch (e) {
    if (/invalidated/i.test(String(e && e.message))) {
      contextInvalid = true;
      stopAll();
    }
    if (callback) callback(null);
  }
}

function safeStorageGet(keys, cb) {
  if (stopped) return;
  try { chrome.storage.local.get(keys, cb); }
  catch (e) { if (/invalidated/i.test(String(e && e.message))) stopAll(); }
}

function safeStorageSet(obj, cb) {
  if (stopped) return;
  try { chrome.storage.local.set(obj, cb); }
  catch (e) { if (/invalidated/i.test(String(e && e.message))) stopAll(); }
}

function safeStorageClear(cb) {
  if (stopped) return;
  try { chrome.storage.local.clear(cb); }
  catch (e) { if (/invalidated/i.test(String(e && e.message))) stopAll(); }
}

function badge(text) {
  safeSend({ type: 'mr_badge', text: text || '' });
}

function progress(text) {
  badge(text.length > 8 ? '...' : text);
  safeSend({ type: 'mr_progress', text });
}

const DB_NAME = 'mangareader_cache';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('pages')) {
        req.result.createObjectStore('pages');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pages', 'readonly');
    const req = tx.objectStore('pages').get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pages', 'readwrite');
    tx.objectStore('pages').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbClear() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pages', 'readwrite');
    tx.objectStore('pages').clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function imgSource(img) {
  return img.currentSrc || img.src || img.getAttribute('data-src') || img.getAttribute('data-original') || '';
}

function mangaImagesIn(doc) {
  const all = [...doc.images];
  let imgs = all.filter(i => i.className && (
    i.className.includes('limit-width') ||
    i.className.includes('_images')   // Webtoon görselleri
  ));
  imgs = imgs.filter(i => !i.className.includes('_thumbnailImages'));
  if (!imgs.length) {
    imgs = all.filter(i => {
      const s = imgSource(i).toLowerCase();
      if (!s || s.startsWith('data:')) return false;
      if (/icon|logo|avatar|spacer|button|emoji|flag/i.test(s)) return false;
      const w = i.naturalWidth || parseInt(i.getAttribute('width'), 10) || 0;
      const h = i.naturalHeight || parseInt(i.getAttribute('height'), 10) || 0;
      // 1x1 saydam yer tutucuları ve küçük ikonları ele.
      if (w > 0 && h > 0 && (w < 400 || h < 400)) return false;
      if (w >= 400 && h >= 400) return true;
      if (s.includes('bg_transparency')) return false;
      if (/hitomi|webtoon-phinf|\.webp|\.jpg|\.jpeg/.test(s)) return true;
      return false;
    });
  }
  return imgs;
}

function mangaImages() {
  return mangaImagesIn(document);
}

function cacheKey() {
  return location.host + location.pathname + location.hash + location.search;
}

function keyForUrl(u) {
  const x = new URL(u, location.href);
  return x.host + x.pathname + x.hash + x.search;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function toDataUrl(blob) {
  return new Promise(resolve => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.readAsDataURL(blob);
  });
}

let lastFetchError = '';

async function fetchImageDirect(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await toDataUrl(blob);
  } catch (e) {
    return null;
  }
}

function fetchImageViaBackground(url, referer) {
  return new Promise((resolve) => {
    safeSend({ action: 'fetch_images', items: [{ url, referer: referer || location.href }] }, (response) => {
      const v = response && response.images && response.images[0];
      if (!v || (typeof v === 'string' && v.startsWith('__FETCH_ERROR__'))) {
        if (v) lastFetchError = v.replace('__FETCH_ERROR__', '');
        resolve(null);
      } else {
        resolve(v);
      }
    });
  });
}

async function fetchImagesViaBackground(urls, referer) {
  // Eski davranış: önce sayfa içinden doğrudan indir (Hitomi burada çalışıyordu).
  // CORS engelirse background'a düş (Webtoon için gerekli).
  const images = [];
  const indices = [];
  for (let i = 0; i < urls.length; i++) {
    let data = await fetchImageDirect(urls[i]);
    if (!data) data = await fetchImageViaBackground(urls[i], referer);
    if (data) {
      images.push(data);
      indices.push(i);
    } else {
      lastFetchError = lastFetchError || 'görsel indirilemedi';
    }
  }
  return { images, indices };
}

// --- Overlay katmanı: görselin src'sini değiştirmek yerine üstüne çeviri koyar ---
const OVERLAY_CLASS = 'mangareader-tr-overlay';
let overlayPairs = [];
const originalSrcMap = new WeakMap();

function clearOverlays() {
  document.querySelectorAll('.' + OVERLAY_CLASS).forEach(e => e.remove());
  overlayPairs = [];
  document.querySelectorAll('img[data-mr-translated]').forEach(i => delete i.dataset.mrTranslated);
}

function clearTranslation() {
  clearOverlays();
  originalSrcMap.forEach((src, img) => {
    try { img.src = src; } catch (e) {}
  });
  // WeakMap'ı yeniden oluşturamayız; geri yüklenenler için işaret kaldı.
  document.querySelectorAll('img[data-mr-original]').forEach(i => delete i.dataset.mrOriginal);
}

function positionOverlay(pair) {
  if (!pair.orig.isConnected) return;
  const r = pair.orig.getBoundingClientRect();
  pair.overlay.style.left = r.left + 'px';
  pair.overlay.style.top = r.top + 'px';
  pair.overlay.style.width = r.width + 'px';
  pair.overlay.style.height = r.height + 'px';
}

function showOverlays(imgs, urls) {
  // Webtoon: görselin kendisini değiştir; sayfa kaydırmada overlay takılmasın.
  if (/webtoons\.com/.test(location.host)) {
    imgs.forEach((img, i) => {
      if (!urls[i]) return;
      if (!originalSrcMap.has(img)) originalSrcMap.set(img, img.src);
      img.src = urls[i];
      img.dataset.mrTranslated = '1';
    });
    return;
  }

  imgs.forEach((img, i) => {
    if (!urls[i]) return;
    let pair = overlayPairs.find(p => p.orig === img);
    if (!pair) {
      const overlay = document.createElement('img');
      overlay.className = OVERLAY_CLASS;
      overlay.style.position = 'fixed';
      overlay.style.zIndex = '2147483647';
      overlay.style.pointerEvents = 'none';
      overlay.style.objectFit = 'fill';
      overlay.style.border = 'none';
      document.body.appendChild(overlay);
      pair = { orig: img, overlay };
      overlayPairs.push(pair);
    }
    pair.overlay.src = urls[i];
    positionOverlay(pair);
    img.dataset.mrTranslated = '1';
  });
}

window.addEventListener('scroll', () => { if (!stopped) overlayPairs.forEach(positionOverlay); }, true);
window.addEventListener('resize', () => { if (!stopped) overlayPairs.forEach(positionOverlay); });

let translating = false;

async function translatePage(force = false, silent = false) {
  if (stopped) return { status: 'Eklenti yenilendi, sayfayı yenileyin.' };
  if (translating) return { status: 'Çeviri zaten sürüyor.' };
  translating = true;
  try {
    if (!silent) progress('Sayfa taranıyor...');
    const all = mangaImages();
    console.log('[MangaReaderTR] aday görsel:', all.length);
    let imgs = all.filter(i => force || !i.dataset.mrTranslated).slice(0, 10);
    if (!imgs.length) {
      const msg = all.length ? 'Yeni sayfa yok (' + all.length + ' görsel çevrilmiş).' :
        'Sayfada manga görseli bulunamadı. Toplam img: ' + document.images.length;
      console.log('[MangaReaderTR]', msg);
      return { status: msg };
    }
    lastFoundTime = Date.now();

    // Force modunda eski overlay'leri kaldır, yeni sonuçlarla değiştir.
    if (force) imgs.forEach(img => {
      overlayPairs.filter(p => p.orig === img).forEach(p => p.overlay.remove());
      overlayPairs = overlayPairs.filter(p => p.orig !== img);
      delete img.dataset.mrTranslated;
    });

    const key = cacheKey();
    if (!force) {
      const cached = await idbGet(key);
      if (cached) {
        if (!silent) progress('Önbellekten yükleniyor...');
        showOverlays(imgs, cached);
        await new Promise(r => setTimeout(r, 500));
        overlayPairs.forEach(positionOverlay);
        prefetchNextPages();
        return { status: 'Tamamlandı: ' + imgs.length + ' sayfa önbellekten. Overlay: ' + overlayPairs.length + ' (sonraki sayfalar hazırlanıyor)' };
      }
    }

    if (!silent) progress('Görseller toplanıyor: ' + imgs.length + ' sayfa...');
    const urls = imgs.map(img => imgSource(img));
    const fetched = await fetchImagesViaBackground(urls);
    if (!fetched || !fetched.images.length) {
      return { status: 'Hiçbir görsel indirilemedi: ' + lastFetchError };
    }
    imgs = fetched.indices.map(i => imgs[i]);
    const sources = fetched.images;

    if (!silent) progress('Backend’e gönderildi. BallonsTranslator çeviriyor...');
    const res = await fetch(BACKEND + '/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ images: sources, source_lang: sourceLang })
    });
    const data = await res.json();
    if (!data.images || data.images.length !== imgs.length) {
      return { status: 'Çeviri hatası: ' + (data.error || 'beklenmeyen sonuç') };
    }

    if (!silent) progress('Çeviriler sayfaya yerleştiriliyor...');
    showOverlays(imgs, data.images);
    await new Promise(r => setTimeout(r, 800));
    overlayPairs.forEach(positionOverlay);
    const ok = overlayPairs.filter(p => p.overlay.complete && p.overlay.naturalWidth > 0).length;
    console.log('[MangaReaderTR] overlay kontrolü:', ok + '/' + overlayPairs.length);
    await idbSet(key, data.images);
    badge('OK');
    setTimeout(() => badge(''), 5000);
    prefetchNextPages();
    return { status: 'Tamamlandı: ' + imgs.length + ' sayfa. Overlay: ' + ok + '/' + overlayPairs.length + ' (sonraki sayfalar hazırlanıyor)' };
  } finally {
    translating = false;
  }
}

// --- Arka planda sonraki sayfaları çevir (gizli iframe ile) ---
const PREFETCH_AHEAD = 2;

async function waitForFrameImages(iframe, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const doc = iframe.contentDocument;
      if (doc && mangaImagesIn(doc).length) return mangaImagesIn(doc);
    } catch (e) {}
    await sleep(500);
  }
  return [];
}

async function translateUrlsInDoc(doc) {
  let imgs = mangaImagesIn(doc);
  if (!imgs.length) return null;
  const fetched = await fetchImagesViaBackground(imgs.map(img => imgSource(img)), doc.location.href);
  if (!fetched || !fetched.images.length) return null;
  imgs = fetched.indices.map(i => imgs[i]);
  const sources = fetched.images;
  const res = await fetch(BACKEND + '/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ images: sources })
  });
  const data = await res.json();
  return data.images && data.images.length === imgs.length ? data.images : null;
}

async function prefetchPage(pageNum) {
  if (stopped) return;
  const url = new URL(location.href);
  url.hash = '#' + pageNum;
  const key = keyForUrl(url.href);
  if (await idbGet(key)) return; // zaten çevrilmiş

  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;left:-9999px;top:0;width:900px;height:1400px;opacity:0;border:0;pointer-events:none;';
  iframe.src = url.href;
  document.body.appendChild(iframe);
  try {
    await new Promise(res => {
      iframe.addEventListener('load', res, { once: true });
      setTimeout(res, 12000);
    });
    const imgs = await waitForFrameImages(iframe);
    if (!imgs.length) {
      console.log('[MangaReaderTR] prefetch: sayfa', pageNum, 'görsel bulunamadı');
      return;
    }
    const translated = await translateUrlsInDoc(iframe.contentDocument);
    if (translated) {
      await idbSet(key, translated);
      console.log('[MangaReaderTR] prefetch: sayfa', pageNum, 'hazır');
    }
  } catch (e) {
    console.log('[MangaReaderTR] prefetch hatası:', e.message);
  } finally {
    iframe.remove();
  }
}

async function prefetchNextPages() {
  const current = parseInt((location.hash || '').replace('#', ''), 10);
  if (!Number.isFinite(current)) return;
  for (let n = 1; n <= PREFETCH_AHEAD; n++) {
    await prefetchPage(current + n);
  }
}

let autoEnabled = false;
let sourceLang = 'English';
console.log('[MangaReaderTR] content script yüklendi:', location.href);
safeStorageGet(['mr_auto', 'mr_source_lang'], (r) => {
  autoEnabled = !!r.mr_auto;
  if (r.mr_source_lang) sourceLang = r.mr_source_lang;
});

function debugInfo() {
  const imgs = mangaImages();
  return {
    loaded: true, url: location.href, title: document.title,
    totalImages: document.images.length, candidateCount: imgs.length, overlays: overlayPairs.length,
    candidates: imgs.slice(0, 6).map(i => ({
      src: imgSource(i).slice(0, 120), nw: i.naturalWidth, nh: i.naturalHeight,
      w: i.getAttribute('width'), h: i.getAttribute('height'), cls: i.className
    })),
    autoEnabled, backend: BACKEND
  };
}

function maybeAuto() {
  if (stopped || !autoEnabled || translating) return;
  const pending = mangaImages().filter(i => !i.dataset.mrTranslated);
  if (pending.length) {
    progress('Otomatik: çeviriliyor');
    translatePage(false, true);
    return;
  }
  if (Date.now() - lastFoundTime > AUTO_TIMEOUT_MS) {
    autoEnabled = false;
    safeStorageSet({ mr_auto: false });
    badge('');
    progress('Otomatik mod kapandı');
    console.log('[MangaReaderTR] Otomatik mod kapatıldı: 1 dakika yeni görsel bulunamadı.');
    safeSend({ type: 'mr_progress', text: 'Otomatik mod kapatıldı (yeni sayfa bulunamadı).' });
  }
}

async function applyCachedIfAny() {
  if (stopped) return false;
  const imgs = mangaImages().filter(i => !i.dataset.mrTranslated);
  if (!imgs.length) return false;
  const cached = await idbGet(cacheKey());
  if (!cached) return false;
  showOverlays(imgs, cached);
  await sleep(300);
  overlayPairs.forEach(positionOverlay);
  progress('Hazır çeviri');
  console.log('[MangaReaderTR] hazır çeviri uygulandı:', imgs.length);
  return true;
}

function onNavigate() {
  if (stopped) return;
  clearOverlays();
  setTimeout(async () => {
    if (await applyCachedIfAny()) return;
    maybeAuto();
  }, 1200);
}
window.addEventListener('hashchange', onNavigate);
window.addEventListener('popstate', onNavigate);

// Sayfa ilk açıldığında da hazır çeviri varsa hemen uygula.
setTimeout(async () => { await applyCachedIfAny(); }, 1800);

const observer = new MutationObserver((mutations) => {
  if (stopped) return;
  for (const m of mutations) {
    if (m.type === 'attributes' && m.target && m.target.tagName === 'IMG' && m.target.dataset.mrTranslated) {
      const pair = overlayPairs.find(p => p.orig === m.target);
      if (pair) {
        pair.overlay.remove();
        overlayPairs = overlayPairs.filter(p => p !== pair);
      }
      delete m.target.dataset.mrTranslated;
    }
  }
  setTimeout(maybeAuto, 900);
});
observer.observe(document.body || document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['src']
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.action === 'translate') {
    translatePage(true)
      .then(sendResponse)
      .catch(e => sendResponse({ status: 'Hata: ' + e.message }));
    return true;
  }
  if (msg && msg.action === 'stop_translation') {
    autoEnabled = false;
    safeStorageSet({ mr_auto: false });
    clearTranslation();
    badge('');
    sendResponse({ status: 'Çeviri kapatıldı, orijinal sayfa geri yüklendi.' });
    return true;
  }
  if (msg && msg.action === 'clear_cache') {
    idbClear()
      .then(() => { clearOverlays(); sendResponse({ status: 'Önbellek ve overlay temizlendi.' }); })
      .catch(e => sendResponse({ status: 'Hata: ' + e.message }));
    return true;
  }
  if (msg && msg.action === 'auto') {
    autoEnabled = !!msg.enabled;
    safeStorageSet({ mr_auto: autoEnabled });
    sendResponse({ status: autoEnabled ? 'Otomatik mod açık.' : 'Otomatik mod kapalı.' });
    if (autoEnabled) setTimeout(maybeAuto, 500);
    return true;
  }
  if (msg && msg.action === 'get_auto') {
    sendResponse({ enabled: autoEnabled });
    return true;
  }
  if (msg && msg.action === 'get_source') {
    sendResponse({ lang: sourceLang });
    return true;
  }
  if (msg && msg.action === 'set_source') {
    sourceLang = msg.lang || 'English';
    safeStorageSet({ mr_source_lang: sourceLang });
    sendResponse({ lang: sourceLang });
    return true;
  }
  if (msg && msg.action === 'debug') {
    sendResponse(debugInfo());
    return true;
  }
});

} catch (e) {
  console.error('[MangaReaderTR] FATAL:', e);
  safeSend({ type: 'mr_progress', text: 'FATAL HATA: ' + (e && e.message ? e.message : String(e)) });
}
} // __mrContentLoaded guard
