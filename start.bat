@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist backend\.venv (
  echo Python орчин суулгаж байна...
  python -m venv backend\.venv || goto :error
  backend\.venv\Scripts\pip install -r backend\requirements.txt || goto :error
)
if not exist frontend\dist (
  echo Frontend бүтээж байна...
  pushd frontend
  call npm install || goto :error
  call npm run build || goto :error
  popd
)

start "" http://localhost:8000
cd backend
.venv\Scripts\python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
goto :eof

:error
echo Алдаа гарлаа.
pause
