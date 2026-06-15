@echo off
title Build Portable EXE
cd /d "%~dp0"

echo ============================================================
echo   Kugou Music Downloader - Portable Build Script
echo   Builds a single .exe with API server + TUI downloader
echo ============================================================
echo.

node --version >nul 2>&1
if %errorlevel% neq 0 (
  echo [ERR] Node.js required: https://nodejs.org
  pause & exit /b 1
)

for /f "tokens=1 delims=." %%v in ('node --version') do set NODE_VER=%%v
set NODE_MAJOR=%NODE_VER:~1%
echo   Node.js v%NODE_MAJOR%.x
if %NODE_MAJOR% lss 18 (
  echo [ERR] Node.js 18+ required
  pause & exit /b 1
)

:: Install all dependencies (main + API)
echo [0/5] Installing dependencies...
call npm install

:: Copy yoga WASM loader (needed by esbuild bundle)
if not exist lib\yoga-wasm.cjs (
  echo   Copying yoga WASM loader...
  copy /Y node_modules\yoga-layout\binaries\wasm-sync-node.js lib\yoga-wasm.cjs >nul
)

:: Build everything
echo [1/5] Building...
node scripts\build.mjs
if %errorlevel% neq 0 (
  echo [ERR] Build failed.
  pause & exit /b 1
)

:: Package into zip
echo [2/5] Packaging kugou-download.zip...
if exist kugou-download.zip del kugou-download.zip
if exist dist\pkg rmdir /s /q dist\pkg
mkdir dist\pkg
copy /Y dist\api.exe dist\pkg\ >nul
copy /Y dist\download.exe dist\pkg\ >nul
xcopy /E /I /Q dist\public dist\pkg\public >nul
powershell -Command "Compress-Archive -Force -Path 'dist\pkg\*' -DestinationPath 'kugou-download.zip'"
if %errorlevel% neq 0 (
  echo [WARN] ZIP packaging failed. The .exe files are still in dist\
) else (
  echo   kugou-download.zip created
  rmdir /s /q dist\pkg
)

echo.
echo ============================================================
echo   Build Complete!
echo ============================================================
echo.
echo   kugou-download.zip   - Ready to distribute
echo.
echo   Extract both .exe files to the same folder and run download.exe.
echo   API server starts automatically on localhost:3000.
echo   Close the window to stop both.
echo.
pause
