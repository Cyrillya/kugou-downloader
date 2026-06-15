@echo off
title Kugou Music Downloader
cd /d "%~dp0"

:: Install project dependencies
if not exist node_modules\ (
  echo [INFO] Installing project dependencies...
  call npm install --no-audit --no-fund
)

echo [INFO] Running downloader...
node download.js %*
pause
