# MangaReader TR

Manga sayfalarını tarayıcıda tek tıkla Türkçeye çeviren sistem.

## Mimari

```
Edge/Chrome eklentisi  ->  Yerel FastAPI backend  ->  BallonsTranslator
     (overlay)              (port 8000)              (OCR + çeviri + inpainting)
```

- Eklenti sayfadaki manga görsellerini bulur, backend'e gönderir.
- Backend BallonsTranslator ile çevirir, orijinal metni siler, çeviriyi balonlara yerleştirir.
- Eklenti sonucu görselin üstüne overlay olarak koyar; `src` değiştirilmediği için sitelerin lazy-load kodları bozmaz.
- Sonraki 2 sayfa gizli iframe ile arka planda önceden çevrilir; sayfaya geçince çeviri hazır gelir.
- Sonuçlar IndexedDB'de cache'lenir; geçici dosyalar her çeviriden sonra silinir.

## Kurulum

1. BallonsTranslator'ı bu klasörün yanına klonla:
   ```powershell
   git clone https://github.com/dmMaze/BallonsTranslator.git ../BallonsTranslator
   ```
2. BallonsTranslator bağımlılıklarını kur (Python 3.12 + PyTorch CUDA önerilir):
   ```powershell
   cd ../BallonsTranslator
   python -m venv venv
   .\venv\Scripts\python.exe -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu124
   .\venv\Scripts\python.exe -m pip install -r requirements.txt
   ```
3. Bu projeyi yapılandır:
   ```powershell
   cd ..\MangaReader
   .\venv\Scripts\python.exe setup_ballons.py
   ```
   (İlk çalıştırmada BallonsTranslator OCR/inpainting modellerini indirir.)

4. Backend'i başlat:
   ```powershell
   .\start_backend.bat
   ```

5. Edge/Chrome:
   - `edge://extensions` -> Geliştirici modu -> Paketlenmemiş yükle
   - `extension` klasörünü seç
   - Popup'tan **"Bu sayfayı Türkçe çevir"** veya **"Sonraki sayfaları otomatik çevir"** seçeneğini kullan.

## Notlar

- Backend adresi `http://127.0.0.1:8000`. Farklı bir konum için `MANGA_BT_ROOT` ortam değişkenini ayarla.
- Yazı boyutu düzeltmesi (0.8 alt sınır, 14 px okunabilirlik tabanı) `setup_ballons.py` tarafından uygulanır.
- Popup üzerinden **Önbelleği temizle** ve **Tanılama (log)** düğmeleri vardır.
- Bu depo yalnızca MangaReader'ı içerir; BallonsTranslator ayrı bir GPL-3.0 projesidir.
