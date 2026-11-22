import os
import sys
import json
import time
import base64
import shutil
import subprocess
import uuid
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

ROOT = os.path.dirname(os.path.abspath(__file__))
BT_ROOT = os.environ.get("MANGA_BT_ROOT") or os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "BallonsTranslator")
)
BT_PY = os.path.join(BT_ROOT, "venv", "Scripts", "python.exe")
WORK = os.path.join(ROOT, "outputs", "backend_jobs")
os.makedirs(WORK, exist_ok=True)

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def b64_to_bytes(data_url):
    if "," in data_url:
        data_url = data_url.split(",", 1)[1]
    return base64.b64decode(data_url)


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
        with open(os.path.join(job, f"page_{i+1:03d}.png"), "wb") as f:
            f.write(b64_to_bytes(data_url))

    env = os.environ.copy()
    env["PYTHONUTF8"] = "1"
    env["QT_QPA_PLATFORM_PLUGIN_PATH"] = os.path.join(
        BT_ROOT, "venv", "Lib", "site-packages", "PyQt6", "Qt6", "plugins"
    )

    cmd = [
        BT_PY, "-m", "ballontranslator", "--headless", "--exec_dirs", job
    ]
    proc = subprocess.run(cmd, cwd=BT_ROOT, env=env, input="exit\n",
                          capture_output=True, text=True, timeout=1800)

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