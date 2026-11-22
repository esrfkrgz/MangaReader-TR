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


def extract_blocks(job):
    """Algılanan metin bloklarını okuma sırasıyla döndürür."""
    for name in os.listdir(job):
        if not (name.startswith("imgtrans_") and name.endswith(".json")):
            continue
        try:
            with open(os.path.join(job, name), "r", encoding="utf-8") as f:
                data = json.load(f)
            blocks = []
            for page_key in sorted(data.get("pages", {}).keys()):
                for b in data["pages"][page_key] or []:
                    text = b.get("text") or []
                    if isinstance(text, list):
                        text = " ".join(str(x) for x in text if x)
                    box = b.get("xyxy") or [0, 0, 0, 0]
                    blocks.append({
                        "text": str(text).strip(),
                        "box": [float(v) for v in box[:4]],
                    })
            def key(item):
                x1, y1, x2, y2 = item["box"]
                return (int(((y1 + y2) / 2) // 40), -((x1 + x2) / 2))
            return sorted(blocks, key=key)
        except Exception:
            pass
    return []


def build_job_config(source_lang, inpaint, background, ocr_only=False):
    """İstek için özel config üret; genel config dosyasına dokunma."""
    with open(BT_CONFIG, "r", encoding="utf-8") as f:
        cfg = json.load(f)
    module = cfg.setdefault("module", {})
    if source_lang in SOURCE_LANGUAGES:
        module["translate_source"] = source_lang
    module["enable_inpaint"] = bool(inpaint) and not ocr_only
    module["enable_translate"] = not ocr_only
    fmt = cfg.setdefault("global_fontformat", {})
    if background == "white":
        fmt["frgb"] = [0, 0, 0]
        fmt["srgb"] = [255, 255, 255]
    else:
        fmt["frgb"] = [255, 255, 255]
        fmt["srgb"] = [0, 0, 0]
    fmt["stroke_width"] = 1.5
    return cfg


@app.get("/languages")
def languages():
    return {"source": SOURCE_LANGUAGES, "target": ["Türk dili"]}


def run_ballons(job, env, config_path):
    cmd = [BT_PY, "-m", "ballontranslator", "--headless", "--config", config_path, "--exec_dirs", job]
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

    # Her istek kendi config dosyasını kullanır; inpainting kapalıysa hiç çalışmaz.
    cfg = build_job_config(body.get("source_lang"), body.get("inpaint", True), body.get("background", "auto"), body.get("ocr_only", False))
    config_path = os.path.join(job, "request_config.json")
    with open(config_path, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
    proc = await asyncio.to_thread(run_ballons, job, env, config_path)

    result_dir = os.path.join(job, "result")
    try:
        if not os.path.isdir(result_dir):
            return JSONResponse({"error": "no result", "stderr": proc.stderr[-1000:]}, status_code=500)

        out = []
        for name in sorted(os.listdir(result_dir)):
            if name.lower().endswith((".png", ".jpg", ".jpeg")):
                with open(os.path.join(result_dir, name), "rb") as f:
                    out.append("data:image/png;base64," + base64.b64encode(f.read()).decode("ascii"))
        blocks = extract_blocks(job)
        return {"images": out, "blocks": blocks}
    finally:
        # Geçici iş klasörünü her durumda sil; çevirdikçe diskte birikmesin.
        shutil.rmtree(job, ignore_errors=True)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)