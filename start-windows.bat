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

set "BILIBATCH_SUPERVISOR=1"
set "OPENED_BROWSER="

:run_server
echo Dang khoi dong may chu tai http://localhost:3000 ...
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
