@echo off
title Kugou Music Downloader
cd /d "%~dp0"

:: ── 自动安装依赖 ────────────────────────────────────
if not exist node_modules\ (
  echo [INFO] Installing project dependencies...
  call npm install --no-audit --no-fund
)

:: ── 自动克隆 KuGouMusicApi ────────────────────────
if not exist KuGouMusicApi\package.json (
  echo [INFO] Cloning KuGouMusicApi...
  git clone https://github.com/MakcRe/KuGouMusicApi.git KuGouMusicApi
  if not exist KuGouMusicApi\package.json (
    echo [ERR] Clone failed. Check network or clone manually.
    pause
    exit /b 1
  )
)

:: ── 自动安装 API 依赖 ──────────────────────────────
if not exist KuGouMusicApi\node_modules\ (
  echo [INFO] Installing API dependencies...
  cd KuGouMusicApi
  call npm install --no-audit --no-fund
  cd ..
)

:: ── 自动配置概念版 ─────────────────────────────────
if not exist KuGouMusicApi\.env (
  echo platform=lite > KuGouMusicApi\.env
)

:: ── 清理残留的 API 进程 ────────────────────────────
echo [INFO] Cleaning stale API processes...
taskkill /FI "WINDOWTITLE eq KugouAPI*" /F /T >nul 2>nul
ping -n 2 127.0.0.1 >nul

:: ── 启动 API 服务 ──────────────────────────────────
echo [INFO] Starting API server...
start "KugouAPI" /min cmd /c "cd /d "%~dp0KuGouMusicApi" && npm run dev"
echo [INFO] Waiting 8 seconds for API startup...
ping -n 8 127.0.0.1 >nul

:: ── 运行下载器 ────────────────────────────────────
echo [INFO] Running download script...
node download.js %*
pause
