@echo off
title Kugou Music Downloader (JS only)
cd /d "%~dp0"

:: ── 自动安装依赖 ────────────────────────────────────
if not exist node_modules\ (
  echo [INFO] Installing project dependencies...
  call npm install --no-audit --no-fund
)

echo [INFO] Running download script...
node download.js %*
pause
