@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ==========================================
echo   BiliBatch - Khoi dong tren may tinh
echo ==========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [LOI] Chua cai dat Node.js. Hay tai Node.js LTS tai: https://nodejs.org/
  pause
  exit /b 1
)

where ffmpeg >nul 2>&1
if errorlevel 1 (
  echo [CANH BAO] Chua tim thay ffmpeg trong PATH.
  echo Hay cai nhanh bang lenh: winget install Gyan.FFmpeg --source winget
  echo Sau do mo lai cua so nay.
  echo.
)

if not exist "node_modules" (
  echo Dang cai dat thu vien lan dau...
  call npm install --legacy-peer-deps
  if errorlevel 1 (
    echo [LOI] Khong the cai dat thu vien npm.
    pause
    exit /b 1
  )
)

rem --- Tu dong chuan bi moi truong Muse2API (127.0.0.1:18610) ---
if not exist "muse2api\app.py" goto after_muse2api_setup
if exist "muse2api\.venv\Scripts\python.exe" (
  "muse2api\.venv\Scripts\python.exe" -c "import fastapi, uvicorn, pydantic, requests, websocket" >nul 2>&1
  if not errorlevel 1 goto after_muse2api_setup
  echo [Muse2API] Phat hien thieu thu vien trong .venv, dang cai dat bo sung...
  "muse2api\.venv\Scripts\python.exe" -m pip install -r "muse2api\requirements.txt"
  goto after_muse2api_setup
)

set "PY_CMD="
python --version >nul 2>&1
if not errorlevel 1 set "PY_CMD=python"
if defined PY_CMD goto setup_muse2api_venv
py -3 --version >nul 2>&1
if not errorlevel 1 set "PY_CMD=py -3"
if defined PY_CMD goto setup_muse2api_venv

docker info >nul 2>&1
if not errorlevel 1 (
  echo [Muse2API] Dang khoi chay Muse2API qua Docker Compose...
  docker compose -f "muse2api\docker-compose.yml" up -d
)
goto after_muse2api_setup

:setup_muse2api_venv
echo [Muse2API] Dang tao moi truong ao muse2api\.venv lan dau...
%PY_CMD% -m venv "muse2api\.venv"
if exist "muse2api\.venv\Scripts\python.exe" (
  echo [Muse2API] Dang cai dat thu vien Muse2API...
  "muse2api\.venv\Scripts\python.exe" -m pip install --upgrade pip >nul 2>&1
  "muse2api\.venv\Scripts\python.exe" -m pip install -r "muse2api\requirements.txt"
)

:after_muse2api_setup

set "BILIBATCH_SUPERVISOR=1"
set "OPENED_BROWSER="

:run_server
echo Dang khoi dong may chu tai http://localhost:3000 ^(va tu dong bat Muse2API 127.0.0.1:18610^)...
if "%OPENED_BROWSER%"=="" (
  set "OPENED_BROWSER=1"
  start "" http://localhost:3000
)
call npm run dev
if errorlevel 42 if not errorlevel 43 (
  echo.
  echo [CAP NHAT] Dang khoi dong lai may chu voi phien ban moi...
  echo.
  timeout /t 1 /nobreak >nul
  goto run_server
)
pause
