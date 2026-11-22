const statusEl = document.getElementById('status');

function setStatus(text) {
  statusEl.textContent = text;
}

window.addEventListener('error', (e) => {
  setStatus('JS HATASI: ' + e.message + '\n' + (e.filename || '') + ':' + e.lineno);
});
window.addEventListener('unhandledrejection', (e) => {
  setStatus('PROMISE HATASI: ' + (e.reason?.message || e.reason));
});
setStatus('Popup yüklendi.');

fetch('http://127.0.0.1:8000/health')
  .then(r => r.ok ? setStatus('Backend hazır. Çeviriye basabilirsin.') : setStatus('Backend yanıt vermiyor.'))
  .catch(() => setStatus('BACKEND KAPALI: start_backend.bat dosyasını çalıştır.'));

function send(tab, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tab.id, message, (response) => {
      if (!chrome.runtime.lastError) {
        resolve({ ok: true, response });
      } else {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
      }
    });
  });
}

async function ensureContent(tab) {
  let r = await send(tab, { action: 'get_auto' });
  if (r.ok) return true;
  setStatus('Content script yok, enjekte ediliyor...');
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });
    r = await send(tab, { action: 'get_auto' });
    return r.ok;
  } catch (e) {
    setStatus('Enjeksiyon hatası: ' + e.message + '\nSayfayı F5 ile yenileyip tekrar dene.');
    return false;
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'mr_progress') setStatus(msg.text);
});

document.getElementById('go').addEventListener('click', async () => {
  setStatus('Başlatılıyor...');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!await ensureContent(tab)) return;
  const r = await send(tab, { action: 'translate' });
  setStatus(r.ok ? (r.response?.status || 'Bitti.') : ('Hata: ' + r.error));
});

document.getElementById('stoptr').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!await ensureContent(tab)) return;
  const r = await send(tab, { action: 'stop_translation' });
  setStatus(r.ok ? (r.response?.status || 'Kapatıldı.') : ('Hata: ' + r.error));
  autoEl.checked = false;
});

document.getElementById('clear').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!await ensureContent(tab)) return;
  const r = await send(tab, { action: 'clear_cache' });
  setStatus(r.ok ? (r.response?.status || 'Temizlendi.') : ('Hata: ' + r.error));
});

document.getElementById('diag').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!await ensureContent(tab)) return;
  const r = await send(tab, { action: 'debug' });
  if (!r.ok) { setStatus('Tanılama hatası: ' + r.error); return; }
  const d = r.response;
  const lines = [
    'loaded=' + d.loaded,
    'url=' + d.url,
    'title=' + d.title,
    'totalImages=' + d.totalImages,
    'candidates=' + d.candidateCount,
    'overlays=' + d.overlays,
    'auto=' + d.autoEnabled,
    'backend=' + d.backend,
    ...d.candidates.map((c, i) => '#' + (i + 1) + ' src=' + c.src + ' nw=' + c.nw + ' nh=' + c.nh)
  ];
  setStatus(lines.join('\n'));
  console.log('[MangaReaderTR popup debug]', d);
});

const autoEl = document.getElementById('auto');
(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!await ensureContent(tab)) return;
  const r = await send(tab, { action: 'get_auto' });
  autoEl.checked = !!r.response?.enabled;
})();

autoEl.addEventListener('change', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!await ensureContent(tab)) return;
  const r = await send(tab, { action: 'auto', enabled: autoEl.checked });
  setStatus(r.ok ? (r.response?.status || '') : ('Hata: ' + r.error));
});
