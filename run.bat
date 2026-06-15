@echo off
title Kugou Music Downloader
cd /d "%~dp0"

:: Install project dependencies
if not exist node_modules\ (
  echo [INFO] Installing project dependencies...
  call npm install --no-audit --no-fund
)

:: Clone KuGouMusicApi if needed
if not exist KuGouMusicApi\package.json (
  echo [INFO] Cloning KuGouMusicApi...
  git clone https://github.com/MakcRe/KuGouMusicApi.git KuGouMusicApi
  if not exist KuGouMusicApi\package.json (
    echo [ERR] Clone failed. Check network or clone manually.
    pause
    exit /b 1
  )
)

:: Install API dependencies
if not exist KuGouMusicApi\node_modules\ (
  echo [INFO] Installing API dependencies...
  cd KuGouMusicApi
  call npm install --no-audit --no-fund
  cd ..
)

:: Configure lite platform
if not exist KuGouMusicApi\.env (
  echo platform=lite > KuGouMusicApi\.env
)

:: Clean stale API processes
echo [INFO] Cleaning stale API processes...
taskkill /FI "WINDOWTITLE eq KugouAPI*" /F /T >nul 2>nul
ping -n 2 127.0.0.1 >nul

:: Start API server
echo [INFO] Starting API server...
start "KugouAPI" /min cmd /c "cd /d "%~dp0KuGouMusicApi" && npm run dev"
echo [INFO] Waiting 3 seconds for API startup...
ping -n 3 127.0.0.1 >nul

:: Run downloader
echo [INFO] Running downloader...
node download.js %*

:: Cleanup
taskkill /FI "WINDOWTITLE eq KugouAPI*" /F /T >nul 2>nul
pause
