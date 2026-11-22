@echo off
set PYTHONUTF8=1
cd /d "%~dp0"
".\venv\Scripts\python.exe" "backend_server.py"
pause