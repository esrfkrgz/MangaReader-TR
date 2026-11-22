import os
import sys
import json
import time
import base64
import shutil
import subprocess
import uuid
import asyncio
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

ROOT = os.path.dirname(os.path.abspath(__file__))
BT_ROOT = os.environ.get("MANGA_BT_ROOT") or os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "BallonsTranslator")
)
BT_PY = os.path.join(BT_ROOT, "venv", "Scripts", "python.exe")
BT_CONFIG = os.path.join(BT_ROOT, "config", "config.json")
WORK = os.path.join(ROOT, "outputs", "backend_jobs")
os.makedirs(WORK, exist_ok=True)

SOURCE_LANGUAGES = [
    "English", "日本語", "简体中文", "繁體中文", "한국어",
    "Español", "Português", "Français", "Italiano", "Deutsch",
]
job_lock = asyncio.Lock()

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def b64_to_bytes(data_url):
    if not isinstance(data_url, str) or not data_url.startswith("data:"):
        raise ValueError("görsel verisi data URL değil")
    if "," not in data_url:
        raise ValueError("data URL virgül içermiyor")
    payload = data_url.split(",", 1)[1]
    try:
        return base64.b64decode(payload, validate=False)
    except Exception as e:
        raise ValueError(f"geçersiz base64: {e}")


def set_render_mode(inpaint, background):
    """Orijinal metni silme ve yazı rengi/zemin ayarlarını uygula."""
    try:
        with open(BT_CONFIG, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        cfg.setdefault("module", {})["enable_inpaint"] = bool(inpaint)
        fmt = cfg.setdefault("global_fontformat", {})
        if background == "white":
            fmt["frgb"] = [0, 0, 0]
            fmt["srgb"] = [255, 255, 255]
            fmt["stroke_width"] = 1.5
        elif background == "black":
            fmt["frgb"] = [255, 255, 255]
            fmt["srgb"] = [0, 0, 0]
            fmt["stroke_width"] = 1.5
        else:
            fmt["frgb"] = [255, 255, 255]
            fmt["srgb"] = [0, 0, 0]
            fmt["stroke_width"] = 1.5
        with open(BT_CONFIG, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


def set_source_language(lang):
    """BallonsTranslator config'inde kaynak dil'i geçici olarak ayarla."""
    if not lang or lang not in SOURCE_LANGUAGES:
        return
    try:
        with open(BT_CONFIG, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        cfg.setdefault("module", {})["translate_source"] = lang
        with open(BT_CONFIG, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


@app.get("/languages")
def languages():
    return {"source": SOURCE_LANGUAGES, "target": ["Türk dili"]}


def run_ballons(job, env):
    cmd = [BT_PY, "-m", "ballontranslator", "--headless", "--exec_dirs", job]
    return subprocess.run(cmd, cwd=BT_ROOT, env=env, input="exit\n",
                          capture_output=True, text=True, timeout=1800)


@app.get("/health")
def health():
    return {"ok": True, "engine": "ballonstranslator"}


@app.post("/translate")
async def translate(req: Request):
    body = await req.json()
    images = body.get("images", [])
    if not images:
        return JSONResponse({"error": "no images"}, status_code=400)

    job = os.path.join(WORK, "job_" + uuid.uuid4().hex[:8])
    os.makedirs(job, exist_ok=True)

    for i, data_url in enumerate(images):
        try:
            raw = b64_to_bytes(data_url)
        except ValueError as e:
            shutil.rmtree(job, ignore_errors=True)
            return JSONResponse({"error": f"Geçersiz görsel #{i+1}: {e}"}, status_code=400)
        with open(os.path.join(job, f"page_{i+1:03d}.png"), "wb") as f:
            f.write(raw)

    env = os.environ.copy()
    env["PYTHONUTF8"] = "1"
    env["QT_QPA_PLATFORM_PLUGIN_PATH"] = os.path.join(
        BT_ROOT, "venv", "Lib", "site-packages", "PyQt6", "Qt6", "plugins"
    )

    # Aynı anda birden fazla istek config dosyasını bozmasın.
    async with job_lock:
        set_source_language(body.get("source_lang"))
        set_render_mode(body.get("inpaint", True), body.get("background", "auto"))
        proc = await asyncio.to_thread(run_ballons, job, env)

    result_dir = os.path.join(job, "result")
    try:
        if not os.path.isdir(result_dir):
            return JSONResponse({"error": "no result", "stderr": proc.stderr[-1000:]}, status_code=500)

        out = []
        for name in sorted(os.listdir(result_dir)):
            if name.lower().endswith((".png", ".jpg", ".jpeg")):
                with open(os.path.join(result_dir, name), "rb") as f:
                    out.append("data:image/png;base64," + base64.b64encode(f.read()).decode("ascii"))
        return {"images": out}
    finally:
        # Geçici iş klasörünü her durumda sil; çevirdikçe diskte birikmesin.
        shutil.rmtree(job, ignore_errors=True)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)